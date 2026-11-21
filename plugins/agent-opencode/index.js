/**
 * `@sredevopsorg/dsh-agent-opencode` — an agent preset that works only by
 * delegating to the OpenCode CLI.
 *
 * `cordis.patch.yml` declares three host rows: the `opencode` preset whose
 * `plugins` list binds `dsh-tool-subagent` to the provider name
 * `opencode-preset`, the host watcher that answers output-token-limit cutoffs,
 * and this package's own row. This module runs in that own row and registers
 * only the authenticated bridge behind the bundle's Web settings page; the
 * watcher's behavior lives in `auto-continue.js`.
 *
 * The provider is deliberately **not** part of this bundle. A DSH preset cannot
 * mount a host service, and a host-level provider row here would collide with
 * `@sredevopsorg/dsh-subagent-opencode`'s own `opencode` row when both are
 * installed. The profile supplies the provider instead, under the distinct name
 * `opencode-preset`; `profiles/preset.cordis.patch.yml` ships that patch.
 *
 * @module @sredevopsorg/dsh-agent-opencode
 */

import { registerSettingsRoute } from './settings.js'

/** The Cordis plugin name, matching the loader row id in `cordis.patch.yml`. */
export const name = 'agent-opencode'

/**
 * Mount the bundle's Web settings bridge.
 *
 * The route is optional and scoped to a Web profile: the preset and the watcher
 * are composed by the patch and do not depend on this module.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function apply(ctx) {
  registerSettingsRoute(ctx)
}
