/**
 * Settings-bridge tests: the authenticated gate, snapshot projection, nested
 * requirement merging, stale fingerprints, reset, and route lifetime.
 *
 * The fake editor records the complete config each write produces, so the tests
 * also prove that `env` maps the page does not expose are preserved.
 */

import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import {
  DEFAULTS,
  MAX_BODY_BYTES,
  PACKAGE_NAME,
  ROUTE_PREFIX,
  TARGET_ENTRY_ID,
  fingerprint,
  handleRequest,
  mergeSettings,
  registerSettingsRoute,
  toValues,
  validateSave,
} from '../settings.js'

const INHERITED = Object.freeze({
  providerName: 'opencode',
  command: 'opencode',
  args: ['acp'],
  permission: 'session',
  passEnv: ['OPENCODE_*', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'HOME'],
  disposeGraceMs: 3000,
  requirements: {
    require: [],
    credentials: [],
    install: false,
    installManager: 'pnpm',
    installArgs: [],
    installTimeoutMs: 300000,
  },
})

/** Build an in-memory config editor for one entry. */
function makeEditor(options = {}) {
  let current = structuredClone(options.config ?? INHERITED)
  const writes = []
  const entry = {
    options: { id: options.entryId ?? TARGET_ENTRY_ID, name: PACKAGE_NAME },
    fiber: options.inactive === true ? undefined : {},
  }
  const editor = {
    writes,
    get current() { return current },
    configuration() {
      return [{
        entry: { ...entry, options: { ...entry.options, config: structuredClone(current) } },
        inherited: structuredClone(INHERITED),
        override: structuredClone(current),
      }]
    },
    entries() { return [entry] },
    async edit(_target, change) {
      const next = change(structuredClone(current), structuredClone(INHERITED))
      writes.push(next)
      current = next
    },
  }
  return editor
}

/** Build a root context serving one editor and an admitted browser peer. */
function makeContext(editor, options = {}) {
  const browserPeer = options.browserPeer ?? { principal: { kind: 'owner' } }
  const connection = {
    browserPeer,
    admit() {
      return options.admission ?? { peer: options.admittedPeer ?? browserPeer }
    },
  }
  return {
    get(name) {
      if (name === 'configEditor') return options.noEditor === true ? undefined : editor
      if (name === 'connection') return options.noConnection === true ? undefined : connection
      return undefined
    },
  }
}

/** Build one request for the route. */
function makeRequest(options = {}) {
  const body = options.body
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  request.method = options.method ?? 'GET'
  request.url = options.url ?? `${ROUTE_PREFIX}/config`
  request.headers = {
    ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }),
    ...(options.headers ?? {}),
  }
  return request
}

/** Build one recording response. */
function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writableEnded: false,
    writeHead(status, headers = {}) {
      this.statusCode = status
      this.headers = { ...this.headers, ...headers }
      return this
    },
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body = '') {
      this.body = body
      this.writableEnded = true
    },
  }
}

/** Call the route. */
async function call(ctx, request) {
  const response = makeResponse()
  await handleRequest(ctx, request, response)
  return { response, json: response.body === '' ? undefined : JSON.parse(response.body) }
}

/** A complete save body. */
function saveBody(editor, mutate = values => values) {
  const values = mutate(structuredClone(toValues(editor.current)))
  return JSON.stringify({ fingerprint: fingerprint(editor.current), values })
}

test('GET projects every curated provider and requirement field', async () => {
  const editor = makeEditor()
  const { response, json } = await call(makeContext(editor), makeRequest())
  assert.equal(response.statusCode, 200)
  assert.equal(json.ok, true)
  assert.equal(json.entryId, TARGET_ENTRY_ID)
  assert.equal(json.editable, true)
  assert.equal(json.isDefault, true)
  assert.deepEqual(json.values, toValues(INHERITED))
  assert.equal(json.fingerprint, fingerprint(INHERITED))
})

test('GET follows a custom row id when the conventional row is absent', async () => {
  const editor = makeEditor({ entryId: 'subagent-opencode-preset' })
  const { response, json } = await call(makeContext(editor), makeRequest())
  assert.equal(response.statusCode, 200)
  assert.equal(json.entryId, 'subagent-opencode-preset')
})

test('POST merges nested requirements and preserves env maps', async () => {
  const config = {
    ...INHERITED,
    env: { KEEP: '1' },
    requirements: { ...INHERITED.requirements, env: { SECRET: 'kept' }, installDir: '/opt/opencode' },
  }
  const editor = makeEditor({ config })
  const { response, json } = await call(makeContext(editor), makeRequest({
    method: 'POST',
    body: saveBody(editor, values => ({
      ...values,
      permission: 'allow',
      requirements: { ...values.requirements, model: 'openai/gpt-5-codex', install: true, installManager: 'npm' },
    })),
  }))
  assert.equal(response.statusCode, 200)
  assert.equal(json.ok, true)
  assert.equal(json.values.permission, 'allow')
  assert.equal(json.values.requirements.model, 'openai/gpt-5-codex')
  assert.equal(json.values.requirements.install, true)
  assert.equal(json.values.requirements.installManager, 'npm')
  assert.deepEqual(editor.current.env, { KEEP: '1' })
  assert.deepEqual(editor.current.requirements.env, { SECRET: 'kept' })
  assert.equal(editor.current.requirements.installDir, '/opt/opencode')
})

test('clearing an optional field removes it from the row config', async () => {
  const editor = makeEditor({
    config: { ...INHERITED, requirements: { ...INHERITED.requirements, model: 'openai/gpt-5-codex' } },
  })
  const { response, json } = await call(makeContext(editor), makeRequest({
    method: 'POST',
    body: saveBody(editor, values => ({
      ...values,
      requirements: { ...values.requirements, model: null },
    })),
  }))
  assert.equal(response.statusCode, 200)
  assert.equal(json.values.requirements.model, null)
  assert.equal(Object.hasOwn(editor.current.requirements, 'model'), false)
})

test('POST with an old fingerprint returns 409 and writes nothing', async () => {
  const editor = makeEditor()
  const body = JSON.stringify({ fingerprint: 'stale', values: toValues(INHERITED) })
  const { response, json } = await call(makeContext(editor), makeRequest({ method: 'POST', body }))
  assert.equal(response.statusCode, 409)
  assert.equal(json.code, 'stale')
  assert.equal(json.ok, false)
  assert.equal(json.fingerprint, fingerprint(INHERITED))
  assert.equal(editor.writes.length, 0)
})

test('reset returns the inherited bundle config', async () => {
  const editor = makeEditor({ config: { ...INHERITED, permission: 'allow' } })
  const { response, json } = await call(makeContext(editor), makeRequest({
    method: 'POST',
    url: `${ROUTE_PREFIX}/reset`,
    body: JSON.stringify({ fingerprint: fingerprint(editor.current) }),
  }))
  assert.equal(response.statusCode, 200)
  assert.equal(json.isDefault, true)
  assert.deepEqual(json.values, toValues(INHERITED))
  assert.deepEqual(editor.current, INHERITED)
})

test('the editor and connection services are required', async () => {
  const missingEditor = await call(makeContext(makeEditor(), { noEditor: true }), makeRequest())
  assert.equal(missingEditor.response.statusCode, 503)
  assert.equal(missingEditor.json.code, 'editor-missing')
  const missingConnection = await call(makeContext(makeEditor(), { noConnection: true }), makeRequest())
  assert.equal(missingConnection.response.statusCode, 503)
  assert.equal(missingConnection.json.code, 'unavailable')
})

test('an unauthenticated or non-browser peer is rejected', async () => {
  const rejected = await call(makeContext(makeEditor(), { admission: { rejection: 401 } }), makeRequest())
  assert.equal(rejected.response.statusCode, 401)
  const other = await call(makeContext(makeEditor(), { admittedPeer: { principal: { kind: 'api' } } }), makeRequest())
  assert.equal(other.response.statusCode, 403)
})

test('unknown paths, methods, media types, and oversized bodies are refused', async () => {
  const editor = makeEditor()
  assert.equal((await call(makeContext(editor), makeRequest({ url: `${ROUTE_PREFIX}/nope` }))).response.statusCode, 404)
  assert.equal((await call(makeContext(editor), makeRequest({ method: 'PUT' }))).response.statusCode, 405)
  assert.equal((await call(makeContext(editor), makeRequest({
    method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' },
  }))).response.statusCode, 415)
  const tooLarge = JSON.stringify({ fingerprint: 'x', values: { providerName: 'a'.repeat(MAX_BODY_BYTES) } })
  assert.equal((await call(makeContext(editor), makeRequest({ method: 'POST', body: tooLarge }))).response.statusCode, 413)
})

test('validateSave rejects invalid shapes and nested fields', () => {
  const base = { fingerprint: 'x', values: toValues(INHERITED) }
  const fail = (values, code = 'invalid-request') => {
    const result = validateSave({ ...base, values })
    assert.equal(result.error?.code, code)
  }
  fail({ ...base.values, extra: 1 })
  fail({ ...base.values, providerName: ' ' })
  fail({ ...base.values, permission: 'always' })
  fail({ ...base.values, args: 'acp' })
  fail({ ...base.values, args: [''] })
  fail({ ...base.values, disposeGraceMs: 0 })
  fail({ ...base.values, requirements: { ...base.values.requirements, extra: 1 } })
  fail({ ...base.values, requirements: { ...base.values.requirements, require: ['unknown'] } })
  fail({ ...base.values, requirements: { ...base.values.requirements, require: ['auth', 'auth'] } })
  fail({ ...base.values, requirements: { ...base.values.requirements, model: 'gpt-5-codex' } })
  fail({ ...base.values, requirements: { ...base.values.requirements, installManager: 'yarn' } })
  fail({ ...base.values, requirements: { ...base.values.requirements, installDir: 'relative/path' } })
  fail({ ...base.values, requirements: { ...base.values.requirements, installTimeoutMs: -1 } })
})

test('mergeSettings preserves keys the page does not own', () => {
  const current = {
    ...INHERITED,
    futureField: 'kept',
    requirements: { ...INHERITED.requirements, installBinDir: '/opt/bin' },
  }
  const values = toValues(INHERITED)
  values.requirements.installDir = null
  const next = mergeSettings(current, values)
  assert.equal(next.futureField, 'kept')
  assert.equal(next.requirements.installBinDir, '/opt/bin')
  assert.equal(Object.hasOwn(next.requirements, 'installDir'), false)
})

test('toValues falls back to the documented defaults', () => {
  const values = toValues({})
  assert.equal(values.providerName, DEFAULTS.providerName)
  assert.equal(values.command, DEFAULTS.command)
  assert.deepEqual(values.args, [...DEFAULTS.args])
  assert.equal(values.permission, DEFAULTS.permission)
  assert.deepEqual(values.passEnv, [...DEFAULTS.passEnv])
  assert.equal(values.disposeGraceMs, DEFAULTS.disposeGraceMs)
  assert.equal(values.requirements.install, false)
  assert.equal(values.requirements.installManager, DEFAULTS.requirements.installManager)
  assert.equal(values.requirements.installTimeoutMs, DEFAULTS.requirements.installTimeoutMs)
})

test('registerSettingsRoute reference counts one route per Web server', () => {
  let registered = 0
  let disposed = 0
  const webServer = {
    register(route) {
      registered += 1
      assert.equal(route.path, ROUTE_PREFIX)
      return () => { disposed += 1 }
    },
  }
  const releases = []
  const makeCtx = () => ({
    inject(services, callback) {
      assert.deepEqual(services, ['webServer', 'connection'])
      const cleanups = []
      callback({
        root: {},
        webServer,
        effect(fn) { cleanups.push(fn()) },
      })
      releases.push(() => { for (const cleanup of cleanups) cleanup() })
    },
  })
  registerSettingsRoute(makeCtx())
  registerSettingsRoute(makeCtx())
  assert.equal(registered, 1)
  releases[0]()
  assert.equal(disposed, 0)
  releases[1]()
  assert.equal(disposed, 1)
  registerSettingsRoute(makeCtx())
  assert.equal(registered, 2)
  releases[2]()
  assert.equal(disposed, 2)
})

test('registerSettingsRoute tolerates a host without inject or a Web server', () => {
  assert.doesNotThrow(() => registerSettingsRoute(undefined))
  assert.doesNotThrow(() => registerSettingsRoute({}))
  assert.doesNotThrow(() => registerSettingsRoute({
    inject(_services, callback) {
      callback({ root: {}, webServer: undefined, effect() {} })
    },
  }))
})
