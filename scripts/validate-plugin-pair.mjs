#!/usr/bin/env node
/**
 * validate-plugin-pair.mjs
 *
 * Prove that independently installable bundles in this repository do not
 * collide in one profile.
 *
 * Every bundle may insert host-level rows. Two bundles that insert the same
 * entry id, or two `dsh-tool-subagent` rows with the same `toolName`, cannot
 * be enabled together: DSH rejects the duplicate and one of the two packages
 * becomes unusable. A provider *name* has the same constraint, but a bundle
 * typically ships its provider that way on purpose (the preset binds a name a
 * profile supplies), so only a host-level `subagent-opencode`-style
 * registration counts here.
 *
 * What this validator checks (errors):
 *   - no two bundles insert the same host-level row id
 *   - no two bundles expose the same model-facing subagent tool name
 *   - no two bundles register the same provider name at host level
 *   - a bundle that ships `profiles/*.yml` provider patches does not reuse a
 *     provider name another bundle registers at host level, unless the name is
 *     its own intentionally distinct binding
 *
 * Profiles under `plugins/<dir>/profiles/` are not checked against the bundle
 * that ships them: they are added one at a time by a user, and using the same
 * provider name there is documented on purpose.
 *
 * Usage:
 *   node scripts/validate-plugin-pair.mjs [--dsh-root <node_modules/@deepseek-ai>] [--json]
 *   -h, --help     show this help
 *
 * The script needs only Node (no DSH installation).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");

/** The row whose `provider`/`toolName` pair is the model-facing tool name. */
const SUBAGENT_TOOL = "@deepseek-ai/dsh-tool-subagent";

const errors = [];
const notes = [];

/** Read a JSON file. */
function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

/** Whether a value names an existing directory. */
function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Whether a value names an existing file. */
function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * A minimal YAML reader for the subset this repository's patches use.
 *
 * The patches are block-style mappings and lists with scalar values and
 * comments. Rather than pull a parser into a dependency-free repository, this
 * reader tracks indentation and stops at the depth it needs: the row list under
 * `- insert:` and the keys below each row. Values that use `!!js` or an inline
 * flow list are read as opaque text; only string-typed fields are inspected.
 * @param {string} text - the patch source.
 * @returns {Array<{id: string | undefined, name: string | undefined, config: Record<string, string>}>} rows.
 */
function parseInsertRows(text) {
  const rows = [];
  let inInsert = false;
  let current;
  let rowIndent = -1;
  let configIndent = -1;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\t/g, "  ");
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (trimmed === "- insert:") {
      inInsert = true;
      continue;
    }
    if (!inInsert) continue;
    if (/^-\s/.test(trimmed) === false && indent <= 0) {
      // A new top-level key ends the insert block.
      inInsert = false;
      continue;
    }
    const idMatch = /^-\s*id:\s*(.+)$/.exec(trimmed);
    const bareIdMatch = /^id:\s*(.+)$/.exec(trimmed);
    if (idMatch !== null && (rowIndent === -1 || indent <= rowIndent)) {
      rowIndent = indent;
      current = { id: unquote(idMatch[1]), name: undefined, config: {} };
      rows.push(current);
      configIndent = -1;
      continue;
    }
    if (current === undefined) continue;
    if (bareIdMatch !== null && configIndent === -1) {
      current.id = unquote(bareIdMatch[1]);
      continue;
    }
    const nameMatch = /^name:\s*(.+)$/.exec(trimmed);
    if (nameMatch !== null && configIndent === -1) {
      current.name = unquote(nameMatch[1]);
      continue;
    }
    if (trimmed === "config:") {
      configIndent = indent;
      continue;
    }
    if (configIndent !== -1 && indent > configIndent) {
      const field = /^([A-Za-z][\w-]*):\s*(.+)$/.exec(trimmed);
      if (field !== null) current.config[field[1]] = unquote(field[2]);
    }
  }
  return rows;
}

/** Strip the quotes YAML allows around a scalar. */
function unquote(value) {
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** The patch files a bundle's manifest names. */
function bundlePatches(directory, manifest) {
  const patch = manifest.dsh?.bundle?.patch;
  const patches = Array.isArray(patch) ? patch : patch === undefined ? [] : [patch];
  return patches
    .filter((entry) => typeof entry === "string")
    .map((entry) => path.join(directory, entry))
    .filter(exists);
}

/** The provider patches a bundle ships under `profiles/`. */
function profilePatches(directory) {
  const profiles = path.join(directory, "profiles");
  if (!isDirectory(profiles)) return [];
  return fs
    .readdirSync(profiles)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => path.join(profiles, name));
}

/**
 * Collect the host-level row identity a bundle would add.
 * @param {string} directory - plugin directory.
 * @param {string[]} patches - bundle patch files.
 * @returns {{ids: Map<string, string>, tools: Map<string, string>, providers: Map<string, string>}} identities.
 */
function hostIdentities(directory, patches) {
  const label = path.basename(directory);
  const ids = new Map();
  const tools = new Map();
  const providers = new Map();
  for (const patch of patches) {
    for (const row of parseInsertRows(fs.readFileSync(patch, "utf8"))) {
      if (typeof row.id === "string") ids.set(row.id, label);
      if (row.name === SUBAGENT_TOOL) {
        const toolName = row.config.toolName;
        if (typeof toolName === "string") tools.set(toolName, label);
        const provider = row.config.provider;
        if (typeof provider === "string") providers.set(provider, label);
      }
      // A provider row under the bundle's own package is a host-level
      // registration; the standard subagent bundle ships one.
      if (typeof row.name === "string" && row.name === "@sredevopsorg/dsh-subagent-opencode") {
        const provider = row.config.providerName ?? "opencode";
        providers.set(provider, label);
      }
    }
  }
  return { ids, tools, providers };
}

/** Collect the provider names a bundle's profile patches declare. */
function profileProviderNames(directory) {
  const names = new Map();
  for (const patch of profilePatches(directory)) {
    for (const row of parseInsertRows(fs.readFileSync(patch, "utf8"))) {
      if (row.name !== "@sredevopsorg/dsh-subagent-opencode") continue;
      names.set(row.config.providerName ?? "opencode", path.relative(REPO_ROOT, patch));
    }
  }
  return names;
}

/**
 * Report a duplicate key, naming both bundles.
 * @param {string} kind - what kind of identity collided.
 * @param {Map<string, string>} identities - this bundle's identities, keyed.
 * @param {Map<string, string>} seen - first owner per key across earlier bundles.
 * @param {string} bundle - the current bundle.
 */
function checkDuplicates(kind, identities, seen, bundle) {
  for (const key of identities.keys()) {
    const first = seen.get(key);
    if (first === undefined || first === bundle) continue;
    errors.push(
      `${kind} "${key}" is inserted by both "${first}" and "${bundle}"; they cannot be enabled together`,
    );
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    const text = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    const start = text.indexOf("/**");
    const end = text.indexOf("*/", start);
    process.stdout.write(`${text.slice(start + 3, end).replace(/^ \* ?/gm, "")}\n`);
    return;
  }
  const json = argv.includes("--json");

  const directories = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PLUGINS_DIR, entry.name))
    .filter((directory) => exists(path.join(directory, "package.json")))
    .sort();

  const allIds = new Map();
  const allTools = new Map();
  const allProviders = new Map();
  const hostProviders = new Map();
  const profileProviders = new Map();

  for (const directory of directories) {
    const bundle = path.basename(directory);
    const manifest = readJson(path.join(directory, "package.json"));
    const { ids, tools, providers } = hostIdentities(directory, bundlePatches(directory, manifest));
    checkDuplicates("row id", ids, allIds, bundle);
    checkDuplicates("tool name", tools, allTools, bundle);
    checkDuplicates("host provider", providers, allProviders, bundle);
    for (const [key, owner] of ids) if (!allIds.has(key)) allIds.set(key, owner);
    for (const [key, owner] of tools) if (!allTools.has(key)) allTools.set(key, owner);
    for (const [key, owner] of providers) {
      if (!allProviders.has(key)) allProviders.set(key, owner);
      hostProviders.set(key, owner);
    }
    for (const [provider, file] of profileProviderNames(directory)) {
      profileProviders.set(provider, { bundle, file });
    }
  }

  // A bundle's profile patch may reuse a provider name that another bundle
  // already registers at host level only when the name is intentionally
  // distinct; an identical name would collide the moment both are installed.
  for (const [provider, { bundle, file }] of profileProviders) {
    const owner = hostProviders.get(provider);
    if (owner === undefined || owner === bundle) continue;
    errors.push(
      `profile patch ${file} declares provider "${provider}", which bundle "${owner}" registers at host level; ` +
        `install both and the profile has two registrations of the same name`,
    );
  }

  const summary = {
    ok: errors.length === 0,
    bundles: directories.length,
    errors,
    notes,
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    for (const noteText of notes) process.stdout.write(`  ${noteText}\n`);
    for (const error of errors) process.stdout.write(`✗ ${error}\n`);
    process.stdout.write(
      `${errors.length === 0 ? "PASS" : "FAIL"}: ${directories.length} bundle(s), ${errors.length} error(s)\n`,
    );
  }
  if (errors.length > 0) process.exitCode = 1;
}

main();
