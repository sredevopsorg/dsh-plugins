import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import {
  MAX_BODY_BYTES,
  ROUTE_PREFIX,
  apply,
  handleRequest,
  readBody,
  validatePayload,
} from '../index.js'

const ROOT = '/workspace'
const SESSION = { id: 'session-1', header: { cwd: ROOT } }

function normalize(path) {
  const parts = []
  for (const part of String(path).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return `/${parts.join('/')}`
}

function createFs(options = {}) {
  const calls = []
  const root = options.root ?? ROOT
  return {
    calls,
    async resolve(path, opts = {}) {
      const base = opts.cwd ?? root
      const absolute = path.startsWith('/') ? path : `${base}/${path}`
      const targetKey = normalize(absolute)
      return { targetKey, displayPath: targetKey }
    },
    contains(parent, child) {
      const root = parent.targetKey.replace(/\/+$/, '')
      return child.targetKey === root || child.targetKey.startsWith(`${root}/`)
    },
    async lstat() {
      if (options.lstat !== undefined) return options.lstat
      return { type: 'file', version: 'v1' }
    },
    async stat() {
      return { type: 'file', version: options.statVersion ?? 'v2' }
    },
    async writeText(...args) {
      calls.push(args)
      if (options.writeError !== undefined) throw options.writeError
      return { operation: 'update', version: 'v-next', before: 'old', after: args[1] }
    },
  }
}

function createContext(options = {}) {
  const fs = options.fs ?? createFs()
  const session = options.session ?? SESSION
  const browserPeer = options.browserPeer ?? { principal: { kind: 'owner' } }
  const policy = options.policy ?? { mode: 'workspace-write', workspaceRoot: ROOT }
  return {
    connection: {
      browserPeer,
      admit(request) {
        assert.equal(typeof request.headers, 'object')
        return options.admission ?? { peer: browserPeer }
      },
    },
    sessions: {
      get(id) {
        if (options.sessionMissing === true) return undefined
        return id === SESSION.id ? session : undefined
      },
    },
    sandboxPolicy: {
      workspaceRoot: policy.workspaceRoot,
      resolve() {
        return policy
      },
    },
    fs,
  }
}

function makeRequest(options = {}) {
  const body = options.body
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  request.method = options.method ?? 'POST'
  request.url = options.url ?? `${ROUTE_PREFIX}/write`
  request.headers = {
    'content-type': 'application/json',
    ...(body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) }),
    ...(options.headers ?? {}),
  }
  return request
}

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

async function call(ctx, request) {
  const response = makeResponse()
  await handleRequest(ctx, request, response)
  return {
    response,
    json: response.body === '' ? undefined : JSON.parse(response.body),
  }
}

function writeBody(overrides = {}) {
  return JSON.stringify({
    sessionId: SESSION.id,
    path: 'src/app.ts',
    content: 'const answer = 42\n',
    expectedVersion: 'v1',
    ...overrides,
  })
}

test('apply registers one prefix route owned by an effect', () => {
  const routes = []
  let effects = 0
  const ctx = {
    effect(fn) {
      effects += 1
      return fn()
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
  apply(ctx)
  assert.equal(effects, 1)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, ROUTE_PREFIX)
})

test('validatePayload requires a version unless forced', () => {
  const missing = validatePayload({ sessionId: 's', path: 'a', content: 'x' })
  assert.equal(missing.status, 400)
  assert.equal(missing.code, 'missing-version')
  const forced = validatePayload({ sessionId: 's', path: 'a', content: 'x', force: true })
  assert.equal(forced.value.force, true)
  assert.equal(forced.value.expectedVersion, undefined)
})

test('validatePayload rejects a file above the editor cap', () => {
  const result = validatePayload({
    sessionId: 's',
    path: 'a',
    content: 'x'.repeat(1024 * 1024 + 1),
    expectedVersion: 'v1',
  })
  assert.equal(result.status, 413)
  assert.equal(result.code, 'file-too-large')
})

test('validatePayload rejects a NUL path and a non-object body', () => {
  const nulPath = validatePayload({
    sessionId: 's',
    path: 'a\u0000b',
    content: 'x',
    expectedVersion: 'v1',
  })
  assert.equal(nulPath.status, 400)
  assert.equal(nulPath.code, 'invalid-request')

  const arrayBody = validatePayload([])
  assert.equal(arrayBody.status, 400)
  assert.equal(arrayBody.code, 'invalid-request')
})

test('a Session without a cwd uses the sandbox policy workspace root', async () => {
  const fallbackRoot = '/fallback-workspace'
  const fs = createFs({ root: fallbackRoot })
  const ctx = createContext({
    fs,
    session: { id: SESSION.id, header: {} },
    policy: { mode: 'workspace-write', workspaceRoot: fallbackRoot },
  })
  const { response } = await call(ctx, makeRequest({ body: writeBody() }))

  assert.equal(response.statusCode, 200)
  assert.equal(fs.calls[0][0].targetKey, `${fallbackRoot}/src/app.ts`)
})

test('successful save writes with the expected version and policy', async () => {
  const fs = createFs()
  const ctx = createContext({ fs })
  const { response, json } = await call(ctx, makeRequest({ body: writeBody() }))

  assert.equal(response.statusCode, 200)
  assert.equal(json.ok, true)
  assert.equal(json.version, 'v-next')
  assert.equal(fs.calls.length, 1)
  const [target, content, expected, , policy] = fs.calls[0]
  assert.equal(target.targetKey, `${ROOT}/src/app.ts`)
  assert.equal(content, 'const answer = 42\n')
  assert.deepEqual(expected, { kind: 'replaceIfVersion', version: 'v1' })
  assert.equal(policy.mode, 'workspace-write')
})

test('force skips the version guard', async () => {
  const fs = createFs()
  const ctx = createContext({ fs })
  const { response } = await call(ctx, makeRequest({
    body: writeBody({ force: true, expectedVersion: undefined }),
  }))
  assert.equal(response.statusCode, 200)
  assert.equal(fs.calls[0][2], undefined)
})

test('stale version maps to 409 and reports the current version', async () => {
  const stale = Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
  const fs = createFs({ writeError: stale, statVersion: 'v9' })
  const ctx = createContext({ fs })
  const { response, json } = await call(ctx, makeRequest({ body: writeBody() }))

  assert.equal(response.statusCode, 409)
  assert.equal(json.code, 'stale')
  assert.equal(json.version, 'v9')
})

test('read-only policy refuses the write before touching the file', async () => {
  const fs = createFs()
  const ctx = createContext({
    fs,
    policy: { mode: 'read-only', workspaceRoot: ROOT },
  })
  const { response, json } = await call(ctx, makeRequest({ body: writeBody() }))

  assert.equal(response.statusCode, 403)
  assert.equal(json.code, 'read-only')
  assert.equal(fs.calls.length, 0)
})

test('a sandbox write denial maps to a 403 write-denied response', async () => {
  const denied = Object.assign(new Error('sandbox denied'), { code: 'FS_SANDBOX_DENIED' })
  const fs = createFs({ writeError: denied })
  const ctx = createContext({ fs })
  const { response, json } = await call(ctx, makeRequest({ body: writeBody() }))

  assert.equal(response.statusCode, 403)
  assert.equal(json.code, 'write-denied')
  assert.equal(fs.calls.length, 1)
})

test('paths outside the workspace are refused', async () => {
  const fs = createFs()
  const ctx = createContext({ fs })
  const { response, json } = await call(ctx, makeRequest({
    body: writeBody({ path: '../outside.txt' }),
  }))

  assert.equal(response.statusCode, 403)
  assert.equal(json.code, 'outside-workspace')
  assert.equal(fs.calls.length, 0)
})

test('a final symlink is refused', async () => {
  const fs = createFs({ lstat: { type: 'symlink', version: 'v1' } })
  const ctx = createContext({ fs })
  const { response, json } = await call(ctx, makeRequest({ body: writeBody() }))

  assert.equal(response.statusCode, 400)
  assert.equal(json.code, 'symlink-not-supported')
})

test('a missing Session is reported as a 404', async () => {
  const ctx = createContext({ sessionMissing: true })
  const { response, json } = await call(ctx, makeRequest({ body: writeBody() }))

  assert.equal(response.statusCode, 404)
  assert.equal(json.code, 'session-not-found')
})

test('unauthenticated requests keep the admission status', async () => {
  const ctx = createContext({ admission: { rejection: 401 } })
  const { response, json } = await call(ctx, makeRequest({ body: writeBody() }))

  assert.equal(response.statusCode, 401)
  assert.equal(json.code, 'unauthenticated')
})

test('API peers that are not the shared browser peer are refused', async () => {
  const ctx = createContext({ admission: { peer: { principal: { kind: 'owner' } } } })
  const { response, json } = await call(ctx, makeRequest({ body: writeBody() }))

  assert.equal(response.statusCode, 403)
  assert.equal(json.code, 'browser-only')
})

test('wrong method and unknown subpaths are refused', async () => {
  const ctx = createContext()
  const wrongMethod = await call(ctx, makeRequest({ method: 'GET', body: undefined }))
  assert.equal(wrongMethod.response.statusCode, 405)
  assert.equal(wrongMethod.response.headers.Allow, 'POST')

  const wrongPath = await call(ctx, makeRequest({ url: `${ROUTE_PREFIX}/other`, body: writeBody() }))
  assert.equal(wrongPath.response.statusCode, 404)
})

test('content type and JSON body are validated', async () => {
  const ctx = createContext()
  const wrongType = await call(ctx, makeRequest({
    body: writeBody(),
    headers: { 'content-type': 'text/plain' },
  }))
  assert.equal(wrongType.response.statusCode, 415)

  const invalidJson = await call(ctx, makeRequest({ body: '{' }))
  assert.equal(invalidJson.response.statusCode, 400)
  assert.equal(invalidJson.json.code, 'invalid-json')
})

test('a declared oversized body is refused without reading it', async () => {
  const ctx = createContext()
  const request = makeRequest({ body: '{}' })
  request.headers['content-length'] = String(MAX_BODY_BYTES + 1)
  const { response, json } = await call(ctx, request)
  assert.equal(response.statusCode, 413)
  assert.equal(json.code, 'request-too-large')
})

test('readBody drains an oversized body and reports its cap', async () => {
  const request = Readable.from([Buffer.alloc(32)])
  await assert.rejects(() => readBody(request, 8), (error) => error.code === 'BODY_TOO_LARGE')
})
