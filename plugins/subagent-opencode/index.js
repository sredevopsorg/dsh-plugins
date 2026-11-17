/**
 * Profile-named OpenCode subagent provider.
 *
 * Registers one external `SubagentProvider` on `ctx.subagents`. Every accepted
 * run starts a fresh `opencode acp` child in the delegating Session's working
 * directory and returns only its final text; the child's own session, model,
 * tools, and credentials never cross into the parent conversation.
 *
 * The `requirements` config declares which OpenCode configuration is mandatory,
 * fails the plugin load when it is statically missing, relays the declared
 * environment into the child the seam would otherwise scrub, and — when a
 * profile opts in — installs the OpenCode CLI the command does not resolve.
 *
 * @module @sredevopsorg/dsh-subagent-opencode
 */

import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { cwd } from 'node:process'
import { loadSchemastery } from './sdk.js'
import { startOpenCodeRun } from './acp.js'
import {
  assertLoadTimeRequirements,
  assertPositiveGrace,
  requirementFailures,
  relayEnv,
} from './requirements.js'
import {
  assertInstallPolicy,
  defaultInstallDir,
  hostPlatformPackage,
  installOpenCode,
  knownInstall,
  withExecutableOnPath,
} from './install.js'

export const name = 'subagent-opencode'
export const inject = ['subagents', 'subprocess']

const DEFAULT_PROVIDER_NAME = 'opencode'
const DEFAULT_COMMAND = 'opencode'
const DEFAULT_DISPOSE_GRACE_MS = 3_000
const DEFAULT_PASS_ENV = ['OPENCODE_*', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'HOME']
const DEFAULT_INSTALL_MANAGER = 'pnpm'
const DEFAULT_INSTALL_TIMEOUT_MS = 300_000

/** The `schemastery` builder, used to declare {@link Config}. */
const z = await loadSchemastery()

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
    /** Mandatory gates: `auth`, `credentials`, `model`, `install`. Empty disables enforcement. */
    require: z.array(z.union(['auth', 'credentials', 'model', 'install'])).default([]),
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
    /**
     * Install the OpenCode platform package when the configured command does
     * not resolve. Off by default: a delegation never downloads a program
     * unless the profile asked for it.
     */
    install: z.boolean().default(false),
    /** Package manager the explicit install drives; `none` refuses to install. */
    installManager: z.union(['pnpm', 'npm', 'none']).default(DEFAULT_INSTALL_MANAGER),
    /** Directory the explicit install writes to and is reused from (default: `<profile>/opencode`). */
    installDir: z.string(),
    /** Extra package-manager arguments, before the packages. */
    installArgs: z.array(z.string()).default([]),
    /** Bound on one explicit install run, in milliseconds. */
    installTimeoutMs: z.number().default(DEFAULT_INSTALL_TIMEOUT_MS),
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
    const config = this.config
    const aborted = () => new Error('subagent-opencode: the run was aborted')
    if (request.signal.aborted) throw aborted()

    const resolved = await this.resolveExecutable()
    const failures = requirementFailures(config.requirements, process.env, {
      commandMissing: resolved.executable === undefined,
    })
    if (failures.length > 0) throw new Error(failures.join('\n'))
    if (request.signal.aborted) throw aborted()

    let cwd
    try {
      cwd = assertUsableCwd(request.cwd)
    } catch (error) {
      this.ctx.logger.warn(`subagent-opencode "${this.name}": child cwd is unusable: ${error.message}`)
      throw error
    }

    const env = relayEnv({
      requirements: config.requirements,
      passEnv: config.passEnv,
      env: config.env,
      parentEnv: process.env,
    })
    const run = await startOpenCodeRun(request, {
      cwd,
      args: config.args,
      permission: config.permission,
      disposeGraceMs: config.disposeGraceMs,
      // An installed executable runs with its own directory first on `PATH`, so
      // it finds the helpers it ships. A resolved one keeps the configured env.
      env: resolved.install === true ? withExecutableOnPath(env, resolved.executable) : env,
      configOptions: {
        model: config.requirements.model,
        effort: config.requirements.effort,
        mode: config.requirements.mode,
      },
      // An install is addressed directly: its directory is not on `PATH`, so the
      // run must not look the command up again and fail on the executable it
      // just verified.
      resolveCommand: () => resolved.executable ?? resolveCommand(this.ctx, config.command),
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
    })
    return run
  }

  /**
   * Locate the OpenCode executable, installing it only when the profile allows it.
   *
   * An executable the host already provides is never replaced: the first
   * resolution that succeeds ends the search. Everything after that reads the
   * configured install directory, then installs once when the profile opted in.
   * @returns {Promise<{executable?: string, install: boolean}>} the executable found in the install directory, and whether the run should address it directly.
   */
  async resolveExecutable() {
    const config = this.config
    if (await resolves(this.ctx, config.command)) return { install: false }
    if (!namesOpenCode(config.command)) return { install: false }

    const manager = config.requirements.installManager
    const known = knownInstall(config.requirements.installDir)
    if (known !== undefined) return { executable: known, install: true }
    if (config.requirements.install !== true || manager === 'none') return { install: false }

    try {
      const executable = installOpenCode({
        manager,
        platform: hostPlatformPackage(),
        args: config.requirements.installArgs,
        dir: config.requirements.installDir,
        timeoutMs: config.requirements.installTimeoutMs,
      })
      this.ctx.logger.info(`subagent-opencode "${this.name}": installed OpenCode for ${process.platform}-${process.arch} in the configured install directory`)
      return { executable, install: true }
    } catch (error) {
      this.ctx.logger.warn(error.message)
      return { install: false }
    }
  }
}

/**
 * Whether a configured command names OpenCode itself.
 *
 * An explicit install provides `opencode` and nothing else, so a command that
 * names another program is left exactly as configured: installing would not
 * make it resolvable, and would download a program the profile never asked for.
 * @param {string} command - configured executable.
 * @returns {boolean} whether the command is `opencode`.
 */
function namesOpenCode(command) {
  if (typeof command !== 'string' || command === '') return false
  const name = command.split(/[/\\]/).pop() ?? ''
  return (process.platform === 'win32' ? name.replace(/\.exe$/i, '') : name) === 'opencode'
}

/**
 * Whether a configured executable resolves right now.
 *
 * A resolution failure is the only signal that an install may be needed, so it
 * is reported as a boolean and the run's own resolver still raises the coded
 * error that becomes the model-facing diagnostic.
 * @param {object} ctx - plugin context.
 * @param {string} command - configured executable.
 * @returns {Promise<boolean>} whether it resolved.
 */
async function resolves(ctx, command) {
  try {
    await resolveCommand(ctx, command)
    return true
  } catch {
    return false
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
  if (typeof command !== 'string' || command === '') {
    throw new Error('subagent-opencode: `command` must name the OpenCode executable')
  }
  if (command.includes('/') || command.includes('\\')) return command
  return ctx.subprocess.resolveExecutable(command)
}

/**
 * Assert that a child working directory is an absolute, existing directory.
 *
 * This mirrors `assertUsableCwd` from `@deepseek-ai/dsh-subagent`, but keeps
 * that package out of the module's load-time dependencies: only the DSH
 * runtime that calls {@link apply} needs it, so this cheap local check is
 * enough to fail a bad request early.
 * @param {string} cwd - resolved working directory.
 * @returns {string} the validated directory.
 */
function assertUsableCwd(cwd) {
  if (typeof cwd !== 'string' || cwd === '' || !isAbsolute(cwd)) {
    throw new Error(`subagent-opencode: child cwd must be an absolute path; received ${JSON.stringify(cwd)}`)
  }
  let stats
  try {
    stats = statSync(cwd)
  } catch {
    throw new Error('subagent-opencode: child cwd does not exist')
  }
  if (!stats.isDirectory()) throw new Error('subagent-opencode: child cwd is not a directory')
  return cwd
}

/**
 * Register one profile-named OpenCode provider.
 * @param {object} ctx - context carrying the shared subagent and subprocess services.
 * @param {object} config - resolved plugin configuration.
 */
export function apply(ctx, config) {
  const requirements = resolvedRequirements(config.requirements ?? {})
  assertPositiveGrace('disposeGraceMs', config.disposeGraceMs)
  assertInstallPolicy({
    manager: requirements.installManager,
    timeoutMs: requirements.installTimeoutMs,
  })
  assertLoadTimeRequirements(requirements, process.env)

  ctx.subagents.registerProvider(new OpenCodeProvider(
    config.providerName ?? DEFAULT_PROVIDER_NAME,
    ctx,
    {
      command: config.command ?? DEFAULT_COMMAND,
      args: config.args ?? ['acp'],
      permission: config.permission ?? 'reject',
      passEnv: config.passEnv ?? [...DEFAULT_PASS_ENV],
      env: config.env ?? {},
      disposeGraceMs: config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
      installDir: defaultInstallDir(requirements.installDir, isDirectory(config.profileDir) ? config.profileDir : cwd()),
      requirements,
    },
  ))
}

/**
 * Fill the requirement defaults the loader may leave unset.
 *
 * Config schemas run before a plugin mounts, but a deployment can also hand
 * `apply` a plain object. Keeping the defaults in one place means an explicit
 * install is off unless something asked for it, whichever way it arrived.
 * @param {object} requirements - configured requirement block.
 * @returns {object} the same block with every install field defined.
 */
function resolvedRequirements(requirements) {
  return {
    ...requirements,
    install: requirements.install === true,
    installManager: requirements.installManager ?? DEFAULT_INSTALL_MANAGER,
    installArgs: requirements.installArgs ?? [],
    installTimeoutMs: requirements.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
  }
}

/**
 * Whether a value names an existing directory.
 * @param {unknown} value - candidate path.
 * @returns {boolean} whether it is a directory.
 */
function isDirectory(value) {
  if (typeof value !== 'string' || value === '') return false
  try {
    return statSync(value).isDirectory()
  } catch {
    return false
  }
}
