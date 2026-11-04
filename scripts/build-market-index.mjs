#!/usr/bin/env node
/**
 * build-market-index.mjs
 *
 * Build the repository's plugin market index: the format-1 JSON document that
 * `@deepseek-ai/dsh-experimental-plugin-market-bundle` reads when a user adds
 * its URL under **Plugins -> Discover -> Add index source**.
 *
 * Every package under `plugins/` that declares a DSH bundle is listed with its
 * release tags. Each tag becomes one exact version, installable from the tag's
 * pinned commit through pnpm's Git subdirectory support:
 *
 *   source: { type: "git", url: "https://github.com/sredevopsorg/dsh-plugins",
 *             commit: "<40-hex sha>", path: "plugins/<directory>" }
 *
 * Display metadata (title, description, icon, homepage, repository, keywords)
 * comes from the package manifest and `plugins/<directory>/locale/en.json`.
 * A plugin without a release tag is not listed; tag it first.
 *
 * Usage:
 *   node scripts/build-market-index.mjs [--output <file>] [--check] [--json]
 *   --output FILE  write the index there (default: <repository>/index.json)
 *   --check        do not write; exit 1 when the file differs from the build
 *   --json         emit a machine-readable summary
 *   -h, --help     show this help
 *
 * The script needs Node and git only: it never installs packages or runs
 * plugin code. `git` must be able to see the release tags, so use a full clone
 * (CI checks out with fetch-depth 0).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
const DEFAULT_OUTPUT = path.join(REPO_ROOT, "index.json");

/** Repository web page, without the `.git` suffix. */
const REPO_WEB = "https://github.com/sredevopsorg/dsh-plugins";
/** Canonical published index URL, used in documentation and validation. */
const INDEX_URL = "https://raw.githubusercontent.com/sredevopsorg/dsh-plugins/main/index.json";
const INDEX_TITLE = { en: "sredevopsorg DSH plugins" };
const INDEX_DESCRIPTION = {
  en: "DSH bundles maintained by sredevopsorg, installed from pinned Git commits.",
};
const AUTHOR = "sredevopsorg";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

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
  const options = { output: DEFAULT_OUTPUT, check: false, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--output":
        options.output = argv[++index];
        if (options.output === undefined || options.output === "") {
          throw new Error("--output needs a file");
        }
        break;
      case "--check":
        options.check = true;
        break;
      case "--json":
        options.json = true;
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

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

/** Release tags in `<plugin-directory>-v<version>` form, grouped by directory. */
function releaseTagsByDirectory() {
  const tags = git(["for-each-ref", "--format=%(refname:short)", "refs/tags"])
    .split("\n")
    .filter((tag) => tag !== "")
    .sort();
  const grouped = new Map();
  for (const tag of tags) {
    const match = /^(.+)-v(.+)$/u.exec(tag);
    if (match === null) continue;
    const [, directory, version] = match;
    if (!SEMVER.test(version)) continue;
    const versions = grouped.get(directory) ?? [];
    versions.push({ tag, version });
    grouped.set(directory, versions);
  }
  return grouped;
}

/** Compare two exact SemVer versions, without a dependency. */
function compareVersions(left, right) {
  const parse = (version) => {
    const [core, prerelease = ""] = version.split("+")[0].split("-");
    return { core: core.split(".").map(Number), prerelease: prerelease === "" ? [] : prerelease.split(".") };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const difference = Number(leftPart) - Number(rightPart);
      if (difference !== 0) return difference;
    } else if (leftNumeric) {
      return -1;
    } else if (rightNumeric) {
      return 1;
    } else if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }
  return 0;
}

function manifestAtCommit(commit, directory) {
  const text = git(["show", `${commit}:plugins/${directory}/package.json`]);
  return JSON.parse(text);
}

function fileAtCommitExists(commit, relativePath) {
  try {
    git(["cat-file", "-e", `${commit}:${relativePath}`]);
    return true;
  } catch {
    return false;
  }
}

function publishedPlugin(directory, manifest, tags, warnings) {
  const label = `plugins/${directory}`;
  const versions = [];
  for (const { tag, version } of tags) {
    const commit = git(["rev-parse", `${tag}^{commit}`]);
    const taggedManifest = manifestAtCommit(commit, directory);
    if (taggedManifest.version !== version) {
      throw new Error(
        `${label}: tag ${tag} names version ${version}, but package.json at ${commit} is ` +
          `${JSON.stringify(taggedManifest.version)}`,
      );
    }
    if (taggedManifest.name !== manifest.name) {
      throw new Error(
        `${label}: tag ${tag} names package ${JSON.stringify(taggedManifest.name)}, ` +
          `but the current manifest is ${JSON.stringify(manifest.name)}`,
      );
    }
    const publishTimestamp = Number(git(["log", "-1", "--format=%ct", commit]));
    if (!Number.isInteger(publishTimestamp) || publishTimestamp < 0) {
      throw new Error(`${label}: cannot read the commit time of ${tag}`);
    }
    if (!fileAtCommitExists(commit, `plugins/${directory}/README.md`)) {
      warnings.push(`${label}: tag ${tag} has no README.md; its Discover entry page will be empty`);
    }
    /** @type {{ version: string, publishTimestamp: number, source: object, engines?: object }} */
    const entry = {
      version,
      publishTimestamp,
      source: {
        type: "git",
        url: REPO_WEB,
        commit,
        path: `plugins/${directory}`,
      },
    };
    const dshRange = taggedManifest.engines?.dsh;
    if (typeof dshRange === "string" && dshRange.trim() !== "") {
      entry.engines = { dsh: dshRange };
    }
    versions.push(entry);
  }
  if (versions.length === 0) return undefined;
  versions.sort((left, right) => compareVersions(right.version, left.version));

  const locale = readLocale(directory);
  const repositoryUrl = repositoryWebUrl(manifest, label);
  const plugin = {
    name: manifest.name,
  };
  if (typeof locale.title === "string" && locale.title.trim() !== "") {
    plugin.title = locale.title;
  }
  if (typeof locale.description === "string" && locale.description.trim() !== "") {
    plugin.description = locale.description;
  }
  const declaredIcon =
    typeof manifest.icon === "string" && manifest.icon.trim() !== ""
      ? manifest.icon.replace(/^\.\//u, "")
      : "icon.svg";
  if (fs.existsSync(path.join(PLUGINS_DIR, directory, declaredIcon))) {
    // The icon is published beside the index and resolves against the index URL.
    plugin.icon = `plugins/${directory}/${declaredIcon}`;
  }
  plugin.author = AUTHOR;
  if (typeof manifest.homepage === "string" && manifest.homepage.trim() !== "") {
    plugin.homepage = manifest.homepage;
  }
  plugin.repository = {
    url: repositoryUrl,
    directory: typeof manifest.repository?.directory === "string" ? manifest.repository.directory : `plugins/${directory}`,
  };
  plugin.metadata = {
    keywords: Array.isArray(manifest.keywords)
      ? manifest.keywords.filter((keyword) => typeof keyword === "string")
      : [],
  };
  plugin.versions = versions;
  return plugin;
}

function readLocale(directory) {
  const filename = path.join(PLUGINS_DIR, directory, "locale", "en.json");
  if (!fs.existsSync(filename)) return {};
  const value = readJson(filename);
  const meta = value !== null && typeof value === "object" ? value.meta : undefined;
  if (meta === null || typeof meta !== "object") return {};
  return {
    title: typeof meta.title === "string" ? meta.title : undefined,
    description: typeof meta.description === "string" ? meta.description : undefined,
  };
}

function repositoryWebUrl(manifest, label) {
  const declared = manifest.repository?.url;
  if (typeof declared !== "string" || declared.trim() === "") {
    return REPO_WEB;
  }
  const normalized = declared.replace(/^git\+/u, "").replace(/\.git$/u, "");
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${label}: repository.url is not an absolute URL: ${declared}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label}: repository.url must use https: or http:`);
  }
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/u, "");
}

/**
 * Build the index document from the packages and release tags in this checkout.
 * @returns {{ index: object, plugins: string[], versions: number, warnings: string[] }}
 */
export function buildMarketIndex() {
  const warnings = [];
  const tagsByDirectory = releaseTagsByDirectory();
  const directories = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const plugins = [];
  const listed = [];
  let versionCount = 0;
  for (const directory of directories) {
    const manifestFile = path.join(PLUGINS_DIR, directory, "package.json");
    if (!fs.existsSync(manifestFile)) continue;
    const manifest = readJson(manifestFile);
    if (manifest.dsh?.bundle?.patch === undefined) {
      warnings.push(`plugins/${directory}: no dsh.bundle.patch; not a market bundle`);
      continue;
    }
    const tags = tagsByDirectory.get(directory) ?? [];
    if (tags.length === 0) {
      warnings.push(`plugins/${directory}: no release tag; tag it to publish it in the index`);
      continue;
    }
    const plugin = publishedPlugin(directory, manifest, tags, warnings);
    if (plugin !== undefined) {
      plugins.push(plugin);
      listed.push(directory);
      versionCount += plugin.versions.length;
    }
  }
  const index = {
    format: 1,
    title: INDEX_TITLE,
    description: INDEX_DESCRIPTION,
    plugins,
  };
  return { index, plugins: listed, versions: versionCount, warnings };
}

function serialize(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const { index, plugins, versions, warnings } = buildMarketIndex();
  const text = serialize(index);
  const output = path.resolve(options.output);

  let changed = true;
  if (fs.existsSync(output)) {
    changed = fs.readFileSync(output, "utf8") !== text;
  }
  if (options.check) {
    for (const warning of warnings) process.stderr.write(`! ${warning}\n`);
    if (changed) {
      process.stderr.write(
        `build-market-index: ${path.relative(process.cwd(), output)} is not what the build produces; ` +
          "run `node scripts/build-market-index.mjs` and commit the result\n",
      );
      return 1;
    }
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          { output: path.relative(process.cwd(), output), changed, plugins, versions, warnings },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(`up to date: ${plugins.length} plugin(s), ${versions} version(s)\n`);
    }
    return 0;
  }
  if (changed) fs.writeFileSync(output, text);
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        { output: path.relative(process.cwd(), output), changed, plugins, versions, warnings },
        null,
        2,
      )}\n`,
    );
  } else {
    for (const warning of warnings) process.stdout.write(`! ${warning}\n`);
    process.stdout.write(
      `${changed ? "wrote" : "unchanged"} ${path.relative(process.cwd(), output)}: ` +
        `${plugins.length} plugin(s), ${versions} version(s)\n`,
    );
  }
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (error) {
    process.stderr.write(`build-market-index: ${error.message}\n`);
    process.exit(1);
  }
}

export { INDEX_URL, REPO_WEB, SEMVER, compareVersions, serialize };
