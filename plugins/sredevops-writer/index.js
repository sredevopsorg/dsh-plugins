/**
 * `@sredevopsorg/dsh-sredevops-writer` — an editorial agent preset for
 * sredevops.org.
 *
 * The bundle is configuration: `cordis.patch.yml` declares one
 * `@deepseek-ai/dsh-agent-preset` row whose children are the persona, the tools
 * an editorial session needs, and a filesystem skill provider pointed at this
 * package's `skills/` directory.
 *
 * Resolving that directory is the one genuinely awkward part, because the patch
 * value must satisfy two evaluators:
 *
 *   - the **Loader** at runtime, which evaluates `!!js` with `with (ctx)` so a
 *     `baseUrl` for the config file is in scope (that is how DSH's own shipped
 *     presets do it);
 *   - the repository's **validator** (`scripts/validate-bundles.mjs`), which
 *     evaluates the same expressions with only `ctx` and `process` in scope, on
 *     a checkout where this package is *not* installed into `node_modules`.
 *
 * `baseUrl` therefore fails CI, and a single `createRequire` root cannot be right
 * for both a profile install and a bare checkout. The patch expression resolves
 * the specifier that exists in each layout, in order, and falls back to the
 * checkout-relative path that the validator and a local `dsh plugin add` use.
 *
 * This module is the package entry point. It exports no Cordis plugin and mounts
 * nothing; the constants exist so the test suite can assert the agreement the
 * patch depends on.
 *
 * @module @sredevopsorg/dsh-sredevops-writer
 */

import { fileURLToPath } from "node:url";

/** Cordis plugin name, matching the row id convention used in this repository. */
export const name = "sredevops-writer";

/** Absolute path of the packaged `skills/` directory, with a trailing separator. */
export const SKILLS_DIR = fileURLToPath(new URL("./skills/", import.meta.url));

/**
 * Standard precedence rank for a packaged skill root.
 *
 * This is the literal value of `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill`,
 * duplicated on purpose: this package is installed into a profile from Git, so it
 * must not import `@deepseek-ai/*` packages. `plugins/skills` documents the same
 * trade-off. Rank 600 keeps the three editorial skills alongside DSH's own
 * bundled skills instead of shadowing project or user roots.
 */
export const SKILLS_RANK = 600;

/** The bundle is configuration-only; nothing to mount beyond the patch rows. */
export function apply() {}
