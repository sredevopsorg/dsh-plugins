/**
 * `@sredevopsorg/dsh-subagent-opencode/conformance` — a preset's providers.
 *
 * A bundle that ships an agent preset and a subagent provider in one package
 * installs both in **one** profile, and DSH presets cannot mount host
 * services: a preset only binds a tool to a provider that some other row has
 * already registered. This optional row closes the gap those two facts leave
 * with one composition-time check.
 *
 * Once the host has composed every row, it confirms that each provider named
 * in `providers` is actually registered. An in-process provider counts through
 * `ctx.subagents`; an external one counts through its package's declared
 * `providerNames`, exactly as `scripts/validate-bundles.mjs` establishes the
 * same fact at build time.
 *
 * The check reports and never blocks. It does not install, mount, or replace a
 * provider, and it never fails the profile: DSH already refuses a component
 * that requires a missing service, so this diagnostic only says **why** a
 * preset's `subagent_opencode` tool is absent and what supplies it.
 *
 * @module @sredevopsorg/dsh-subagent-opencode/conformance
 */

/** Cordis plugin name. */
export const name = 'subagent-opencode-conformance'

/** How long the host composition may take before the check gives up, in ms. */
export const DEFAULT_TIMEOUT_MS = 10_000

/** Defaults applied to a row that declares no `config`. */
export const DEFAULT_CONFIG = Object.freeze({
  /** Provider names a preset binds and expects someone to register. */
  providers: Object.freeze(['opencode-preset', 'opencode']),
  /** Providers an external package declares without an in-process registration. */
  providerNames: Object.freeze([]),
  /** Bound on the wait for the host composition, in milliseconds. */
  timeoutMs: DEFAULT_TIMEOUT_MS,
})

/**
 * Merge a row's `config` with {@link DEFAULT_CONFIG}.
 *
 * Invalid or missing values fall back to the default instead of failing the
 * row, so a stale profile patch keeps working.
 * @param {unknown} raw - the row's config, or undefined.
 * @returns {{providers: string[], providerNames: string[], timeoutMs: number}} resolved config.
 */
export function normalizeConfig(raw) {
  const config = {
    providers: [...DEFAULT_CONFIG.providers],
    providerNames: [...DEFAULT_CONFIG.providerNames],
    timeoutMs: DEFAULT_CONFIG.timeoutMs,
  }
  if (raw === null || typeof raw !== 'object') return config
  const record = /** @type {Record<string, unknown>} */ (raw)
  const providers = stringList(record.providers)
  // An explicit empty list turns the check off; omission keeps the default.
  if (Array.isArray(record.providers)) config.providers = providers
  config.providerNames = stringList(record.providerNames)
  if (Number.isSafeInteger(record.timeoutMs) && record.timeoutMs > 0) config.timeoutMs = record.timeoutMs
  return config
}

/**
 * Keep the non-empty trimmed strings of a candidate list.
 * @param {unknown} value - candidate.
 * @returns {string[]} trimmed strings.
 */
function stringList(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter(entry => typeof entry === 'string' && entry.trim() !== '')
    .map(entry => entry.trim())
}

/**
 * Whether a provider name has a registration behind it.
 * @param {object} ctx - plugin context.
 * @param {string} provider - the name a delegation row binds.
 * @param {readonly string[]} declared - names external packages declare.
 * @returns {boolean} whether the provider is registered or declared.
 */
export function providerAvailable(ctx, provider, declared) {
  if (declared.includes(provider)) return true
  try {
    return ctx?.subagents?.getProvider?.(provider) !== undefined
  } catch {
    return false
  }
}

/**
 * The fixed diagnostic for an unbacked provider.
 * @param {string} provider - the bound provider name.
 * @returns {string} one diagnostic line.
 */
export function missingProviderDiagnostic(provider) {
  return (
    `subagent-opencode: provider ${JSON.stringify(provider)} is not registered; ` +
    `a preset that binds it will not get its \`subagent_opencode\` tool. ` +
    `Supply it with \`permission: session\` from this package's own provider row (` +
    `\`providerName: ${provider}\`, or \`opencode\`), or install a package that registers it.`
  )
}

/**
 * Report every named provider that has no registration behind it.
 * @param {object} ctx - plugin context.
 * @param {{providers: readonly string[], providerNames: readonly string[]}} config - resolved config.
 * @returns {string[]} diagnostics; empty when every provider is backed.
 */
export function inspectProviders(ctx, config) {
  return config.providers
    .filter(provider => !providerAvailable(ctx, provider, config.providerNames))
    .map(missingProviderDiagnostic)
}

/**
 * Mount the check. It runs after the host composition settles and reports only.
 * @param {object} ctx - plugin context.
 * @param {unknown} rawConfig - the row's `config`.
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const warn = (line) => ctx.logger?.warn?.(line)
  const report = () => {
    try {
      for (const diagnostic of inspectProviders(ctx, config)) warn(diagnostic)
    } catch (error) {
      warn(`subagent-opencode: conformance check could not run: ${String(error)}`)
    }
  }
  // The host emits `ready` once composition settles. Racing it with a timeout
  // keeps a host that never emits one from holding the check forever, and a
  // host without the event reports at once from what it has composed so far.
  try {
    if (typeof ctx.parallel !== 'function') {
      report()
      return
    }
    const ready = ctx.parallel('ready').catch(() => {})
    void Promise.race([
      ready.then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), config.timeoutMs).unref?.()),
    ]).then(() => report())
  } catch (error) {
    warn(`subagent-opencode: conformance check could not start: ${String(error)}`)
  }
}
