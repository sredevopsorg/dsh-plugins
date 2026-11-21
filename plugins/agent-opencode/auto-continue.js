/**
 * `@sredevopsorg/dsh-agent-opencode/auto-continue` — finish an OpenCode-preset
 * reply that the model's output token limit cut off.
 *
 * The Web chat renders "Output token limit reached … Send \"continue\" to let
 * the model resume." from the turn's end reason, not from any session text. This
 * plugin listens for that reason (`turn/end` with `reason.kind === 'max-tokens'`)
 * and queues the same `continue` prompt a human would type, once the agent is
 * idle again. Reacting to the reason instead of the rendered sentence keeps the
 * behavior working in every locale and in surfaces that render it differently.
 *
 * A run stops when a turn ends for any other reason (the reply completed) or
 * when the rolling guard trips: more than `maxAttempts` automatic continuations
 * within `windowMs`. The guard is what keeps a model that only ever emits
 * cutoff-length replies from looping forever; the queued `continue` messages are
 * ordinary user messages, so the log states exactly what happened.
 *
 * `requireChildPrompt` narrows the trigger to the orchestrator's own reply. The
 * preset delegates, so a turn that consumed a tool result ends with the child's
 * stop reason instead; that reason is already in the completion notice, and
 * continuing it would repeat the delegation. The switch is off by default so a
 * profile that only wants the historical behavior is unaffected.
 *
 * The row is installed by this bundle at the host level and scopes itself to the
 * declared preset id, because `session/event` listeners are realm-wide: a preset
 * plugin receives every session's events, so the filter is explicit here.
 *
 * @module @sredevopsorg/dsh-agent-opencode/auto-continue
 */

import { randomUUID } from 'node:crypto'

/** Cordis plugin name. */
export const name = 'auto-continue'

/** Services required to observe agents and their sessions. */
export const inject = ['agents']

/** Defaults applied to a row that declares no `config`. */
export const DEFAULT_CONFIG = Object.freeze({
  /** Preset whose sessions this watcher serves. */
  presetId: 'opencode',
  /** Exact text sent as the continuing user message. */
  text: 'continue',
  /** Automatic continuations allowed inside one rolling window. */
  maxAttempts: 5,
  /** Length of the rolling window in milliseconds (3 minutes). */
  windowMs: 3 * 60 * 1000,
  /**
   * Only continue when the cut-off belongs to the orchestrator's own answer.
   *
   * A one-shot child also ends its turn with `max-tokens` when its own provider
   * caps output. That stop reason reaches the orchestrator in the completion
   * notice, so queueing `continue` for it would pay for a second, redundant
   * delegation. The cut-off turn's last model-visible event tells the two
   * apart: a `tool`-role result there means the turn consumed the child's
   * result. A host that exposes no surface keeps the historical behavior.
   */
  requireChildPrompt: false,
})

/**
 * Merge a row's `config` with {@link DEFAULT_CONFIG}.
 *
 * The plugin deliberately exports no `schemastery` Config: a Git-installed
 * bundle must not resolve `@deepseek-ai/*` packages, and this repository keeps
 * such plugins dependency-free. Invalid or missing values fall back to the
 * default instead of failing the row, so a stale profile patch keeps working.
 *
 * @param {unknown} raw - the row's config, or undefined.
 * @returns {{presetId: string, text: string, maxAttempts: number, windowMs: number, requireChildPrompt: boolean}} resolved config.
 */
export function normalizeConfig(raw) {
  const config = { ...DEFAULT_CONFIG }
  if (raw === null || typeof raw !== 'object') return config
  const record = /** @type {Record<string, unknown>} */ (raw)
  if (typeof record.presetId === 'string' && record.presetId.trim() !== '') {
    config.presetId = record.presetId.trim()
  }
  if (typeof record.text === 'string' && record.text.trim() !== '') config.text = record.text
  if (Number.isSafeInteger(record.maxAttempts) && record.maxAttempts > 0) {
    config.maxAttempts = record.maxAttempts
  }
  if (Number.isSafeInteger(record.windowMs) && record.windowMs > 0) config.windowMs = record.windowMs
  if (typeof record.requireChildPrompt === 'boolean') config.requireChildPrompt = record.requireChildPrompt
  return config
}

/**
 * Drop attempts outside the rolling window.
 * @param {number[]} attempts - continuation timestamps, oldest first.
 * @param {number} now - current epoch milliseconds.
 * @param {number} windowMs - window length in milliseconds.
 * @returns {number[]} the attempts still inside the window.
 */
export function pruneAttempts(attempts, now, windowMs) {
  const floor = now - windowMs
  return attempts.filter((at) => at > floor && at <= now)
}

/**
 * Build the user message that resumes a cut-off reply.
 * @param {string} text - the exact prompt text.
 * @returns {{id: string, role: 'user', content: Array<{type: 'text', text: string}>, source: {kind: 'user'}}} a complete `UserMessage`.
 */
export function continuationMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/**
 * Read the preset a session actually runs.
 *
 * The projection covers a preset selected while the session was still blank;
 * the creation header is the fallback when the registry is not mounted.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} session - the live session.
 * @returns {string | null} the recorded preset id.
 */
function presetOf(ctx, session) {
  const registry = ctx.get('agentPresets')
  if (registry !== undefined && typeof registry.presetForSession === 'function') {
    try {
      return registry.presetForSession(session)
    } catch {
      // Fall back to the creation header below.
    }
  }
  return session?.header?.agentPreset ?? null
}

/**
 * The last model-visible event of a session, when the host exposes the surface.
 *
 * DSH keeps the model-visible surface as event sequences; a session that does
 * not expose `surface.nodes` (or an older host) yields undefined, and the
 * caller falls back to the historical behavior.
 * @param {object} session - the session that ended the turn.
 * @returns {object | undefined} the last event.
 */
function lastSurfaceEvent(session) {
  const nodes = session?.surface?.nodes
  if (!Array.isArray(nodes) || nodes.length === 0) return undefined
  const seq = nodes[nodes.length - 1]
  try {
    return typeof session.eventAt === 'function' ? session.eventAt(seq) : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether a cut-off turn belongs to the orchestrator's own answer.
 *
 * A turn that consumed a tool result (this preset delegates, so the tool is
 * `subagent_opencode`) ends with the child's stop reason. The orchestrator is
 * told that reason in the completion notice; a `continue` message would pay
 * for a redundant delegation that the model did not ask for. The turn's last
 * model-visible event is the discriminator: a `tool`-role message there means
 * the turn is the delegation round, not a plain reply.
 *
 * An unreadable session is treated as a plain reply, so a host that does not
 * expose the log keeps the historical behavior instead of silently stopping
 * the loop.
 * @param {object} session - the session that ended the turn.
 * @returns {boolean} whether the turn is the orchestrator's own reply.
 */
export function isOwnReply(session) {
  try {
    const event = lastSurfaceEvent(session)
    if (event === undefined) return true
    // A tool result is appended with the `tool` role; every event type that
    // carries one names it `tool` in `data.message.role` or `data.role`.
    return event.data?.message?.role !== 'tool' && event.data?.role !== 'tool'
  } catch {
    return true
  }
}

/**
 * Track and answer output-limit turn endings.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {unknown} rawConfig - the row's `config`.
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  /** @type {Map<string, {attempts: number[], pending: boolean}>} */
  const states = new Map()

  /** Read or create the watcher state for one session. */
  function stateFor(sessionId) {
    let state = states.get(sessionId)
    if (state === undefined) {
      state = { attempts: [], pending: false }
      states.set(sessionId, state)
    }
    return state
  }

  /** Whether the agent is a live agent of the configured preset. */
  function targetAgent(agent) {
    return agent !== undefined && presetOf(ctx, agent.session) === config.presetId
  }

  /**
   * Queue the continuation for an idle agent unless the guard or a human wins.
   * @param {object} agent - the live agent.
   * @param {{attempts: number[], pending: boolean}} state - its watcher state.
   */
  function continueAgent(agent, state) {
    if (!targetAgent(agent)) return
    // A message queued during the cut-off turn is the human's answer; adding
    // `continue` as well would run it as a second prompt.
    if (agent.inbox.hasPending) return
    const now = Date.now()
    state.attempts = pruneAttempts(state.attempts, now, config.windowMs)
    if (state.attempts.length >= config.maxAttempts) {
      ctx.logger?.warn?.(
        `auto-continue: paused session "${agent.id}" after ${state.attempts.length} continuations ` +
          `within ${config.windowMs}ms; the rolling window must drain before the next continuation`,
      )
      return
    }
    state.attempts.push(now)
    try {
      agent.followup(continuationMessage(config.text))
    } catch (error) {
      // The attempt remains counted: a queue failure is exactly the kind of
      // repeated failure the guard exists to stop repeating.
      ctx.logger?.warn?.(`auto-continue: could not queue a continuation for session "${agent.id}": ${String(error)}`)
    }
  }

  ctx.on('session/event', (session, event) => {
    // A turn that opens before the cut-off agent went idle already consumed a
    // queued human prompt; the next turn is not ours to answer.
    if (event?.type === 'turn/start') {
      const state = states.get(session.id)
      if (state !== undefined) state.pending = false
      return
    }
    if (event?.type !== 'turn/end') return
    if (event.data?.reason?.kind !== 'max-tokens') return
    // A stop reason that belongs to a delegated child is already reported to
    // the orchestrator; continuing it would repeat the delegation.
    if (config.requireChildPrompt && !isOwnReply(session)) return
    const agent = ctx.agents.get(session.id)
    if (agent === undefined || agent.session !== session) return
    if (!targetAgent(agent)) return
    stateFor(session.id).pending = true
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    const state = states.get(agent.id)
    if (state === undefined || !state.pending) return
    state.pending = false
    continueAgent(agent, state)
  })

  ctx.on('agent/error', ({ agent }) => {
    const state = states.get(agent.id)
    if (state !== undefined) state.pending = false
  })

  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent.id)
  })
}
