/**
 * Provider tests: configuration defaults, load-time enforcement, and the
 * start-time contract the subagent service depends on.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply, Config } from '../index.js'

/** A context stub that records the provider it is handed. */
function fakeContext() {
  const registered = []
  return {
    registered,
    logger: { warn() {} },
    subagents: { registerProvider: (provider) => { registered.push(provider) } },
    subprocess: {
      spawn() { throw new Error('spawn should not be reached in these tests') },
      async resolveExecutable() { throw new Error('resolve should not be reached') },
    },
  }
}

/** Resolve Config the way the loader does, then apply it. */
function mount(overrides = {}) {
  const ctx = fakeContext()
  const config = Config(overrides)
  apply(ctx, config)
  return { ctx, provider: ctx.registered[0] }
}

test('the default configuration registers the opencode provider', () => {
  const { ctx, provider } = mount()
  assert.equal(ctx.registered.length, 1)
  assert.equal(provider.name, 'opencode')
})

test('the provider advertises no start-time capabilities', () => {
  const { provider } = mount()
  assert.deepEqual(provider.capabilities, {
    agentOptions: false,
    agentPreset: false,
    outputSchema: false,
    depthLimit: false,
  })
  assert.equal(provider.inheritsParentContext, false)
})

test('providerName renames the registry entry', () => {
  const { provider } = mount({ providerName: 'oc' })
  assert.equal(provider.name, 'oc')
})

test('an empty require list mounts without any OpenCode configuration', () => {
  assert.doesNotThrow(() => mount({ requirements: { require: [] } }))
})

test('a required credential missing at load fails the plugin mount', () => {
  assert.throws(
    () => mount({ requirements: { require: ['credentials'], credentials: ['DSH_TEST_ABSENT_KEY'] } }),
    /required configuration is missing: DSH_TEST_ABSENT_KEY is not set/,
  )
})

test('a required model that is malformed fails the plugin mount', () => {
  assert.throws(
    () => mount({ requirements: { require: ['model'], model: 'not-a-model' } }),
    /must look like "provider\/model"/,
  )
})

test('a required auth gate fails when the configured home has no store', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-subagent-opencode-mount-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  assert.throws(
    () => mount({ requirements: { require: ['auth'], home } }),
    /OpenCode has no stored credentials/,
  )
})

test('an unknown gate is rejected by the schema before the plugin loads', () => {
  // schemastery narrows `require` to the known gates, so a typo never reaches
  // assertRequirements; that helper still guards direct callers.
  assert.throws(
    () => mount({ requirements: { require: ['nope'] } }),
    /expected "auth" \| "credentials" \| "model"/,
  )
})

test('a non-positive process grace is rejected at load', () => {
  assert.throws(() => mount({ disposeGraceMs: 0 }), /disposeGraceMs must be a positive finite number/)
  assert.throws(() => mount({ disposeGraceMs: Number.POSITIVE_INFINITY }), /disposeGraceMs/)
})

test('start rejects before spawning when a credential disappears after load', async () => {
  const name = 'DSH_TEST_LATE_KEY'
  process.env[name] = 'set-at-mount'
  const { provider } = mount({ requirements: { require: ['credentials'], credentials: [name] } })
  delete process.env[name]
  await assert.rejects(
    provider.start({
      prompt: [{ type: 'text', text: 'hi' }],
      cwd: process.cwd(),
      signal: new AbortController().signal,
    }),
    new RegExp(`required configuration is missing: ${name}`),
  )
})
