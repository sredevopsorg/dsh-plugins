/**
 * Auto-continue contract tests: the turn-ending trigger, the preset filter, the
 * queued human prompt, and the rolling guard that stops runaway continuation.
 *
 * The tests drive `apply()` through a fake Cordis context, so they need no DSH
 * runtime, no OpenCode install, and no network.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_CONFIG,
  apply,
  continuationMessage,
  normalizeConfig,
  pruneAttempts,
} from '../auto-continue.js'

/**
 * Build a fake host around the plugin.
 * @param {object} [config] - the row config.
 */
function harness(config) {
  /** @type {Map<string, Function[]>} */
  const listeners = new Map()
  const followups = []
  const warnings = []
  const agents = new Map()
  const ctx = {
    agents: { get: (id) => agents.get(id) },
    get(name) {
      if (name !== 'agentPresets') return undefined
      return { presetForSession: (session) => session.preset ?? session.header?.agentPreset ?? null }
    },
    logger: { warn: (message) => warnings.push(message) },
    on(name, listener) {
      const registered = listeners.get(name) ?? []
      registered.push(listener)
      listeners.set(name, registered)
    },
  }
  apply(ctx, config)

  /**
   * Add a live agent running one preset.
   * @param {string} presetId - preset the session runs.
   * @param {{pending?: boolean, failFollowup?: boolean}} [options] - inbox and queue behavior.
   */
  function addAgent(presetId = DEFAULT_CONFIG.presetId, options = {}) {
    const session = {
      id: `session-${agents.size + 1}`,
      preset: presetId,
      header: { agentPreset: presetId },
    }
    const agent = {
      id: session.id,
      session,
      inbox: { hasPending: options.pending === true },
      followup(message) {
        if (options.failFollowup === true) throw new Error('inbox closed')
        followups.push(message)
      },
    }
    agents.set(agent.id, agent)
    return agent
  }

  /** Dispatch one host event to the plugin's listeners. */
  function emit(name, ...args) {
    for (const listener of listeners.get(name) ?? []) listener(...args)
  }

  /** End one turn with the given reason, then let the agent settle. */
  function endTurn(agent, kind = 'max-tokens') {
    emit('session/event', agent.session, { type: 'turn/end', data: { reason: { kind } } })
    emit('agent/status', { agent, status: 'idle' })
  }

  return { addAgent, emit, endTurn, followups, warnings }
}

test('a max-tokens turn end queues one continue prompt when idle', () => {
  const host = harness()
  const agent = host.addAgent()

  host.endTurn(agent)

  assert.equal(host.followups.length, 1)
  const [message] = host.followups
  assert.equal(message.role, 'user')
  assert.deepEqual(message.content, [{ type: 'text', text: 'continue' }])
  assert.deepEqual(message.source, { kind: 'user' })
  assert.equal(typeof message.id, 'string')
  assert.ok(message.id.length > 0)
})

test('the continuation waits for idle instead of queueing inside the turn-end event', () => {
  const host = harness()
  const agent = host.addAgent()

  host.emit('session/event', agent.session, {
    type: 'turn/end',
    data: { reason: { kind: 'max-tokens' } },
  })
  assert.equal(host.followups.length, 0, 'the session is still publishing its own append')

  host.emit('agent/status', { agent, status: 'idle' })
  assert.equal(host.followups.length, 1)
})

test('a completed or errored turn never continues', () => {
  const host = harness()
  const agent = host.addAgent()

  host.endTurn(agent, 'stop')
  host.endTurn(agent, 'error')
  host.endTurn(agent, 'aborted')

  assert.equal(host.followups.length, 0)
})

test('sessions of another preset are ignored', () => {
  const host = harness()
  const agent = host.addAgent('standard')

  host.endTurn(agent)

  assert.equal(host.followups.length, 0)
})

test('a human prompt queued during the cut-off turn wins', () => {
  const host = harness()
  const agent = host.addAgent(DEFAULT_CONFIG.presetId, { pending: true })

  host.endTurn(agent)

  assert.equal(host.followups.length, 0)
})

test('a turn that opens before idle consumes the pending continuation', () => {
  const host = harness()
  const agent = host.addAgent()

  // The cutoff turn ends, but the loop immediately opens the next turn from a
  // queued human prompt, so no idle transition follows.
  host.emit('session/event', agent.session, {
    type: 'turn/end',
    data: { reason: { kind: 'max-tokens' } },
  })
  host.emit('session/event', agent.session, { type: 'turn/start', data: { turn: 2 } })
  host.emit('agent/status', { agent, status: 'idle' })

  assert.equal(host.followups.length, 0)
})

test('an agent error clears a pending continuation', () => {
  const host = harness()
  const agent = host.addAgent()

  host.emit('session/event', agent.session, {
    type: 'turn/end',
    data: { reason: { kind: 'max-tokens' } },
  })
  host.emit('agent/error', { agent })
  host.emit('agent/status', { agent, status: 'idle' })

  assert.equal(host.followups.length, 0)
})

test('more than five continuations inside three minutes stop the loop', () => {
  const host = harness()
  const agent = host.addAgent()

  for (let index = 0; index < 6; index += 1) host.endTurn(agent)

  assert.equal(host.followups.length, 5, 'five continuations are allowed; the sixth is refused')
  assert.equal(host.warnings.length, 1)
  assert.match(host.warnings[0], /paused session/)
})

test('a failing queue write still counts toward the guard', () => {
  const host = harness()
  const agent = host.addAgent(DEFAULT_CONFIG.presetId, { failFollowup: true })

  for (let index = 0; index < 6; index += 1) host.endTurn(agent)

  assert.equal(host.followups.length, 0)
  assert.equal(host.warnings.filter((line) => line.includes('could not queue')).length, 5)
  assert.equal(host.warnings.filter((line) => line.includes('paused session')).length, 1)
})

test('a custom attempt budget and text are honored', () => {
  const host = harness({ maxAttempts: 2, text: 'go on' })
  const agent = host.addAgent()

  for (let index = 0; index < 3; index += 1) host.endTurn(agent)

  assert.equal(host.followups.length, 2)
  assert.deepEqual(host.followups[0].content, [{ type: 'text', text: 'go on' }])
})

test('pruneAttempts keeps only timestamps inside the rolling window', () => {
  const now = 1_000_000
  const attempts = [now - 180_001, now - 180_000, now - 60_000, now, now + 1]
  assert.deepEqual(pruneAttempts(attempts, now, 180_000), [now - 60_000, now])
})

test('normalizeConfig keeps valid overrides and falls back on invalid ones', () => {
  assert.deepEqual(normalizeConfig(undefined), DEFAULT_CONFIG)
  assert.deepEqual(normalizeConfig({ presetId: '  opencode  ', text: '', maxAttempts: 0, windowMs: -1 }), {
    ...DEFAULT_CONFIG,
    presetId: 'opencode',
  })
  assert.deepEqual(normalizeConfig({ presetId: 'other', text: 'resume', maxAttempts: 3, windowMs: 1000 }), {
    presetId: 'other',
    text: 'resume',
    maxAttempts: 3,
    windowMs: 1000,
  })
})

test('continuationMessage carries a fresh identity per message', () => {
  const first = continuationMessage('continue')
  const second = continuationMessage('continue')
  assert.notEqual(first.id, second.id)
  assert.equal(first.role, 'user')
})
