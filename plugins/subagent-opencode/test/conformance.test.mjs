/**
 * Conformance tests: the provider-name check that tells a preset's owner why a
 * `subagent_opencode` tool has no provider behind it.
 *
 * These run without DSH, without OpenCode, and without network.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apply,
  DEFAULT_CONFIG,
  inspectProviders,
  missingProviderDiagnostic,
  normalizeConfig,
  providerAvailable,
} from '../conformance.js'

/** A context registering the given provider names in-process. */
function contextWith(registered = [], warnings = []) {
  const providers = new Map(registered.map((name) => [name, { name }]))
  return {
    warnings,
    logger: { warn: (line) => warnings.push(line) },
    // No `ready` event: the check reports immediately from what exists.
    subagents: { getProvider: (name) => providers.get(name) },
    get: () => undefined,
  }
}

/** Wait for a microtask turn so `apply`'s promise settles. */
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('a registered provider reports nothing', () => {
  const ctx = contextWith(['opencode-preset'])
  assert.deepEqual(inspectProviders(ctx, normalizeConfig({ providers: ['opencode-preset'] })), [])
})

test('a declared external provider counts as registered', () => {
  const ctx = contextWith([])
  const config = normalizeConfig({ providers: ['opencode'], providerNames: ['opencode'] })
  assert.deepEqual(inspectProviders(ctx, config), [])
})

test('an unbacked provider reports one fixed diagnostic', () => {
  const ctx = contextWith([])
  const [diagnostic] = inspectProviders(ctx, normalizeConfig({ providers: ['opencode-preset'] }))
  assert.match(diagnostic, /provider "opencode-preset" is not registered/)
  assert.match(diagnostic, /subagent_opencode/)
  assert.match(diagnostic, /permission: session/)
  assert.match(diagnostic, /providerName: opencode-preset/)
})

test('every default provider is checked', () => {
  assert.deepEqual([...DEFAULT_CONFIG.providers], ['opencode-preset', 'opencode'])
  const ctx = contextWith(['opencode'])
  const diagnostics = inspectProviders(ctx, normalizeConfig(undefined))
  assert.equal(diagnostics.length, 1, 'only the missing one is reported')
  assert.match(diagnostics[0], /"opencode-preset"/)
})

test('an explicit empty list turns the check off', () => {
  assert.deepEqual(normalizeConfig({ providers: [] }).providers, [])
  assert.deepEqual(inspectProviders(contextWith([]), normalizeConfig({ providers: [] })), [])
})

test('an invalid or missing config falls back to the defaults', () => {
  assert.deepEqual(normalizeConfig(null), {
    providers: [...DEFAULT_CONFIG.providers],
    providerNames: [],
    timeoutMs: DEFAULT_CONFIG.timeoutMs,
  })
  assert.deepEqual(normalizeConfig({ providers: ['', '  ', 3], timeoutMs: -1 }), {
    providers: [],
    providerNames: [],
    timeoutMs: DEFAULT_CONFIG.timeoutMs,
  })
})

test('a provider lookup that throws counts as unbacked', () => {
  const ctx = {
    subagents: {
      getProvider() {
        throw new Error('service unavailable')
      },
    },
  }
  assert.equal(providerAvailable(ctx, 'opencode', []), false)
})

test('the diagnostic names the provider and never a credential or path', () => {
  const line = missingProviderDiagnostic('opencode')
  assert.match(line, /provider "opencode" is not registered/)
  assert.doesNotMatch(line, /API_KEY|token|secret/)
})

test('apply reports through the logger once the host composition settles', async () => {
  const warnings = []
  const ctx = contextWith([], warnings)
  apply(ctx, { providers: ['opencode-preset'] })
  await flush()
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /provider "opencode-preset" is not registered/)
})

test('apply reports nothing when the provider is registered', async () => {
  const warnings = []
  const ctx = contextWith(['opencode-preset'], warnings)
  apply(ctx, { providers: ['opencode-preset'] })
  await flush()
  assert.deepEqual(warnings, [])
})

test('a host that emits ready is honored before the check runs', async () => {
  const warnings = []
  let release
  const ctx = {
    ...contextWith([], warnings),
    parallel: (name) => {
      assert.equal(name, 'ready')
      return new Promise((resolve) => { release = resolve })
    },
  }
  apply(ctx, { providers: ['opencode-preset'], timeoutMs: 5000 })
  await flush()
  assert.equal(warnings.length, 0, 'the check waits for ready')
  release()
  await flush()
  await flush()
  assert.equal(warnings.length, 1)
})

test('a host that never emits ready still reports within the timeout', async () => {
  const warnings = []
  const ctx = { ...contextWith([], warnings), parallel: () => new Promise(() => {}) }
  apply(ctx, { providers: ['opencode-preset'], timeoutMs: 20 })
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(warnings.length, 1)
})
