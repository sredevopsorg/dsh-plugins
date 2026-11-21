/**
 * Session-following permission policy.
 *
 * The child process answers its own `session/request_permission` prompts, so
 * the parent has to decide what the child may do before the run starts. With
 * `permission: session` that decision follows the *session that is delegating*:
 *
 * - a session whose approval policy is `never` gets a child that refuses every
 *   permission request, which matches "never ask the user" — there is no one to
 *   ask, so a request that needs a human cannot be granted;
 * - every other session, and every session this provider cannot inspect, keeps
 *   the configured policy. A child never gains authority the parent could not
 *   verify, so an unrecognized session is treated as untrusted.
 *
 * Reading the policy uses the approval service's session-scoped facts: the
 * recorded `approval/policy` override, then the service's own configured
 * default. DSH makes the effective value private, so this module reaches the
 * two documented pieces it is computed from and falls back to `ask` — the
 * documented default — when neither is readable. Every access is guarded: a
 * DSH release that reshapes the service degrades to `ask` instead of failing a
 * delegation.
 *
 * @module @sredevopsorg/dsh-subagent-opencode/approval-policy
 */

/** The approval policies a session can have. */
export const SESSION_POLICIES = Object.freeze(['ask', 'never'])

/** The configured fallback when no session fact is readable (the DSH default). */
export const DEFAULT_SESSION_POLICY = 'ask'

/** Where the resolved session policy came from, in resolution order. */
export const POLICY_SOURCES = Object.freeze(['session', 'default', 'fallback'])

/**
 * Read the delegating session from a start request without assuming its shape.
 * @param {object} request - subagent start request.
 * @returns {object | undefined} the parent session, when the seam supplied one.
 */
export function sessionOf(request) {
  const agent = request?.agent
  if (agent !== null && typeof agent === 'object') {
    const session = agent.session
    if (session !== null && typeof session === 'object') return session
  }
  const session = request?.session
  return session !== null && typeof session === 'object' ? session : undefined
}

/**
 * Resolve the approval policy of the delegating session.
 *
 * The lookup never throws and never awaits: an `overrideOf` that misbehaves
 * (throws, or returns a promise) is ignored, because a permission policy must
 * be known before the child starts.
 * @param {object} ctx - plugin context carrying the `approval` service.
 * @param {object} request - subagent start request.
 * @returns {{policy: string, source: string}} the policy and where it came from.
 */
export function resolveSessionPolicy(ctx, request) {
  const fallback = { policy: DEFAULT_SESSION_POLICY, source: 'fallback' }
  let approval
  try {
    approval = ctx?.get?.('approval')
  } catch {
    return fallback
  }
  if (approval === null || typeof approval !== 'object') return fallback

  const session = sessionOf(request)
  if (session !== undefined && typeof approval.overrideOf === 'function') {
    try {
      const override = approval.overrideOf(session)
      // A promise is a signature this module does not understand; ignore it
      // rather than returning a policy decided by an unresolved lookup.
      if (typeof override === 'string' && SESSION_POLICIES.includes(override)) {
        return { policy: override, source: 'session' }
      }
    } catch {
      // Fall through to the service default.
    }
  }

  const configured = approval.config?.policy
  if (typeof configured === 'string' && SESSION_POLICIES.includes(configured)) {
    return { policy: configured, source: 'default' }
  }
  return fallback
}

/**
 * Project the session policy onto the ACP permission policy.
 *
 * `never` refuses every request; any other session keeps the configured
 * policy. The projection is intentionally one-way: a session policy can only
 * make the child stricter, never more permissive than the profile allowed.
 * @param {string} configured - the row's `permission` value.
 * @param {string} sessionPolicy - resolved session approval policy.
 * @returns {string} the ACP permission policy to apply.
 */
export function projectPolicy(configured, sessionPolicy) {
  return sessionPolicy === 'never' ? 'reject' : configured
}

/**
 * Format the fixed line the run appends to a permission diagnostic.
 *
 * Only closed-vocabulary facts appear: the ACP policy, the session policy, and
 * where that policy came from. No value from the environment, the task, or a
 * command ever enters this text.
 * @param {string} policy - the ACP permission policy the run applied.
 * @param {{policy: string, source: string}} resolved - the session resolution.
 * @returns {string} one diagnostic line.
 */
export function describePolicy(policy, resolved) {
  return (
    `Permission policy: ${policy} (session approval policy ${resolved.policy} from ${resolved.source}; ` +
    'set `permission` to override it)'
  )
}
