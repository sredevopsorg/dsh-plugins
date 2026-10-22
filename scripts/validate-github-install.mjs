#!/usr/bin/env node
/**
 * validate-github-install.mjs
 *
 * Validate that every plugin in this repository can be installed from its
 * GitHub address, pinned to a release tag.
 *
 * Checks (errors):
 *   - `plugins/<dir>/package.json` names, versions, license, description,
 *     `type: module`, `dsh.manifestVersion: 1`, and a readable bundle patch
 *   - `repository`, `homepage`, and `bugs` point at this repository and at
 *     `plugins/<dir>` as the package directory
 *   - `engines.dsh` is declared
 *   - no dependency uses `workspace:`, `file:`, or `link:`, and no install
 *     lifecycle script runs when pnpm fetches the package from Git
 *   - every export target exists, and `files` ships the patch, README, icon,
 *     locale, and every JavaScript module
 *   - `npm pack --dry-run` produces a tarball with those files
 *   - the root README and the plugin README carry the exact pinned install spec
 *   - the release tag `<dir>-v<version>` is a valid Git ref, and `--tag`
 *     resolves a pushed tag to exactly one package version
 *
 * Usage:
 *   node scripts/validate-github-install.mjs [--strict] [--json] [--tag <tag>]
 *   --strict       treat warnings as errors
 *   --json         emit machine-readable results
 *   --tag TAG      assert TAG is a release tag for one current package version
 *   -h, --help     show this help
 *
 * The script needs only Node and npm; it does not require a DSH installation.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
const REPO_SLUG = "sredevopsorg/dsh-plugins";
const REPO_HTTPS = `https://github.com/${REPO_SLUG}`;
const REPO_GIT = `git+${REPO_HTTPS}.git`;
const REPO_URL_FORMS = new Set([REPO_GIT, `${REPO_HTTPS}.git`, REPO_HTTPS]);
const ISSUES_URL = `${REPO_HTTPS}/issues`;
const EXPECTED_NAME_PREFIX = "@sredevopsorg/dsh-";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const INSTALL_HOOKS = ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"];

const results = { plugins: [], errors: [], warnings: [], tag: undefined };
let errorCount = 0;
let warningCount = 0;

function fail(message) {
  results.errors.push(message);
  errorCount += 1;
}
function warn(message) {
  results.warnings.push(message);
  warningCount += 1;
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
  const options = { strict: false, json: false, tag: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--strict":
        options.strict = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--tag":
        options.tag = argv[++index];
        if (options.tag === undefined || options.tag === "") throw new Error("--tag needs a tag name");
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

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function readText(filename) {
  return fs.readFileSync(filename, "utf8");
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

/** Every regular file under a package directory, relative and POSIX-separated. */
function packageFiles(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(toPosix(path.relative(directory, absolute)));
    }
  };
  walk(directory);
  return files.sort();
}

function canonicalTag(directory, version) {
  return `${directory}-v${version}`;
}

function canonicalSpec(directory, version) {
  return `github:${REPO_SLUG}#${canonicalTag(directory, version)}&path:/plugins/${directory}`;
}

/** Normalize npm's `pack --json` shape: an array on npm 10, a map on npm 12. */
function packEntry(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("npm did not print JSON");
  const parsed = JSON.parse(stdout.slice(start, end + 1));
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  if (entry === undefined || typeof entry !== "object") throw new Error("npm printed no package entry");
  return entry;
}

/** Run `npm pack --dry-run --json` with a private cache and log directory. */
function packDryRun(directory) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-github-install-"));
  const env = {
    ...process.env,
    npm_config_cache: temporary,
    npm_config_logs_dir: temporary,
    npm_config_loglevel: "silent",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
    npm_config_progress: "false",
  };
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    const stdout = execFileSync(
      command,
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: directory, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return packEntry(stdout);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/** Resolve an exports target, rejecting paths that leave the package. */
function checkExportTarget(directory, label, target) {
  if (typeof target !== "string") {
    fail(`${label}: every export target must be a string`);
    return [];
  }
  const relative = target.replace(/^\.\//, "");
  const requires = [];
  if (relative.includes("*")) {
    const parent = path.posix.dirname(relative);
    const absolute = path.join(directory, parent);
    if (!isDirectory(absolute) || fs.readdirSync(absolute).length === 0) {
      fail(`${label}: export target ${JSON.stringify(target)} matches no files`);
    }
    return requires;
  }
  const absolute = path.resolve(directory, relative);
  if (!absolute.startsWith(`${path.resolve(directory)}${path.sep}`) || !exists(absolute)) {
    fail(`${label}: export target does not exist: ${target}`);
    return requires;
  }
  requires.push(relative);
  return requires;
}

function checkManifest(directory, manifest, label) {
  const name = path.basename(directory);
  const expectedName = `${EXPECTED_NAME_PREFIX}${name}`;
  const required = new Set(["package.json"]);

  if (manifest.name !== expectedName) {
    fail(`${label}: name must be ${expectedName}, found ${JSON.stringify(manifest.name)}`);
  }
  if (typeof manifest.version !== "string" || !SEMVER.test(manifest.version)) {
    fail(`${label}: version must be a semantic version, found ${JSON.stringify(manifest.version)}`);
  }
  if (manifest.private === true) fail(`${label}: remove "private": true so the package can be fetched from Git`);
  if (manifest.type !== "module") fail(`${label}: type must be "module"`);
  if (typeof manifest.description !== "string" || manifest.description.trim() === "") {
    fail(`${label}: description is required`);
  }
  if (typeof manifest.license !== "string" || manifest.license.trim() === "") {
    fail(`${label}: license is required`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail(`${label}: files must list what the Git package ships`);
  }
  if (typeof manifest.engines?.dsh !== "string" || manifest.engines.dsh === "") {
    fail(`${label}: engines.dsh is required so an incompatible DSH refuses the install`);
  }

  const repository = manifest.repository;
  if (repository === null || typeof repository !== "object") {
    fail(`${label}: repository must name this Git repository and package directory`);
  } else {
    if (repository.type !== "git") fail(`${label}: repository.type must be "git"`);
    if (!REPO_URL_FORMS.has(repository.url)) {
      fail(`${label}: repository.url must be ${REPO_GIT}, found ${JSON.stringify(repository.url)}`);
    }
    if (repository.directory !== `plugins/${name}`) {
      fail(`${label}: repository.directory must be plugins/${name}, found ${JSON.stringify(repository.directory)}`);
    }
  }
  if (manifest.homepage !== `${REPO_HTTPS}/tree/main/plugins/${name}#readme`) {
    fail(`${label}: homepage must be ${REPO_HTTPS}/tree/main/plugins/${name}#readme`);
  }
  if (manifest.bugs?.url !== ISSUES_URL) {
    fail(`${label}: bugs.url must be ${ISSUES_URL}`);
  }
  if (Array.isArray(manifest.keywords) === false || manifest.keywords.length === 0) {
    warn(`${label}: add keywords so package search and display have terms`);
  }

  if (manifest.dsh?.manifestVersion !== 1) fail(`${label}: dsh.manifestVersion must be 1`);
  const patch = manifest.dsh?.bundle?.patch;
  const patches = Array.isArray(patch) ? patch : patch === undefined ? [] : [patch];
  if (patches.length === 0) fail(`${label}: dsh.bundle.patch is required`);
  for (const patchPath of patches) {
    if (typeof patchPath !== "string" || !exists(path.join(directory, patchPath))) {
      fail(`${label}: bundle patch does not exist: ${JSON.stringify(patchPath)}`);
    } else {
      required.add(patchPath.replace(/^\.\//, ""));
    }
  }

  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [dependency, spec] of Object.entries(manifest[field] ?? {})) {
      if (/^(?:workspace|file|link):/.test(String(spec))) {
        fail(`${label}: ${field}.${dependency} uses ${spec}; a Git-installed package must be self-contained`);
      }
    }
  }
  for (const hook of INSTALL_HOOKS) {
    if (typeof manifest.scripts?.[hook] === "string") {
      fail(`${label}: scripts.${hook} would run when pnpm prepares the Git package; remove it`);
    }
  }

  if (exists(path.join(directory, "README.md"))) required.add("README.md");
  else fail(`${label}: README.md is required by files and by package display`);
  if (typeof manifest.icon === "string") {
    const icon = manifest.icon.replace(/^\.\//, "");
    if (!exists(path.join(directory, icon))) fail(`${label}: icon does not exist: ${manifest.icon}`);
    else required.add(icon);
  }
  if (isDirectory(path.join(directory, "locale"))) {
    if (!exists(path.join(directory, "locale", "en.json"))) {
      fail(`${label}: locale/en.json is missing`);
    } else {
      required.add("locale/en.json");
    }
  }

  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    const subpath = key === "." ? "main export" : `export ${key}`;
    if (typeof target === "string") {
      for (const relative of checkExportTarget(directory, label, target)) required.add(relative);
      continue;
    }
    if (target === null || typeof target !== "object") {
      fail(`${label}: ${subpath} must be a path or a conditions object`);
      continue;
    }
    for (const [condition, conditional] of Object.entries(target)) {
      if (typeof conditional !== "string") {
        fail(`${label}: ${subpath} condition ${condition} must be a path`);
        continue;
      }
      for (const relative of checkExportTarget(directory, label, conditional)) required.add(relative);
    }
  }

  // Every runtime module must ride along, whether or not an export names it.
  for (const file of packageFiles(directory)) {
    if (/\.(?:c?js|mjs)$/.test(file) && !file.startsWith("scripts/")) required.add(file);
  }

  return { required, name, version: manifest.version };
}

function checkTarball(directory, manifest, required, label) {
  let entry;
  try {
    entry = packDryRun(directory);
  } catch (error) {
    const detail = error.stderr === undefined ? "" : `: ${String(error.stderr).trim()}`;
    fail(`${label}: npm pack --dry-run failed${detail}`);
    return [];
  }
  const shipped = new Set((entry.files ?? []).map((file) => file.path));
  if (entry.name !== manifest.name) fail(`${label}: packed name is ${JSON.stringify(entry.name)}`);
  if (entry.version !== manifest.version) fail(`${label}: packed version is ${JSON.stringify(entry.version)}`);
  for (const file of [...required].sort()) {
    if (!shipped.has(file)) fail(`${label}: "files" does not ship ${file}`);
  }
  return [...shipped].sort();
}

function checkDocs(directory, directoryName, spec, label) {
  const rootReadme = path.join(REPO_ROOT, "README.md");
  if (!exists(rootReadme)) {
    fail("README.md: missing at the repository root");
  } else if (!readText(rootReadme).includes(spec)) {
    fail(`README.md: add the pinned install command for plugins/${directoryName}: ${spec}`);
  }
  const pluginReadme = path.join(directory, "README.md");
  if (exists(pluginReadme) && !readText(pluginReadme).includes(spec)) {
    fail(`${label}: add the pinned install command to the README: ${spec}`);
  }
}

function checkTagRef(tag, label) {
  try {
    execFileSync("git", ["check-ref-format", `refs/tags/${tag}`], { stdio: "ignore" });
  } catch (error) {
    if (error.code === "ENOENT") warn("git is not available; skipped the tag ref check");
    else fail(`${label}: ${tag} is not a valid Git tag`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const directories = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PLUGINS_DIR, entry.name))
    .filter((directory) => exists(path.join(directory, "package.json")))
    .sort();
  if (directories.length === 0) fail(`no packages found under ${PLUGINS_DIR}`);

  const expectedTags = [];
  for (const directory of directories) {
    const directoryName = path.basename(directory);
    const label = `plugins/${directoryName}`;
    const manifest = readJson(path.join(directory, "package.json"));
    const { required, version } = checkManifest(directory, manifest, label);
    const shipped = checkTarball(directory, manifest, required, label);
    const tag = canonicalTag(directoryName, version);
    const spec = canonicalSpec(directoryName, version);
    expectedTags.push(tag);
    results.plugins.push({
      directory: directoryName,
      name: manifest.name,
      version,
      tag,
      spec,
      files: shipped,
    });
    checkDocs(directory, directoryName, spec, label);
    checkTagRef(tag, label);
  }

  if (options.tag !== undefined) {
    results.tag = options.tag;
    const matched = results.plugins.find((plugin) => plugin.tag === options.tag);
    if (matched === undefined) {
      fail(
        `tag ${JSON.stringify(options.tag)} does not match any current package version; expected one of: ${expectedTags.join(", ")}`,
      );
    }
  }

  const failed = errorCount > 0 || (options.strict && warningCount > 0);
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          plugins: results.plugins,
          tag: results.tag,
          errors: results.errors,
          warnings: results.warnings,
          ok: !failed,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    for (const plugin of results.plugins) {
      console.log(`✓ ${plugin.directory}  ${plugin.name}@${plugin.version}`);
      console.log(`  tag:  ${plugin.tag}`);
      console.log(`  spec: ${plugin.spec}`);
    }
    for (const message of results.errors) console.log(`✗ ${message}`);
    for (const message of results.warnings) console.log(`! ${message}`);
    console.log(
      `validate-github-install: ${results.plugins.length} plugins, ${errorCount} errors, ${warningCount} warnings`,
    );
  }
  return failed ? 1 : 0;
}

try {
  process.exit(main());
} catch (error) {
  console.error(`validate-github-install: ${error.message}`);
  process.exit(1);
}
