/**
 * Load this bundle's runtime dependencies from the running DSH installation.
 *
 * A bundle installed from GitHub lives in the profile's `node_modules`, and
 * Node's ESM resolver cannot see the DSH installation's dependencies from
 * there. The DSH CLI (`@deepseek-ai/dsh`) is always reachable from the process
 * that loaded this plugin, so resolution anchors on its manifest exactly as
 * `locate-docs.md` prescribes for shipped packages.
 *
 * Both packages are DSH's own dependencies, so this adds nothing to install and
 * nothing to keep in version step with a DSH upgrade:
 *
 * - `@deepseek-ai/schemastery` — the Config schema vocabulary every bundle uses.
 * - `@agentclientprotocol/sdk@1.4.0` — shipped as a dependency of
 *   `@deepseek-ai/dsh-acp`, which e.g. `subagent-codex` composes alongside.
 *
 * @module @sredevopsorg/dsh-subagent-opencode/sdk
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Anchors that may reach the DSH installation, in order. */
const ANCHORS = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-acp']

/**
 * Locate `@deepseek-ai/dsh` manifests the Node resolver can already see,
 * covering a global install whose sibling dependencies are not reachable
 * from this package's own directory.
 * @returns {string[]} manifest paths usable as resolution anchors.
 */
function globalDshManifests() {
  const anchors = []
  const candidates = [
    ...(process.env.NODE_PATH ?? '').split(':').filter(Boolean).map(entry => join(entry, '@deepseek-ai', 'dsh')),
    join(process.execPath, '..', '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh'),
  ]
  for (const candidate of candidates) {
    try {
      const manifest = join(candidate, 'package.json')
      if (existsSync(manifest)) anchors.push(manifest)
    } catch {
      // An unreadable candidate is simply not an anchor.
    }
  }
  return anchors
}

/**
 * Resolve a package to a file URL through the DSH installation.
 * @param {string} specifier - bare package specifier.
 * @returns {{url: string, require: NodeRequire} | undefined} resolution.
 */
function resolveThroughDsh(specifier) {
  const searches = []
  if (typeof process.env.DSH_INSTALL_DIR === 'string' && process.env.DSH_INSTALL_DIR !== '') {
    searches.push(process.env.DSH_INSTALL_DIR)
  }
  for (const anchor of ANCHORS) {
    try {
      searches.push(createRequire(import.meta.url).resolve(anchor))
    } catch {
      // An installation that lacks one anchor may still carry the other.
    }
  }
  // A globally installed DSH (`npm i -g @deepseek-ai/dsh`) is not reachable
  // from this package's location, and a global install may not place
  // dependencies in a flat layout either. Anchor on the DSH package itself,
  // which is the directory of any `@deepseek-ai/dsh` the Node resolver can
  // already see — the same package the running CLI was launched from.
  for (const packageJson of globalDshManifests()) searches.push(packageJson)
  for (const search of searches) {
    try {
      const requireFromDsh = createRequire(search)
      return { url: pathToFileURL(requireFromDsh.resolve(specifier)).href, require: requireFromDsh }
    } catch {
      // Try the next anchor.
    }
  }
  return undefined
}

const imports = new Map()

/**
 * Load one dependency module, preferring normal resolution and falling back to
 * the DSH installation.
 * @param {string} specifier - bare package specifier.
 * @param {string} hint - remedy appended when the package cannot be found.
 * @returns {Promise<object>} the module namespace.
 */
export async function loadFromDsh(specifier, hint) {
  const anchor = `${specifier}::${hint}`
  const pending = imports.get(anchor)
  if (pending !== undefined) return pending
  const load = (async () => {
    try {
      return await import(specifier)
    } catch {
      const resolved = resolveThroughDsh(specifier)
      if (resolved === undefined) {
        throw new Error(`subagent-opencode: cannot resolve ${specifier}; ${hint}`)
      }
      return import(resolved.url)
    }
  })()
  imports.set(anchor, load)
  return load
}

/**
 * Load the Agent Client Protocol SDK module.
 * @returns {Promise<object>} the SDK module namespace.
 */
export function loadAcpSdk() {
  return loadFromDsh(
    '@agentclientprotocol/sdk',
    'it ships with @deepseek-ai/dsh-acp, so keep that bundle installed alongside this one',
  )
}

/**
 * Load `@deepseek-ai/schemastery` and expose its default export.
 * @returns {Promise<object>} the `schemastery` builder.
 */
export function loadSchemastery() {
  return loadFromDsh('@deepseek-ai/schemastery', 'it is a dependency of the DSH runtime').then(
    module => module.default ?? module,
  )
}
