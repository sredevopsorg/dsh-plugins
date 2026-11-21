/**
 * One-shot OpenCode child over the Agent Client Protocol.
 *
 * Every run spawns `opencode acp` through the subprocess seam, which starts a
 * private OpenCode server inside that process: no shared background service is
 * contacted and no network port is opened. The run publishes only after the
 * ACP handshake, the new session, and the configured session options succeed,
 * so a misconfigured or unauthenticated child never reaches the parent.
 *
 * Teardown is cooperative and idempotent: ACP exits when its stdin closes, so
 * closing stdin is the documented shutdown; the process's own grace window and
 * the seam's managed-range termination are the backstop.
 *
 * @module @sredevopsorg/dsh-subagent-opencode/acp
 */

import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { describePolicy } from './approval-policy.js'
import { failureDiagnostic } from './requirements.js'
import { loadAcpSdk } from './sdk.js'

/** How many streamed tool-call titles the diagnostic trail retains. */
const MAX_TRAIL = 32

/** Fixed hint per failure category. Each line is static text. */
const HINTS = Object.freeze({
  install: 'Install OpenCode with `pnpm add -g --allow-build=@opencode/cli @opencode/cli`, or set `command` to its absolute path.',
  'auth-required': 'Run `opencode auth login` for the configured home before delegating.',
  configuration: 'Fix the `requirements` block in the profile patch; the message above names the missing item.',
})

/** A failure whose facts are safe to publish. */
export class OpenCodeFailure extends Error {
  /**
   * @param {{stage: string, category: string, hint?: string}} facts - closed-vocabulary facts.
   * @param {unknown} [cause] - internal cause kept off the message.
   */
  constructor(facts, cause) {
    super(`subagent-opencode: ${failureDiagnostic(facts)}`, cause === undefined ? undefined : { cause })
    this.name = 'OpenCodeFailure'
    this.facts = facts
  }
}

/**
 * Build the command line for a configured executable and argument list.
 *
 * A global `pnpm add -g` writes `opencode` outside the `PATH` of a GUI-launched
 * DSH, so callers may pass an absolute path; nothing here assumes a shell.
 * @param {string} command - executable name or path.
 * @param {readonly string[]} args - configured arguments, `acp` normalized in.
 * @returns {readonly string[]} the argv tail after the executable.
 */
export function acpArgs(args) {
  return args.includes('acp') ? [...args] : ['acp', ...args]
}

/**
 * Map an ACP terminal stop reason onto the seam's vocabulary.
 * @param {string} stopReason - ACP stop reason.
 * @returns {string} shared stop reason.
 */
export function mapStopReason(stopReason) {
  switch (stopReason) {
    case 'end_turn': return 'completed'
    case 'max_tokens': return 'max-tokens'
    case 'refusal': return 'refusal'
    case 'cancelled': return 'aborted'
    default: return 'error'
  }
}

/**
 * Recognize an ACP authentication failure across sdk shapes.
 * @param {unknown} error - rejected ACP call.
 * @returns {boolean} whether the agent demanded authentication.
 */
export function authRequired(error) {
  const code = error?.code ?? error?.cause?.code
  const message = typeof error?.message === 'string' ? error.message : ''
  return code === -32000 && /auth/i.test(message) || /auth_required|authentication required/i.test(message)
}

/**
 * Classify a rejected call into a safe category.
 * @param {unknown} error - rejected call.
 * @returns {'auth-required' | 'unknown'} safe category.
 */
function category(error) {
  return authRequired(error) ? 'auth-required' : 'unknown'
}

/** Collect assistant text and a bounded tool-call trail from session updates. */
class OutputCollector {
  #texts = []
  #trail = []
  #permissions = 0

  /**
   * Fold one `session/update` notification.
   * @param {object} update - ACP session update.
   */
  update(update) {
    switch (update?.sessionUpdate) {
      case 'agent_message_chunk': {
        const block = update.content
        if (block?.type === 'text' && typeof block.text === 'string') this.#texts.push(block.text)
        break
      }
      case 'tool_call':
      case 'tool_call_update': {
        const title = typeof update.title === 'string' ? update.title : update.kind
        if (typeof title === 'string' && title !== '') {
          this.#trail.push(title.slice(0, 120))
          if (this.#trail.length > MAX_TRAIL) this.#trail.shift()
        }
        break
      }
      default:
        // Plans, thoughts, usage, and command catalogs are not part of the answer.
        break
    }
  }

  /** Record one permission prompt answered by policy. */
  notePermission() {
    this.#permissions += 1
  }

  /** @returns {number} permission prompts answered. */
  get permissions() {
    return this.#permissions
  }

  /**
   * The child's final text, in stream order.
   * @returns {{type: 'text', text: string}[]} assistant text blocks.
   */
  output() {
    const text = this.#texts.join('')
    return text === '' ? [] : [{ type: 'text', text }]
  }

  /**
   * A diagnostic-only summary of the work the child attempted.
   * @returns {string | undefined} trail summary.
   */
  trail() {
    return this.#trail.length === 0 ? undefined : `Tools attempted: ${this.#trail.join(' > ')}`
  }
}

/**
 * Answer one permission request per the configured policy.
 * @param {object} params - ACP permission request.
 * @param {'reject' | 'allow'} policy - configured policy.
 * @returns {object} ACP permission response.
 */
export function permissionOutcome(params, policy) {
  const options = Array.isArray(params?.options) ? params.options : []
  const wanted = policy === 'allow' ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always']
  for (const kind of wanted) {
    const match = options.find(option => option.kind === kind)
    if (match !== undefined) return { outcome: { outcome: 'selected', optionId: match.optionId } }
  }
  return { outcome: { outcome: 'cancelled' } }
}

/**
 * Start one OpenCode child and publish it after the handshake succeeds.
 * @param {object} request - resolved subagent start request.
 * @param {object} spec - resolved run inputs and seam hooks.
 * @param {string} [spec.policy] - the ACP permission policy this run applies.
 * @param {string} [spec.policyNote] - the fixed policy line a permission diagnostic carries.
 * @returns {Promise<object>} the published run handle.
 */
export async function startOpenCodeRun(request, spec) {
  const texts = taskText(request.prompt)
  // `permission` stays the historical name for the policy; an explicit
  // `policy` lets a caller resolve it per run without renaming the option.
  const policy = spec.policy ?? spec.permission
  const policyNote = spec.policyNote ?? describePolicy(policy, { policy, source: 'configured' })
  if (request.signal.aborted) throw new OpenCodeFailure({ stage: 'initialize', category: 'unknown' })

  let executable
  try {
    executable = await spec.resolveCommand()
  } catch (error) {
    throw new OpenCodeFailure({ stage: 'install', category: 'unknown', hint: HINTS.install }, error)
  }

  let child
  try {
    child = spec.spawn({
      argv: [executable, ...acpArgs(spec.args)],
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
      graceMs: spec.disposeGraceMs,
      env: spec.env,
    })
  } catch (error) {
    throw new OpenCodeFailure({ stage: 'initialize', category: 'unknown' }, error)
  }

  const collector = new OutputCollector()
  const { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } =
    spec.sdk ?? await loadAcpSdk()
  const connection = new ClientSideConnection(
    () => ({
      async sessionUpdate({ update }) { collector.update(update) },
      async requestPermission(params) {
        collector.notePermission()
        return permissionOutcome(params, policy)
      },
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  )

  let childOutcome
  const processFailure = child.done.then(
    (outcome) => {
      childOutcome = outcome
      throw new OpenCodeFailure({ stage: 'process', category: 'process', outcome })
    },
    (error) => {
      throw new OpenCodeFailure({ stage: 'process', category: 'unknown' }, error)
    },
  )
  processFailure.catch(() => {})

  let disposed
  const teardown = () => {
    if (disposed !== undefined) return disposed
    disposed = (async () => {
      // ACP documents that the child exits when its stdin closes; the grace
      // window is its chance to flush, and termination is the backstop.
      try { child.stdin.end() } catch { /* stdin may already be closed by the child */ }
      await new Promise(resolve => setTimeout(resolve, Math.min(spec.disposeGraceMs, 50)))
      try { child.terminate() } catch { /* termination is advisory once the range is empty */ }
      try { await child.waitForExit() } catch { /* reported by child.done below */ }
      // Never let a child that ignores termination hang the run: the seam owns
      // its managed range, so an unresolved exit is reported, not awaited forever.
      await Promise.race([
        child.done.catch(() => {}),
        new Promise(resolve => setTimeout(resolve, spec.disposeGraceMs).unref?.()),
      ])
    })()
    return disposed
  }

  let stage = 'initialize'
  let sessionId
  try {
    await Promise.race([
      connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          // The client answers `session/request_permission` itself, by policy.
          // Advertising it lets an agent that consults client capabilities
          // route its prompts here instead of failing on an unknown capability.
          fs: { readTextFile: false, writeTextFile: false, sessionPermissionRequests: true },
          terminal: false,
        },
      }),
      processFailure,
    ])

    stage = 'session-new'
    const session = await Promise.race([
      connection.newSession({ cwd: spec.cwd, mcpServers: [] }),
      processFailure,
    ])
    sessionId = session.sessionId

    // Required configurations are applied before publication: a rejected model,
    // effort, or mode fails the start instead of silently running the default.
    stage = 'configure'
    for (const [configId, value] of Object.entries(spec.configOptions)) {
      if (value === undefined) continue
      await Promise.race([
        connection.setSessionConfigOption({ sessionId, configId, value }),
        processFailure,
      ])
    }
  } catch (error) {
    const facts = error instanceof OpenCodeFailure
      ? error.facts
      : { stage, category: category(error) }
    const failure = new OpenCodeFailure(facts, error)
    try {
      await teardown()
    } catch (cleanupError) {
      throw new AggregateError([failure, cleanupError], failure.message)
    }
    if (request.signal.aborted) throw new OpenCodeFailure({ stage, category: 'unknown' }, error)
    throw failure
  }

  const runAbort = new AbortController()
  const cancel = () => {
    if (runAbort.signal.aborted) return
    runAbort.abort()
    // `session/cancel` is advisory: the agent SHOULD answer the held prompt
    // with `cancelled`, but one that does not must not hang the run. The
    // aborted signal races the pending prompt below, so cancellation settles
    // locally and teardown ends the child.
    connection.cancel({ sessionId }).catch(() => {})
  }
  const onAbort = () => { cancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  /** Reject as soon as local cancellation is requested. */
  const whenCancelled = () => new Promise((_, reject) => {
    if (runAbort.signal.aborted) return reject(new Error('subagent-opencode: run cancelled'))
    runAbort.signal.addEventListener(
      'abort',
      () => reject(new Error('subagent-opencode: run cancelled')),
      { once: true },
    )
  })

  let diagnostic
  const result = (async () => {
    try {
      stage = 'prompt'
      const response = await Promise.race([
        connection.prompt({ sessionId, prompt: texts }),
        processFailure,
        whenCancelled(),
      ])
      const stopReason = mapStopReason(response.stopReason)
      if (stopReason === 'completed') return { output: collector.output(), stopReason }
      // A prompt that ended with permission prompts answered by policy is the
      // case the policy line explains: the child stopped because it could not
      // act, not because OpenCode failed.
      diagnostic = [
        failureDiagnostic({
          stage: 'prompt',
          category: stopReason === 'error' ? 'unknown' : stopReason,
          permissions: collector.permissions,
          outcome: childOutcome,
        }),
        collector.permissions > 0 ? policyNote : undefined,
      ].filter(line => line !== undefined).join('\n')
      return { output: collector.output(), stopReason, diagnostic }
    } catch (error) {
      if (runAbort.signal.aborted) {
        return { output: collector.output(), stopReason: 'aborted' }
      }
      const facts = error instanceof OpenCodeFailure
        ? error.facts
        : { stage, category: category(error) }
      const trail = collector.trail()
      diagnostic = [
        failureDiagnostic({ ...facts, permissions: collector.permissions }),
        HINTS[facts.category] ?? HINTS[facts.cause?.category],
        // The policy explains a child that stopped because it could not act,
        // which is otherwise easy to read as an OpenCode error.
        collector.permissions > 0 ? policyNote : undefined,
        trail,
      ].filter(line => line !== undefined).join('\n')
      return { output: collector.output(), stopReason: 'error', diagnostic }
    }
  })()

  return {
    id: randomUUID(),
    result,
    dispose() {
      request.signal.removeEventListener('abort', onAbort)
      cancel()
      return teardown()
    },
  }
}

/**
 * Preserve the one-shot task before it crosses the process boundary.
 * @param {readonly object[]} prompt - accepted task content.
 * @returns {{type: 'text', text: string}[]} ACP prompt blocks.
 */
export function taskText(prompt) {
  if (prompt.length === 0) {
    throw new Error('subagent-opencode: the one-shot task must contain only text blocks')
  }
  const blocks = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-opencode: the one-shot task must contain only text blocks')
    }
    blocks.push({ type: 'text', text: block.text })
  }
  if (blocks.every(block => block.text.trim() === '')) {
    throw new Error('subagent-opencode: the one-shot task must not be empty')
  }
  return blocks
}
