/**
 * Profile-named OpenCode subagent provider.
 *
 * Registers one external `SubagentProvider` on `ctx.subagents`. Every accepted
 * run starts a fresh `opencode acp` child in the delegating Session's working
 * directory and returns only its final text; the child's own session, model,
 * tools, and credentials never cross into the parent conversation.
 *
 * The `requirements` config declares which OpenCode configuration is mandatory,
 * fails the plugin load when it is statically missing, and relays the declared
 * environment into the child the seam would otherwise scrub.
 *
 * @module @sredevopsorg/dsh-subagent-opencode
 */

import { loadFromDsh, loadSchemastery } from './sdk.js'
import { startOpenCodeRun } from './acp.js'
import {
  assertLoadTimeRequirements,
  assertPositiveGrace,
  requirementFailures,
  relayEnv,
} from './requirements.js'

export const name = 'subagent-opencode'
export const inject = ['subagents', 'subprocess']

const DEFAULT_PROVIDER_NAME = 'opencode'
const DEFAULT_COMMAND = 'opencode'
const DEFAULT_DISPOSE_GRACE_MS = 3_000
const DEFAULT_PASS_ENV = ['OPENCODE_*', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'HOME']

/** The `schemastery` builder and the `dsh-subagent` helpers, resolved from DSH. */
const z = await loadSchemastery()
const { assertUsableCwd } = await loadFromDsh(
  '@deepseek-ai/dsh-subagent',
  'this provider must run inside a DSH installation',
)

/** Deployment-owned provider, process, and required-configuration settings. */
export const Config = z.object({
  /** Provider name on `ctx.subagents` (default `opencode`). */
  providerName: z.string().default(DEFAULT_PROVIDER_NAME),
  /** OpenCode executable: a bare name resolved on `PATH`, or an absolute path. */
  command: z.string().default(DEFAULT_COMMAND),
  /** Arguments after the executable; `acp` is added when absent. */
  args: z.array(z.string()).default(['acp']),
  /** Auto-answer `session/request_permission` prompts: `reject` (default) or `allow`. */
  permission: z.union(['reject', 'allow']).default('reject'),
  /** Ambient names re-forwarded after the seam's credential scrub (exact or `PREFIX_*`). */
  passEnv: z.array(z.string()).default([...DEFAULT_PASS_ENV]),
  /** Explicit child environment layered last. */
  env: z.dict(z.string()).default({}),
  /** Grace in milliseconds before the child is terminated after its stdin closes. */
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  /** Required OpenCode configurations: declare, enforce, and relay. */
  requirements: z.object({
    /** Mandatory gates: `auth`, `credentials`, `model`. Empty disables enforcement. */
    require: z.array(z.union(['auth', 'credentials', 'model'])).default([]),
    /** Variable names whose parent values are relayed to the child; required ones must be set. */
    credentials: z.array(z.string()).default([]),
    /** OpenCode `provider/model` applied to each session. */
    model: z.string(),
    /** OpenCode agent id applied to each session. */
    mode: z.string(),
    /** Model variant applied to each session. */
    effort: z.string(),
    /** OpenCode home exported as `OPENCODE_HOME`. */
    home: z.string(),
    /** Literal child environment values. */
    env: z.dict(z.string()).default({}),
  }).default({}),
})

/**
 * The OpenCode provider. Advertises no start-time capabilities: an
 * out-of-process child cannot honor `agentOptions`, `agentPreset`,
 * `outputSchema`, or a numeric depth cap, and the service rejects a request
 * needing any of them instead of silently ignoring it.
 */
class OpenCodeProvider {
  capabilities = Object.freeze({
    agentOptions: false,
    agentPreset: false,
    outputSchema: false,
    depthLimit: false,
  })

  inheritsParentContext = false

  constructor(name, ctx, config) {
    this.name = name
    this.ctx = ctx
    this.config = config
  }

  /**
   * Start one OpenCode child.
   * @param {object} request - resolved start request from the subagent service.
   * @returns {Promise<object>} the published run handle.
   */
  async start(request) {
    const failures = request.signal.aborted
      ? []
      : requirementFailures(this.config.requirements, process.env)
    if (failures.length > 0) {
      throw new Error(failures.join('\n'))
    }
    let cwd
    try {
      cwd = assertUsableCwd('subagent-opencode', 'child cwd', request.cwd)
    } catch (error) {
      this.ctx.logger.warn(`subagent-opencode "${this.name}": child cwd is unusable: ${error.message}`)
      throw error
    }

    const config = this.config
    const run = await startOpenCodeRun(request, {
      cwd,
      args: config.args,
      permission: config.permission,
      disposeGraceMs: config.disposeGraceMs,
      env: relayEnv({
        requirements: config.requirements,
        passEnv: config.passEnv,
        env: config.env,
        parentEnv: process.env,
      }),
      configOptions: {
        model: config.requirements.model,
        effort: config.requirements.effort,
        mode: config.requirements.mode,
      },
      resolveCommand: () => resolveCommand(this.ctx, config.command),
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
    })
    return run
  }
}

/**
 * Resolve the configured executable to something the seam can spawn.
 *
 * A bare name goes through the seam's resolver, which searches `PATH` and
 * raises a coded "not found" the caller turns into an install hint. A value
 * containing a path separator is used as given, so an absolute path to a
 * pnpm-global `opencode` works even when that directory is not on `PATH`.
 * @param {object} ctx - plugin context.
 * @param {string} command - configured executable.
 * @returns {Promise<string>} the executable to spawn.
 */
async function resolveCommand(ctx, command) {
  if (command.includes('/') || command.includes('\\')) return command
  return ctx.subprocess.resolveExecutable(command)
}

/**
 * Register one profile-named OpenCode provider.
 * @param {object} ctx - context carrying the shared subagent and subprocess services.
 * @param {object} config - resolved plugin configuration.
 */
export function apply(ctx, config) {
  const requirements = config.requirements ?? {}
  assertPositiveGrace('disposeGraceMs', config.disposeGraceMs)
  assertLoadTimeRequirements(requirements, process.env)

  ctx.subagents.registerProvider(new OpenCodeProvider(
    config.providerName ?? DEFAULT_PROVIDER_NAME,
    ctx,
    {
      args: config.args ?? ['acp'],
      permission: config.permission ?? 'reject',
      passEnv: config.passEnv ?? [...DEFAULT_PASS_ENV],
      env: config.env ?? {},
      disposeGraceMs: config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
      requirements,
    },
  ))
}
