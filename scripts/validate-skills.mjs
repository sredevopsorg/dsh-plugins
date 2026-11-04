#!/usr/bin/env node
/**
 * validate-skills.mjs
 *
 * Validate every skill in this repository against the contract enforced by
 * `@deepseek-ai/dsh-skill-filesystem`, and enforce that skills stay inside the
 * one installable package (`plugins/skills`) instead of leaking back into a
 * bare top-level `skills/` directory.
 *
 * Skills live at `plugins/skills/skills/` and are served by
 * `@sredevopsorg/dsh-skills`, which registers a skill provider on `ctx.skills`.
 * The same frontmatter contract applies. Misconfiguration fails *silently at
 * discovery* (the skill is dropped with a log line nobody reads), so this
 * script makes the same checks loud and exits non-zero in CI.
 *
 * Checks (errors):
 *   - a candidate is a `plugins/skills/skills/<name>/SKILL.md` directory bundle
 *     or a flat `plugins/skills/skills/<name>.md` file
 *   - YAML frontmatter exists and is well formed
 *   - `name` is present, kebab-case, and matches its directory/file basename
 *   - `description` is present and non-empty
 *   - `disable-model-invocation` / `user-invocable` hold a boolean spelling the
 *     provider accepts (true/false, yes/no, on/off, 1/0, case-insensitive)
 *   - enforcement: a `SKILL.md` exists **outside** the packaged plugin's
 *     `plugins/skills/skills` and outside another plugin package's own
 *     `plugins/<name>/skills` vendor directory (including a resurrected
 *     top-level `skills/` directory)
 *   - enforcement: the package manifest ships the skills directory, and
 *     `npm pack --dry-run` includes every packaged skill file
 *
 * Checks (warnings):
 *   - `description` longer than the catalog cap (truncated, not fatal)
 *   - unknown frontmatter keys
 *   - `**\/SKILL.md` nested below a skill root (deliberately not discovered)
 *   - duplicate skill names
 *   - npm is unavailable, so the pack-contents check is skipped
 *
 * Usage:
 *   node scripts/validate-skills.mjs [--strict] [--json] [--no-pack]
 *   --strict   treat warnings as errors
 *   --json     emit machine-readable results
 *   --no-pack  skip the `npm pack --dry-run` contents check
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packageDir = path.join(repoRoot, "plugins", "skills");
const skillsDir = path.join(packageDir, "skills");
const packageManifestFile = path.join(packageDir, "package.json");

/** Catalog render cap from @deepseek-ai/dsh-tool-skill. */
const DESCRIPTION_CAP = 500;

/** Directories never scanned for stray skills. */
const IGNORED_DIRS = new Set([".git", ".dsh", "node_modules", "dist", "build", "themes"]);

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOOLEAN_KEYS = ["disable-model-invocation", "user-invocable"];
const KNOWN_KEYS = [
  "name",
  "description",
  "whenToUse",
  "metadata",
  "license",
  ...BOOLEAN_KEYS,
];

const TRUE_WORDS = new Set(["true", "yes", "on", "1"]);
const FALSE_WORDS = new Set(["false", "no", "off", "0"]);

const results = [];
let errors = 0;
let warnings = 0;

function report(level, file, message) {
  const record = { level, file: path.relative(repoRoot, file), message };
  results.push(record);
  if (level === "error") errors += 1;
  else warnings += 1;
  if (!process.argv.includes("--json")) {
    const mark = level === "error" ? "✗" : "!";
    console.log(`${mark} ${record.file}: ${message}`);
  }
}

/**
 * Parse the leading `---` frontmatter block. Returns null when the file has no
 * frontmatter, otherwise a Map of key -> raw scalar string. Block scalars
 * (`>-`, `|`) are folded/kept as one string so presence and booleans work.
 */
function parseFrontmatter(text) {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return null;

  const fields = new Map();
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;

    const [, key, inline] = kv;
    if (inline === ">" || inline === ">-" || inline === "|" || inline === "|-") {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        block.push(lines[i + 1].trim());
        i += 1;
      }
      fields.set(key, block.join(" ").trim());
    } else {
      fields.set(key, inline.trim());
    }
  }
  return fields;
}

function unquote(value) {
  return value.replace(/^["'](.*)["']$/, "$1").trim();
}

function isBooleanWord(value) {
  const normalized = unquote(value).toLowerCase();
  return TRUE_WORDS.has(normalized) || FALSE_WORDS.has(normalized);
}

function collectEntries(dir) {
  const entries = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dirent.name.startsWith(".") || dirent.name.startsWith("_")) continue;
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      const skillFile = path.join(full, "SKILL.md");
      if (fs.existsSync(skillFile)) entries.push({ kind: "bundle", name: dirent.name, file: skillFile });
    } else if (dirent.isFile() && dirent.name.endsWith(".md")) {
      entries.push({ kind: "flat", name: dirent.name.replace(/\.md$/, ""), file: full });
    }
  }
  return entries;
}

function findNestedSkillFiles(dir, depth = 0) {
  const nested = [];
  if (depth > 6) return nested;
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dirent.name.startsWith(".")) continue;
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      const skillFile = path.join(full, "SKILL.md");
      if (depth >= 1 && fs.existsSync(skillFile)) nested.push(skillFile);
      nested.push(...findNestedSkillFiles(full, depth + 1));
    }
  }
  return nested;
}

function validate(entry) {
  const text = fs.readFileSync(entry.file, "utf8");
  const fields = parseFrontmatter(text);

  if (!fields) {
    report("error", entry.file, "missing YAML frontmatter — the provider drops this skill");
    return;
  }

  // name
  const name = fields.get("name");
  if (!name) {
    report("error", entry.file, "frontmatter is missing required key `name`");
  } else {
    const normalized = unquote(name);
    if (!KEBAB_CASE.test(normalized)) {
      report("error", entry.file, `name "${normalized}" is not kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$)`);
    }
    if (normalized !== entry.name) {
      report(
        "error",
        entry.file,
        `name "${normalized}" must match its ${entry.kind === "bundle" ? "directory" : "file"} name "${entry.name}"`,
      );
    }
  }

  // description
  const description = fields.get("description");
  if (!description) {
    report("error", entry.file, "frontmatter is missing required key `description`");
  } else {
    const normalized = unquote(description);
    if (!normalized) {
      report("error", entry.file, "`description` is empty");
    } else if (normalized.length > DESCRIPTION_CAP) {
      report(
        "warning",
        entry.file,
        `description is ${normalized.length} chars; the catalog truncates at ${DESCRIPTION_CAP} — front-load the triggers`,
      );
    }
  }

  // boolean flags
  for (const key of BOOLEAN_KEYS) {
    if (!fields.has(key)) continue;
    if (!isBooleanWord(fields.get(key))) {
      report(
        "error",
        entry.file,
        `\`${key}: ${fields.get(key)}\` is not an accepted boolean — the provider drops the whole skill ` +
          "(use true/false, yes/no, on/off, or 1/0)",
      );
    }
  }

  // unknown keys
  for (const key of fields.keys()) {
    if (!KNOWN_KEYS.includes(key)) {
      report("warning", entry.file, `unknown frontmatter key \`${key}\` (ignored by the provider)`);
    }
  }
}

/**
 * Walk the repository for skill files that escaped the packaged location.
 *
 * The skills plugin's own root is skipped (it is validated above). A different
 * plugin package may legitimately vendor its own `skills/` assets (for example
 * `plugins/superagent/skills/`, which ships inside that plugin's tarball), so
 * those subtrees are skipped too. Everywhere else — a top-level `skills/`,
 * `docs/`, `src/`, and so on — a `SKILL.md` is a packaging error.
 */
function findStraySkillFiles() {
  const stray = [];
  const otherPluginSkillsDir = /^plugins[/\\]([^/\\]+)[/\\]skills$/;
  const walk = (current) => {
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (IGNORED_DIRS.has(dirent.name)) continue;
        const relative = path.relative(repoRoot, full).split(path.sep).join("/");
        if (relative === "plugins/skills/skills") continue;
        const otherSkillRoot = otherPluginSkillsDir.exec(relative);
        if (otherSkillRoot !== null && otherSkillRoot[1] !== "skills") continue;
        walk(full);
      } else if (dirent.isFile() && dirent.name === "SKILL.md") {
        stray.push(full);
      }
    }
  };
  walk(repoRoot);
  return stray;
}

function enforcePackagingLocation() {
  if (fs.existsSync(path.join(repoRoot, "skills"))) {
    report(
      "error",
      path.join(repoRoot, "skills"),
      "top-level skills/ must not exist — move it to plugins/skills/skills so it ships with the skills plugin",
    );
  }

  for (const stray of findStraySkillFiles()) {
    report(
      "error",
      stray,
      "SKILL.md outside plugins/skills/skills — every new or edited skill must live inside the packaged plugin " +
        "(move it to plugins/skills/skills/<name>/SKILL.md)",
    );
  }
}

/** Read the package manifest and verify it ships the skills directory. */
function enforceManifestFiles() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(packageManifestFile, "utf8"));
  } catch (error) {
    report("error", packageManifestFile, `cannot read the skills package manifest: ${error.message}`);
    return;
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const shipsSkills = files.some(
    (entry) => typeof entry === "string" && (entry === "skills" || entry === "skills/" || entry === "skills/**" || entry.startsWith("skills/")),
  );
  if (!shipsSkills) {
    report(
      "error",
      packageManifestFile,
      'package.json "files" must include the packaged skills directory (e.g. "skills")',
    );
  }
}

/** Normalize npm's `pack --json` shape: an array on npm 10/11, a map on npm 12. */
function packEntry(stdout) {
  const text = stdout.trim();
  const candidates = [text];
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) candidates.push(text.slice(arrayStart, arrayEnd + 1));
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
      if (entry !== null && typeof entry === "object") return entry;
    } catch {
      // Try the next shape; npm notices may precede the JSON document.
    }
  }
  return undefined;
}

/** List every regular file under a directory, POSIX-separated and relative. */
function listFiles(directory, root = directory) {
  const files = [];
  for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, dirent.name);
    if (dirent.isDirectory()) files.push(...listFiles(full, root));
    else if (dirent.isFile()) files.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return files.sort();
}

/**
 * Enforce that `npm pack` would actually publish every packaged skill file.
 * This is what makes "a new or edited skill is always part of the installable
 * plugin" true end to end: a file that is on disk but excluded from the
 * tarball is not installed, no matter what the provider scans.
 */
function enforcePackContents() {
  if (process.argv.includes("--no-pack")) return;
  if (!fs.existsSync(skillsDir)) return;

  const environment = {
    ...process.env,
    npm_config_cache: path.join(os.tmpdir(), "dsh-validate-skills-npm-cache"),
    npm_config_loglevel: "silent",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
    npm_config_progress: "false",
  };
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: packageDir,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) {
    if (result.error.code === "ENOENT") {
      report("warning", packageManifestFile, "npm is not available; skipped the npm pack contents check");
      return;
    }
    report("error", packageManifestFile, `cannot run ${command} pack: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    const diagnostics = [result.stderr, result.stdout]
      .map((text) => (text === null ? "" : String(text).trim()))
      .filter((text) => text !== "")
      .join("\n")
      .split("\n")
      .slice(-5)
      .join("\n");
    report(
      "error",
      packageManifestFile,
      `npm pack --dry-run exited with ${String(result.status)}${diagnostics === "" ? "" : `:\n${diagnostics}`}`,
    );
    return;
  }
  const entry = packEntry(result.stdout ?? "");
  if (entry === undefined || !Array.isArray(entry.files)) {
    report("error", packageManifestFile, "could not read the file list from npm pack --dry-run --json");
    return;
  }
  const shipped = new Set(entry.files.map((file) => file.path));
  const expected = listFiles(skillsDir).map((file) => `skills/${file}`);
  for (const file of expected) {
    if (!shipped.has(file)) {
      report(
        "error",
        path.join(packageDir, file),
        "npm pack would not ship this packaged skill file — adjust package.json \"files\" (and .npmignore if any)",
      );
    }
  }
}

function main() {
  if (!fs.existsSync(skillsDir)) {
    console.error(`✗ no packaged skills directory at ${path.relative(repoRoot, skillsDir)}`);
    process.exit(2);
  }

  const entries = collectEntries(skillsDir);
  const seen = new Map();

  for (const entry of entries) {
    if (seen.has(entry.name)) {
      report("error", entry.file, `duplicate skill name "${entry.name}" (also ${path.relative(repoRoot, seen.get(entry.name))})`);
    } else {
      seen.set(entry.name, entry.file);
    }
    validate(entry);
  }

  for (const nested of findNestedSkillFiles(skillsDir)) {
    report("warning", nested, "nested SKILL.md is not discovered — only top-level skills are scanned");
  }

  enforcePackagingLocation();
  enforceManifestFiles();
  enforcePackContents();

  const strict = process.argv.includes("--strict");
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ skills: entries.length, errors, warnings, results }, null, 2));
  } else {
    const level = errors > 0 || (strict && warnings > 0) ? "FAIL" : "PASS";
    console.log(`\n${level}: ${entries.length} skill(s), ${errors} error(s), ${warnings} warning(s)`);
  }

  process.exit(errors > 0 || (strict && warnings > 0) ? 1 : 0);
}

main();
