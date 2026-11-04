/**
 * `@sredevopsorg/dsh-skills` — one DSH plugin that packages every skill in this
 * repository and registers them with the host skill catalog.
 *
 * The bundle patch inserts one host-wide row (`skills`). Its `apply()` registers a
 * skill provider on `ctx.skills`; the provider discovers the packaged
 * `skills/` directory (directory bundles `skills/<name>/SKILL.md` and flat
 * `skills/<name>.md` files), parses their frontmatter, and serves their bodies on
 * demand. The skills stay plain Markdown: no build step, no runtime dependency,
 * and the body keeps its original resource base so `references/`, `scripts/`,
 * and `assets/` paths inside `SKILL.md` resolve as written.
 *
 * Frontmatter contract (identical to `@deepseek-ai/dsh-skill-filesystem`):
 *   - `name` — required, kebab-case, matches the directory / flat-file name;
 *   - `description` — required, non-empty;
 *   - `whenToUse` — optional string;
 *   - `disable-model-invocation` / `user-invocable` — optional booleans;
 *   - `metadata` — optional free-form mapping (exposed as skill metadata).
 * A file that fails this contract is skipped with a warning, exactly like the
 * filesystem provider.
 *
 * @module @sredevopsorg/dsh-skills
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Cordis plugin name (the row id in `cordis.patch.yml`). */
export const name = "skills";

/** Service required by the provider. */
export const inject = ["skills"];

/**
 * Standard precedence rank for packaged skill providers and local bundled roots.
 *
 * This is the literal value of `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill`.
 * It is duplicated here on purpose: this plugin is installed from Git into a
 * profile with `dsh plugin add`, so it must not import `@deepseek-ai/*` packages
 * (they are not guaranteed to resolve from a workspace-linked plugin). The repo
 * convention is a dependency-free package — see README "Why no peerDependencies".
 */
const BUNDLED_SKILL_RANK = 600;

/** Provider name used in the `ctx.skills` registry. */
export const PROVIDER_NAME = "dsh-skills";

/** Default packaged skills root: `./skills/` next to this module. */
const DEFAULT_SKILLS_DIR = fileURLToPath(new URL("./skills/", import.meta.url));

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRUE_WORDS = new Set(["true", "yes", "on", "1"]);
const FALSE_WORDS = new Set(["false", "no", "off", "0"]);

// ── Frontmatter parsing ─────────────────────────────────────────────────────
// A deliberately small YAML subset: `key: scalar`, folded/literal block
// scalars, and one or more levels of indented mappings (for `metadata`).
// This repository's skills use only those shapes; the validator guarantees a
// new or edited skill stays inside them before CI runs the provider test.

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "") return "";
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) {
      throw new Error(`unterminated double-quoted scalar: ${value}`);
    }
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
    }
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) {
      throw new Error(`unterminated single-quoted scalar: ${value}`);
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function isBlockIndicator(inline) {
  return /^[>|][+-]?$/.test(inline);
}

function readBlockScalar(lines, startIndex, indicator) {
  const collected = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      collected.push("");
      index += 1;
      continue;
    }
    if (!/^\s/.test(line)) break;
    collected.push(line.trim());
    index += 1;
  }
  const value =
    indicator.startsWith("|")
      ? collected.join("\n").trim()
      : collected
          .join(" ")
          .split(/\s+/)
          .filter((part) => part !== "")
          .join(" ");
  return { value, nextIndex: index };
}

function readIndentedLines(lines, startIndex) {
  const block = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      block.push("");
      index += 1;
      continue;
    }
    if (!/^\s/.test(line)) break;
    block.push(line);
    index += 1;
  }
  return { block, nextIndex: index };
}

function minimumIndent(lines) {
  let indent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim() === "") continue;
    indent = Math.min(indent, /^\s*/.exec(line)[0].length);
  }
  return Number.isFinite(indent) ? indent : 0;
}

/** Parse a block of `key: value` lines into a plain object. */
function parseMapping(lines) {
  const indent = minimumIndent(lines);
  const data = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "" || /^\s*#/.test(line)) {
      index += 1;
      continue;
    }
    if (/^\s*/.exec(line)[0].length !== indent) {
      index += 1;
      continue;
    }
    const match = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(line.slice(indent));
    if (match === null) {
      throw new Error(`invalid YAML frontmatter line: ${JSON.stringify(line.trim())}`);
    }
    const [, key, inline] = match;
    index += 1;
    if (isBlockIndicator(inline)) {
      const block = readBlockScalar(lines, index, inline);
      data[key] = block.value;
      index = block.nextIndex;
      continue;
    }
    if (inline !== "") {
      data[key] = parseScalar(inline);
      continue;
    }
    const nested = readIndentedLines(lines, index);
    if (nested.block.some((candidate) => candidate.trim() !== "")) {
      data[key] = parseMapping(nested.block);
      index = nested.nextIndex;
    } else {
      data[key] = "";
    }
  }
  return data;
}

/**
 * Split a Markdown skill file into its frontmatter mapping and body.
 *
 * @param {string} raw — complete file contents.
 * @returns {{ data: Record<string, unknown>, body: string } | undefined} `undefined` when
 *   the file has no leading `---` fenced block.
 */
export function parseSkillDocument(raw) {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (match === null) return undefined;
  return { data: parseMapping(match[1].split(/\r?\n/)), body: raw.slice(match[0].length) };
}

function stringField(data, key) {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalString(data, key) {
  const value = stringField(data, key);
  return value === undefined ? {} : { [key]: value };
}

function objectField(data, key) {
  const value = data[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined;
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (TRUE_WORDS.has(normalized)) return true;
    if (FALSE_WORDS.has(normalized)) return false;
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`);
}

/**
 * Resolve the invocation policy exactly like the filesystem provider.
 *
 * @param {Record<string, unknown>} data — parsed frontmatter.
 * @returns {{ modelInvocable: boolean, userInvocable: boolean }} resolved policy.
 * @throws {TypeError} when an invocation field is not an accepted boolean spelling.
 */
export function parseInvocationPolicy(data) {
  for (const [legacy, canonical] of [
    ["disableModelInvocation", "disable-model-invocation"],
    ["modelInvocable", "disable-model-invocation"],
    ["userInvocable", "user-invocable"],
  ]) {
    if (Object.hasOwn(data, legacy)) {
      throw new TypeError(`frontmatter field "${legacy}" is unsupported; use "${canonical}"`);
    }
  }
  return {
    modelInvocable: frontmatterBoolean(data, "disable-model-invocation") !== true,
    userInvocable: frontmatterBoolean(data, "user-invocable") !== false,
  };
}

/**
 * Parse and validate one skill file. Returns `undefined` when the file is not a
 * discoverable skill (missing/invalid frontmatter, name, or description).
 *
 * @param {string} raw — complete file contents.
 * @returns {{ name: string, description: string, whenToUse?: string,
 *   invocation: { modelInvocable: boolean, userInvocable: boolean },
 *   metadata?: Record<string, unknown>, content: string } | undefined} parsed skill, or
 *   `undefined` for a file the provider would drop.
 */
export function parseSkillFile(raw) {
  let parsed;
  try {
    parsed = parseSkillDocument(raw);
  } catch {
    return undefined;
  }
  if (parsed === undefined) return undefined;

  const skillName = stringField(parsed.data, "name");
  const description = stringField(parsed.data, "description");
  if (skillName === undefined || description === undefined) return undefined;
  if (!KEBAB_CASE.test(skillName)) return undefined;

  let invocation;
  try {
    invocation = parseInvocationPolicy(parsed.data);
  } catch {
    return undefined;
  }

  const metadata = objectField(parsed.data, "metadata");
  return {
    name: skillName,
    description,
    ...optionalString(parsed.data, "whenToUse"),
    invocation,
    ...(metadata === undefined ? {} : { metadata }),
    content: parsed.body.trim(),
  };
}

// ── Discovery ───────────────────────────────────────────────────────────────

/**
 * List packaged skill locators under a skills root.
 *
 * @param {string} skillsDir — absolute skills root.
 * @returns {Promise<Array<{ name: string, file: string, directory: string }>>} directory
 *   bundles and flat `.md` files, sorted by entry name.
 */
async function discoverSkillLocators(skillsDir) {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const locators = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    if (entry.isDirectory()) {
      locators.push({
        name: entry.name,
        file: join(skillsDir, entry.name, "SKILL.md"),
        directory: join(skillsDir, entry.name),
      });
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      locators.push({
        name: entry.name.replace(/\.md$/, ""),
        file: join(skillsDir, entry.name),
        directory: skillsDir,
      });
    }
  }
  return locators;
}

/**
 * Create the packaged skill provider.
 *
 * @param {object} [options] — provider options.
 * @param {string} [options.skillsDir] — skills root; defaults to the packaged `./skills/`.
 * @param {string} [options.providerName] — registry name; defaults to `dsh-skills`.
 * @param {{ warn?: (message: string) => void }} [options.logger] — host logger for dropped files.
 * @returns {{ name: string, list: Function, get: Function }} skill provider.
 */
export function createProvider(options = {}) {
  const skillsDir = options.skillsDir ?? DEFAULT_SKILLS_DIR;
  const providerName = options.providerName ?? PROVIDER_NAME;
  const warn = (message) => options.logger?.warn?.(message);

  return {
    name: providerName,

    async list(lookup = {}) {
      lookup.signal?.throwIfAborted();
      let locators;
      try {
        locators = await discoverSkillLocators(skillsDir);
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
      }

      const candidates = [];
      for (const locator of locators) {
        lookup.signal?.throwIfAborted();
        let raw;
        try {
          raw = await readFile(locator.file, "utf8");
        } catch (error) {
          if (error?.code === "ENOENT") continue;
          warn(`skill file ${locator.file} ignored: ${String(error)}`);
          continue;
        }
        const parsed = parseSkillFile(raw);
        if (parsed === undefined) {
          warn(`skill file ${locator.file} ignored: missing or invalid frontmatter (name and description are required)`);
          continue;
        }
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
          invocation: parsed.invocation,
          provider: providerName,
          source: "bundled",
          rank: BUNDLED_SKILL_RANK,
          locator: { file: locator.file, directory: locator.directory },
          resourceBase: { kind: "directory", path: locator.directory },
          path: locator.file,
          ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
        });
      }
      return candidates;
    },

    async get(candidate, lookup = {}) {
      lookup.signal?.throwIfAborted();
      const locator = candidate?.locator;
      if (locator === undefined || typeof locator.file !== "string") return undefined;
      let raw;
      try {
        raw = await readFile(locator.file, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      }
      lookup.signal?.throwIfAborted();
      const parsed = parseSkillFile(raw);
      if (parsed === undefined) return undefined;
      return {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
        invocation: parsed.invocation,
        provider: candidate.provider,
        source: candidate.source,
        resourceBase: candidate.resourceBase,
        path: candidate.path,
        ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
        content: parsed.content,
      };
    },
  };
}

/**
 * Register the packaged skill provider on `ctx.skills`.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx — plugin context with the skills service.
 */
export function apply(ctx) {
  ctx.skills.registerProvider(() => createProvider({ logger: ctx.logger }));
}
