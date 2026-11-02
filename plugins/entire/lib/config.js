/**
 * Row config for the Entire toolkit.
 *
 * A workspace-linked plugin cannot resolve bare `@deepseek-ai/*` specifiers
 * unless its manifest declares them, so this package stays dependency-free and
 * validates its own config instead of exporting a zod `Config` schema. The
 * posture matches the local flaresolverr plugin: every key is optional and a
 * malformed value falls back to its default rather than failing activation.
 */

export const DEFAULTS = Object.freeze({
  /** Executable name or absolute path. */
  binary: 'entire',
  /** Empty means "use the Session's working directory". */
  repoPath: '',
  /** Permit repository-scoped mutations after approval. */
  allowWrites: false,
  /** Permit machine/account/control-plane commands after approval; implies writes. */
  allowAdmin: false,
  /** Default per-call timeout in milliseconds. */
  timeoutMs: 600_000,
  /** Head/tail truncation budget in characters. */
  maxOutputChars: 24_000,
  /** Add the Entire section to the system prompt. */
  promptSection: true,
  /** Forward DSH session lifecycle events to `entire hooks dsh`. */
  capture: true,
  /** Repository marker written by `entire-agent-dsh install-hooks`; empty skips the repo scope. */
  captureMarker: '.entire/dsh-hooks.json',
  /** Timeout for one forwarded hook call. */
  captureTimeoutMs: 10_000
});

export const MIN_TIMEOUT_MS = 5_000;
export const MAX_TIMEOUT_MS = 3_600_000;
export const MIN_CAPTURE_TIMEOUT_MS = 1_000;
export const MAX_CAPTURE_TIMEOUT_MS = 120_000;
export const MIN_OUTPUT_CHARS = 2_000;
export const MAX_OUTPUT_CHARS = 200_000;

/** True for a non-null, non-array object. */
export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve the row's `config` into a complete, frozen settings object.
 *
 * @param raw - the row's `config` object, possibly undefined or malformed.
 * @returns a complete settings object.
 */
export function resolveConfig(raw) {
  const config = { ...DEFAULTS };
  if (!isRecord(raw)) return Object.freeze(config);

  if (typeof raw.binary === 'string' && raw.binary.trim() !== '') {
    config.binary = raw.binary.trim();
  }
  if (typeof raw.repoPath === 'string') {
    config.repoPath = raw.repoPath.trim();
  }
  if (typeof raw.allowWrites === 'boolean') config.allowWrites = raw.allowWrites;
  if (typeof raw.allowAdmin === 'boolean') config.allowAdmin = raw.allowAdmin;
  if (
    Number.isInteger(raw.timeoutMs) &&
    raw.timeoutMs >= MIN_TIMEOUT_MS &&
    raw.timeoutMs <= MAX_TIMEOUT_MS
  ) {
    config.timeoutMs = raw.timeoutMs;
  }
  if (
    Number.isInteger(raw.maxOutputChars) &&
    raw.maxOutputChars >= MIN_OUTPUT_CHARS &&
    raw.maxOutputChars <= MAX_OUTPUT_CHARS
  ) {
    config.maxOutputChars = raw.maxOutputChars;
  }
  if (typeof raw.promptSection === 'boolean') config.promptSection = raw.promptSection;
  if (typeof raw.capture === 'boolean') config.capture = raw.capture;
  if (typeof raw.captureMarker === 'string') config.captureMarker = raw.captureMarker.trim();
  if (
    Number.isInteger(raw.captureTimeoutMs) &&
    raw.captureTimeoutMs >= MIN_CAPTURE_TIMEOUT_MS &&
    raw.captureTimeoutMs <= MAX_CAPTURE_TIMEOUT_MS
  ) {
    config.captureTimeoutMs = raw.captureTimeoutMs;
  }

  return Object.freeze(config);
}

/** True when the settings allow repository-scoped mutations. */
export function writesAllowed(settings) {
  return settings.allowWrites === true || settings.allowAdmin === true;
}

/** True when the settings allow machine/account/control-plane commands. */
export function adminAllowed(settings) {
  return settings.allowAdmin === true;
}
