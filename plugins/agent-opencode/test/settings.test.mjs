/**
 * Settings-bridge tests: the authenticated gate, the snapshot contract, save
 * merging, stale fingerprints, reset, and route lifetime.
 *
 * No DSH runtime, profile, YAML file, or browser is needed: the config editor is
 * a small in-memory fake that records the config each write produces.
 */

import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import {
  MAX_BODY_BYTES,
  ROUTE_PREFIX,
  TARGET_ENTRY_ID,
  fingerprint,
  handleRequest,
  mergeSettings,
  registerSettingsRoute,
  toValues,
  validateSave,
} from '../settings.js'

const ENTRY_NAME = '@sredevopsorg/dsh-agent-opencode/auto-continue'
const INHERITED = Object.freeze({
  presetId: 'opencode',
  text: 'continue',
  maxAttempts: 5,
  windowMs: 180000,
  requireChildPrompt: true,
})

/**
 * Build an in-memory config editor for one entry.
 * @param {object} [options] - initial config and entry state.
 */
function makeEditor(options = {}) {
  let current = structuredClone(options.config ?? INHERITED)
  const writes = []
  const entry = {
    options: { id: options.entryId ?? TARGET_ENTRY_ID, name: ENTRY_NAME },
    fiber: options.inactive === true ? undefined : {},
  }
  const editor = {
    writes,
    get current() { return current },
    configuration() {
      return [{ entry: { ...entry, options: { ...entry.options, config: structuredClone(current) } }, inherited: structuredClone(INHERITED), override: structuredClone(current) }]
    },
    entries() { return [entry] },
    async edit(target, change) {
      const next = change(structuredClone(current), structuredClone(INHERITED))
      writes.push(next)
      current = next
    },
  }
  return editor
}

/**
 * Build a root context serving one editor and an admitted browser peer.
 * @param {object} editor - fake config editor.
 * @param {object} [options] - auth overrides.
 */
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

/**
 * Build one request for the route.
 * @param {object} [options] - method, path, body, and headers.
 */
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

/**
 * Call the route.
 * @param {object} ctx - fake context.
 * @param {object} request - request.
 */
async function call(ctx, request) {
  const response = makeResponse()
  await handleRequest(ctx, request, response)
  return { response, json: response.body === '' ? undefined : JSON.parse(response.body) }
}

/** A full save payload. */
function saveBody(overrides = {}) {
  const values = {
    presetId: 'opencode',
    text: 'continue',
    maxAttempts: 7,
    windowMs: 120000,
    requireChildPrompt: false,
    ...overrides.values,
  }
  return JSON.stringify({
    fingerprint: overrides.fingerprint ?? fingerprint(INHERITED),
    values,
  })
}

test('GET returns the live values, defaults flag, and fingerprint', async () => {
  const editor = makeEditor()
  const { response, json } = await call(makeContext(editor), makeRequest())
  assert.equal(response.statusCode, 200)
  assert.equal(json.ok, true)
  assert.equal(json.entryId, TARGET_ENTRY_ID)
  assert.equal(json.editable, true)
  assert.equal(json.isDefault, true)
  assert.deepEqual(json.values, toValues(INHERITED))
  assert.equal(json.fingerprint, fingerprint(INHERITED))
  assert.equal(response.headers['Cache-Control'], 'no-store')
})

test('GET reports an inactive row instead of pretending it can save', async () => {
  const editor = makeEditor({ inactive: true })
  const { response, json } = await call(makeContext(editor), makeRequest())
  assert.equal(response.statusCode, 200)
  assert.equal(json.editable, false)
  assert.equal(json.reason, 'inactive')
})

test('GET reports a YAML expression as read-only', async () => {
  const editor = makeEditor({ config: { __jsExpr: 'process.env.CONFIG' } })
  const { response, json } = await call(makeContext(editor), makeRequest())
  assert.equal(response.statusCode, 200)
  assert.equal(json.editable, false)
  assert.equal(json.reason, 'expression')
})

test('POST saves the curated fields and preserves unrelated keys', async () => {
  const editor = makeEditor({ config: { ...INHERITED, futureField: 'kept' } })
  const { response, json } = await call(
    makeContext(editor),
    makeRequest({ method: 'POST', body: saveBody({ fingerprint: fingerprint(editor.current) }) }),
  )
  assert.equal(response.statusCode, 200)
  assert.equal(json.ok, true)
  assert.equal(json.values.maxAttempts, 7)
  assert.equal(json.values.requireChildPrompt, false)
  assert.equal(json.isDefault, false)
  assert.equal(editor.writes.length, 1)
  assert.equal(editor.current.futureField, 'kept')
})

test('POST with an old fingerprint returns 409 and writes nothing', async () => {
  const editor = makeEditor()
  const { response, json } = await call(
    makeContext(editor),
    makeRequest({ method: 'POST', body: saveBody({ fingerprint: 'stale' }) }),
  )
  assert.equal(response.statusCode, 409)
  assert.equal(json.code, 'stale')
  assert.equal(json.ok, false)
  assert.equal(json.fingerprint, fingerprint(INHERITED))
  assert.equal(editor.writes.length, 0)
})

test('reset returns the inherited config and drops the override', async () => {
  const editor = makeEditor({ config: { ...INHERITED, text: 'again' } })
  const { response, json } = await call(
    makeContext(editor),
    makeRequest({ method: 'POST', url: `${ROUTE_PREFIX}/reset`, body: JSON.stringify({ fingerprint: fingerprint(editor.current) }) }),
  )
  assert.equal(response.statusCode, 200)
  assert.equal(json.ok, true)
  assert.equal(json.isDefault, true)
  assert.deepEqual(json.values, toValues(INHERITED))
  assert.deepEqual(editor.current, INHERITED)
})

test('the editor is required', async () => {
  const { response, json } = await call(makeContext(makeEditor(), { noEditor: true }), makeRequest())
  assert.equal(response.statusCode, 503)
  assert.equal(json.code, 'editor-missing')
})

test('a missing connection service is unavailable', async () => {
  const { response, json } = await call(makeContext(makeEditor(), { noConnection: true }), makeRequest())
  assert.equal(response.statusCode, 503)
  assert.equal(json.code, 'unavailable')
})

test('an unauthenticated peer is rejected', async () => {
  const editor = makeEditor()
  const ctx = makeContext(editor, { admission: { rejection: 401 } })
  const { response } = await call(ctx, makeRequest())
  assert.equal(response.statusCode, 401)
  assert.equal(editor.writes.length, 0)
})

test('a peer that is not the browser peer is rejected', async () => {
  const editor = makeEditor()
  const ctx = makeContext(editor, { admittedPeer: { principal: { kind: 'api' } } })
  const { response } = await call(ctx, makeRequest())
  assert.equal(response.statusCode, 403)
})

test('unknown paths and methods are refused', async () => {
  const editor = makeEditor()
  const unknown = await call(makeContext(editor), makeRequest({ url: `${ROUTE_PREFIX}/nope` }))
  assert.equal(unknown.response.statusCode, 404)
  const method = await call(makeContext(editor), makeRequest({ method: 'PUT' }))
  assert.equal(method.response.statusCode, 405)
})

test('a non-JSON body is refused', async () => {
  const editor = makeEditor()
  const { response, json } = await call(makeContext(editor), makeRequest({
    method: 'POST',
    body: 'x',
    headers: { 'content-type': 'text/plain' },
  }))
  assert.equal(response.statusCode, 415)
  assert.equal(json.code, 'unsupported-media-type')
})

test('a body above the cap is refused before parsing', async () => {
  const editor = makeEditor()
  const body = JSON.stringify({ fingerprint: 'x', values: { text: 'a'.repeat(MAX_BODY_BYTES) } })
  const { response, json } = await call(makeContext(editor), makeRequest({ method: 'POST', body }))
  assert.equal(response.statusCode, 413)
  assert.equal(json.code, 'request-too-large')
})

test('validateSave rejects unknown, missing, and mistyped fields', () => {
  const base = { fingerprint: 'x', values: { ...toValues(INHERITED) } }
  assert.equal(validateSave({ ...base, values: { ...base.values, extra: 1 } }).error.code, 'invalid-request')
  assert.equal(validateSave({ ...base, values: { text: 'continue' } }).error.code, 'invalid-request')
  assert.equal(validateSave({ ...base, values: { ...base.values, maxAttempts: '5' } }).error.code, 'invalid-request')
  assert.equal(validateSave({ ...base, values: { ...base.values, text: '   ' } }).error.code, 'invalid-request')
  assert.equal(validateSave({ ...base, values: { ...base.values, windowMs: 1 } }).error.code, 'invalid-request')
  assert.equal(validateSave({ fingerprint: '', values: base.values }).error.code, 'invalid-request')
})

test('mergeSettings only replaces the page fields', () => {
  const next = mergeSettings({ ...INHERITED, extra: true }, { ...toValues(INHERITED), text: 'again' })
  assert.equal(next.text, 'again')
  assert.equal(next.extra, true)
  assert.deepEqual(Object.keys(next).sort(), [...Object.keys(INHERITED), 'extra'].sort())
})

test('registerSettingsRoute reference counts one route per Web server', () => {
  let registered = 0
  let disposed = 0
  const webServer = {
    register(route) {
      registered += 1
      assert.equal(route.kind, 'prefix')
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

  // A fresh registration after the last release registers again.
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
      let cleanups = []
      callback({
        root: {},
        webServer: undefined,
        effect(fn) { cleanups.push(fn()) },
      })
      for (const cleanup of cleanups) cleanup()
    },
  }))
})
