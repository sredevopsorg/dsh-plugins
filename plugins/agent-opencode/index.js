/**
 * `@sredevopsorg/dsh-agent-opencode` — an agent preset that works only by
 * delegating to the OpenCode CLI.
 *
 * `cordis.patch.yml` declares both rows this bundle needs: the
 * `@sredevopsorg/dsh-subagent-opencode` provider that registers `opencode` on
 * `ctx.subagents`, and the `@deepseek-ai/dsh-agent-preset` declaration whose
 * `plugins` list binds `dsh-tool-subagent` to that provider. The preset owns the
 * behavior, so this module has nothing to register: it exists so the package
 * resolves as a Cordis plugin and its manifest can describe itself.
 *
 * @module @sredevopsorg/dsh-agent-opencode
 */

/** The Cordis plugin name, matching the loader row id in `cordis.patch.yml`. */
export const name = 'agent-opencode'

/**
 * Mount the bundle. The patch rows do the work; nothing is registered here.
 */
export function apply() {}
