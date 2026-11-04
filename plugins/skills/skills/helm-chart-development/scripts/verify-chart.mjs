#!/usr/bin/env node
/**
 * verify-chart.mjs
 *
 * Verify a Helm chart without a cluster.
 *
 * Runs `helm lint --strict` and `helm template`, then adds the static and
 * rendered-output checks that Helm itself does not perform:
 *
 *   - named templates without a chart-name prefix (global namespace collisions)
 *   - `{{ template }}` where `include` is needed
 *   - unquoted `.Values` interpolation (YAML injection / broken manifests)
 *   - `.Values.x` reads that no values.yaml entry declares (silent typos)
 *   - values.yaml entries that no template reads (dead configuration)
 *   - hardcoded `namespace:` in template metadata
 *   - deprecated apiVersions, floating image tags
 *   - CRDs placed outside crds/
 *   - rendered output containing <no value>, duplicate resources,
 *     over-long or non-DNS-1123 names
 *
 * Usage:
 *   node verify-chart.mjs <chart-dir> [options] [-- helm template flags]
 *
 * Options:
 *   -f, --values <file>     values file, repeatable (passed to helm)
 *   --set <k=v>             set a value, repeatable
 *   --set-string <k=v>      set a string value, repeatable
 *   --kube-version <v>      Kubernetes version for Capabilities
 *   --api-versions <v>      extra API version, repeatable
 *   --include-subcharts     also analyse vendored subcharts under charts/
 *                           (off by default: a parent's values.yaml says
 *                           nothing about a subchart's own values)
 *   --no-strict             do not pass --strict to `helm lint`
 *   --strict                also exit non-zero when only warnings were found
 *   --quiet                 only print problems and the summary
 *
 * Exit codes: 0 ok · 1 problems found · 2 usage/environment error
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const chartDir = args.find((a) => !a.startsWith("-")) ?? ".";
const passthrough = [];
const helmArgs = [];
let strictLint = true;
let strictExit = false;
let quiet = false;
let includeSubcharts = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  const next = () => {
    const value = args[i + 1];
    if (value === undefined) usage(`${arg} requires a value`);
    i += 1;
    return value;
  };
  switch (arg) {
    case "-h":
    case "--help":
      usage(null, 0);
      break;
    case "-f":
    case "--values":
      helmArgs.push("-f", next());
      break;
    case "--set":
      helmArgs.push("--set", next());
      break;
    case "--set-string":
      helmArgs.push("--set-string", next());
      break;
    case "--kube-version":
      helmArgs.push("--kube-version", next());
      break;
    case "--api-versions":
      helmArgs.push("--api-versions", next());
      break;
    case "--include-subcharts":
      includeSubcharts = true;
      break;
    case "--no-strict":
      strictLint = false;
      break;
    case "--strict":
      strictExit = true;
      break;
    case "--quiet":
      quiet = true;
      break;
    case "--":
      passthrough.push(...args.slice(i + 1));
      i = args.length;
      break;
    default:
      break;
  }
}

function usage(message, code = 2) {
  const text = fs.readFileSync(new URL(import.meta.url), "utf8");
  const header = text.slice(text.indexOf("/**"), text.indexOf("*/") + 2);
  const doc = header.replace(/^\/\*\*|\*\/$/g, "").replace(/^\s*\* ?/gm, "");
  if (message) process.stderr.write(`✗ ${message}\n\n`);
  process.stdout.write(doc);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  red: color ? "[31m" : "",
  yellow: color ? "[33m" : "",
  green: color ? "[32m" : "",
  dim: color ? "[2m" : "",
  off: color ? "[0m" : "",
};

const findings = [];
let errors = 0;
let warnings = 0;
let notes = 0;

function report(level, file, message) {
  findings.push({ level, file, message });
  if (level === "error") errors += 1;
  else if (level === "warning") warnings += 1;
  else notes += 1;
  const prefix = file ? `${file}: ` : "";
  if (level === "error") {
    process.stderr.write(`${c.red}✗${c.off} ${prefix}${message}\n`);
  } else if (level === "warning" && !quiet) {
    process.stdout.write(`${c.yellow}!${c.off} ${prefix}${message}\n`);
  }
}
const error = (file, message) => report("error", file, message);
const warn = (file, message) => report("warning", file, message);
const note = (file, message) => report("info", file, message);

function section(title) {
  if (quiet) return;
  process.stdout.write(`\n${c.dim}${title}${c.off}\n`);
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function helm(argsToPass) {
  const result = spawnSync("helm", argsToPass, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

if (spawnSync("helm", ["version", "--short"], { stdio: "ignore" }).error) {
  process.stderr.write("✗ helm was not found on PATH — install Helm 3+ (https://helm.sh/docs/intro/install/)\n");
  process.exit(2);
}

const chartRoot = path.resolve(chartDir);
if (!fs.existsSync(path.join(chartRoot, "Chart.yaml"))) {
  process.stderr.write(`✗ no Chart.yaml in ${chartDir} — pass the chart directory\n`);
  process.exit(2);
}

function readChartYaml() {
  try {
    return fs.readFileSync(path.join(chartRoot, "Chart.yaml"), "utf8");
  } catch {
    return "";
  }
}
const chartYamlText = readChartYaml();
const chartName = (/^name:\s*["']?([A-Za-z0-9-]+)/m.exec(chartYamlText) ?? [])[1] ?? "";

// ---------------------------------------------------------------------------
// Collect files
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(chartRoot, file) || path.basename(file);

const templatesDir = path.join(chartRoot, "templates");
const subchartDirs = includeSubcharts
  ? fs.existsSync(path.join(chartRoot, "charts"))
    ? fs.readdirSync(path.join(chartRoot, "charts"), { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(chartRoot, "charts", e.name, "Chart.yaml")))
        .map((e) => path.join(chartRoot, "charts", e.name))
    : []
  : [];

const chartDirs = [{ root: chartRoot, name: chartName, templatesDir, valuesFile: path.join(chartRoot, "values.yaml") }];
for (const sub of subchartDirs) {
  const subYaml = fs.readFileSync(path.join(sub, "Chart.yaml"), "utf8");
  const subName = (/^name:\s*["']?([A-Za-z0-9-]+)/m.exec(subYaml) ?? [])[1] ?? path.basename(sub);
  chartDirs.push({ root: sub, name: subName, templatesDir: path.join(sub, "templates"), valuesFile: path.join(sub, "values.yaml") });
}

const parsedCharts = chartDirs.map((dir) => {
  const files = walk(dir.templatesDir);
  const templates = files.filter((f) => !f.split(path.sep).some((p) => p.startsWith("_")) && /\.(ya?ml|tpl)$/.test(f));
  const helpers = files.filter((f) => f.split(path.sep).some((p) => p.startsWith("_")));
  const notesFile = files.find((f) => path.basename(f) === "NOTES.txt");
  const valuesText = fs.existsSync(dir.valuesFile) ? fs.readFileSync(dir.valuesFile, "utf8") : "";
  return { ...dir, templates, helpers, notesFile, valuesText };
});

// ---------------------------------------------------------------------------
// 1. helm lint
// ---------------------------------------------------------------------------

section("helm lint");
const lintArgs = ["lint", chartRoot, ...helmArgs, ...passthrough];
if (strictLint) lintArgs.push("--strict");
const lint = helm(lintArgs);

if (lint.error) {
  process.stderr.write(`✗ failed to run helm lint: ${lint.error.message}\n`);
  process.exit(2);
}

const lintOutput = `${lint.stdout}${lint.stderr}`;
for (const line of lintOutput.split("\n")) {
  const match = /^\[(ERROR|WARNING|INFO)\]\s*(.*)$/.exec(line.trim());
  if (!match) continue;
  const [, level, message] = match;
  if (level === "ERROR") error("helm lint", message);
  else if (level === "WARNING") warn("helm lint", message);
  else note("helm lint", message);
}
if (!findings.length) {
  note("helm lint", lint.status === 0 ? "clean" : "clean (informational output only)");
}
if (lint.status !== 0) {
  process.stderr.write(`\n${c.dim}${lintOutput.trim()}${c.off}\n`);
}

// ---------------------------------------------------------------------------
// 2. helm template
// ---------------------------------------------------------------------------

section("helm template");
const templateRun = helm(["template", "verify-release", chartRoot, ...helmArgs, ...passthrough]);

if (templateRun.error) {
  process.stderr.write(`✗ failed to run helm template: ${templateRun.error.message}\n`);
  process.exit(2);
}

if (templateRun.status !== 0) {
  const message = `${templateRun.stderr}${templateRun.stdout}`.trim();
  error("helm template", "rendering failed — fix this first, the remaining checks need output");
  process.stderr.write(`\n${c.dim}${message}${c.off}\n`);
  reportSummary();
  process.exit(1);
}
if (!quiet) process.stdout.write(`${c.dim}rendered ${templateRun.stdout.split("\n---").length} document(s)${c.off}\n`);

// ---------------------------------------------------------------------------
// 3. Static checks
// ---------------------------------------------------------------------------

const DEPRECATED_API_VERSIONS = new Map([
  ["extensions/v1beta1", "removed in Kubernetes 1.16 — use apps/v1"],
  ["networking.k8s.io/v1beta1", "removed in Kubernetes 1.22 — use networking.k8s.io/v1"],
  ["policy/v1beta1", "removed in Kubernetes 1.25 — use policy/v1 (PodDisruptionBudget)"],
  ["autoscaling/v2beta1", "removed in Kubernetes 1.26 — use autoscaling/v2"],
  ["batch/v1beta1", "removed in Kubernetes 1.25 — use batch/v1 (CronJob)"],
  ["apiextensions.k8s.io/v1beta1", "removed in Kubernetes 1.22 — use apiextensions.k8s.io/v1"],
  ["rbac.authorization.k8s.io/v1beta1", "removed in Kubernetes 1.22 — use rbac.authorization.k8s.io/v1"],
  ["admissionregistration.k8s.io/v1beta1", "removed in Kubernetes 1.22 — use admissionregistration.k8s.io/v1"],
]);

const RECOMMENDED_LABELS = ["helm.sh/chart", "app.kubernetes.io/managed-by", "app.kubernetes.io/instance"];

/** Strip Go template actions so structural checks see the literal YAML around them. */
function blankActions(text) {
  return text.replace(/\{\{-?[\s\S]*?-?\}\}/g, (m) => m.replace(/[^\n]/g, " "));
}

function valueKeyPaths(yamlText) {
  const paths = [];
  const stack = [];
  for (const raw of yamlText.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("- ")) continue;
    const indent = raw.length - raw.trimStart().length;
    const match = /^([A-Za-z0-9_.-]+)\s*:(\s|$)/.exec(trimmed);
    if (!match) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const key = match[1].replace(/^["']|["']$/g, "");
    paths.push([...stack.map((s) => s.key), key].join("."));
    stack.push({ indent, key });
  }
  return paths;
}

function valueReferences(text) {
  const refs = new Set();
  for (const match of text.matchAll(/\.Values\.([A-Za-z0-9_.-]+)/g)) {
    refs.add(match[1].replace(/\.$/, ""));
  }
  return refs;
}

/** Dotted paths that values.schema.json declares as strings (type:string or enum). */
function schemaStringPathsOf(chartRootDir) {
  const file = path.join(chartRootDir, "values.schema.json");
  if (!fs.existsSync(file)) return new Set();
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return new Set();
  }
  const found = new Set();
  const walk = (node, prefix) => {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const next = prefix ? `${prefix}.${key}` : key;
      if (child.enum) found.add(next);
      else if (child.type === "string") found.add(next);
      walk(child, next);
    }
    for (const [key, child] of Object.entries(node.definitions ?? {})) {
      walk(child, prefix ? `${prefix}.${key}` : key);
    }
  };
  walk(schema, "");
  return found;
}

/** Dotted paths whose values.yaml default is a quoted string. */
function quotedStringDefaults(yamlText) {
  const found = new Set();
  const stack = [];
  for (const raw of yamlText.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("- ")) continue;
    const indent = raw.length - raw.trimStart().length;
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const key = match[1].replace(/^["']|["']$/g, "");
    const path = [...stack.map((s) => s.key), key].join(".");
    const rest = match[2].trim();
    if (/^".*"$/.test(rest) || /^'.*'$/.test(rest)) found.add(path);
    stack.push({ indent, key });
  }
  return found;
}

/** Do two dotted paths refer to the same value subtree? */
function related(a, b) {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

for (const chart of parsedCharts) {
  const source = [...chart.templates, ...chart.helpers]
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  const label = chart.root === chartRoot ? "" : `${path.relative(chartRoot, chart.root)}/`;

  // --- named templates must be namespaced -------------------------------
  for (const file of [...chart.templates, ...chart.helpers]) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/\{\{-?\s*define\s+"([^"]+)"/g)) {
      const name = match[1];
      if (chart.name && !name.startsWith(`${chart.name}.`) && !name.startsWith(`${chart.name}-`)) {
        warn(rel(file), `define "${name}" is not namespaced with "${chart.name}." — names are global and the last-loaded definition silently wins`);
      }
    }
  }

  // --- template vs include ----------------------------------------------
  for (const file of chart.templates) {
    const text = fs.readFileSync(file, "utf8");
    if (/\{\{-?\s*template\s+"[^"]+"/.test(text)) {
      warn(rel(file), 'uses {{ template }}, which splices output at column 0 — prefer {{- include "…" . | nindent N }}');
    }
  }

  // --- unquoted interpolation of values the chart declares as strings ------
  // A blanket "quote everything" check flags every integer field, so only flag
  // paths the chart itself says are strings: values.schema.json type:string /
  // enum, or a quoted string default in values.yaml.
  const stringPaths = new Set([...schemaStringPathsOf(chart.root), ...quotedStringDefaults(chart.valuesText)]);

  if (chart.templates.length > 0 && stringPaths.size === 0 && !fs.existsSync(path.join(chart.root, "values.schema.json"))) {
    note(`${label}templates/`, "no values.schema.json, so string-typed values cannot be detected — add one to make | quote verifiable");
  }

  for (const file of chart.templates) {
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split("\n");
    const reported = new Set();
    lines.forEach((line, i) => {
      if (!line.includes(".Values")) return;
      // Only a bare scalar value is at risk: `key: {{ … }}`. A value already
      // wrapped in quotes (`key: "{{ … }}"`), or a block/list context, is fine.
      const kv = /^\s*-?\s*[A-Za-z0-9_."'/()-]+\s*:\s*(.+)$/.exec(line);
      if (!kv) return;
      if (!/^\{\{-?\s*[\w$.]/.test(kv[1].trim())) return;
      for (const match of line.matchAll(/\{\{-?([\s\S]*?)-?\}\}/g)) {
        const action = match[1];
        if (/\b(quote|squote|toYaml|toYamlPretty|toJson|toPrettyJson|toRawJson|nindent|indent|b64enc|printf)\b/.test(action)) continue;
        for (const ref of valueReferences(action)) {
          if (!stringPaths.has(ref)) continue;
          const key = `${i}:${ref}`;
          if (reported.has(key)) continue;
          reported.add(key);
          warn(rel(file), `line ${i + 1} interpolates the string value "${ref}" unquoted — add | quote so a value containing ":" or a newline cannot break the document`);
        }
      }
    });
  }

  // --- hardcoded namespace ----------------------------------------------
  for (const file of chart.templates) {
    const text = blankActions(fs.readFileSync(file, "utf8"));
    if (/^\s*namespace:\s*\S/m.test(text)) {
      warn(rel(file), "sets metadata.namespace explicitly — pass --namespace at install time so the chart works in any namespace");
    }
  }

  // --- deprecated apiVersions -------------------------------------------
  for (const file of chart.templates) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/^\s*apiVersion:\s*["']?([A-Za-z0-9/.]+)/gm)) {
      const advice = DEPRECATED_API_VERSIONS.get(match[1]);
      if (advice) warn(rel(file), `apiVersion ${match[1]} — ${advice}`);
    }
  }

  // --- floating image tags ----------------------------------------------
  for (const file of chart.templates) {
    const text = fs.readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      const image = /^\s*-?\s*image\s*:\s*(.+)$/.exec(line);
      if (image) {
        // Strip the template actions, then look at the literal tag that remains.
        const literal = image[1].replace(/\{\{[\s\S]*?\}\}/g, "").replace(/["']/g, "").trim();
        const floating = /:(latest|head|canary|stable)\b/i.exec(literal);
        if (floating) warn(rel(file), `line ${i + 1} pins no version — image tag "${floating[1]}" is floating; use a fixed tag or a digest so rollbacks are reproducible`);
      }
      const tag = /^\s*-?\s*tag\s*:\s*["']?(latest|head|canary|stable)["']?\s*$/i.exec(line);
      if (tag) warn(rel(file), `line ${i + 1} defaults the image tag to "${tag[1]}" — use a pinned version or digest`);
    });
  }
  for (const match of chart.valuesText.matchAll(/^\s*-?\s*tag\s*:\s*["']?(latest|head|canary|stable)["']?\s*$/gim)) {
    warn(`${label}values.yaml`, `defaults the image tag to "${match[1]}" — use a pinned version or digest`);
  }

  // --- tabs in indentation ----------------------------------------------
  for (const file of [...chart.templates, ...chart.helpers]) {
    const text = fs.readFileSync(file, "utf8");
    const line = text.split("\n").findIndex((l) => /^\t+ /.test(l));
    if (line !== -1) warn(rel(file), `line ${line + 1} is indented with a tab — YAML requires spaces`);
  }

  // --- values referenced but never declared ------------------------------
  if (chart.valuesText) {
    const declared = valueKeyPaths(chart.valuesText);
    const referenced = valueReferences(source);
    for (const ref of referenced) {
      if (ref === "global" || ref.startsWith("global.")) continue;
      if (declared.some((d) => related(d, ref))) continue;
      warn(`${label}templates/`, `.Values.${ref} is read but not declared in values.yaml — a typo renders empty and ships a broken default`);
    }
    const reportedUnused = new Set();
    for (const key of declared) {
      if (referenced.size && [...referenced].some((r) => related(r, key))) continue;
      // Report only the topmost unused key — its children are implied.
      if (key.split(".").slice(0, -1).some((parent) => reportedUnused.has(parent))) continue;
      reportedUnused.add(key);
      warn(`${label}values.yaml`, `"${key}" is declared but no template reads it`);
    }
  }

  // --- housekeeping ------------------------------------------------------
  if (!chart.notesFile) warn(`${label}templates/NOTES.txt`, "missing — it is the only documentation most users read");
  if (chart.root === chartRoot && !fs.existsSync(path.join(chartRoot, ".helmignore"))) {
    warn(".helmignore", "missing — .git, *.tgz and CI files will ship inside the package");
  }

  // --- recommended labels ------------------------------------------------
  if (chart.templates.length > 0) {
    for (const key of RECOMMENDED_LABELS) {
      // Match the label as a whole YAML key, so `…/managed-by-x` does not
      // count as `…/managed-by`.
      const present = source.includes(`${key}:`) || source.includes(`"${key}"`);
      if (!present) {
        warn(`${label}templates/`, `no resource carries the recommended ${key} label — without it kubectl cannot find or roll back this release`);
      }
    }
  }

  // --- defined but never referenced -------------------------------------
  const defined = new Set([...source.matchAll(/\{\{-?\s*define\s+"([^"]+)"/g)].map((m) => m[1]));
  const invoked = new Set([
    ...[...source.matchAll(/\{\{-?\s*include\s+"([^"]+)"/g)].map((m) => m[1]),
    ...[...source.matchAll(/\{\{-?\s*template\s+"([^"]+)"/g)].map((m) => m[1]),
  ]);
  for (const name of defined) {
    if (!invoked.has(name) && !name.endsWith("test")) {
      warn(`${label}templates/`, `define "${name}" is never included — dead code or a typo`);
    }
  }
}

// --- CRDs outside crds/ -----------------------------------------------------
const crdFiles = walk(path.join(chartRoot, "templates")).filter((f) => /kind:\s*CustomResourceDefinition\b/.test(fs.readFileSync(f, "utf8")));
for (const file of crdFiles) {
  error(rel(file), "is a CRD in templates/ — move it to crds/ so it is installed first and never upgraded over");
}

// ---------------------------------------------------------------------------
// 4. Rendered output checks
// ---------------------------------------------------------------------------

section("rendered output");

const rendered = templateRun.stdout;
const documents = rendered.split(/^---\s*$/m).filter((doc) => doc.trim().length > 0);

const identities = new Map();
let hooks = 0;
let documentsWithoutMetadata = 0;

for (const doc of documents) {
  const lines = doc.split("\n");
  const apiVersion = (/^apiVersion:\s*["']?([A-Za-z0-9/.]+)/m.exec(doc) ?? [])[1] ?? "";
  const kind = (/^kind:\s*["']?([A-Za-z]+)/m.exec(doc) ?? [])[1] ?? "";
  const source = (/#\s*Source:\s*(\S+)/.exec(doc) ?? [])[1] ?? "rendered output";

  if (!kind || !apiVersion) {
    documentsWithoutMetadata += 1;
    warn(source, "rendered document has no apiVersion/kind — usually a stray {{- if }} block or a badly indented template");
    continue;
  }

  const name = (/(^|\n)metadata:\n(?:[ \t]+.*\n)*?[ \t]+name:\s*["']?([^"'\s#]+)/.exec(doc) ?? [])[2] ?? "";
  const namespace = (/(^|\n)metadata:\n(?:[ \t]+.*\n)*?[ \t]+namespace:\s*["']?([^"'\s#]+)/.exec(doc) ?? [])[1] ?? "";

  if (doc.includes('"helm.sh/hook"')) hooks += 1;

  if (name) {
    const identity = `${kind}/${namespace || "_cluster"}/${name}`;
    if (identities.has(identity)) {
      error(source, `renders ${identity}, which ${identities.get(identity)} already renders — the release will fight itself`);
    } else {
      identities.set(identity, source);
    }

    // A CRD's object name is a DNS subdomain (plural.group), not a label.
    if (kind === "CustomResourceDefinition") {
      if (name.length > 253) warn(source, `CRD name "${name}" is ${name.length} characters — the limit is 253`);
    } else {
      if (name.length > 63) {
        warn(source, `name "${name}" is ${name.length} characters — chart-generated names are capped at 63 (use trunc 63 | trimSuffix "-")`);
      }
      if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(name)) {
        warn(source, `name "${name}" is not a valid DNS-1123 name (lowercase alphanumeric, '-' and '.', starting and ending alphanumeric)`);
      }
      if (kind === "Service" && /-\d+$/.test(name)) {
        warn(source, `Service "${name}" ends in a numeric suffix, which some DNS resolvers read as an IP address`);
      }
    }
  } else if (kind !== "List") {
    warn(source, `${kind} rendered without metadata.name`);
  }

  if (doc.includes("<no value>")) {
    error(source, "rendered <no value> — a template referenced something undefined");
  }
}

if (documentsWithoutMetadata === 0 && documents.length === 0) {
  warn("chart", "rendered no resources at all — check that every template is gated on a value that is actually set");
}
if (hooks > 0) note("chart", `${hooks} hook resource(s) — hooks are not part of the release and never appear in helm get manifest`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function reportSummary() {
  const failed = errors > 0 || (strictExit && warnings > 0);
  const status = failed ? `${c.red}FAIL${c.off}` : `${c.green}PASS${c.off}`;
  process.stdout.write(`\n${status}: ${errors} error(s), ${warnings} warning(s)\n`);
  if (failed && errors === 0) process.stdout.write(`${c.dim}--strict was set and only warnings were found${c.off}\n`);
  if (errors > 0) {
    process.stdout.write(`${c.dim}next: fix the errors above, then re-run this script and helm lint ./<chart> --strict${c.off}\n`);
  } else if (warnings > 0) {
    process.stdout.write(`${c.dim}next: warnings are advisory; review them against the chart's intent${c.off}\n`);
  }
}

reportSummary();
process.exit(errors > 0 || (strictExit && warnings > 0) ? 1 : 0);