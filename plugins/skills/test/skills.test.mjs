import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROVIDER_NAME,
  apply,
  createProvider,
  inject,
  name,
  parseInvocationPolicy,
  parseSkillDocument,
  parseSkillFile,
} from "../index.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const skillsDir = join(packageRoot, "skills");

const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

async function skillDirectories() {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

test("the plugin is a bundled skill provider with the repo packaging contract", () => {
  assert.equal(name, "skills");
  assert.deepEqual(inject, ["skills"]);
  assert.equal(PROVIDER_NAME, "dsh-skills");
  assert.equal(typeof apply, "function");
  assert.equal(manifest.name, "@sredevopsorg/dsh-skills");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.dsh.manifestVersion, 1);
  assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(manifest.engines.dsh, "^0.2.1-rc.2");
  for (const entry of ["index.js", "README.md", "cordis.patch.yml", "icon.svg", "locale/*.json", "skills"]) {
    assert.ok(manifest.files.includes(entry), `files must ship ${entry}`);
  }
});

test("every packaged skill parses with the filesystem-provider frontmatter contract", async () => {
  const directories = await skillDirectories();
  assert.ok(directories.length >= 10, "this package ships the repository's skills");
  assert.ok(directories.includes("kustomize"), "this package ships the kustomize skill");
  for (const directory of directories) {
    const raw = await readFile(join(skillsDir, directory, "SKILL.md"), "utf8");
    const parsed = parseSkillFile(raw);
    assert.ok(parsed, `${directory}/SKILL.md must parse`);
    assert.equal(parsed.name, directory, "frontmatter name must match the directory name");
    assert.match(parsed.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(parsed.description.length > 0, "description is required");
    assert.equal(typeof parsed.invocation.modelInvocable, "boolean");
    assert.equal(typeof parsed.invocation.userInvocable, "boolean");
    assert.ok(parsed.content.length > 0, "skill body must not be empty");
    assert.ok(!parsed.content.startsWith("---"), "frontmatter is removed from the body");
  }
});

test("the provider lists all packaged skills with parsed metadata and resource bases", async () => {
  const provider = createProvider();
  const candidates = await provider.list({});

  assert.equal(provider.name, "dsh-skills");
  assert.equal(candidates.length, (await skillDirectories()).length);
  assert.deepEqual(
    candidates.map((candidate) => candidate.name),
    (await skillDirectories()).sort(),
  );

  for (const candidate of candidates) {
    assert.equal(candidate.provider, "dsh-skills");
    assert.equal(candidate.source, "bundled");
    assert.equal(candidate.rank, 600);
    assert.equal(typeof candidate.description, "string");
    assert.equal(candidate.resourceBase.kind, "directory");
    assert.equal(candidate.resourceBase.path, join(skillsDir, candidate.name));
    assert.equal(candidate.path, join(skillsDir, candidate.name, "SKILL.md"));
    if (candidate.whenToUse !== undefined) assert.equal(typeof candidate.whenToUse, "string");
    if (candidate.metadata !== undefined) assert.equal(typeof candidate.metadata, "object");

    const definition = await provider.get(candidate, {});
    assert.ok(definition, "get() must load the body");
    assert.equal(definition.name, candidate.name);
    assert.equal(definition.description, candidate.description);
    assert.equal(definition.content, parseSkillFile(await readFile(candidate.path, "utf8")).content);
    assert.ok(definition.content.includes(`# `), "body keeps its Markdown title");
  }
});

test("resources referenced by a skill live inside its packaged resource base", async () => {
  const expectations = {
    "ghost-theme-development": ["references/theme-structure-and-routing.md"],
    "ghost-theme-modern-frontend": ["references/vite-tailwind-pipeline.md", "scripts/scaffold-theme.mjs", "scripts/verify-theme.sh"],
    "helm-chart-development": ["references/template-language.md", "scripts/verify-chart.mjs"],
    "kubernetes-kubectl-operations": ["references/inspect-and-debug.md", "scripts/verify-kube-access.sh"],
    "kustomize": ["references/patches-and-transforms.md", "scripts/verify-kustomize.mjs"],
    "supabase": ["references/skill-feedback.md", "assets/feedback-issue-template.md"],
    "supabase-postgres-best-practices": ["references/security-rls-basics.md"],
  };
  for (const [skillName, resources] of Object.entries(expectations)) {
    const root = join(skillsDir, skillName);
    for (const resource of resources) {
      const body = await readFile(join(root, resource), "utf8");
      assert.ok(body.length > 0, `${skillName}/${resource} must be packaged and non-empty`);
    }
  }
});

test("the provider also discovers flat <name>.md skills", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-skills-flat-"));
  try {
    await writeFile(
      join(directory, "flat-skill.md"),
      "---\nname: flat-skill\ndescription: Flat file skill for the provider test.\nuser-invocable: false\n---\n\n# Flat\n",
      "utf8",
    );
    const logger = { warnings: [], warn(message) { this.warnings.push(message); } };
    const provider = createProvider({ skillsDir: directory, logger });
    const candidates = await provider.list({});
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].name, "flat-skill");
    assert.deepEqual(candidates[0].invocation, { modelInvocable: true, userInvocable: false });
    const definition = await provider.get(candidates[0], {});
    assert.equal(definition.content, "# Flat");
    assert.equal(logger.warnings.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid skills are skipped, not fatal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-skills-invalid-"));
  try {
    await mkdir(join(directory, "no-frontmatter"));
    await writeFile(join(directory, "no-frontmatter", "SKILL.md"), "# No frontmatter\n", "utf8");
    await mkdir(join(directory, "missing-description"));
    await writeFile(join(directory, "missing-description", "SKILL.md"), "---\nname: missing-description\n---\nbody\n", "utf8");
    await mkdir(join(directory, "bad-boolean"));
    await writeFile(
      join(directory, "bad-boolean", "SKILL.md"),
      "---\nname: bad-boolean\ndescription: bad\nuser-invocable: maybe\n---\nbody\n",
      "utf8",
    );
    const logger = { warnings: [], warn(message) { this.warnings.push(message); } };
    const provider = createProvider({ skillsDir: directory, logger });
    assert.deepEqual(await provider.list({}), []);
    assert.equal(logger.warnings.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("frontmatter parser handles folded scalars, quoted scalars, metadata, and boolean spellings", () => {
  const parsed = parseSkillDocument(
    [
      "---",
      "name: parsing-fixture",
      'description: "Uses: colons, commas, and a — dash."',
      "whenToUse: >-",
      "  Use when parsing",
      "  folded scalars.",
      "metadata:",
      "  author: sredevopsorg",
      "  version: '1.0.0'",
      "user-invocable: no",
      "---",
      "",
      "# Fixture",
      "",
    ].join("\n"),
  );
  assert.ok(parsed);
  assert.equal(parsed.data.description, "Uses: colons, commas, and a — dash.");
  assert.equal(parsed.data.whenToUse, "Use when parsing folded scalars.");
  assert.deepEqual(parsed.data.metadata, { author: "sredevopsorg", version: "1.0.0" });
  assert.equal(parsed.body.trim(), "# Fixture");

  const skill = parseSkillFile([
    "---",
    "name: parsing-fixture",
    'description: "Quoted: description."',
    "whenToUse: Use when testing.",
    "metadata:",
    "  author: sredevopsorg",
    "disable-model-invocation: on",
    "user-invocable: 0",
    "---",
    "body",
  ].join("\n"));
  assert.ok(skill);
  assert.deepEqual(skill.invocation, { modelInvocable: false, userInvocable: false });
  assert.equal(skill.content, "body");
  assert.deepEqual(parseSkillDocument("# no frontmatter"), undefined);
});

test("legacy invocation keys are rejected like the filesystem provider", () => {
  for (const key of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    assert.throws(() => parseInvocationPolicy({ [key]: true }), /unsupported/);
  }
  for (const spelling of ["true", "yes", "on", "1", true, 1]) {
    assert.deepEqual(parseInvocationPolicy({ "disable-model-invocation": spelling }).modelInvocable, false);
  }
  for (const spelling of ["false", "no", "off", "0", false, 0]) {
    assert.deepEqual(parseInvocationPolicy({ "user-invocable": spelling }).userInvocable, false);
  }
});
