#!/usr/bin/env node
/**
 * validate-skills.mjs
 *
 * Validate every skill in this repository against the contract enforced by
 * `@deepseek-ai/dsh-skill-filesystem`. Misconfiguration there fails *silently
 * at discovery* (the skill is dropped with a log line nobody reads), so this
 * script makes the same checks loud and exit non-zero in CI.
 *
 * Checks (errors):
 *   - a candidate is a top-level `skills/<name>/SKILL.md` directory bundle or
 *     a top-level `skills/<name>.md` flat file
 *   - YAML frontmatter exists and is well formed
 *   - `name` is present, kebab-case, and matches its directory/file basename
 *   - `description` is present and non-empty
 *   - `disable-model-invocation` / `user-invocable` hold a boolean spelling the
 *     provider accepts (true/false, yes/no, on/off, 1/0, case-insensitive)
 *
 * Checks (warnings):
 *   - `description` longer than the catalog cap (truncated, not fatal)
 *   - unknown frontmatter keys
 *   - `**\/SKILL.md` nested below a skill root (deliberately not discovered)
 *   - duplicate skill names
 *
 * Usage:
 *   node scripts/validate-skills.mjs [--strict] [--json]
 *   --strict   treat warnings as errors
 *   --json     emit machine-readable results
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const skillsDir = path.join(repoRoot, "skills");

/** Catalog render cap from @deepseek-ai/dsh-tool-skill. */
const DESCRIPTION_CAP = 500;

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

function main() {
  if (!fs.existsSync(skillsDir)) {
    console.error(`✗ no skills directory at ${path.relative(repoRoot, skillsDir)}`);
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
