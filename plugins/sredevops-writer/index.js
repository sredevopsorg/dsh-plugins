/**
 * `@sredevopsorg/dsh-sredevops-writer` — an editorial agent preset for
 * sredevops.org, packaged with the three skills it relies on.
 *
 * `cordis.patch.yml` declares two rows: one `@deepseek-ai/dsh-agent-preset` row
 * (the persona and the tools an editorial session needs) and one host row that
 * mounts this module. The host row's `apply()` registers a skill provider on
 * `ctx.skills`; the provider discovers the packaged `skills/` directory
 * (directory bundles `skills/<name>/SKILL.md`) and serves their bodies on
 * demand.
 *
 * The skills are located from `import.meta.url`, never from the patch. An
 * earlier revision computed the path inside a `!!js` expression with
 * `createRequire(process.cwd())`, which cannot see a profile install from
 * outside the dsh installation directory: it silently fell back to
 * `<session cwd>/plugins/sredevops-writer/skills`, so the three skills vanished
 * from the catalog whenever a session started outside this checkout. A module
 * URL needs no evaluator, no `baseUrl`, and no install-layout guesswork.
 *
 * `apply()` runs from a host row, so the provider registers in the global skill
 * layer and every agent sees it, not only sessions using this preset. The
 * `skill-filesystem` row inside the preset keeps discovering workspace and user
 * skills beside these three.
 *
 * @module @sredevopsorg/dsh-sredevops-writer
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Cordis plugin name (the row id in `cordis.patch.yml`). */
export const name = "sredevops-writer";

/** Service required by the provider. */
export const inject = ["skills"];

/** Provider name in the `ctx.skills` registry. */
export const PROVIDER_NAME = "sredevops-writer";

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

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRUE_WORDS = new Set(["true", "yes", "on", "1"]);
const FALSE_WORDS = new Set(["false", "no", "off", "0"]);

// ── Frontmatter ─────────────────────────────────────────────────────────────
// The same deliberately small YAML subset `plugins/skills` parses: `key:
// scalar`, inline scalars, and `key: |` / `key: >` block scalars. The validator
// keeps new and edited skills inside that subset.

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "") return "";
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) {
      throw new Error(`unterminated double-quoted scalar: ${value}`);
    }
    return value.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
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
  const lines = match[1].split(/\r?\n/);
  const data = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const field = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(line);
    if (field === null) {
      throw new Error(`invalid YAML frontmatter line: ${JSON.stringify(line.trim())}`);
    }
    const [, key, inline] = field;
    if (isBlockIndicator(inline)) {
      const block = readBlockScalar(lines, index + 1, inline);
      data[key] = block.value;
      index = block.nextIndex - 1;
      continue;
    }
    data[key] = parseScalar(inline);
  }
  return { data, body: raw.slice(match[0].length) };
}

function stringField(data, key) {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalString(data, key) {
  const value = stringField(data, key);
  return value === undefined ? {} : { [key]: value };
}

function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined;
  const value = data[key];
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
 * @throws {TypeError} when an invocation field is not an accepted boolean spelling, or a
 *   removed legacy key is present.
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
 * Parse and validate one skill file.
 *
 * @param {string} raw — complete file contents.
 * @returns {{ name: string, description: string, whenToUse?: string,
 *   invocation: { modelInvocable: boolean, userInvocable: boolean },
 *   metadata?: Record<string, unknown>, content: string } | undefined} the parsed
 *   skill, or `undefined` for a file the provider must drop.
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

  return {
    name: skillName,
    description,
    ...optionalString(parsed.data, "whenToUse"),
    invocation,
    content: parsed.body.trim(),
  };
}

// ── Discovery and provider ──────────────────────────────────────────────────

/**
 * List packaged skill directory bundles under a skills root.
 *
 * A missing root yields no locators rather than an error: the provider reports
 * an empty, complete observation, which is the honest answer for a package
 * whose `skills/` was not shipped.
 *
 * @param {string} skillsDir — absolute skills root.
 * @returns {Promise<Array<{ name: string, file: string, directory: string }>>} locators
 *   sorted by entry name.
 */
export async function discoverSkillLocators(skillsDir) {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
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

async function readCandidate(file, locator, providerName, warn) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    warn(`skill file ${file} ignored: ${String(error)}`);
    return undefined;
  }
  const parsed = parseSkillFile(raw);
  if (parsed === undefined) {
    warn(`skill file ${file} ignored: missing or invalid frontmatter (name and description are required)`);
    return undefined;
  }
  return {
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
    invocation: parsed.invocation,
    provider: providerName,
    source: "bundled",
    rank: SKILLS_RANK,
    locator,
    resourceBase: { kind: "directory", path: locator.directory },
    path: file,
    ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
  };
}

/**
 * Create the packaged skill provider.
 *
 * @param {object} [options] — provider options.
 * @param {string} [options.skillsDir] — skills root; defaults to this package's `./skills/`.
 * @param {string} [options.providerName] — registry name; defaults to `sredevops-writer`.
 * @param {{ warn?: (message: string) => void }} [options.logger] — host logger for dropped files.
 * @returns {{ name: string, list: Function, get: Function }} the skill provider.
 */
export function createProvider(options = {}) {
  const skillsDir = options.skillsDir ?? SKILLS_DIR;
  const providerName = options.providerName ?? PROVIDER_NAME;
  const warn = (message) => options.logger?.warn?.(message);

  return {
    name: providerName,

    async list(lookup = {}) {
      lookup.signal?.throwIfAborted();
      const candidates = [];
      for (const locator of await discoverSkillLocators(skillsDir)) {
        lookup.signal?.throwIfAborted();
        const candidate = await readCandidate(locator.file, locator, providerName, warn);
        if (candidate !== undefined) candidates.push(candidate);
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
 * The row mounts at host level, so the registration lands in the global skill
 * layer and every agent's merged catalog includes the three editorial skills.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx — plugin context with the skills service.
 */
export function apply(ctx) {
  ctx.skills.registerProvider(() => createProvider({ logger: ctx.logger }));
}
