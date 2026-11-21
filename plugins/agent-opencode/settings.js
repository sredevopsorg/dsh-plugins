/**
 * Host half of the OpenCode bundle's Web settings page.
 *
 * The browser never edits the profile patch itself. It asks this route for the
 * live `auto-continue-opencode` values and posts them back; the route merges
 * only the fields the page owns and hands the complete config to
 * {@link ConfigEditor.edit}, which validates it, serializes the write with
 * other profile changes, preserves unrelated YAML rows and comments, and
 * reloads the row through the Loader.
 *
 * The route follows `code-editor`'s gateway: an authenticated browser peer is
 * required, JSON only, a hard body cap, and `Cache-Control: no-store`. An agent
 * cannot call it, so changing the watcher's behavior stays a user action.
 *
 * @module @sredevopsorg/dsh-agent-opencode/settings
 */

import { createHash } from 'node:crypto'
import { DEFAULT_CONFIG } from './auto-continue.js'

/** Absolute path prefix owned by the settings bridge. */
export const ROUTE_PREFIX = '/__dsh-agent-opencode-settings'

/** Request body cap; these settings are small. */
export const MAX_BODY_BYTES = 64 * 1024

/** Loader row whose values the page edits. */
export const TARGET_ENTRY_ID = 'auto-continue-opencode'

/** Fields this page owns. Every other key in the row config is preserved. */
export const SETTING_FIELDS = Object.freeze(['presetId', 'text', 'maxAttempts', 'windowMs', 'requireChildPrompt'])

/** Routes shared by every mounted instance of this package. */
const routes = new WeakMap()

/** One entry accepted by the page, before validation. */
const FIELD_RULES = Object.freeze({
  presetId: { type: 'string', trim: true, minLength: 1, maxLength: 200 },
  text: { type: 'string', minLength: 1, maxLength: 8192, nonBlank: true },
  maxAttempts: { type: 'integer', min: 1, max: 1000 },
  windowMs: { type: 'integer', min: 1000, max: 86_400_000 },
  requireChildPrompt: { type: 'boolean' },
})

/** Raised when the browser edited a config someone else already replaced. */
class StaleConfigError extends Error {
  constructor() {
    super('The settings changed since this page read them.')
    this.name = 'StaleConfigError'
  }
}

/**
 * Register the settings bridge on a host context.
 *
 * The route is optional: a host with no Web server, or a profile booted without
 * a browser, still gets the watcher. The package may be mounted more than once
 * under different row ids, so registrations are reference counted per Web
 * server instead of colliding on the one route path.
 *
 * @param {object} ctx - host plugin context.
 */
export function registerSettingsRoute(ctx) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.inject !== 'function') return
  ctx.inject(['webServer', 'connection'], (scope) => {
    if (scope === null || typeof scope !== 'object' || scope.webServer === undefined) return
    if (typeof scope.effect !== 'function') return
    scope.effect(() => acquireRoute(scope), 'agent-opencode: Web settings route')
  })
}

/**
 * Acquire one reference to the package's route.
 * @param {object} scope - context carrying the Web server service.
 * @returns {() => void} release for this reference.
 */
function acquireRoute(scope) {
  const root = scope.root ?? scope
  const webServer = scope.webServer
  let state = routes.get(webServer)
  if (state === undefined) {
    state = {
      refs: 0,
      dispose: webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => { void handleRequest(root, req, res) },
      }),
    }
    routes.set(webServer, state)
  }
  state.refs += 1
  return () => {
    state.refs -= 1
    if (state.refs > 0) return
    state.dispose()
    routes.delete(webServer)
  }
}

/**
 * Serve one settings request.
 * @param {object} ctx - root host context providing `connection` and `configEditor`.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 * @returns {Promise<void>} completion after the response is written.
 */
export async function handleRequest(ctx, req, res) {
  try {
    const pathname = requestPathname(req)
    if (pathname !== `${ROUTE_PREFIX}/config` && pathname !== `${ROUTE_PREFIX}/reset`) {
      return sendJson(res, 404, { ok: false, code: 'not-found', message: 'Unknown settings endpoint.' })
    }
    const admission = authenticate(ctx, req)
    if (admission !== undefined) return sendJson(res, admission.status, admission.body)

    const editor = ctx.get?.('configEditor')
    if (editor === undefined || typeof editor.edit !== 'function' || typeof editor.configuration !== 'function') {
      return sendJson(res, 503, { ok: false, code: 'editor-missing', message: 'Configuration cannot be saved in this profile.' })
    }
    const found = findEntry(editor)
    if (found === undefined) {
      return sendJson(res, 404, { ok: false, code: 'entry-missing', message: `The ${TARGET_ENTRY_ID} row is not active.` })
    }

    if (pathname === `${ROUTE_PREFIX}/config` && req.method === 'GET') {
      return sendJson(res, 200, snapshot(found))
    }
    if (pathname === `${ROUTE_PREFIX}/config` && req.method === 'POST') {
      const payload = await readJsonRequest(req)
      if (payload.error !== undefined) return sendJson(res, payload.error.status, payload.error.body)
      const result = await save(editor, found, payload.value)
      return sendJson(res, result.status, result.body)
    }
    if (pathname === `${ROUTE_PREFIX}/reset` && req.method === 'POST') {
      const payload = await readJsonRequest(req)
      if (payload.error !== undefined) return sendJson(res, payload.error.status, payload.error.body)
      const fingerprint = requireFingerprint(payload.value)
      if (fingerprint.error !== undefined) return sendJson(res, 400, fingerprint.error)
      const result = await reset(editor, found, fingerprint.value)
      return sendJson(res, result.status, result.body)
    }
    res.setHeader?.('Allow', pathname.endsWith('/reset') ? 'POST' : 'GET, POST')
    return sendJson(res, 405, { ok: false, code: 'method-not-allowed', message: 'Use the documented HTTP method.' })
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      code: 'internal-error',
      message: error instanceof Error ? error.message : 'The settings request failed.',
    })
  }
}

/**
 * Read one current snapshot without writing anything.
 * @param {object} editor - config editor service.
 * @param {object} found - entry returned by {@link findEntry}.
 * @returns {object} the JSON body the page consumes.
 */
function snapshot(found) {
  const current = plainConfig(found.entry.options.config)
  const inherited = plainConfig(found.inherited)
  const expression = isExpression(current)
  // FiberState.ACTIVE is 2; an undefined state is a test or older host stub.
  const editable = !expression && found.entry.fiber !== undefined && (found.entry.fiber.state === undefined || found.entry.fiber.state === 2)
  return {
    ok: true,
    entryId: TARGET_ENTRY_ID,
    editable,
    ...editable ? {} : { reason: expression ? 'expression' : 'inactive' },
    isDefault: fingerprint(current) === fingerprint(inherited),
    values: toValues(current),
    fingerprint: fingerprint(current),
  }
}

/**
 * Apply one save operation.
 * @param {object} editor - config editor service.
 * @param {object} found - current entry.
 * @param {object} payload - validated request body.
 * @returns {Promise<object>} response written.
 */
async function save(editor, found, payload) {
  const current = plainConfig(found.entry.options.config)
  if (isExpression(current)) return expressionRefusal()
  if (found.entry.fiber === undefined) return inactiveRefusal()
  const parsed = validateSave(payload)
  if (parsed.error !== undefined) return { status: 400, body: parsed.error }

  let saved
  let inherited
  try {
    await editor.edit(found.entry, (latest, base) => {
      if (fingerprint(latest) !== parsed.value.fingerprint) throw new StaleConfigError()
      saved = mergeSettings(latest, parsed.value.values)
      inherited = base
      return saved
    })
  } catch (error) {
    return sendEditFailure(editor, found, error)
  }
  return { status: 200, body: {
    ok: true,
    entryId: TARGET_ENTRY_ID,
    editable: true,
    isDefault: fingerprint(saved) === fingerprint(inherited),
    values: toValues(saved),
    fingerprint: fingerprint(saved),
  } }
}

/**
 * Remove this page's fields from the profile override.
 * @param {object} editor - config editor service.
 * @param {object} found - current entry.
 * @param {string} expected - fingerprint read by the page.
 * @returns {Promise<object>} response written.
 */
async function reset(editor, found, expected) {
  const current = plainConfig(found.entry.options.config)
  if (isExpression(current)) return expressionRefusal()
  if (found.entry.fiber === undefined) return inactiveRefusal()

  let saved
  let inherited
  try {
    await editor.edit(found.entry, (latest, base) => {
      if (fingerprint(latest) !== expected) throw new StaleConfigError()
      saved = base
      inherited = base
      return base
    })
  } catch (error) {
    return sendEditFailure(editor, found, error)
  }
  return { status: 200, body: {
    ok: true,
    entryId: TARGET_ENTRY_ID,
    editable: true,
    isDefault: true,
    values: toValues(saved),
    fingerprint: fingerprint(saved),
  } }
}

/**
 * Validate a decoded save body.
 * @param {unknown} payload - decoded JSON.
 * @returns {{value?: {fingerprint: string, values: object}} | {error: object}} parsed body or a 400 body.
 */
export function validateSave(payload) {
  if (!isPlainObject(payload)) return { error: invalid('The request body must be a JSON object.') }
  const expected = requireFingerprint(payload)
  if (expected.error !== undefined) return expected
  const values = payload.values
  if (!isPlainObject(values)) return { error: invalid('`values` must be a JSON object.') }
  const unknown = Object.keys(values).filter(key => !SETTING_FIELDS.includes(key))
  if (unknown.length > 0) return { error: invalid(`Unknown setting: ${unknown.join(', ')}.`) }
  const normalized = {}
  for (const [field, rule] of Object.entries(FIELD_RULES)) {
    if (!Object.hasOwn(values, field)) return { error: invalid(`\`${field}\` is required.`) }
    const checked = validateField(field, rule, values[field])
    if (checked.error !== undefined) return checked
    normalized[field] = checked.value
  }
  return { value: { fingerprint: expected.value, values: normalized } }
}

/**
 * Validate one field against its rule.
 * @param {string} field - field name.
 * @param {object} rule - declared shape.
 * @param {unknown} value - supplied value.
 * @returns {{value: unknown} | {error: object}} normalized value or a 400 body.
 */
function validateField(field, rule, value) {
  switch (rule.type) {
    case 'boolean':
      if (typeof value !== 'boolean') return { error: invalid(`\`${field}\` must be a boolean.`) }
      return { value }
    case 'integer': {
      if (!Number.isInteger(value) || value < rule.min || value > rule.max) {
        return { error: invalid(`\`${field}\` must be an integer from ${rule.min} to ${rule.max}.`) }
      }
      return { value }
    }
    case 'string': {
      if (typeof value !== 'string') return { error: invalid(`\`${field}\` must be a string.`) }
      const text = rule.trim === true ? value.trim() : value
      if (text.length < rule.minLength || text.length > rule.maxLength) {
        return { error: invalid(`\`${field}\` must be ${rule.minLength} to ${rule.maxLength} characters.`) }
      }
      if (rule.nonBlank === true && text.trim() === '') return { error: invalid(`\`${field}\` must not be blank.`) }
      return { value: text }
    }
    default:
      return { error: invalid(`\`${field}\` has no validation rule.`) }
  }
}

/**
 * Require the fingerprint the page read before editing.
 * @param {object} payload - decoded request body.
 * @returns {{value: string} | {error: object}} fingerprint or a 400 body.
 */
function requireFingerprint(payload) {
  if (!isPlainObject(payload) || typeof payload.fingerprint !== 'string' || payload.fingerprint === '') {
    return { error: invalid('`fingerprint` is required.') }
  }
  return { value: payload.fingerprint }
}

/**
 * Merge this page's fields into the complete row config.
 * @param {unknown} current - latest complete config.
 * @param {object} values - validated fields.
 * @returns {object} complete next config.
 */
export function mergeSettings(current, values) {
  const next = isPlainObject(current) ? { ...current } : {}
  for (const field of SETTING_FIELDS) next[field] = values[field]
  return next
}

/**
 * Project a raw config onto the page's values.
 * @param {unknown} current - complete config.
 * @returns {{presetId: string, text: string, maxAttempts: number, windowMs: number, requireChildPrompt: boolean}} page values.
 */
export function toValues(current) {
  const raw = isPlainObject(current) ? current : {}
  const merged = { ...DEFAULT_CONFIG, ...raw }
  return {
    presetId: typeof merged.presetId === 'string' && merged.presetId !== '' ? merged.presetId : DEFAULT_CONFIG.presetId,
    text: typeof merged.text === 'string' ? merged.text : DEFAULT_CONFIG.text,
    maxAttempts: Number.isInteger(merged.maxAttempts) ? merged.maxAttempts : DEFAULT_CONFIG.maxAttempts,
    windowMs: Number.isInteger(merged.windowMs) ? merged.windowMs : DEFAULT_CONFIG.windowMs,
    requireChildPrompt: merged.requireChildPrompt === true,
  }
}

/**
 * Find the row the page edits.
 * @param {object} editor - config editor service.
 * @returns {{entry: object, inherited: object} | undefined} the entry and its bundle layer.
 */
function findEntry(editor) {
  try {
    return editor.configuration().find(item => item.entry?.options?.id === TARGET_ENTRY_ID)
  } catch {
    return undefined
  }
}

/**
 * Require the authenticated browser peer, mirroring the code editor gateway.
 * @param {object} ctx - root context carrying `connection`.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {{status: number, body: object} | undefined} rejection, or undefined when admitted.
 */
function authenticate(ctx, req) {
  const connection = ctx.get?.('connection')
  if (connection === undefined || typeof connection.admit !== 'function') {
    return { status: 503, body: { ok: false, code: 'unavailable', message: 'The browser connection service is not available.' } }
  }
  let admission
  try {
    admission = connection.admit({ headers: req.headers ?? {} })
  } catch {
    return { status: 401, body: { ok: false, code: 'unauthenticated', message: 'The request was not admitted.' } }
  }
  if (admission?.rejection !== undefined) {
    return {
      status: admission.rejection === 401 ? 401 : 403,
      body: { ok: false, code: 'unauthenticated', message: 'The browser request was not admitted.' },
    }
  }
  if (connection.browserPeer === undefined || admission?.peer !== connection.browserPeer) {
    return { status: 403, body: { ok: false, code: 'browser-only', message: 'This endpoint accepts authenticated browser requests only.' } }
  }
  return undefined
}

/**
 * Translate an editor failure into the page's error vocabulary.
 * @param {object} editor - config editor service.
 * @param {object} found - entry the write targeted.
 * @param {unknown} error - rejected `edit` call.
 * @returns {object} response written.
 */
function sendEditFailure(editor, found, error) {
  if (error instanceof StaleConfigError) return sendStale(editor, found)
  const message = error instanceof Error ? error.message : String(error)
  if (/overridden by a home patch|command-line overlay/i.test(message)) {
    return { status: 409, body: { ok: false, code: 'overridden', message } }
  }
  if (/no longer available|changed during reload/i.test(message)) {
    return { status: 409, body: { ok: false, code: 'entry-missing', message } }
  }
  if (/no longer active/i.test(message)) {
    return { status: 409, body: { ok: false, code: 'inactive', message } }
  }
  return { status: 400, body: { ok: false, code: 'invalid-value', message } }
}

/**
 * Answer a stale write with fresh values.
 * @param {object} editor - config editor service.
 * @param {object} found - entry the write targeted.
 * @returns {object} response written.
 */
function sendStale(editor, found) {
  const fresh = findEntry(editor)
  if (fresh === undefined) {
    return { status: 409, body: { ok: false, code: 'stale', message: 'These settings changed elsewhere. Reopen the page.' } }
  }
  const current = snapshot(fresh)
  return { status: 409, body: {
    ok: false,
    code: 'stale',
    message: 'These settings changed elsewhere.',
    entryId: current.entryId,
    editable: current.editable,
    ...current.reason === undefined ? {} : { reason: current.reason },
    isDefault: current.isDefault,
    values: current.values,
    fingerprint: current.fingerprint,
  } }
}

/** Refuse a row whose config is a YAML expression. */
function expressionRefusal() {
  return { status: 409, body: {
    ok: false,
    code: 'expression',
    message: 'This row uses a YAML expression. Edit it in cordis.patch.yml instead.',
  } }
}

/** Refuse a row with no live entry. */
function inactiveRefusal() {
  return { status: 409, body: { ok: false, code: 'inactive', message: 'This row is not active.' } }
}

/** Build one 400 body. */
function invalid(message) {
  return { ok: false, code: 'invalid-request', message }
}

/**
 * Whether a value is a plain config object, not a `!!js` expression wrapper.
 * @param {unknown} value - candidate config.
 * @returns {boolean} whether it is a plain object.
 */
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Normalize a config to a plain object.
 * @param {unknown} value - raw config.
 * @returns {object} plain config.
 */
function plainConfig(value) {
  return isPlainObject(value) ? value : {}
}

/**
 * Whether a config is an unevaluated `!!js` expression.
 * @param {unknown} value - candidate config.
 * @returns {boolean} whether it is an expression wrapper.
 */
function isExpression(value) {
  return isPlainObject(value) && Object.keys(value).length === 1 && typeof value.__jsExpr === 'string'
}

/**
 * Hash a config so a page cannot overwrite a concurrent change.
 * @param {unknown} value - config values.
 * @returns {string} SHA-256 over canonical JSON.
 */
export function fingerprint(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/**
 * Stable JSON for hashing; object key order never changes the result.
 * @param {unknown} value - JSON-shaped value.
 * @returns {string} canonical JSON.
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainObject(value)) {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Read a JSON request body with a hard byte cap.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {Promise<{value: unknown} | {error: {status: number, body: object}}>} decoded body or a failure.
 */
async function readJsonRequest(req) {
  const mediaType = headerValue(req.headers, 'content-type').split(';')[0].trim().toLowerCase()
  if (mediaType !== 'application/json') {
    return { error: { status: 415, body: { ok: false, code: 'unsupported-media-type', message: 'Use Content-Type: application/json.' } } }
  }
  const declared = Number(headerValue(req.headers, 'content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { error: { status: 413, body: { ok: false, code: 'request-too-large', message: `The request body is larger than ${MAX_BODY_BYTES} bytes.` } } }
  }
  let text
  try {
    text = await readBody(req, MAX_BODY_BYTES)
  } catch (error) {
    if (error?.code === 'BODY_TOO_LARGE') {
      return { error: { status: 413, body: { ok: false, code: 'request-too-large', message: `The request body is larger than ${MAX_BODY_BYTES} bytes.` } } }
    }
    return { error: { status: 400, body: { ok: false, code: 'invalid-request', message: 'The request body could not be read.' } } }
  }
  try {
    return { value: JSON.parse(text) }
  } catch {
    return { error: { status: 400, body: { ok: false, code: 'invalid-json', message: 'The request body is not valid JSON.' } } }
  }
}

/**
 * Read a request body with a hard byte cap while draining an oversized body.
 * @param {import('node:http').IncomingMessage} req - request stream.
 * @param {number} limit - inclusive byte cap.
 * @returns {Promise<string>} UTF-8 body text.
 */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let tooLarge = false
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    req.on('data', (chunk) => {
      if (tooLarge) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > limit) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('Request body is too large.')
        error.code = 'BODY_TOO_LARGE'
        settle(reject, error)
        return
      }
      settle(resolve, Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', error => settle(reject, error))
    req.on('aborted', () => {
      const error = new Error('Request aborted.')
      error.code = 'REQUEST_ABORTED'
      settle(reject, error)
    })
  })
}

/**
 * Write a JSON response.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {object} payload - JSON-compatible body.
 */
export function sendJson(res, status, payload) {
  if (res.writableEnded === true) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

/**
 * Read the pathname of a request target.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {string} pathname without the query.
 */
function requestPathname(req) {
  const raw = typeof req.url === 'string' && req.url !== '' ? req.url : '/'
  const query = raw.indexOf('?')
  return query === -1 ? raw : raw.slice(0, query)
}

/**
 * Read one lowercase header value.
 * @param {object} headers - request headers.
 * @param {string} name - header name.
 * @returns {string} value, or an empty string.
 */
function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  return typeof value === 'string' ? value : Array.isArray(value) ? value.join(',') : ''
}
