/**
 * Host half of the DSH Web workspace code editor.
 *
 * It registers one authenticated endpoint used by the right-sidebar editor
 * tab. The endpoint is deliberately small: a body is validated, the target is
 * confined to the live Session workspace, the Session sandbox policy is
 * applied, and `fs.writeText` performs the atomic publication with the version
 * guard the editor read from disk.
 *
 * No agent tool, prompt section, or session event is registered here.
 */

/** Absolute path prefix owned by this bundle. */
export const ROUTE_PREFIX = '/__dsh-code-editor'
/** Request body cap; the editor's own file cap is far smaller. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024
/** Largest editable file the editor will send back. */
export const MAX_FILE_BYTES = 1024 * 1024

export const inject = [
  'webServer',
  'connection',
  'fs',
  'sandboxPolicy',
  'sessions',
]

/**
 * Mount the authenticated write route.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: (req, res) => handleRequest(ctx, req, res),
    }),
    'dsh-code-editor: authenticated workspace write endpoint',
  )
}

/**
 * Handle one request to the write endpoint.
 * @param {object} ctx - Host context with connection, fs, policy, and sessions.
 * @param {import('node:http').IncomingMessage} req - HTTP request.
 * @param {import('node:http').ServerResponse} res - HTTP response.
 */
export async function handleRequest(ctx, req, res) {
  try {
    const pathname = requestPathname(req)
    if (pathname !== `${ROUTE_PREFIX}/write`) {
      return sendJson(res, 404, { ok: false, code: 'not-found', message: 'Unknown code editor endpoint.' })
    }
    if (req.method !== 'POST') {
      res.setHeader?.('Allow', 'POST')
      return sendJson(res, 405, { ok: false, code: 'method-not-allowed', message: 'Use POST.' })
    }

    const admission = ctx.connection.admit({ headers: req.headers })
    if (admission.rejection !== undefined) {
      return sendJson(res, admission.rejection, {
        ok: false,
        code: admission.rejection === 401 ? 'unauthenticated' : 'forbidden',
        message: 'The browser request was not admitted.',
      })
    }
    if (ctx.connection.browserPeer === undefined || admission.peer !== ctx.connection.browserPeer) {
      return sendJson(res, 403, {
        ok: false,
        code: 'browser-only',
        message: 'This endpoint accepts authenticated browser requests only.',
      })
    }

    const mediaType = headerValue(req.headers, 'content-type').split(';')[0].trim().toLowerCase()
    if (mediaType !== 'application/json') {
      return sendJson(res, 415, {
        ok: false,
        code: 'unsupported-media-type',
        message: 'Use Content-Type: application/json.',
      })
    }

    const declaredLength = Number(headerValue(req.headers, 'content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return sendJson(res, 413, {
        ok: false,
        code: 'request-too-large',
        message: `The request body is larger than ${MAX_BODY_BYTES} bytes.`,
      })
    }

    let text
    try {
      text = await readBody(req, MAX_BODY_BYTES)
    } catch (error) {
      if (error?.code === 'BODY_TOO_LARGE') {
        return sendJson(res, 413, {
          ok: false,
          code: 'request-too-large',
          message: `The request body is larger than ${MAX_BODY_BYTES} bytes.`,
        })
      }
      throw error
    }

    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      return sendJson(res, 400, {
        ok: false,
        code: 'invalid-json',
        message: 'The request body is not valid JSON.',
      })
    }

    const validation = validatePayload(payload)
    if (validation.error !== undefined) {
      return sendJson(res, validation.status, {
        ok: false,
        code: validation.code,
        message: validation.error,
      })
    }
    const { sessionId, path, content, expectedVersion, force } = validation.value

    const session = ctx.sessions.get(sessionId)
    if (session === undefined) {
      return sendJson(res, 404, {
        ok: false,
        code: 'session-not-found',
        message: 'The Session is not live. Open the Session before saving.',
      })
    }

    const workspaceRoot = session.header.cwd ?? ctx.sandboxPolicy.workspaceRoot
    const rootTarget = await ctx.fs.resolve(workspaceRoot, { signal: undefined })
    const target = await ctx.fs.resolve(path, { cwd: workspaceRoot, signal: undefined })
    if (!ctx.fs.contains(rootTarget, target)) {
      return sendJson(res, 403, {
        ok: false,
        code: 'outside-workspace',
        message: 'The target is outside the Session workspace.',
      })
    }

    const current = await ctx.fs.lstat(path, { cwd: workspaceRoot }, undefined)
    if (current === undefined) {
      return sendJson(res, 404, {
        ok: false,
        code: 'file-not-found',
        message: 'The file does not exist.',
      })
    }
    if (current.type === 'symlink') {
      return sendJson(res, 400, {
        ok: false,
        code: 'symlink-not-supported',
        message: 'Files reached through a final symbolic link cannot be edited.',
      })
    }
    if (current.type !== 'file') {
      return sendJson(res, 400, {
        ok: false,
        code: 'not-a-regular-file',
        message: 'Only regular files can be edited.',
      })
    }

    const policy = ctx.sandboxPolicy.resolve({ session })
    if (policy.mode === 'read-only') {
      return sendJson(res, 403, {
        ok: false,
        code: 'read-only',
        message: 'This Session is read-only. Switch its file policy before saving.',
      })
    }

    const expected = force
      ? undefined
      : { kind: 'replaceIfVersion', version: expectedVersion }

    let outcome
    try {
      outcome = await ctx.fs.writeText(target, content, expected, undefined, policy)
    } catch (error) {
      if (error?.code === 'FS_STALE_VERSION') {
        let version
        try {
          version = (await ctx.fs.stat(target, undefined))?.version
        } catch {
          version = undefined
        }
        return sendJson(res, 409, {
          ok: false,
          code: 'stale',
          message: 'The file changed on disk after it was read.',
          ...(version === undefined ? {} : { version }),
        })
      }
      if (error?.code === 'FS_SANDBOX_DENIED' || error?.code === 'FS_PERMISSION_DENIED') {
        return sendJson(res, 403, {
          ok: false,
          code: 'write-denied',
          message: error.message ?? 'The file policy denied this write.',
        })
      }
      throw error
    }

    return sendJson(res, 200, {
      ok: true,
      operation: outcome.operation,
      version: outcome.version,
    })
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      code: 'internal-error',
      message: 'The code editor could not complete the request.',
    })
  }
}

/**
 * Validate one decoded write payload.
 * @param {unknown} payload - Parsed JSON value.
 * @returns {{value: {sessionId: string, path: string, content: string, expectedVersion: string|undefined, force: boolean}} | {error: string, status: number, code: string}}
 */
export function validatePayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail(400, 'invalid-request', 'The request body must be a JSON object.')
  }
  const record = /** @type {Record<string, unknown>} */ (payload)
  if (typeof record.sessionId !== 'string' || record.sessionId.length === 0) {
    return fail(400, 'invalid-request', '`sessionId` must be a non-empty string.')
  }
  if (typeof record.path !== 'string' || record.path.length === 0 || record.path.includes('\0')) {
    return fail(400, 'invalid-request', '`path` must be a non-empty path without NUL bytes.')
  }
  if (typeof record.content !== 'string') {
    return fail(400, 'invalid-request', '`content` must be a string.')
  }
  if (Buffer.byteLength(record.content, 'utf8') > MAX_FILE_BYTES) {
    return fail(413, 'file-too-large', `Files are limited to ${MAX_FILE_BYTES} bytes.`)
  }
  const force = record.force === true
  const expectedVersion = record.expectedVersion
  if (force !== true && (typeof expectedVersion !== 'string' || expectedVersion.length === 0)) {
    return fail(
      400,
      'missing-version',
      '`expectedVersion` is required unless `force` is true.',
    )
  }
  if (expectedVersion !== undefined && typeof expectedVersion !== 'string') {
    return fail(400, 'invalid-request', '`expectedVersion` must be a string when supplied.')
  }
  return {
    value: {
      sessionId: record.sessionId,
      path: record.path,
      content: record.content,
      expectedVersion: force ? undefined : expectedVersion,
      force,
    },
  }
}

/**
 * Read a request body with a hard byte cap while draining an oversized body.
 * @param {import('node:http').IncomingMessage} req - Request stream.
 * @param {number} limit - Inclusive byte cap.
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
    req.on('error', (error) => settle(reject, error))
    req.on('aborted', () => {
      const error = new Error('Request aborted.')
      error.code = 'REQUEST_ABORTED'
      settle(reject, error)
    })
  })
}

/**
 * Write a JSON response.
 * @param {import('node:http').ServerResponse} res - Response.
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
 * @param {import('node:http').IncomingMessage} req - Request.
 * @returns {string} Pathname without the query.
 */
function requestPathname(req) {
  const raw = typeof req.url === 'string' ? req.url : ''
  const query = raw.indexOf('?')
  return query === -1 ? raw : raw.slice(0, query)
}

/**
 * Read one header as a string.
 * @param {import('node:http').IncomingHttpHeaders} headers - Request headers.
 * @param {string} name - Lowercase header name.
 * @returns {string} Header value or an empty string.
 */
function headerValue(headers, name) {
  const value = headers === undefined || headers === null ? undefined : headers[name]
  if (Array.isArray(value)) return value.join(', ')
  return typeof value === 'string' ? value : ''
}

/**
 * Build one validation failure.
 * @param {number} status - HTTP status.
 * @param {string} code - Stable failure code.
 * @param {string} error - Human-readable message.
 */
function fail(status, code, error) {
  return { status, code, error }
}
