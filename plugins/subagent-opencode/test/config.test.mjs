/**
 * Required-configuration tests: declaration, enforcement, and relay.
 *
 * These run without OpenCode, without a child process, and without network.
 * Every assertion about a message also asserts that no secret value leaks.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertLoadTimeRequirements,
  assertModel,
  assertRequirements,
  authState,
  failureDiagnostic,
  RELAY_ORDER,
  relayEnv,
  REQUIREMENTS,
  requirementFailures,
} from '../requirements.js'

const SECRET = 'sk-do-not-leak-this-value'

/** Build a resolved requirement block with defaults. */
function requirements(overrides = {}) {
  return { require: [], credentials: [], env: {}, ...overrides }
}

/** Create a temporary home directory removed when the test ends. */
function tempHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-subagent-opencode-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}

test('an empty require list enforces nothing', () => {
  assert.deepEqual(requirementFailures(requirements(), {}), [])
  assert.doesNotThrow(() => assertLoadTimeRequirements(requirements(), {}))
})

for (const gate of REQUIREMENTS) {
  test(`require names the known gate ${gate}`, () => {
    assert.doesNotThrow(() => assertRequirements([gate]))
  })
}

test('an unknown gate is rejected with the accepted list', () => {
  assert.throws(
    () => assertRequirements(['everything']),
    new RegExp(`requirements\\.require accepts ${REQUIREMENTS.join(', ')}; found "everything"`),
  )
})

test('the install gate fails only when the command does not resolve', () => {
  const gated = requirements({ require: ['install'] })
  assert.deepEqual(requirementFailures(gated, {}), [], 'a resolvable command satisfies it')
  assert.deepEqual(requirementFailures(gated, {}, { commandMissing: false }), [])
  const failures = requirementFailures(gated, {}, { commandMissing: true })
  assert.equal(failures.length, 1)
  assert.match(
    failures[0],
    /the OpenCode command does not resolve; run `pnpm add -g --allow-build=@opencode\/cli @opencode\/cli`/,
  )
})

test('install paths are checked for shape, not existence', () => {
  assert.doesNotThrow(() => assertLoadTimeRequirements(requirements({ installDir: '/opt/opencode' }), {}))
  assert.throws(
    () => assertLoadTimeRequirements(requirements({ installDir: 'opencode' }), {}),
    /requirements\.installDir must be an absolute path/,
  )
  assert.throws(
    () => assertLoadTimeRequirements(requirements({ installBinDir: '' }), {}),
    /requirements\.installBinDir must be an absolute path/,
  )
})

test('a required credential that is unset fails and names only the variable', () => {
  const failures = requirementFailures(
    requirements({ require: ['credentials'], credentials: ['OPENAI_API_KEY'] }),
    { OPENAI_API_KEY: '' },
  )
  assert.equal(failures.length, 1)
  assert.match(failures[0], /required configuration is missing: OPENAI_API_KEY is not set in the parent environment/)
  assert.doesNotMatch(failures[0], new RegExp(SECRET))
})

test('a required credential that is set passes', () => {
  assert.deepEqual(
    requirementFailures(
      requirements({ require: ['credentials'], credentials: ['OPENAI_API_KEY'] }),
      { OPENAI_API_KEY: SECRET },
    ),
    [],
  )
})

test('several missing credentials are reported together, in declared order', () => {
  const failures = requirementFailures(
    requirements({ require: ['credentials'], credentials: ['B_KEY', 'A_KEY'] }),
    {},
  )
  assert.equal(failures.length, 1)
  assert.match(failures[0], /B_KEY, A_KEY are not set/)
})

test('a required model that is absent fails', () => {
  const failures = requirementFailures(requirements({ require: ['model'] }), {})
  assert.equal(failures.length, 1)
  assert.match(failures[0], /requirements\.model is not set/)
})

test('a model reference must be provider/model', () => {
  assert.doesNotThrow(() => assertModel('openai/gpt-5-codex'))
  assert.doesNotThrow(() => assertModel(undefined))
  for (const bad of ['gpt-5-codex', 'openai/', '/gpt-5-codex', 'openai/gpt 5', 'a/b/c']) {
    assert.throws(() => assertModel(bad), /requirements\.model must look like "provider\/model"/, bad)
  }
})

test('auth state reports present for either credential layout', (t) => {
  const root = tempHome(t)
  assert.equal(authState(root), 'missing')

  const data = join(root, 'data')
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'auth.json'), '{}')
  assert.equal(authState(root), 'present')
})

test('auth state accepts the data-root layout', (t) => {
  const root = tempHome(t)
  writeFileSync(join(root, 'auth.json'), '{}')
  assert.equal(authState(root), 'present')
})

test('auth state is unknown without a home, so the gate defers to ACP', () => {
  assert.equal(authState(undefined), 'unknown')
  assert.deepEqual(requirementFailures(requirements({ require: ['auth'] }), {}), [])
})

test('a required auth gate fails when the configured home proves no login', (t) => {
  const root = tempHome(t)
  const failures = requirementFailures(requirements({ require: ['auth'], home: root }), {})
  assert.equal(failures.length, 1)
  assert.match(failures[0], /OpenCode has no stored credentials/)
  assert.match(failures[0], /run `opencode auth login`/)
})

test('load-time enforcement throws one message carrying every failure', (t) => {
  const root = tempHome(t)
  assert.throws(
    () => assertLoadTimeRequirements(
      requirements({ require: ['auth', 'credentials', 'model'], home: root, credentials: ['MISSING_KEY'] }),
      {},
    ),
    (error) => {
      assert.match(error.message, /MISSING_KEY is not set/)
      assert.match(error.message, /no stored credentials/)
      assert.match(error.message, /requirements\.model is not set/)
      return true
    },
  )
})

test('relay forwards ambient names, declared credentials, home, then literals', () => {
  const relay = relayEnv({
    requirements: requirements({
      credentials: ['OPENAI_API_KEY', 'ABSENT_KEY'],
      home: '/opt/opencode',
      env: { OPENCODE_DISABLE_TELEMETRY: '1' },
    }),
    passEnv: ['OPENCODE_SESSION', 'ABSENT_AMBIENT'],
    env: { EXTRA: 'explicit' },
    parentEnv: {
      OPENCODE_SESSION: 'ses_1',
      OPENAI_API_KEY: SECRET,
      PATH: '/usr/bin',
    },
  })
  assert.deepEqual(relay, {
    OPENCODE_SESSION: 'ses_1',
    OPENAI_API_KEY: SECRET,
    OPENCODE_HOME: '/opt/opencode',
    OPENCODE_DISABLE_TELEMETRY: '1',
    EXTRA: 'explicit',
  })
  // Ambient variables that were not declared are never relayed implicitly.
  assert.equal('PATH' in relay, false)
  assert.equal(RELAY_ORDER.length, 4)
})

test('an explicit env value wins over a relayed one of the same name', () => {
  const relay = relayEnv({
    requirements: requirements({ credentials: ['OPENAI_API_KEY'], env: { OPENAI_API_KEY: 'from-requirements' } }),
    passEnv: [],
    env: { OPENAI_API_KEY: 'from-plugin-env' },
    parentEnv: { OPENAI_API_KEY: SECRET },
  })
  assert.equal(relay.OPENAI_API_KEY, 'from-plugin-env')
  assert.doesNotMatch(Object.values(relay).join(' '), new RegExp(SECRET))
})

test('a diagnostic carries only closed-vocabulary facts', () => {
  const line = failureDiagnostic({ stage: 'prompt', category: 'unknown', permissions: 2 })
  assert.equal(line, 'Subagent failure (product: OpenCode; stage: prompt; category: unknown; permissions requested: 2)')

  const withProcess = failureDiagnostic({
    stage: 'process',
    category: 'process',
    outcome: { exitCode: 3, signal: null },
  })
  assert.equal(withProcess, 'Subagent failure (product: OpenCode; stage: process; category: process; exit code: 3)')
  assert.doesNotMatch(withProcess, /null/)
})
