import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROVIDER_NAME,
  SKILLS_DIR,
  SKILLS_RANK,
  apply,
  createProvider,
  inject,
  parseSkillFile,
} from "../index.js";

// The bundle is one host-level skill-provider row plus one agent-preset row.
// The tests check the packaging contract, the preset structure, the provider's
// discovery and parsing, and that no install layout or working directory can
// redirect where the skills are found.

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

test("the skill directory comes from the module URL, not the patch", () => {
  // A path lookup inside the patch depended on process.cwd() and on where Node
  // resolved the package: from any session outside this checkout the fallback
  // pointed at a directory that does not exist, and the three skills silently
  // disappeared from the catalog. The provider now derives its root from
  // import.meta.url, which no install layout or working directory can move.
  assert.doesNotMatch(patchText, /!!js/, "the patch declares no evaluated expressions");
  assert.doesNotMatch(patchText, /^\s*customSkillDirs:/m, "skill paths no longer live in the patch");
  assert.doesNotMatch(patchText, /createRequire|process\.cwd/, "the patch must not resolve paths");
  assert.match(patchText, /name: '@sredevopsorg\/dsh-sredevops-writer'/, "the patch mounts the provider module");
  assert.equal(resolve(SKILLS_DIR), resolve(skillsDir), "the exported path is the packaged skills directory");
  assert.ok(manifest.files.includes("skills"), "the skills directory ships");
});

test("the patch mounts the preset and a host-level skill provider row", () => {
  // Rows inside `config.plugins` mount in the preset's scope; the provider row
  // must sit beside the preset so it registers the three skills in the global
  // skill layer and every agent sees them.
  assert.match(patchText, /^ {4}- id: sredevops-writer-skills\n {6}name: '@sredevopsorg\/dsh-sredevops-writer'$/m);
  const presetTail = patchText.slice(patchText.indexOf("id: preset-sredevops-writer"));
  assert.doesNotMatch(presetTail, /name: '@sredevopsorg\/dsh-sredevops-writer'/, "the provider row is not a preset child");
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

test("the provider lists the three packaged skills regardless of the working directory", async () => {
  const original = process.cwd();
  const elsewhere = await mkdtemp(join(tmpdir(), "sredevops-writer-cwd-"));
  try {
    process.chdir(elsewhere);
    const provider = createProvider();
    const candidates = await provider.list({});
    assert.deepEqual(candidates.map((candidate) => candidate.name), [
      "sredevops-article",
      "sredevops-editorial-memory",
      "sredevops-translate",
    ]);
    for (const candidate of candidates) {
      assert.equal(candidate.provider, PROVIDER_NAME);
      assert.equal(candidate.source, "bundled");
      assert.equal(candidate.rank, SKILLS_RANK);
      assert.ok(candidate.description.length > 20, `${candidate.name} has a usable description`);
      const definition = await provider.get(candidate, {});
      assert.equal(definition.name, candidate.name);
      assert.ok(definition.content.length > 500, `${candidate.name} loads its body`);
      assert.ok(definition.resourceBase.path.startsWith(resolve(skillsDir)));
    }
  } finally {
    process.chdir(original);
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("a missing or empty skills root is an empty, complete observation", async () => {
  const provider = createProvider({ skillsDir: join(tmpdir(), "sredevops-writer-absent-root") });
  assert.deepEqual(await provider.list({}), []);
});

test("frontmatter parsing follows the filesystem provider contract", () => {
  const valid = parseSkillFile(
    ["---", "name: example-skill", "description: A test skill.", "whenToUse: When testing.", "---", "", "Body."].join("\n"),
  );
  assert.deepEqual(valid, {
    name: "example-skill",
    description: "A test skill.",
    whenToUse: "When testing.",
    invocation: { modelInvocable: true, userInvocable: true },
    content: "Body.",
  });
  assert.equal(parseSkillFile("no frontmatter here"), undefined);
  assert.equal(parseSkillFile("---\nname: Only A Name\n---\n"), undefined, "a description is required");
  assert.equal(parseSkillFile("---\nname: Not_Kebab\ndescription: x\n---\n"), undefined, "the name is kebab-case");
  assert.equal(
    parseSkillFile("---\nname: ok-name\ndescription: x\ndisableModelInvocation: true\n---\n"),
    undefined,
    "removed legacy invocation keys are rejected",
  );
});

test("apply registers the provider on the skills service", async () => {
  const registered = [];
  const ctx = {
    skills: { registerProvider: (create) => registered.push(create) },
    logger: { warn() {} },
  };
  assert.deepEqual(inject, ["skills"]);
  apply(ctx);
  assert.equal(registered.length, 1);
  const provider = registered[0]();
  assert.equal(provider.name, PROVIDER_NAME);
  assert.equal((await provider.list({})).length, 3);
});

test("the editorial memory ships with its documented seed rule", async () => {
  const memory = await readFile(join(packageRoot, "references", "editorial-memory.md"), "utf8");
  assert.match(memory, /multi-tenant/);
  assert.match(memory, /multiinquilino/);
  assert.ok(memory.length < 8192, "the memory stays readable in one tool result");
});

