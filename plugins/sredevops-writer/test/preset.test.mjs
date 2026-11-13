import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SKILLS_DIR } from "../index.js";

// This bundle is configuration: one agent-preset row plus a small entry module
// that exists to resolve the packaged skills directory. The tests check the
// packaging contract, the preset structure, and the agreement between the
// patch's skill path and the directory that actually ships.

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const skillsDir = join(packageRoot, "skills");

const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const patchText = await readFile(join(packageRoot, "cordis.patch.yml"), "utf8");
const personaMatch = patchText.match(/^\s*prefix: \|\n((?:\s{16}.*\n|\s*\n)*)/m);
const persona = personaMatch === null ? "" : personaMatch[1];

async function readSkill(name) {
  return readFile(join(skillsDir, name, "SKILL.md"), "utf8");
}

test("the manifest follows the repository packaging contract", () => {
  assert.equal(manifest.name, "@sredevopsorg/dsh-sredevops-writer");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.private, undefined, "a publishable bundle must not be private");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.dsh.manifestVersion, 1);
  assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(manifest.engines.dsh, "^0.2.1-rc.2");
  assert.deepEqual(Object.keys(manifest.repository).sort(), ["directory", "type", "url"]);
  assert.equal(manifest.repository.directory, "plugins/sredevops-writer");
  for (const entry of ["index.js", "cordis.patch.yml", "README.md", "icon.svg", "locale/*.json", "skills"]) {
    assert.ok(manifest.files.includes(entry), `files must ship ${entry}`);
  }
  assert.equal(manifest.icon, "./icon.svg");
  assert.equal(manifest.exports["."], "./index.js");
});

test("the patch declares exactly one agent preset", () => {
  assert.equal(patchText.match(/name: '@deepseek-ai\/dsh-agent-preset'/g)?.length, 1);
  assert.match(patchText, /^\s*id: sredevops-writer$/m, "the preset id stays stable for existing sessions");
  assert.match(patchText, /^\s*name: SRE DevOps Writer$/m);
  assert.match(patchText, /^\s*order: 20$/m);
});

test("the skill directory is resolved without baseUrl, and names this package", () => {
  // The preset finds its skills through createRequire(...).resolve(), so the
  // specifier must match package.json or the skills never load. `baseUrl` is
  // rejected on purpose: scripts/validate-bundles.mjs evaluates `!!js` with only
  // `ctx` and `process` in scope, and fails CI when an expression needs baseUrl.
  const expressions = [...patchText.matchAll(/!!js (.+)$/gm)].map((match) => match[1]);
  assert.ok(expressions.length > 0, "the patch has !!js expressions");
  for (const expression of expressions) {
    assert.doesNotMatch(expression, /\bbaseUrl\b/, "CI cannot evaluate baseUrl in a !!js expression");
  }
  const escaped = manifest.name.replace(/[/@]/g, (character) => `\\${character}`);
  assert.match(patchText, new RegExp(`'${escaped}/package\\.json'`));
  assert.match(patchText, /customSkillDirs:/);
  // The exported path and the directory the patch points at must be the same.
  assert.equal(resolve(SKILLS_DIR), resolve(skillsDir));
  assert.ok(manifest.exports["."] !== undefined);
});

test("the persona keeps the voice contract and the mandatory write rule", () => {
  assert.ok(persona.length > 3000, "the persona prefix is present");
  const words = persona.split(/\s+/).filter(Boolean).length;
  assert.ok(words < 900, `the persona should stay under 900 words, found ${words}`);
  for (const phrase of ["sredevops.org", "Kubernetes", "Chilean Spanish"]) {
    assert.ok(persona.includes(phrase), `the persona should mention ${phrase}`);
  }
  // A soft "write a copy" instruction let the model narrate a write it never
  // made. The rule must stay imperative and must forbid claiming success.
  assert.match(persona, /call `write` with the full Markdown/);
  assert.match(persona, /never say a file was written unless `write` returned success/);
});

test("the preset mounts the three editorial skills and the tools they need", () => {
  for (const id of ["skill-filesystem", "tool-skill", "tool-web", "tool-fs", "tool-fs-search", "present"]) {
    assert.match(patchText, new RegExp(`id: ${id}$`, "m"), `the preset must mount ${id}`);
  }
  // Editorial work needs no shell, for exactly the reason the README states.
  assert.doesNotMatch(patchText, /id: (tool-bash|tool-pwsh|bash-sandbox)\b/);
});

test("every skill named by the persona exists with frontmatter", async () => {
  const directories = (await readdir(skillsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(directories, ["sredevops-article", "sredevops-editorial-memory", "sredevops-translate"]);
  for (const directory of directories) {
    const body = await readSkill(directory);
    assert.match(body, /^---\n/, `${directory}/SKILL.md must open with frontmatter`);
    const frontmatter = body.slice(4, body.indexOf("\n---", 4));
    assert.match(frontmatter, /^name:\s*\S+$/m, `${directory} needs a name`);
    assert.match(frontmatter, /^description:\s*\S+/m, `${directory} needs a description`);
    assert.ok(body.includes(directory), `the persona loads ${directory} by name`);
  }
});

test("no reference file exceeds the tool-result pruner threshold", async () => {
  // The pruner trims any result over 8192 characters, and a `read` result adds
  // line numbers, so a file at the limit would arrive truncated.
  const files = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.name.endsWith(".md")) files.push(target);
    }
  };
  await walk(skillsDir);
  await walk(join(packageRoot, "references"));
  assert.ok(files.length >= 8, "the references are packaged");
  for (const file of files) {
    const { size } = await stat(file);
    assert.ok(size < 8192, `${file.slice(packageRoot.length)} is ${size} bytes, over the pruner threshold`);
  }
});

test("relative reference links inside the skills resolve", async () => {
  const { access } = await import("node:fs/promises");
  const files = [
    join(skillsDir, "sredevops-article", "SKILL.md"),
    join(skillsDir, "sredevops-translate", "SKILL.md"),
    join(skillsDir, "sredevops-editorial-memory", "SKILL.md"),
  ];
  for (const file of files) {
    const body = await readFile(file, "utf8");
    for (const match of body.matchAll(/\]\((\.\.?\/[^)#]+)\)/g)) {
      const target = resolve(dirname(file), match[1]);
      await assert.doesNotReject(access(target), `${file} links to a missing file: ${match[1]}`);
    }
  }
});

test("the editorial memory ships with its documented seed rule", async () => {
  const memory = await readFile(join(packageRoot, "references", "editorial-memory.md"), "utf8");
  assert.match(memory, /multi-tenant/);
  assert.match(memory, /multiinquilino/);
  assert.ok(memory.length < 8192, "the memory stays readable in one tool result");
});

