/**
 * Host half of the OpenCode subagent's Web settings page.
 *
 * The provider row owns behavior; this module adds only the authenticated
 * bridge the bundle's browser half calls. Values are read from the live
 * `subagent-opencode` entry and written through {@link ConfigEditor.edit}, so
 * the profile patch keeps its comments and unrelated rows, DSH validates the
 * candidate against the plugin's own `Config`, and the Loader reloads the
 * provider with the new values.
 *
 * Two details make the page safe in this bundle:
 *
 * - The package may be mounted twice in one profile (the standard provider row
 *   plus the preset's `opencode-preset` row), so route registration is
 *   reference counted per Web server instead of colliding on one path.
 * - The route resolves the conventional row first and falls back to the only
 *   active row whose module is this package, and it reads services from the
 *   root context, so it survives the provider row's own reload.
 *
 * Literal `env` maps are deliberately not exposed: they may carry secrets.
 * They stay untouched in `cordis.patch.yml` and are preserved by the merge.
 *
 * @module @sredevopsorg/dsh-subagent-opencode/settings
 */

import { createHash } from 'node:crypto'
import { MANAGERS } from './install.js'
import {
  REQUIREMENTS,
  assertInstallPaths,
  assertModel,
  assertRequirements,
} from './requirements.js'

/** Absolute path prefix owned by the settings bridge. */
export const ROUTE_PREFIX = '/__dsh-subagent-opencode-settings'

/** Request body cap. */
export const MAX_BODY_BYTES = 64 * 1024

/** Package name; a row with this specifier carries the browser half. */
export const PACKAGE_NAME = '@sredevopsorg/dsh-subagent-opencode'

/** Conventional provider row id. */
export const TARGET_ENTRY_ID = 'subagent-opencode'

/** Top-level fields this page owns. */
export const SETTING_FIELDS = Object.freeze([
  'providerName', 'command', 'args', 'permission', 'passEnv', 'disposeGraceMs', 'requirements',
])

/** Requirement fields this page owns. `env` is intentionally absent. */
export const REQUIREMENT_FIELDS = Object.freeze([
  'require', 'credentials', 'model', 'mode', 'effort', 'home',
  'install', 'installManager', 'installDir', 'installArgs', 'installTimeoutMs',
])

/** Display defaults matching the plugin's own fallbacks. */
export const DEFAULTS = Object.freeze({
  providerName: 'opencode',
  command: 'opencode',
  args: Object.freeze(['acp']),
  permission: 'session',
  passEnv: Object.freeze(['OPENCODE_*', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'HOME']),
  disposeGraceMs: 3_000,
  requirements: Object.freeze({
    require: Object.freeze([]),
    credentials: Object.freeze([]),
    install: false,
    installManager: 'pnpm',
    installArgs: Object.freeze([]),
    installTimeoutMs: 300_000,
  }),
})

/** Routes shared by every mounted instance of this package. */
const routes = new WeakMap()

/** Raised when the browser edited a config someone else already replaced. */
class StaleConfigError extends Error {
  constructor() {
    super('The settings changed since this page read them.')
    this.name = 'StaleConfigError'
  }
}

/**
 * Register the settings bridge on a host context.
 * @param {object} ctx - host plugin context.
 */
export function registerSettingsRoute(ctx) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.inject !== 'function') return
  ctx.inject(['webServer', 'connection'], (scope) => {
    if (scope === null || typeof scope !== 'object' || scope.webServer === undefined) return
    if (typeof scope.effect !== 'function') return
    scope.effect(() => acquireRoute(scope), 'subagent-opencode: Web settings route')
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
      return sendJson(res, 404, { ok: false, code: 'entry-missing', message: 'The OpenCode subagent row is not active.' })
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
    entryId: found.entry.options.id,
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
 * @param {object} payload - decoded request body.
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
    entryId: found.entry.options.id,
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
    entryId: found.entry.options.id,
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
  for (const field of SETTING_FIELDS) {
    if (!Object.hasOwn(values, field)) return { error: invalid(`\`${field}\` is required.`) }
    if (field === 'requirements') {
      const requirements = validateRequirements(values.requirements)
      if (requirements.error !== undefined) return requirements
      normalized.requirements = requirements.value
      continue
    }
    const checked = validateScalar(field, values[field])
    if (checked.error !== undefined) return checked
    normalized[field] = checked.value
  }
  return { value: { fingerprint: expected.value, values: normalized } }
}

/**
 * Validate the curated requirement block.
 * @param {unknown} value - supplied requirement object.
 * @returns {{value: object} | {error: object}} normalized requirements or a 400 body.
 */
function validateRequirements(value) {
  if (!isPlainObject(value)) return { error: invalid('`requirements` must be a JSON object.') }
  const unknown = Object.keys(value).filter(key => !REQUIREMENT_FIELDS.includes(key))
  if (unknown.length > 0) return { error: invalid(`Unknown requirement setting: ${unknown.join(', ')}.`) }
  const normalized = {}
  for (const field of REQUIREMENT_FIELDS) {
    if (!Object.hasOwn(value, field)) return { error: invalid(`\`requirements.${field}\` is required.`) }
    const input = value[field]
    switch (field) {
      case 'require': {
        if (!Array.isArray(input) || input.some(gate => typeof gate !== 'string')) {
          return { error: invalid('`requirements.require` must be an array of gate names.') }
        }
        try {
          assertRequirements(input)
        } catch (error) {
          return { error: invalid(errorText(error)) }
        }
        if (new Set(input).size !== input.length) return { error: invalid('`requirements.require` must not repeat a gate.') }
        normalized[field] = [...input]
        break
      }
      case 'credentials':
      case 'installArgs': {
        const checked = validateStringArray(field, input, { allowEmpty: true })
        if (checked.error !== undefined) return checked
        normalized[field] = checked.value
        break
      }
      case 'install': {
        if (typeof input !== 'boolean') return { error: invalid('`requirements.install` must be a boolean.') }
        normalized[field] = input
        break
      }
      case 'installManager': {
        if (!MANAGERS.includes(input)) {
          return { error: invalid(`\`requirements.installManager\` accepts ${MANAGERS.join(', ')}; found ${JSON.stringify(input)}.`) }
        }
        normalized[field] = input
        break
      }
      case 'installTimeoutMs': {
        if (!Number.isInteger(input) || input <= 0 || input > 0x7fff_ffff) {
          return { error: invalid('`requirements.installTimeoutMs` must be a positive integer.') }
        }
        normalized[field] = input
        break
      }
      case 'model': {
        if (input === null) { normalized[field] = null; break }
        if (typeof input !== 'string' || input.trim() === '') return { error: invalid('`requirements.model` must be a string or null.') }
        try {
          assertModel(input)
        } catch (error) {
          return { error: invalid(errorText(error)) }
        }
        normalized[field] = input
        break
      }
      case 'installDir': {
        if (input === null) { normalized[field] = null; break }
        if (typeof input !== 'string' || input.trim() === '') return { error: invalid('`requirements.installDir` must be a string or null.') }
        try {
          assertInstallPaths({ installDir: input })
        } catch (error) {
          return { error: invalid(errorText(error)) }
        }
        normalized[field] = input
        break
      }
      case 'mode':
      case 'effort':
      case 'home': {
        if (input === null) { normalized[field] = null; break }
        if (typeof input !== 'string' || input.trim() === '' || input.length > 4096) {
          return { error: invalid(`\`requirements.${field}\` must be a string or null.`) }
        }
        normalized[field] = input
        break
      }
      default:
        return { error: invalid(`\`requirements.${field}\` has no validation rule.`) }
    }
  }
  return { value: normalized }
}

/**
 * Validate one top-level scalar or list.
 * @param {string} field - field name.
 * @param {unknown} value - supplied value.
 * @returns {{value: unknown} | {error: object}} normalized value or a 400 body.
 */
function validateScalar(field, value) {
  switch (field) {
    case 'providerName':
    case 'command': {
      if (typeof value !== 'string' || value.trim() === '' || value.length > 1024) {
        return { error: invalid(`\`${field}\` must be a non-empty string.`) }
      }
      return { value: field === 'providerName' ? value.trim() : value }
    }
    case 'permission': {
      if (!['session', 'reject', 'allow'].includes(value)) {
        return { error: invalid('`permission` accepts session, reject, or allow.') }
      }
      return { value }
    }
    case 'args':
    case 'passEnv': {
      return validateStringArray(field, value, { allowEmpty: true })
    }
    case 'disposeGraceMs': {
      if (!Number.isInteger(value) || value <= 0 || value > 0x7fff_ffff) {
        return { error: invalid('`disposeGraceMs` must be a positive integer.') }
      }
      return { value }
    }
    default:
      return { error: invalid(`\`${field}\` has no validation rule.`) }
  }
}

/**
 * Validate an array of non-empty strings.
 * @param {string} field - field name used in messages.
 * @param {unknown} value - supplied value.
 * @param {{allowEmpty: boolean}} options - whether an empty array is accepted.
 * @returns {{value: string[]} | {error: object}} normalized list or a 400 body.
 */
function validateStringArray(field, value, options) {
  if (!Array.isArray(value)) return { error: invalid(`\`${field}\` must be an array of strings.`) }
  if (value.length > 256) return { error: invalid(`\`${field}\` accepts at most 256 entries.`) }
  if (!options.allowEmpty && value.length === 0) return { error: invalid(`\`${field}\` must not be empty.`) }
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || item.length > 4096) {
      return { error: invalid(`\`${field}\` entries must be non-empty strings.`) }
    }
  }
  return { value: [...value] }
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
  for (const field of SETTING_FIELDS) {
    if (field !== 'requirements') next[field] = values[field]
  }
  const requirements = isPlainObject(next.requirements) ? { ...next.requirements } : {}
  const patch = isPlainObject(values.requirements) ? values.requirements : {}
  for (const field of REQUIREMENT_FIELDS) {
    if (!Object.hasOwn(patch, field)) continue
    if (patch[field] === null) delete requirements[field]
    else requirements[field] = patch[field]
  }
  next.requirements = requirements
  return next
}

/**
 * Project a raw config onto the page's values.
 * @param {unknown} current - complete config.
 * @returns {object} page values.
 */
export function toValues(current) {
  const raw = isPlainObject(current) ? current : {}
  const requirements = isPlainObject(raw.requirements) ? raw.requirements : {}
  return {
    providerName: text(raw.providerName, DEFAULTS.providerName),
    command: text(raw.command, DEFAULTS.command),
    args: stringArray(raw.args, DEFAULTS.args),
    permission: ['session', 'reject', 'allow'].includes(raw.permission) ? raw.permission : DEFAULTS.permission,
    passEnv: stringArray(raw.passEnv, DEFAULTS.passEnv),
    disposeGraceMs: integer(raw.disposeGraceMs, DEFAULTS.disposeGraceMs),
    requirements: {
      require: Array.isArray(requirements.require)
        ? [...new Set(requirements.require.filter(gate => typeof gate === 'string' && REQUIREMENTS.includes(gate)))]
        : [],
      credentials: stringArray(requirements.credentials, DEFAULTS.requirements.credentials),
      model: optionalText(requirements.model),
      mode: optionalText(requirements.mode),
      effort: optionalText(requirements.effort),
      home: optionalText(requirements.home),
      install: requirements.install === true,
      installManager: MANAGERS.includes(requirements.installManager)
        ? requirements.installManager
        : DEFAULTS.requirements.installManager,
      installDir: optionalText(requirements.installDir),
      installArgs: stringArray(requirements.installArgs, DEFAULTS.requirements.installArgs),
      installTimeoutMs: integer(requirements.installTimeoutMs, DEFAULTS.requirements.installTimeoutMs),
    },
  }
}

/**
 * Find the provider row the page edits.
 * @param {object} editor - config editor service.
 * @returns {{entry: object, inherited: object} | undefined} the entry and its bundle layer.
 */
function findEntry(editor) {
  try {
    const entries = editor.configuration()
    const conventional = entries.find(item => item.entry?.options?.id === TARGET_ENTRY_ID)
    if (conventional !== undefined) return conventional
    return entries.find(item => item.entry?.options?.name === PACKAGE_NAME)
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
  const message = errorText(error)
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

/** Render an unknown thrown value as text. */
function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Read a string with a fallback. */
function text(value, fallback) {
  return typeof value === 'string' && value !== '' ? value : fallback
}

/** Read an optional string. */
function optionalText(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

/** Read a string array with a fallback. */
function stringArray(value, fallback) {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value] : [...fallback]
}

/** Read an integer with a fallback. */
function integer(value, fallback) {
  return Number.isInteger(value) ? value : fallback
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
 * Whether a value is a plain config object.
 * @param {unknown} value - candidate config.
 * @returns {boolean} whether it is a plain object.
 */
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
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
