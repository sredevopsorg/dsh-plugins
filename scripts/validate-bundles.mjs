#!/usr/bin/env node
/**
 * validate-bundles.mjs
 *
 * Validate every bundle patch in this repository against the DSH installation
 * that will load it, and keep the Architect Dev agent preset synchronized with
 * the shipped `standard` preset.
 *
 * Checks (errors):
 *   - each `plugins/<name>/package.json` declares the expected package name,
 *     a valid version, a license, `dsh.manifestVersion: 1`, a readable
 *     `dsh.bundle.patch`, and package files that ship the README/patch/locale/icon
 *   - `engines.dsh` is present and satisfies the installed runtime version
 *   - every row in every `plugins/<name>/cordis.patch.yml` names a package (and
 *     subpath) that resolves from the DSH installation or this repository
 *   - every row config validates against the plugin's exported `Config`
 *   - `!!js` expressions are evaluated with a stub `ctx`, so gated rows are
 *     checked as they resolve in a non-profile context
 *   - no row uses a removed option (currently `backgroundMode`)
 *   - persona templates use only prompt variables registered by the installed DSH
 *   - every `tool-subagent` provider is registered by an installed
 *     `dsh-subagent-*` package
 *   - the Architect Dev preset declaration is structurally valid
 *   - its plugin list mirrors `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`,
 *     except the documented deltas (persona, gated plugin manager, `mcp-*` rows);
 *     its plan-mode section must match the shipped text exactly
 *   - the skills named by the Architect Dev persona exist under `skills/`
 *
 * Checks (warnings): missing locale metadata, subagent provider packages that
 * cannot be inspected, and an installation with no provider packages.
 *
 * Usage:
 *   node scripts/validate-bundles.mjs [--dsh-root <dir>] [--strict] [--json]
 *   --dsh-root DIR  node_modules/@deepseek-ai directory of the DSH installation
 *   --strict        treat warnings as errors
 *   --json          emit machine-readable results
 *   -h, --help      show this help
 *
 * The DSH root defaults to `DSH_INSTALL`, then the real path of `dsh` on PATH.
 * The script resolves `yaml` and `semver` from the DSH installation, so this
 * repository needs no dependencies of its own.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");

const ARCHITECT_ROW_ID = "preset-architect-dev";
const ARCHITECT_ID = "architect-dev";
const ARCHITECT_SKILLS = [
  "software-architecture",
  "fullstack-development",
  "supabase",
  "supabase-postgres-best-practices",
];
/** Rows that intentionally differ from the shipped standard preset. */
const DELTA_ROWS = new Set(["persona", "tool-plugin-manager"]);
/** Extra row ids allowed beyond the shipped standard preset. */
const EXTRA_ROW_PREFIXES = ["mcp-"];
/** Options removed from current DSH plugin configs. */
const REMOVED_OPTIONS = ["backgroundMode"];

const errors = [];
const warnings = [];
const notes = [];

function fail(message) {
  errors.push(message);
}
function warn(message) {
  warnings.push(message);
}
function note(message) {
  notes.push(message);
}

function usage() {
  const text = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const start = text.indexOf("/**");
  const end = text.indexOf("*/", start);
  return text
    .slice(start + 3, end)
    .split("\n")
    .map((line) => line.replace(/^ \* ?/, ""))
    .join("\n")
    .trim();
}

function parseArgs(argv) {
  const options = { dshRoot: undefined, strict: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--dsh-root":
        options.dshRoot = argv[++index];
        if (options.dshRoot === undefined) throw new Error("--dsh-root needs a directory");
        break;
      case "--strict":
        options.strict = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`unknown option: ${argument} (try --help)`);
    }
  }
  return options;
}

function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Accept the installation root, its node_modules, or the @deepseek-ai directory. */
function normalizeDshRoot(candidate) {
  const resolved = path.resolve(candidate);
  if (exists(path.join(resolved, "dsh", "package.json"))) return resolved;
  const nested = path.join(resolved, "@deepseek-ai");
  if (exists(path.join(nested, "dsh", "package.json"))) return nested;
  const fromNodeModules = path.join(resolved, "node_modules", "@deepseek-ai");
  if (exists(path.join(fromNodeModules, "dsh", "package.json"))) return fromNodeModules;
  return resolved;
}

function dshRootFromPath() {
  let binary;
  try {
    binary = execFileSync("sh", ["-c", "command -v dsh"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
  if (binary === "") return undefined;
  let directory;
  try {
    directory = path.dirname(fs.realpathSync(binary));
  } catch {
    return undefined;
  }
  while (directory !== path.dirname(directory)) {
    if (path.basename(directory) === "@deepseek-ai" && exists(path.join(directory, "dsh", "package.json"))) {
      return directory;
    }
    directory = path.dirname(directory);
  }
  return undefined;
}

function resolveDshRoot(explicit) {
  if (explicit !== undefined) return normalizeDshRoot(explicit);
  if (process.env.DSH_INSTALL !== undefined && process.env.DSH_INSTALL !== "") {
    return normalizeDshRoot(process.env.DSH_INSTALL);
  }
  const fromPath = dshRootFromPath();
  if (fromPath !== undefined) return fromPath;
  try {
    const require = createRequire(path.join(process.cwd(), "package.json"));
    return path.dirname(path.dirname(require.resolve("@deepseek-ai/dsh/package.json")));
  } catch {
    return undefined;
  }
}

/**
 * Resolve a DSH package's manifest without assuming a flat node_modules layout.
 * A globally installed `dsh` keeps its dependencies under `dsh/node_modules`, so
 * package paths are resolved through the DSH package, then by walking up from
 * the resolved entry point, and only then by the flat sibling path.
 */
function resolvePackageManifest(requireFromDsh, dshRoot, packageName) {
  const candidates = [];
  try {
    candidates.push(requireFromDsh.resolve(`${packageName}/package.json`));
  } catch {
    // Packages may not export ./package.json; fall through to entry resolution.
  }
  try {
    let directory = path.dirname(requireFromDsh.resolve(packageName));
    while (directory !== path.dirname(directory)) {
      const candidate = path.join(directory, "package.json");
      if (exists(candidate)) {
        try {
          if (readJson(candidate).name === packageName) {
            candidates.push(candidate);
            break;
          }
        } catch {
          // Ignore unreadable manifests while walking up.
        }
      }
      directory = path.dirname(directory);
    }
  } catch {
    // Fall through to the flat sibling path.
  }
  const bareName = packageName.startsWith("@deepseek-ai/")
    ? packageName.slice("@deepseek-ai/".length)
    : packageName;
  candidates.push(path.join(dshRoot, bareName, "package.json"));
  return candidates.find((candidate) => exists(candidate));
}

/**
 * Package directories visible from the DSH installation: the flat sibling
 * layout used by npx and some hoisted installs, plus the nested layout used by
 * a global npm install and pnpm's isolated store.
 */
function packageDirectories(dshRoot, dshPackageDir) {
  const roots = new Set([dshRoot, path.join(dshPackageDir, "node_modules", "@deepseek-ai")]);
  const directories = new Map();
  for (const root of roots) {
    if (!isDirectory(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const directory = path.join(root, entry.name);
      if (!exists(path.join(directory, "package.json"))) continue;
      let key = directory;
      try {
        key = fs.realpathSync(directory);
      } catch {
        // Keep the unresolved path as the de-duplication key.
      }
      directories.set(key, directory);
    }
  }
  return [...directories.values()];
}

/**
 * Prompt variable names registered by the installed DSH packages. Persona
 * templates resolve `{{name}}` strictly against these; an unregistered name
 * fails the whole turn when the prompt renders.
 */
function registeredPromptVariables(packageDirs) {
  const names = new Set();
  const pattern = /\.variable\(\s*["']([^"']+)["']/g;
  for (const directory of packageDirs) {
    for (const relative of ["lib/index.js", "lib/startup.js"]) {
      const file = path.join(directory, relative);
      if (!exists(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(pattern)) names.add(match[1]);
    }
  }
  return names;
}

/** Evaluate a `!!js` scalar the way the Loader would in a profile-less scope. */
function evaluateExpression(expression) {
  const ctx = { get: () => undefined };
  // eslint-disable-next-line no-new-func
  return new Function("ctx", "process", `return (${expression});`)(ctx, process);
}

function evaluateValue(value) {
  if (value !== null && typeof value === "object" && Object.keys(value).length === 1 && Object.hasOwn(value, "__js")) {
    return evaluateExpression(value.__js);
  }
  if (Array.isArray(value)) return value.map((entry) => evaluateValue(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, evaluateValue(entry)]));
  }
  return value;
}

function parsePatch(filename, parseYaml) {
  const text = fs.readFileSync(filename, "utf8");
  return parseYaml(text, {
    customTags: [
      {
        tag: "tag:yaml.org,2002:js",
        resolve: (value) => ({ __js: value }),
      },
    ],
  });
}

/** Flatten group rows into the leaf plugin rows that actually load. */
function leafRows(entries, parent = []) {
  const rows = [];
  for (const row of entries) {
    if (row === null || typeof row !== "object") continue;
    if (row.name === "cordis:group" && Array.isArray(row.config)) {
      rows.push(...leafRows(row.config, [...parent, row.id]));
    } else if (row.name === "cordis:include") {
      // Included lists live in external files; this repository does not use them.
      continue;
    } else {
      rows.push({ ...row, groupPath: parent });
    }
  }
  return rows;
}

function pluginDirectories() {
  return fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PLUGINS_DIR, entry.name))
    .filter((directory) => exists(path.join(directory, "package.json")))
    .sort();
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help === true) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const dshRoot = resolveDshRoot(options.dshRoot);
  if (dshRoot === undefined || !exists(path.join(dshRoot, "dsh", "package.json"))) {
    throw new Error(
      "cannot find a DSH installation: pass --dsh-root <node_modules/@deepseek-ai> or set DSH_INSTALL",
    );
  }

  const requireFromDsh = createRequire(path.join(dshRoot, "dsh", "package.json"));
  let parseYaml;
  let semver;
  try {
    ({ parse: parseYaml } = requireFromDsh("yaml"));
    semver = requireFromDsh("semver");
  } catch (error) {
    throw new Error(
      `cannot resolve validation dependencies (yaml, semver) from ${dshRoot}: ${error.message}`,
    );
  }

  const dshManifest = resolvePackageManifest(requireFromDsh, dshRoot, "@deepseek-ai/dsh");
  const dshPackageDir = dshManifest === undefined ? path.join(dshRoot, "dsh") : path.dirname(dshManifest);
  const runtimeManifest = resolvePackageManifest(requireFromDsh, dshRoot, "@deepseek-ai/dsh-app-boot");
  const runtimeVersion = runtimeManifest === undefined ? undefined : readJson(runtimeManifest).version;
  if (runtimeVersion === undefined) {
    throw new Error(`cannot read the DSH runtime version via ${path.join(dshRoot, "dsh")}`);
  }
  if (semver.valid(runtimeVersion) === null) {
    throw new Error(`installed DSH runtime version is not semver: ${runtimeVersion}`);
  }

  const directories = pluginDirectories();
  if (directories.length === 0) {
    warn(`no plugin packages found under ${PLUGINS_DIR}`);
  }

  const localPackages = new Map();
  const manifests = new Map();
  for (const directory of directories) {
    const manifestPath = path.join(directory, "package.json");
    const manifest = readJson(manifestPath);
    manifests.set(directory, manifest);
    if (typeof manifest.name === "string") localPackages.set(manifest.name, directory);
  }

  const resolvePluginSpec = (specifier) => {
    if (specifier.startsWith("@deepseek-ai/")) {
      return { file: requireFromDsh.resolve(specifier), detail: specifier };
    }
    const directory = localPackages.get(specifier);
    if (directory === undefined) throw new Error(`unknown package: ${specifier}`);
    const manifest = manifests.get(directory);
    const entry = manifest.exports?.["."] ?? manifest.main;
    return {
      file: typeof entry === "string" ? path.resolve(directory, entry) : undefined,
      detail: `${specifier} (repository package)`,
    };
  };

  const configCache = new Map();
  const loadConfig = async (file) => {
    if (configCache.has(file)) return configCache.get(file);
    const module = await import(pathToFileURL(file).href);
    const Config = typeof module.Config === "function" ? module.Config : undefined;
    configCache.set(file, Config);
    return Config;
  };

  // ── Manifest checks ──────────────────────────────────────────────────────
  for (const directory of directories) {
    const manifest = manifests.get(directory);
    const name = path.basename(directory);
    const expectedName = `@sredevopsorg/dsh-${name}`;
    const label = `plugins/${name}/package.json`;

    if (manifest.name !== expectedName) {
      fail(`${label}: name must be ${expectedName}, found ${JSON.stringify(manifest.name)}`);
    }
    if (typeof manifest.version !== "string" || semver.valid(manifest.version) === null) {
      fail(`${label}: version must be a semantic version, found ${JSON.stringify(manifest.version)}`);
    }
    if (manifest.private === true) {
      fail(`${label}: remove "private": true so the bundle can be published like the other plugins`);
    }
    if (typeof manifest.license !== "string" || manifest.license === "") {
      fail(`${label}: license is required`);
    }
    if (manifest.dsh?.manifestVersion !== 1) {
      fail(`${label}: dsh.manifestVersion must be 1`);
    }
    const patch = manifest.dsh?.bundle?.patch;
    const patches = Array.isArray(patch) ? patch : patch === undefined ? [] : [patch];
    if (patches.length === 0) {
      fail(`${label}: dsh.bundle.patch is required`);
    }
    for (const patchPath of patches) {
      if (typeof patchPath !== "string" || !exists(path.join(directory, patchPath))) {
        fail(`${label}: bundle patch does not exist: ${JSON.stringify(patchPath)}`);
      }
    }
    if (typeof manifest.engines?.dsh !== "string" || manifest.engines.dsh === "") {
      fail(`${label}: engines.dsh is required so incompatible DSH versions are refused at install`);
    } else if (!semver.satisfies(runtimeVersion, manifest.engines.dsh, { includePrerelease: true })) {
      fail(
        `${label}: engines.dsh ${manifest.engines.dsh} does not satisfy installed DSH ${runtimeVersion}`,
      );
    }
    if (manifest.icon !== undefined) {
      const iconPath = path.resolve(directory, manifest.icon);
      if (!iconPath.startsWith(`${path.resolve(directory)}${path.sep}`) || !exists(iconPath)) {
        fail(`${label}: icon must be a readable file inside the package`);
      } else if (fs.statSync(iconPath).size > 256 * 1024) {
        fail(`${label}: icon exceeds the 256 KiB display limit`);
      }
    }
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const requiresFile = (predicate, labelText) => {
      if (!files.some(predicate)) fail(`${label}: "files" must include ${labelText}`);
    };
    if (exists(path.join(directory, "README.md"))) requiresFile((entry) => entry === "README.md", "README.md");
    for (const patchPath of patches) {
      if (typeof patchPath !== "string") continue;
      const normalizedPatch = patchPath.replace(/^\.\//, "");
      requiresFile(
        (entry) => entry === normalizedPatch || entry === `./${normalizedPatch}`,
        normalizedPatch,
      );
    }
    if (manifest.icon !== undefined) {
      const icon = manifest.icon.replace(/^\.\//, "");
      requiresFile((entry) => entry === icon || entry === `./${icon}`, icon);
    }
    if (isDirectory(path.join(directory, "locale"))) {
      requiresFile(
        (entry) => entry === "locale/*.json" || entry === "./locale/*.json" || entry === "locale",
        "locale/*.json",
      );
      const localeFile = path.join(directory, "locale", "en.json");
      if (!exists(localeFile)) {
        warn(`${label}: locale/en.json is missing; management surfaces fall back to package fields`);
      } else {
        try {
          const locale = readJson(localeFile);
          if (typeof locale?.meta?.title !== "string" || typeof locale?.meta?.description !== "string") {
            fail(`${label}: locale/en.json must carry meta.title and meta.description`);
          }
        } catch (error) {
          fail(`${label}: locale/en.json is not valid JSON: ${error.message}`);
        }
      }
    }
  }

  // ── Installed package inventory, subagent providers, prompt variables ─────
  const installationPackages = packageDirectories(dshRoot, dshPackageDir);
  const promptVariables = registeredPromptVariables(installationPackages);
  const providerNames = new Set();
  for (const directory of installationPackages) {
    const packageName = path.basename(directory);
    if (!packageName.startsWith("dsh-subagent-")) continue;
    const file = path.join(directory, "lib", "index.js");
    if (!exists(file)) continue;
    try {
      const module = await import(pathToFileURL(file).href);
      if (typeof module.Config === "function") {
        const resolved = module.Config({});
        if (typeof resolved?.providerName === "string") providerNames.add(resolved.providerName);
      }
    } catch (error) {
      warn(`cannot inspect subagent provider package ${packageName}: ${error.message}`);
    }
  }
  if (providerNames.size === 0) {
    warn("no installed subagent provider packages were found; provider checks are skipped");
  }

  // ── Row checks ───────────────────────────────────────────────────────────
  const rowsByDirectory = new Map();
  for (const directory of directories) {
    const manifest = manifests.get(directory);
    const patch = manifest.dsh?.bundle?.patch;
    const patches = Array.isArray(patch) ? patch : patch === undefined ? [] : [patch];
    const rows = [];
    for (const patchPath of patches) {
      if (typeof patchPath !== "string") continue;
      const filename = path.join(directory, patchPath);
      if (!exists(filename)) continue;
      let document;
      try {
        document = parsePatch(filename, parseYaml);
      } catch (error) {
        fail(`${path.relative(REPO_ROOT, filename)}: YAML parse error: ${error.message}`);
        continue;
      }
      const insertRows = Array.isArray(document)
        ? document.flatMap((entry) => (Array.isArray(entry?.insert) ? entry.insert : []))
        : [];
      rows.push(...leafRows(insertRows));
    }
    rowsByDirectory.set(directory, rows);

    const validateRow = async (row, prefix) => {
      const label = `${path.relative(REPO_ROOT, directory)}: ${prefix}${JSON.stringify(row.id)}`;
      if (typeof row.name !== "string" || row.name === "") {
        fail(`${label}: name is required`);
        return;
      }
      for (const option of REMOVED_OPTIONS) {
        if (row.config !== undefined && JSON.stringify(row.config).includes(option)) {
          fail(`${label}: option ${option} was removed from the current DSH schema; drop it`);
        }
      }
      if (row.disabled !== undefined) {
        try {
          evaluateValue(row.disabled);
        } catch (error) {
          fail(`${label}: disabled expression failed: ${error.message}`);
        }
      }
      let resolved;
      try {
        resolved = resolvePluginSpec(row.name);
      } catch (error) {
        fail(`${label}: ${error.message}`);
        return;
      }
      if (resolved.file === undefined) return;
      let config;
      try {
        config = row.config === undefined ? undefined : evaluateValue(row.config);
      } catch (error) {
        fail(`${label}: config expression failed: ${error.message}`);
        return;
      }
      if (row.name === "@deepseek-ai/dsh-persona") {
        for (const field of ["prefix", "suffix"]) {
          const text = config?.[field];
          if (typeof text !== "string") continue;
          for (const match of text.matchAll(/{{([^{}]+)}}/g)) {
            const variable = match[1].trim();
            if (!promptVariables.has(variable)) {
              fail(
                `${label}: ${field} uses unregistered prompt variable {{${variable}}}; ` +
                  `registered: ${[...promptVariables].sort().join(", ") || "none"}`,
              );
            }
          }
        }
      }
      try {
        const Config = await loadConfig(resolved.file);
        if (Config === undefined) return;
        Config(config);
      } catch (error) {
        fail(`${label}: config does not match the current schema: ${error.message.split("\n")[0]}`);
      }
      if (row.name === "@deepseek-ai/dsh-tool-subagent") {
        const provider = config?.provider;
        if (providerNames.size > 0 && !providerNames.has(provider)) {
          fail(
            `${label}: provider ${JSON.stringify(provider)} is not registered by an installed ` +
              `dsh-subagent-* package (available: ${[...providerNames].sort().join(", ")})`,
          );
        }
      }
    };

    for (const row of rows) {
      await validateRow(row, "row ");
      if (row.name === "@deepseek-ai/dsh-agent-preset" && Array.isArray(row.config?.plugins)) {
        for (const child of leafRows(row.config.plugins)) {
          await validateRow(child, "preset child ");
        }
      }
    }
  }

  // ── Architect Dev preset checks ──────────────────────────────────────────
  const architectDirectory = directories.find(
    (directory) => manifests.get(directory)?.name === "@sredevopsorg/dsh-architect-dev-bundle",
  );
  if (architectDirectory === undefined) {
    fail("plugins/architect-dev-bundle is missing");
  } else {
    const rows = rowsByDirectory.get(architectDirectory) ?? [];
    const declaration = rows.find((row) => row.id === ARCHITECT_ROW_ID);
    if (declaration === undefined) {
      fail(`architect-dev: the patch must insert row ${ARCHITECT_ROW_ID}`);
    } else {
      const config = declaration.config ?? {};
      if (config.id !== ARCHITECT_ID) {
        fail(`${ARCHITECT_ROW_ID}: config.id must be ${JSON.stringify(ARCHITECT_ID)}`);
      } else if (declaration.id !== `preset-${config.id}`) {
        fail(`${ARCHITECT_ROW_ID}: row id must be preset-${config.id}`);
      }
      if (!Array.isArray(config.plugins) || config.plugins.length === 0) {
        fail(`${ARCHITECT_ROW_ID}: config.plugins must be a non-empty list`);
      }
      const persona = leafRows(config.plugins ?? []).find((row) => row.id === "persona");
      const personaText = JSON.stringify(persona?.config ?? {});
      for (const skill of ARCHITECT_SKILLS) {
        if (!exists(path.join(SKILLS_DIR, skill, "SKILL.md"))) {
          fail(`architect-dev: persona names skill ${JSON.stringify(skill)} but skills/${skill}/SKILL.md is missing`);
        }
        if (!personaText.includes(skill)) {
          fail(`architect-dev: the persona must name skill ${JSON.stringify(skill)}`);
        }
      }
    }

    // Compare the plugin list with the shipped standard preset.
    let standardFile;
    try {
      standardFile = requireFromDsh.resolve("@deepseek-ai/dsh-web-app/presets/standard.patch.yml");
    } catch {
      const webAppManifest = resolvePackageManifest(
        requireFromDsh,
        dshRoot,
        "@deepseek-ai/dsh-web-app",
      );
      standardFile =
        webAppManifest === undefined
          ? path.join(dshRoot, "dsh-web-app", "presets", "standard.patch.yml")
          : path.join(path.dirname(webAppManifest), "presets", "standard.patch.yml");
    }
    if (!exists(standardFile)) {
      fail(`architect-dev: cannot read the shipped standard preset at ${standardFile}`);
    } else {
      const standardDocument = parsePatch(standardFile, parseYaml);
      const standardInsert = Array.isArray(standardDocument)
        ? standardDocument.flatMap((entry) => (Array.isArray(entry?.insert) ? entry.insert : []))
        : [];
      const standardDeclaration = standardInsert.find((row) => row.id === "preset-standard");
      const standardRows = leafRows(standardDeclaration?.config?.plugins ?? []);
      const architectRows = collectPresetRows(rows.find((row) => row.id === ARCHITECT_ROW_ID));
      const architectById = new Map(architectRows.map((row) => [row.id, row]));
      const standardById = new Map(standardRows.map((row) => [row.id, row]));

      for (const standardRow of standardRows) {
        const candidate = architectById.get(standardRow.id);
        if (candidate === undefined) {
          fail(
            `architect-dev: shipped standard preset row ${JSON.stringify(standardRow.id)} is missing; mirror it`,
          );
          continue;
        }
        if (candidate.name !== standardRow.name) {
          fail(
            `architect-dev: row ${JSON.stringify(standardRow.id)} must use ${standardRow.name}, found ${candidate.name}`,
          );
          continue;
        }
        if (standardRow.id === "plan-mode") {
          const expected = evaluateValue(standardRow.config?.section);
          const actual = evaluateValue(candidate.config?.section);
          if (actual !== expected) {
            fail(
              `architect-dev: plan-mode section drifted from the shipped standard preset; copy the current text`,
            );
          }
          continue;
        }
        if (DELTA_ROWS.has(standardRow.id)) continue;
        const standardDisabled = evaluateSafe(standardRow.disabled);
        const candidateDisabled = evaluateSafe(candidate.disabled);
        if (!jsonEqual(standardDisabled, candidateDisabled)) {
          fail(
            `architect-dev: row ${JSON.stringify(standardRow.id)} disabled state differs from standard ` +
              `(${JSON.stringify(candidateDisabled)} vs ${JSON.stringify(standardDisabled)})`,
          );
        }
        const standardConfig = evaluateSafe(standardRow.config);
        const candidateConfig = evaluateSafe(candidate.config);
        if (!jsonEqual(standardConfig, candidateConfig)) {
          fail(
            `architect-dev: row ${JSON.stringify(standardRow.id)} config differs from standard; mirror the shipped config`,
          );
        }
      }
      for (const candidate of architectRows) {
        if (standardById.has(candidate.id)) continue;
        if (EXTRA_ROW_PREFIXES.some((prefix) => candidate.id.startsWith(prefix))) continue;
        fail(`architect-dev: extra row ${JSON.stringify(candidate.id)} is not part of the standard preset`);
      }
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────
  if (options.strict === true) {
    for (const warning of warnings) errors.push(`[strict] ${warning}`);
  }

  if (options.json === true) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: errors.length === 0,
          dshRoot,
          runtimeVersion,
          errors,
          warnings,
          notes,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    for (const noteText of notes) process.stdout.write(`  ${noteText}\n`);
    for (const warning of warnings) process.stdout.write(`! ${warning}\n`);
    for (const error of errors) process.stdout.write(`✗ ${error}\n`);
    const status = errors.length === 0 ? "PASS" : "FAIL";
    process.stdout.write(
      `${status}: ${directories.length} plugin(s), ${errors.length} error(s), ${warnings.length} warning(s) ` +
        `(DSH ${runtimeVersion} at ${dshRoot})\n`,
    );
  }

  if (errors.length > 0) process.exitCode = 1;
}

/** Flatten a preset declaration's plugin list, tolerating an unreadable row. */
function collectPresetRows(declaration) {
  if (declaration === undefined) return [];
  const plugins = declaration.config?.plugins;
  if (!Array.isArray(plugins)) return [];
  return leafRows(plugins);
}

/** Evaluate a value, returning it unchanged when an `!!js` expression fails. */
function evaluateSafe(value) {
  try {
    return evaluateValue(value);
  } catch {
    return value;
  }
}

main().catch((error) => {
  process.stderr.write(`validate-bundles: ${error.message}\n`);
  process.exitCode = 2;
});
