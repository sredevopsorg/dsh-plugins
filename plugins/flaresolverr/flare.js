/**
 * flare.js — the FlareSolverr wire-protocol adapter.
 *
 * Knows three routes and the shape of their responses, and nothing about
 * Docker or workspace policy:
 *
 *   GET  /        welcome + the User-Agent the solver will use
 *   GET  /health  readiness probe
 *   POST /v1      the command API
 *
 * The one non-obvious rule lives here: a failed command returns HTTP 500 with
 * a *valid* JSON body carrying FlareSolverr's own `message`. Reading the status
 * before the body would discard the only useful diagnostic, so the body is
 * parsed first and the status only decides success when the body is unusable.
 *
 * Deliberately dependency-free: global `fetch` and `node:` imports only.
 */

/** The five commands the v1 API accepts. */
export const COMMANDS = Object.freeze([
  'sessions.create',
  'sessions.list',
  'sessions.destroy',
  'request.get',
  'request.post'
]);

/** Commands that require a `url`. */
export const URL_COMMANDS = Object.freeze(['request.get', 'request.post']);

/** Default solve budget, matching the API's own default. */
export const DEFAULT_MAX_TIMEOUT_MS = 60_000;

const HEALTH_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** A protocol-level failure: transport, malformed response, or the API's own error status. */
export class FlareError extends Error {
  /**
   * @param message - what went wrong, in the API's own words where available.
   * @param code - stable classifier for the caller.
   * @param options - optional hint and cause.
   */
  constructor(message, code, options = {}) {
    super(message);
    this.name = 'FlareError';
    this.code = code;
    this.hint = options.hint ?? '';
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Translate a fetch rejection into a transport diagnosis rather than an opaque abort. */
function transportError(error, signal) {
  if (signal?.aborted === true) {
    return new FlareError('the request was cancelled', 'aborted');
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED/i.test(message)) {
    return new FlareError(
      'connection refused — the container is not accepting connections yet or has exited',
      'connection-refused',
      { hint: 'Check the container logs; Chromium may have failed to start.', cause: error }
    );
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return new FlareError(`the endpoint host could not be resolved: ${message}`, 'dns', { cause: error });
  }
  if (/aborted|AbortError|timeout/i.test(message)) {
    return new FlareError(`the request timed out or was aborted: ${message}`, 'timeout', { cause: error });
  }
  return new FlareError(`transport failure: ${message}`, 'transport', { cause: error });
}

/** Read a bounded response body as text, refusing to buffer an unbounded stream. */
async function readBoundedText(response) {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new FlareError(
      `the response announced ${declared} bytes, above the ${MAX_BODY_BYTES}-byte adapter cap`,
      'too-large',
      { hint: 'Retry with disableMedia=true, or narrow the request.' }
    );
  }
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new FlareError(`the response exceeded the ${MAX_BODY_BYTES}-byte adapter cap`, 'too-large', {
      hint: 'Retry with disableMedia=true, or narrow the request.'
    });
  }
  return text;
}

/**
 * Probe readiness. Never throws: a probe that cannot connect is simply "not ready",
 * and the caller's poll loop decides what that means.
 *
 * @param endpoint - `host:port` of the API.
 * @param timeoutMs - per-probe budget.
 * @param outerSignal - caller cancellation.
 * @returns the parsed health payload, or undefined when the service is not answering.
 */
export async function health(endpoint, timeoutMs = HEALTH_TIMEOUT_MS, outerSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (outerSignal !== undefined) {
    if (outerSignal.aborted) return undefined;
    outerSignal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://${endpoint}/health`, { signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const text = await response.text();
    try {
      const parsed = JSON.parse(text);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    if (outerSignal !== undefined) outerSignal.removeEventListener('abort', onAbort);
  }
}

/**
 * Read the welcome payload, which is where the solver's User-Agent is published.
 * @param endpoint - `host:port` of the API.
 * @param signal - cancellation.
 * @returns the parsed index payload, or undefined when unavailable.
 */
export async function index(endpoint, signal) {
  try {
    const response = await fetch(`http://${endpoint}/`, { signal });
    if (!response.ok) return undefined;
    const parsed = JSON.parse(await response.text());
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run one command against `POST /v1`.
 *
 * @param endpoint - `host:port` of the API.
 * @param body - the command payload; `cmd` is mandatory.
 * @param timeoutMs - transport deadline, derived by the caller from `maxTimeout` plus slack.
 * @param signal - caller cancellation.
 * @returns the parsed response envelope.
 * @throws {FlareError} for transport failures, unparseable bodies, and large bodies.
 */
export async function run(endpoint, body, timeoutMs, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal !== undefined) {
    if (signal.aborted) throw new FlareError('the request was cancelled', 'aborted');
    signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let text;
  let status;
  try {
    const response = await fetch(`http://${endpoint}/v1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    status = response.status;
    text = await readBoundedText(response);
  } catch (error) {
    if (error instanceof FlareError) throw error;
    throw transportError(error, signal);
  } finally {
    clearTimeout(timer);
    if (signal !== undefined) signal.removeEventListener('abort', onAbort);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Only reachable when the service is not actually FlareSolverr, or a proxy
    // intercepted the call; the status is the useful part here.
    throw new FlareError(
      `the endpoint answered HTTP ${status} with a non-JSON body: ${text.slice(0, 200)}`,
      'bad-response',
      { hint: 'Confirm the published port really maps to FlareSolverr rather than another service.' }
    );
  }

  if (!isRecord(parsed)) {
    throw new FlareError(`the endpoint answered HTTP ${status} with a non-object JSON body`, 'bad-response');
  }

  // A 500 with a valid envelope is FlareSolverr reporting its own failure, and
  // its `message` is the whole diagnostic. Surface it as an error, not a result.
  if (parsed.status === 'error' || (status >= 400 && typeof parsed.message === 'string' && parsed.message !== '')) {
    throw new FlareError(parsed.message ?? `HTTP ${status}`, 'command-failed', {
      hint: captchaHint(parsed.message)
    });
  }

  return parsed;
}

/** The captcha case is common enough — and confusing enough — to deserve its own note. */
function captchaHint(message) {
  if (typeof message !== 'string') return '';
  if (/captcha/i.test(message)) {
    return 'FlareSolverr cannot solve interactive CAPTCHAs; upstream states no automatic solver currently works. Use a session and solve once manually, or choose a different target.';
  }
  if (/timeout after/i.test(message)) {
    return 'The challenge did not clear within maxTimeout. Re-run with a session for a better chance, or raise maxTimeout.';
  }
  return '';
}

/**
 * Project a raw response into the bounded summary the model reads by default.
 *
 * `solution.response` is a full page of third-party HTML; returning it verbatim
 * would flood the context on every call. The summary keeps the decisive parts —
 * outcome, final URL, status, size, the User-Agent, and the cookies — and leaves
 * the body available behind an explicit opt-in.
 *
 * @param envelope - the parsed `POST /v1` response.
 * @param includeBody - whether to include the HTML body.
 * @returns a JSON-serializable summary.
 */
export function summarize(envelope, includeBody) {
  const solution = isRecord(envelope.solution) ? envelope.solution : {};
  const cookies = Array.isArray(solution.cookies) ? solution.cookies.filter(isRecord) : [];
  const response = typeof solution.response === 'string' ? solution.response : '';

  const summary = {
    status: envelope.status,
    message: envelope.message,
    version: envelope.version,
    solution: {
      url: solution.url,
      status: solution.status,
      userAgent: solution.userAgent,
      turnstileToken: solution.turnstile_token,
      cookieCount: cookies.length,
      cookies: cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite
      })),
      bodyBytes: response.length,
      ...(includeBody ? { response } : {})
    }
  };

  // `sessions.list` answers with a top-level array; `sessions.create` and
  // `sessions.destroy` answer with a top-level string. Both sit outside
  // `solution`, which is why they are projected separately.
  if (Array.isArray(envelope.sessions)) summary.sessions = envelope.sessions;
  if (typeof envelope.session === 'string') summary.session = envelope.session;
  if (typeof solution.screenshot === 'string') {
    summary.solution.screenshotBytes = solution.screenshot.length;
    if (includeBody === true) summary.solution.screenshot = solution.screenshot;
  }

  return summary;
}

/** Carry the solver's own wording for a User-Agent mismatch, which silently breaks cookie reuse. */
export const USER_AGENT_TRAP =
  'A Cloudflare clearance cookie only works for the exact User-Agent that solved the challenge. Reuse solution.userAgent verbatim in the downstream HTTP client, or the challenge reappears.';
