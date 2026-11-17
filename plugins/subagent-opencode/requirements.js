/**
 * Required OpenCode configurations: declare, enforce, relay.
 *
 * OpenCode reads its provider credentials from its own environment and its
 * stored logins, while the DSH subprocess seam scrubs credential-shaped
 * variables from every child. A delegation therefore needs two things the
 * seam cannot infer:
 *
 * - an explicit list of names to relay back to the child (`credentials`), and
 * - an explicit statement of which configuration is mandatory (`require`), so
 *   a misconfigured profile fails when it loads instead of on first use.
 *
 * Every message produced here is fixed text: it names variables and options,
 * never their values.
 *
 * @module @sredevopsorg/dsh-subagent-opencode/requirements
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PREFIX = 'subagent-opencode'

/** A mandatory configuration gate. */
export const REQUIREMENTS = Object.freeze(['auth', 'credentials', 'model'])

/** A model reference must be `provider/model` without spaces or extra slashes. */
const MODEL_PATTERN = /^[^\s/\\]+\/[^\s/\\]+$/

/**
 * The order in which {@link relayEnv} layers the child environment. Later
 * entries win, so an operator's explicit value always beats an inherited one.
 */
export const RELAY_ORDER = Object.freeze(['passEnv', 'credentials', 'home', 'env'])

/**
 * Assert a positive finite process grace that fits every Node timer.
 * @param {string} name - config field name used in the message.
 * @param {number} value - configured value.
 */
export function assertPositiveGrace(name, value) {
  if (!Number.isFinite(value) || value <= 0 || value > 0x7fff_ffff) {
    throw new Error(`${PREFIX}: ${name} must be a positive finite number no greater than ${0x7fff_ffff}`)
  }
}

/**
 * Reject a requirement list that names an unknown gate.
 * @param {readonly string[]} require - configured gate names.
 */
export function assertRequirements(require) {
  for (const gate of require) {
    if (!REQUIREMENTS.includes(gate)) {
      throw new Error(
        `${PREFIX}: requirements.require accepts ${REQUIREMENTS.join(', ')}; found ${JSON.stringify(gate)}`,
      )
    }
  }
}

/**
 * Assert the shape of a model reference before any child starts.
 * @param {string | undefined} model - configured `provider/model`.
 */
export function assertModel(model) {
  if (model !== undefined && !MODEL_PATTERN.test(model)) {
    throw new Error(`${PREFIX}: requirements.model must look like "provider/model"`)
  }
}

/**
 * Locate OpenCode's credential store for a configured home.
 *
 * OpenCode versions have moved the store between `auth.json` at the data root
 * and a `data/` subdirectory, so both layouts are accepted. A home that cannot
 * be probed at all reports `unknown` rather than a false negative: the gate
 * then defers to the ACP `auth_required` failure instead of blocking a setup
 * that would have worked.
 * @param {string | undefined} home - configured OpenCode home.
 * @returns {'present' | 'missing' | 'unknown'} the observed state.
 */
export function authState(home) {
  if (home === undefined) return 'unknown'
  try {
    for (const candidate of [join(home, 'auth.json'), join(home, 'data', 'auth.json')]) {
      if (existsSync(candidate)) return 'present'
    }
    return 'missing'
  } catch {
    return 'unknown'
  }
}

/**
 * Collect every missing mandatory configuration without throwing, so one load
 * reports all of them instead of only the first.
 * @param {object} requirements - resolved requirement config.
 * @param {Record<string, string | undefined>} env - parent environment.
 * @returns {string[]} fixed failure messages, empty when satisfied.
 */
export function requirementFailures(requirements, env) {
  const failures = []
  const require = requirements.require ?? []

  if (require.includes('credentials')) {
    const missing = (requirements.credentials ?? []).filter(name => typeof env[name] !== 'string' || env[name] === '')
    if (missing.length > 0) {
      failures.push(
        `${PREFIX}: required configuration is missing: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set in the parent environment`,
      )
    }
  }

  if (require.includes('auth') && authState(requirements.home) === 'missing') {
    failures.push(
      `${PREFIX}: required configuration is missing: OpenCode has no stored credentials in ${requirements.home}; run \`opencode auth login\``,
    )
  }

  if (require.includes('model') && requirements.model === undefined) {
    failures.push(`${PREFIX}: required configuration is missing: requirements.model is not set`)
  }

  return failures
}

/**
 * Enforce the gates that can be decided without starting a child: a missing
 * credential, an absent or malformed model, and a credential store that the
 * configured home proves missing. Throw at plugin load so a broken profile
 * fails at boot rather than on first delegation.
 * @param {object} requirements - resolved requirement config.
 * @param {Record<string, string | undefined>} env - parent environment.
 */
export function assertLoadTimeRequirements(requirements, env) {
  assertRequirements(requirements.require ?? [])
  assertModel(requirements.model)
  const failures = requirementFailures(requirements, env)
  if (failures.length > 0) throw new Error(failures.join('\n'))
}

/**
 * Relay the configured parent environment back to the child in one fixed
 * order, matching the seam's documented merge: the service scrubs first, the
 * provider then adds everything here.
 * @param {object} options - relay inputs.
 * @returns {Record<string, string>} explicit child environment.
 */
export function relayEnv({ requirements, passEnv, env, parentEnv }) {
  const relay = {}

  // 1. Ambient names a working OpenCode expects (its own `OPENCODE_*` facts,
  //    home/config roots). Only names present in the parent are forwarded.
  for (const name of passEnv ?? []) {
    const value = parentEnv[name]
    if (typeof value === 'string') relay[name] = value
  }

  // 2. The declared provider credentials, which the seam would otherwise scrub.
  for (const name of requirements.credentials ?? []) {
    const value = parentEnv[name]
    if (typeof value === 'string') relay[name] = value
  }

  // 3. An explicit home pins the credential store the gate inspected.
  if (requirements.home !== undefined) {
    relay.OPENCODE_HOME = process.platform === 'win32' ? requirements.home.replaceAll('\\', '/') : requirements.home
  }

  // 4. Literal values win, then the operator's own `env` wins over both.
  Object.assign(relay, requirements.env ?? {}, env ?? {})

  return relay
}

/**
 * Format the fixed diagnostic line for a failed run. Only closed-vocabulary
 * facts appear; stderr, task content, paths, and environment values never do.
 * @param {object} facts - failure facts.
 * @returns {string} one diagnostic line.
 */
export function failureDiagnostic(facts) {
  const fields = [`product: OpenCode`, `stage: ${facts.stage}`, `category: ${facts.category}`]
  if (facts.permissions !== undefined && facts.permissions > 0) {
    fields.push(`permissions requested: ${facts.permissions}`)
  }
  if (facts.outcome?.exitCode !== null && facts.outcome?.exitCode !== undefined) {
    fields.push(`exit code: ${facts.outcome.exitCode}`)
  }
  if (facts.outcome?.signal !== null && facts.outcome?.signal !== undefined) {
    fields.push(`signal: ${facts.outcome.signal}`)
  }
  return `Subagent failure (${fields.join('; ')})`
}
