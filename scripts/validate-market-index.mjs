#!/usr/bin/env node
/**
 * validate-market-index.mjs
 *
 * Validate `index.json`, the format-1 plugin market index that
 * `@deepseek-ai/dsh-experimental-plugin-market-bundle` reads in Discover.
 *
 * Checks (errors):
 *   - `index.json` exists, parses, and passes `parseMarketIndex` from the DSH
 *     installation's `@deepseek-ai/dsh-plugin-market-index`
 *   - every listed plugin is backed by a `plugins/<directory>/package.json`
 *     bundle, with the same name, homepage, and repository directory
 *   - every listed version is a `<directory>-v<version>` release tag whose
 *     commit, committer time, name, version, and `engines.dsh` match the
 *     package at that commit, installed from this repository at
 *     `plugins/<directory>`
 *   - a listed icon that points into this repository exists
 *   - plugins with release tags are listed, and there are no stale entries
 *   - `index.json` is exactly what `scripts/build-market-index.mjs` generates
 *     from the current tags and manifests
 *
 * Checks (warnings): plugins without a release tag, and release tags that the
 * index has not published yet (the release workflow opens that update).
 * `--strict` treats warnings as errors.
 *
 * Usage:
 *   node scripts/validate-market-index.mjs [--dsh-root <dir>] [--strict] [--json]
 *      [--index-url <url>]
 *   --dsh-root DIR   node_modules/@deepseek-ai directory of the DSH installation
 *   --strict         treat warnings as errors
 *   --json           emit machine-readable results
 *   --index-url URL  published URL of the index (default: the canonical raw URL)
 *   -h, --help       show this help
 *
 * The DSH root defaults to `DSH_INSTALL`, then the real path of `dsh` on PATH.
 * The checkout must contain the release tags: use a full clone, as CI does
 * (fetch-depth 0).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { INDEX_URL, REPO_WEB, buildMarketIndex } from "./build-market-index.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
const INDEX_FILE = path.join(REPO_ROOT, "index.json");
const RAW_PREFIX = new URL(INDEX_URL).href.replace(/index\.json$/u, "");

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
  const options = { dshRoot: undefined, strict: false, json: false, indexUrl: INDEX_URL, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
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
      case "--index-url":
        options.indexUrl = argv[++index];
        if (options.indexUrl === undefined) throw new Error("--index-url needs a URL");
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`unknown option: ${argv[index]} (try --help)`);
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

/** Resolve the index validator from the DSH installation, flat or nested layout. */
async function loadMarketIndexParser(dshRoot) {
  const requireFromDsh = createRequire(path.join(dshRoot, "dsh", "package.json"));
  let entry;
  try {
    entry = requireFromDsh.resolve("@deepseek-ai/dsh-plugin-market-index");
  } catch {
    entry = path.join(dshRoot, "dsh-plugin-market-index", "lib", "index.js");
  }
  if (!exists(entry)) {
    throw new Error(
      `cannot resolve @deepseek-ai/dsh-plugin-market-index from DSH at ${dshRoot}; ` +
        "use a DSH release that ships the plugin market index",
    );
  }
  const module = await import(pathToFileURL(entry).href);
  return module;
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((member, index) => deepEqual(member, right[index]));
  }
  if (typeof left !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (!deepEqual(leftKeys, rightKeys)) return false;
  return leftKeys.every((key) => deepEqual(left[key], right[key]));
}

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function releaseTagsByDirectory() {
  const grouped = new Map();
  const tags = git(["for-each-ref", "--format=%(refname:short)", "refs/tags"])
    .split("\n")
    .filter((tag) => tag !== "")
    .sort();
  for (const tag of tags) {
    const match = /^(.+)-v(.+)$/u.exec(tag);
    if (match === null) continue;
    const versions = grouped.get(match[1]) ?? [];
    versions.push({ tag, version: match[2] });
    grouped.set(match[1], versions);
  }
  return grouped;
}

function pluginDirectories() {
  const directories = new Map();
  if (!fs.existsSync(PLUGINS_DIR)) return directories;
  for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestFile = path.join(PLUGINS_DIR, entry.name, "package.json");
    if (!exists(manifestFile)) continue;
    directories.set(entry.name, readJson(manifestFile));
  }
  return directories;
}

function checkVersion(directory, manifest, plugin, version) {
  const label = `${plugin.name}@${version.version}`;
  const tag = `${directory}-v${version.version}`;
  let commit;
  try {
    commit = git(["rev-parse", `${tag}^{commit}`]);
  } catch {
    fail(`${label}: no release tag ${tag} pins this version`);
    return;
  }
  if (version.source.type !== "git") {
    fail(`${label}: this repository publishes Git sources, found ${JSON.stringify(version.source.type)}`);
    return;
  }
  if (version.source.url !== REPO_WEB) {
    fail(`${label}: source.url must be ${REPO_WEB}, found ${JSON.stringify(version.source.url)}`);
  }
  if (version.source.path !== `plugins/${directory}`) {
    fail(`${label}: source.path must be plugins/${directory}, found ${JSON.stringify(version.source.path)}`);
  }
  if (version.source.commit !== commit) {
    fail(`${label}: source.commit is not the commit of ${tag} (${commit})`);
  }
  const publishTimestamp = Number(git(["log", "-1", "--format=%ct", commit]));
  if (version.publishTimestamp !== publishTimestamp) {
    fail(`${label}: publishTimestamp ${version.publishTimestamp} is not the tag commit time ${publishTimestamp}`);
  }
  let taggedManifest;
  try {
    taggedManifest = JSON.parse(git(["show", `${commit}:plugins/${directory}/package.json`]));
  } catch {
    fail(`${label}: cannot read plugins/${directory}/package.json at ${commit}`);
    return;
  }
  if (taggedManifest.name !== plugin.name) {
    fail(`${label}: package name at ${tag} is ${JSON.stringify(taggedManifest.name)}`);
  }
  if (taggedManifest.version !== version.version) {
    fail(`${label}: package version at ${tag} is ${JSON.stringify(taggedManifest.version)}`);
  }
  const dshRange = taggedManifest.engines?.dsh;
  if (typeof dshRange === "string" && dshRange.trim() !== "") {
    if (version.engines?.dsh !== dshRange) {
      fail(`${label}: engines.dsh must be ${JSON.stringify(dshRange)} from the package at ${tag}`);
    }
  } else if (version.engines?.dsh !== undefined) {
    fail(`${label}: engines.dsh is listed but the package at ${tag} declares none`);
  }
  if (manifest.name !== plugin.name) {
    fail(`plugins/${directory}: manifest name ${JSON.stringify(manifest.name)} is not listed correctly`);
  }
}

function checkRepository(plugin, manifest, directory) {
  const declaredUrl = (() => {
    const value = manifest.repository?.url;
    if (typeof value !== "string" || value.trim() === "") return undefined;
    try {
      const url = new URL(value.replace(/^git\+/u, "").replace(/\.git$/u, ""));
      url.search = "";
      url.hash = "";
      return url.href.replace(/\/$/u, "");
    } catch {
      return undefined;
    }
  })();
  if (plugin.repository !== undefined) {
    const expectedDirectory =
      typeof manifest.repository?.directory === "string"
        ? manifest.repository.directory
        : `plugins/${directory}`;
    if (plugin.repository.url !== (declaredUrl ?? REPO_WEB)) {
      fail(`${plugin.name}: repository.url does not match the package manifest`);
    }
    if (plugin.repository.directory !== expectedDirectory) {
      fail(`${plugin.name}: repository.directory must be ${expectedDirectory}`);
    }
  }
  if (plugin.homepage !== undefined && plugin.homepage !== manifest.homepage) {
    fail(`${plugin.name}: homepage does not match the package manifest`);
  }
}

function checkIcon(plugin, indexUrl) {
  if (plugin.icon === undefined || plugin.icon.startsWith("data:")) return;
  let resolved;
  try {
    resolved = new URL(plugin.icon, indexUrl).href;
  } catch {
    fail(`${plugin.name}: icon does not resolve against the index URL`);
    return;
  }
  if (!resolved.startsWith(RAW_PREFIX)) return; // An external https icon is the market's choice.
  const relative = resolved.slice(RAW_PREFIX.length).split("?")[0].split("#")[0];
  if (!exists(path.join(REPO_ROOT, relative))) {
    fail(`${plugin.name}: icon ${relative} does not exist in this repository`);
  }
}

function report(options, summary) {
  if (options.strict) {
    for (const warning of warnings) errors.push(`[strict] ${warning}`);
  }
  const uniqueWarnings = [...new Set(warnings)];
  const uniqueErrors = [...new Set(errors)];
  const ok = uniqueErrors.length === 0;
  summary.errors = uniqueErrors.length;
  summary.warnings = uniqueWarnings.length;
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ ok, indexUrl: options.indexUrl, ...summary, errors: uniqueErrors, warnings: uniqueWarnings, notes }, null, 2)}\n`,
    );
  } else {
    for (const text of notes) process.stdout.write(`  ${text}\n`);
    for (const warning of uniqueWarnings) process.stdout.write(`! ${warning}\n`);
    for (const error of uniqueErrors) process.stdout.write(`✗ ${error}\n`);
    process.stdout.write(
      `${ok ? "PASS" : "FAIL"}: ${summary.plugins} plugin(s), ${summary.versions} version(s) ` +
        `(${summary.errors} error(s), ${summary.warnings} warning(s))\n`,
    );
  }
  if (!ok) process.exitCode = 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const dshRoot = resolveDshRoot(options.dshRoot);
  if (dshRoot === undefined || !exists(path.join(dshRoot, "dsh", "package.json"))) {
    throw new Error(
      "cannot find a DSH installation: pass --dsh-root <node_modules/@deepseek-ai> or set DSH_INSTALL",
    );
  }
  const { parseMarketIndex } = await loadMarketIndexParser(dshRoot);

  if (!exists(INDEX_FILE)) {
    fail("index.json is missing; run `node scripts/build-market-index.mjs`");
  }
  let parsed = { plugins: [] };
  let parsedOk = false;
  if (exists(INDEX_FILE)) {
    let raw;
    try {
      raw = readJson(INDEX_FILE);
    } catch (error) {
      fail(`index.json is not valid JSON: ${error.message}`);
    }
    if (raw !== undefined) {
      try {
        parsed = parseMarketIndex(raw, options.indexUrl);
        parsedOk = true;
      } catch (error) {
        if (error?.name === "MarketIndexError") {
          fail(`index.json${error.path}: ${error.reason}`);
        } else {
          fail(`index.json cannot be validated: ${error.message}`);
        }
      }
    }
  }

  if (!parsedOk) {
    report(options, { plugins: 0, versions: 0 });
    return;
  }

  const directories = pluginDirectories();
  const tagsByDirectory = releaseTagsByDirectory();
  const byName = new Map();
  for (const [directory, manifest] of directories) {
    byName.set(manifest.name, { directory, manifest });
  }

  const listedDirectories = new Set();
  for (const plugin of parsed.plugins) {
    const match = byName.get(plugin.name);
    if (match === undefined) {
      fail(`index.json lists ${plugin.name}, but no plugins/<directory>/package.json declares it`);
      continue;
    }
    listedDirectories.add(match.directory);
    checkRepository(plugin, match.manifest, match.directory);
    checkIcon(plugin, options.indexUrl);
    const listedVersions = new Set();
    for (const version of plugin.versions) {
      listedVersions.add(version.version);
      checkVersion(match.directory, match.manifest, plugin, version);
    }
    const tags = tagsByDirectory.get(match.directory) ?? [];
    for (const { tag, version } of tags) {
      if (listedVersions.has(version)) continue;
      warn(
        `index.json is stale for release tag ${tag}; run ` +
          "`node scripts/build-market-index.mjs` and commit the result",
      );
    }
  }

  for (const [directory, manifest] of directories) {
    if (manifest.dsh?.bundle?.patch === undefined) continue;
    if (listedDirectories.has(directory)) continue;
    const tags = tagsByDirectory.get(directory) ?? [];
    if (tags.length === 0) {
      warn(`plugins/${directory} has no release tag; tag it to publish it in the index`);
    } else {
      fail(`plugins/${directory} has release tags but is missing from index.json`);
    }
  }

  // The index must be exactly what the generator produces. An index that only
  // lags behind newly pushed tags is a warning: the release workflow publishes
  // that update in a pull request.
  let generated;
  try {
    generated = buildMarketIndex();
  } catch (error) {
    fail(`cannot build the index from the current checkout: ${error.message}`);
  }
  const summary = {
    plugins: parsed.plugins.length,
    versions: parsed.plugins.reduce((total, plugin) => total + plugin.versions.length, 0),
  };
  if (generated !== undefined && errors.length === 0) {
    let expected;
    try {
      expected = parseMarketIndex(generated.index, options.indexUrl);
    } catch (error) {
      fail(`the generator produced an invalid index: ${error.message}`);
    }
    if (expected !== undefined) {
      if (!deepEqual(parsed, expected)) {
        const missing = [];
        for (const plugin of expected.plugins) {
          const listed = parsed.plugins.find((candidate) => candidate.name === plugin.name);
          const listedVersions = new Set((listed?.versions ?? []).map((version) => version.version));
          for (const version of plugin.versions) {
            if (!listedVersions.has(version.version)) missing.push(`${plugin.name}@${version.version}`);
          }
        }
        const trimmed = {
          ...expected,
          plugins: expected.plugins.map((plugin) => {
            const listed = parsed.plugins.find((candidate) => candidate.name === plugin.name);
            const listedVersions = new Set((listed?.versions ?? []).map((version) => version.version));
            return {
              ...plugin,
              versions: plugin.versions.filter((version) => listedVersions.has(version.version)),
            };
          }),
        };
        if (!(missing.length > 0 && deepEqual(parsed, trimmed))) {
          fail(
            "index.json does not match the generated index; run `node scripts/build-market-index.mjs` " +
              "and commit the result",
          );
        }
      }
    }
  }
  for (const warning of generated?.warnings ?? []) note(`generator: ${warning}`);
  report(options, summary);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`validate-market-index: ${error.message}\n`);
  process.exit(2);
}
