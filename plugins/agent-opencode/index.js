/**
 * `@sredevopsorg/dsh-agent-opencode` — an agent preset that works only by
 * delegating to the OpenCode CLI.
 *
 * `cordis.patch.yml` declares the `@deepseek-ai/dsh-agent-preset` row: the
 * `opencode` preset whose `plugins` list binds `dsh-tool-subagent` to the
 * provider name `opencode-preset`, and the host watcher that answers
 * output-token-limit cutoffs. The preset owns the behavior, so this module has
 * nothing to register: it exists so the package resolves as a Cordis plugin and
 * its manifest can describe itself.
 *
 * The provider is deliberately **not** part of this bundle. A DSH preset cannot
 * mount a host service, and a host-level provider row here would collide with
 * `@sredevopsorg/dsh-subagent-opencode`'s own `opencode` row when both are
 * installed. The profile supplies the provider instead, under the distinct name
 * `opencode-preset`; `profiles/preset.cordis.patch.yml` ships that patch.
 *
 * @module @sredevopsorg/dsh-agent-opencode
 */

/** The Cordis plugin name, matching the loader row id in `cordis.patch.yml`. */
export const name = 'agent-opencode'

/**
 * Mount the bundle. The patch rows do the work; nothing is registered here.
 */
export function apply() {}
