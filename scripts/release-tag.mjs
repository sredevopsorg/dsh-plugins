#!/usr/bin/env node
/**
 * release-tag.mjs
 *
 * Create the annotated release tag for one plugin package, after checking that
 * the package validates and that the tag matches its `package.json` version.
 * Pushing the tag starts `.github/workflows/release.yml`, which validates the
 * tag again and creates the GitHub release.
 *
 * Usage:
 *   node scripts/release-tag.mjs --plugin <dir> [--dry-run] [--push]
 *   --plugin DIR  plugin directory under plugins/ (e.g. flaresolverr)
 *   --dry-run     print the tag and install command; change nothing
 *   --push        push the tag to origin after creating it
 *   -h, --help    show this help
 *
 * The worktree must be clean, so the tag always names a reviewed commit.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");

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
  const options = { plugin: undefined, dryRun: false, push: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--plugin":
        options.plugin = argv[++index];
        if (options.plugin === undefined || options.plugin === "") throw new Error("--plugin needs a directory");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--push":
        options.push = true;
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

function git(args, options = {}) {
  const output = execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", ...options });
  return typeof output === "string" ? output.trim() : "";
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (options.plugin === undefined) throw new Error("--plugin <dir> is required (try --help)");

  const directory = path.resolve(PLUGINS_DIR, options.plugin);
  if (!directory.startsWith(`${path.resolve(PLUGINS_DIR)}${path.sep}`) || !fs.existsSync(path.join(directory, "package.json"))) {
    throw new Error(`not a plugin package: ${options.plugin} (expected a directory under plugins/)`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  const directoryName = path.basename(directory);
  const tag = `${directoryName}-v${manifest.version}`;

  const dirty = git(["status", "--porcelain"]);
  if (dirty !== "") throw new Error("worktree is not clean; commit or stash the changes before tagging");
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") process.stderr.write(`release-tag: warning: tagging ${branch}, not main\n`);

  let tagExists = false;
  try {
    git(["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
    tagExists = true;
  } catch {
    // An absent tag is the expected state.
  }
  if (tagExists) {
    throw new Error(`tag ${tag} already exists; bump ${path.join("plugins", directoryName, "package.json")} instead`);
  }

  process.stdout.write(`release-tag: validating ${directoryName}@${manifest.version}\n`);
  execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts", "validate-github-install.mjs"), "--strict"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });

  const spec = `github:sredevopsorg/dsh-plugins#${tag}&path:/plugins/${directoryName}`;
  if (options.dryRun) {
    process.stdout.write(`release-tag: would create ${tag}\n  spec: ${spec}\n`);
    return 0;
  }

  git(["tag", "-a", tag, "-m", `Release ${manifest.name} ${manifest.version}`]);
  process.stdout.write(`release-tag: created ${tag}\n  spec: ${spec}\n`);
  if (options.push) {
    git(["push", "origin", tag], { stdio: "inherit" });
    process.stdout.write(`release-tag: pushed ${tag}; the release workflow will publish it\n`);
  } else {
    process.stdout.write(`release-tag: push it with: git push origin ${tag}\n`);
  }
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  console.error(`release-tag: ${error.message}`);
  process.exit(1);
}
