/**
 * Session-policy tests: how `permission: session` resolves and projects the
 * delegating session's approval policy.
 *
 * These run without DSH, without OpenCode, and without network.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SESSION_POLICY,
  describePolicy,
  POLICY_SOURCES,
  projectPolicy,
  resolveSessionPolicy,
  sessionOf,
  SESSION_POLICIES,
} from '../approval-policy.js'
import { Config, apply } from '../index.js'

/** A fake context exposing an approval service. */
function contextWith(approval) {
  return { get: (name) => (name === 'approval' ? approval : undefined) }
}

/** A start request carrying one delegating session. */
function request(session = { id: 'ses_parent' }) {
  return {
    prompt: [{ type: 'text', text: 'hi' }],
    cwd: process.cwd(),
    signal: new AbortController().signal,
    agent: { id: 'lead', session },
  }
}

test('the known session policies and sources stay closed vocabularies', () => {
  assert.deepEqual([...SESSION_POLICIES], ['ask', 'never'])
  assert.deepEqual([...POLICY_SOURCES], ['session', 'default', 'fallback'])
  assert.equal(DEFAULT_SESSION_POLICY, 'ask')
})

test('the delegating session is read from the request agent', () => {
  const session = { id: 'ses_1' }
  assert.equal(sessionOf(request(session)), session)
  assert.equal(sessionOf({ session }), session, 'a bare session is accepted')
  assert.equal(sessionOf({}), undefined)
  assert.equal(sessionOf(undefined), undefined)
})

test('a recorded never override refuses every permission prompt', () => {
  const ctx = contextWith({
    overrideOf: () => 'never',
    config: { policy: 'ask' },
  })
  assert.deepEqual(resolveSessionPolicy(ctx, request()), { policy: 'never', source: 'session' })
})

test('a recorded ask override keeps the profile policy', () => {
  const ctx = contextWith({ overrideOf: () => 'ask', config: { policy: 'never' } })
  assert.deepEqual(resolveSessionPolicy(ctx, request()), { policy: 'ask', source: 'session' })
})

test('no override falls back to the approval service default', () => {
  const ctx = contextWith({ overrideOf: () => undefined, config: { policy: 'never' } })
  assert.deepEqual(resolveSessionPolicy(ctx, request()), { policy: 'never', source: 'default' })
})

test('a missing session still reads the configured default', () => {
  const ctx = contextWith({ overrideOf: () => 'never', config: { policy: 'ask' } })
  assert.deepEqual(resolveSessionPolicy(ctx, { ...request(), agent: undefined }), {
    policy: 'ask',
    source: 'default',
  })
})

test('an absent approval service falls back to the documented default', () => {
  const ctx = contextWith(undefined)
  assert.deepEqual(resolveSessionPolicy(ctx, request()), { policy: 'ask', source: 'fallback' })
})

test('a throwing or promise-returning override degrades instead of failing', () => {
  const throwing = contextWith({
    overrideOf: () => {
      throw new Error('projection unavailable')
    },
  })
  assert.deepEqual(resolveSessionPolicy(throwing, request()), { policy: 'ask', source: 'fallback' })

  // A promise is a signature this module does not understand: it must not be
  // read as a policy, and the configured default still applies.
  const asPromise = contextWith({ overrideOf: async () => 'never' })
  assert.deepEqual(resolveSessionPolicy(asPromise, request()), { policy: 'ask', source: 'fallback' })
})

test('a rogue override value is ignored', () => {
  for (const rogue of ['allow', '', null, 42, ' NEVER ']) {
    const ctx = contextWith({ overrideOf: () => rogue, config: { policy: 'ask' } })
    assert.deepEqual(resolveSessionPolicy(ctx, request()), { policy: 'ask', source: 'default' }, String(rogue))
  }
})

test('a never session can only make the child stricter, never more permissive', () => {
  assert.equal(projectPolicy('reject', 'never'), 'reject')
  assert.equal(projectPolicy('allow', 'never'), 'reject')
  assert.equal(projectPolicy('allow', 'ask'), 'allow')
  assert.equal(projectPolicy('reject', 'ask'), 'reject')
})

test('permission session resolves an ask session to allow and never to reject', () => {
  // An ask session lets the out-of-process child proceed (it cannot ask a
  // human itself); a never session refuses regardless of the configured policy.
  assert.equal(projectPolicy('session', 'ask'), 'allow')
  assert.equal(projectPolicy('session', 'never'), 'reject')
  assert.equal(projectPolicy('reject', 'ask'), 'reject')
  assert.equal(projectPolicy('reject', 'never'), 'reject')
  assert.equal(projectPolicy('allow', 'ask'), 'allow')
  assert.equal(projectPolicy('allow', 'never'), 'reject')
})

test('the diagnostic line names the policy and its source, and nothing else', () => {
  const line = describePolicy('reject', { policy: 'never', source: 'session' })
  assert.match(line, /Permission policy: reject/)
  assert.match(line, /session approval policy never from session/)
  assert.match(line, /set `permission` to override it/)
})

test('permission session is the schema default and the other values survive', () => {
  assert.equal(Config({}).permission, 'session')
  assert.equal(Config({ permission: 'reject' }).permission, 'reject')
  assert.equal(Config({ permission: 'allow' }).permission, 'allow')
  assert.throws(() => Config({ permission: 'prompt' }), /expected "session" \| "reject" \| "allow"/)
})

test('a session-policy mount keeps the session value and registers one provider', () => {
  const registered = []
  const ctx = {
    get: (name) => (name === 'approval' ? { overrideOf: () => 'never', config: { policy: 'ask' } } : undefined),
    logger: { info() {}, warn() {} },
    subagents: { registerProvider: (provider) => registered.push(provider) },
    subprocess: { spawn() { throw new Error('spawn must not be reached') } },
  }
  apply(ctx, Config({}))
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'opencode')
  assert.equal(registered[0].config.permission, 'session')
})
