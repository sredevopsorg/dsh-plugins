/**
 * Browser-half tests: the two Plugins-page registrations, locale parity, and
 * the pure draft/validation helpers used by the provider form.
 *
 * The client bundle is a lazy factory, so the test installs a minimal
 * `window.__ModuleLoader__` recorder and a stub React before importing it.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

let registration
globalThis.window = {
  __ModuleLoader__: {
    load(next) {
      registration = next
    },
  },
}
await import('../client.js')
delete globalThis.window

const fakeReact = {
  Fragment: 'fragment',
  createElement: () => null,
  useEffect: () => {},
  useMemo: value => value(),
  useRef: value => ({ current: value }),
  useState: value => [value, () => {}],
}

const plugin = registration.factory(specifier => {
  if (specifier === 'react') return fakeReact
  throw new Error(`unexpected module: ${specifier}`)
})

const {
  PKG,
  ROW_ID,
  ROUTE,
  BUNDLE_KEY,
  ROW_KEY,
  FIELDS,
  dictionaries,
  valuesToDraft,
  draftToValues,
  validateDraft,
  terminalReason,
  readOnlyText,
  loadFailureText,
} = plugin.__test

const t = key => key

test('the bundle registers one page and one row form against the Plugins page', () => {
  const slots = []
  const locales = []
  const ctx = {
    effect(fn) {
      const dispose = fn()
      assert.equal(typeof dispose, 'function')
      return () => {}
    },
    locale: {
      bind: () => t,
      register(ns, entries) { locales.push([ns, entries]); return () => {} },
    },
    slots: {
      inject(name, callback) {
        const dispose = callback()
        assert.equal(typeof dispose, 'function')
        return () => {}
      },
      register(options, component) {
        slots.push([options, component])
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  assert.equal(locales.length, 1)
  assert.deepEqual(slots.map(([options]) => options.name), ['plugins.bundle.config', 'plugins.row.config'])
  assert.deepEqual(slots.map(([options]) => options.key), [BUNDLE_KEY, ROW_KEY])
  assert.equal(BUNDLE_KEY, PKG)
  assert.equal(ROW_KEY, `${PKG}#${ROW_ID}`)
  assert.equal(ROUTE, '__dsh-subagent-opencode-settings')
  for (const [, component] of slots) assert.equal(typeof component, 'function')
})

test('terminal response codes map to a stable read-only reason', () => {
  assert.equal(terminalReason('expression'), 'expression')
  assert.equal(terminalReason('overridden'), 'overridden')
  assert.equal(terminalReason('inactive'), 'inactive')
  assert.equal(terminalReason('entry-missing'), 'inactive')
  assert.equal(terminalReason('editor-missing'), 'unavailable')
  assert.equal(terminalReason('invalid-value'), undefined)
  assert.equal(readOnlyText('overridden', key => key), 'state.overridden')
  assert.equal(readOnlyText(undefined, key => key), 'state.inactive')
})

test('load failures distinguish missing endpoints from save failures', () => {
  assert.equal(loadFailureText(401, undefined, key => key), 'error.auth')
  assert.equal(loadFailureText(404, undefined, key => key), 'error.endpoint')
  assert.equal(loadFailureText(503, undefined, key => key), 'error.unavailable')
  assert.equal(loadFailureText(500, undefined, key => key), 'error.load')
})

test('the English and Spanish dictionaries carry the same keys', () => {
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.es).sort())
})

test('every field label and option label has copy in both dictionaries', () => {
  const keys = new Set()
  for (const field of FIELDS) {
    if (field.labelKey !== undefined) keys.add(field.labelKey)
    if (field.helpKey !== undefined) keys.add(field.helpKey)
    for (const option of field.options ?? []) keys.add(option.labelKey)
  }
  assert.ok(keys.size > 0)
  for (const key of keys) {
    assert.ok(Object.hasOwn(dictionaries.en, key), `missing English copy: ${key}`)
    assert.ok(Object.hasOwn(dictionaries.es, key), `missing Spanish copy: ${key}`)
  }
})

test('draft conversion handles nested paths, lists, switches, and cleared optional text', () => {
  const values = {
    providerName: 'opencode',
    command: 'opencode',
    args: ['acp', '--print-logs'],
    permission: 'reject',
    passEnv: ['HOME', 'OPENCODE_*'],
    disposeGraceMs: 5000,
    requirements: {
      require: ['auth', 'model'],
      credentials: ['OPENAI_API_KEY'],
      model: 'openai/gpt-5-codex',
      mode: 'build',
      effort: null,
      home: null,
      install: true,
      installManager: 'npm',
      installDir: '/opt/opencode',
      installArgs: ['--registry', 'https://registry.npmjs.org'],
      installTimeoutMs: 60000,
    },
  }
  const draft = valuesToDraft(values, FIELDS)
  assert.equal(draft['requirements.model'], 'openai/gpt-5-codex')
  assert.equal(draft['requirements.effort'], '')
  assert.equal(draft['requirements.install'], true)
  assert.equal(draft['requirements.require'].length, 2)
  assert.equal(draft['args'], 'acp\n--print-logs')
  assert.deepEqual(draftToValues(draft, FIELDS), { ...values, requirements: { ...values.requirements, effort: null, home: null } })
})

test('validation names invalid model, relative install path, and numbers', () => {
  const values = {
    providerName: 'opencode',
    command: 'opencode',
    args: [],
    permission: 'session',
    passEnv: [],
    disposeGraceMs: 3000,
    requirements: {
      require: [],
      credentials: [],
      model: 'not-a-model',
      mode: null,
      effort: null,
      home: null,
      install: false,
      installManager: 'pnpm',
      installDir: 'relative/path',
      installArgs: [],
      installTimeoutMs: 0,
    },
  }
  const draft = valuesToDraft(values, FIELDS)
  const errors = validateDraft(draft, FIELDS)
  assert.equal(errors['requirements.model'], 'model')
  assert.equal(errors['requirements.installDir'], 'absolute')
  assert.equal(errors['requirements.installTimeoutMs'], 'range')
})
