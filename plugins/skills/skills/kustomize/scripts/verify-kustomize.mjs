#!/usr/bin/env node
/**
 * verify-kustomize.mjs
 *
 * Render and validate kustomization roots without a cluster.
 *
 * For every root it runs `kustomize build`, falls back to `kubectl kustomize`
 * when the standalone binary is missing, and then adds the rendered-output
 * checks that kustomize itself does not perform:
 *
 *   - build failure, reported with the first useful line of the error
 *   - a build that renders nothing (a GitOps pipeline would delete the app)
 *   - a build with no document marker at all
 *   - a document that does not start with `---` or `apiVersion:`
 *   - tab characters used for indentation (YAML forbids them)
 *   - unresolved placeholders left in the output: `$(VAR)` variables that
 *     kustomize never substituted, and `${VAR}` in plain-scalar positions
 *     (Helm/CI syntax reaching a manifest)
 *   - two rendered documents with the same Kind/namespace/name
 *
 * Optional, read-only: `kubectl apply --dry-run=client -f -` from stdin, run
 * only when kubectl is installed and a kubeconfig is discoverable. It never
 * contacts an API server and never mutates a cluster: `--dry-run=client`
 * parses the manifests locally. If either condition is missing the cluster-free
 * check prints a "skipped" line and the render checks still decide the exit code.
 *
 * Usage:
 *   node verify-kustomize.mjs [root...] [options]
 *
 * Roots are directories holding kustomization.yaml or kustomization.yml
 * (default: `.`). A directory that holds overlays instead is expanded: every
 * subdirectory containing a kustomization file becomes a root, and its
 * subdirectories are not searched again.
 *
 * Options:
 *   --kustomize <path>      kustomize binary to run (default: `kustomize` on PATH)
 *   --kubectl <path>        kubectl binary to run (default: `kubectl` on PATH)
 *   --no-kubectl            do not run the kubectl client dry-run at all
 *   --dry-run=client        kubectl client-side dry-run (default)
 *   --no-dry-run            render and validate only, never call kubectl
 *   --load-restrictor <v>   forwarded to kustomize: LoadRestrictionsRootOnly
 *                           (default) or LoadRestrictionsNone for files outside
 *                           the root
 *   --strict                also exit non-zero when only warnings were found
 *   --quiet                 print only failures and the summary
 *
 * Exit codes: 0 ok · 1 problems found · 2 usage/environment error
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const roots = [];
let kustomizeBin = "kustomize";
let kubectlBin = "kubectl";
let kubectlMode = "auto"; // auto | off
let dryRun = "client"; // client | off
let loadRestrictor = "";
let strictExit = false;
let quiet = false;

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  const next = () => {
    const value = argv[i + 1];
    if (value === undefined) usage(`${arg} requires a value`);
    i += 1;
    return value;
  };
  switch (arg) {
    case "-h":
    case "--help":
      usage(null, 0);
      break;
    case "--kustomize":
      kustomizeBin = next();
      break;
    case "--kubectl":
      kubectlBin = next();
      break;
    case "--no-kubectl":
      kubectlMode = "off";
      break;
    case "--dry-run=client":
      dryRun = "client";
      break;
    case "--no-dry-run":
      dryRun = "off";
      break;
    case "--server-side":
    case "--dry-run=server":
      usage(`${arg} is refused: verify-kustomize never talks to an API server`);
      break;
    case "--output":
    case "-o":
      usage(`${arg} is not supported: the rendered stream is validated as-is`);
      break;
    case "--load-restrictor": {
      const value = next();
      if (value !== "LoadRestrictionsRootOnly" && value !== "LoadRestrictionsNone") {
        usage(`--load-restrictor takes LoadRestrictionsRootOnly or LoadRestrictionsNone, got "${value}"`);
      }
      loadRestrictor = value;
      break;
    }
    case "--strict":
      strictExit = true;
      break;
    case "--quiet":
      quiet = true;
      break;
    case "--":
      roots.push(...argv.slice(i + 1).filter((a) => !a.startsWith("-")));
      i = argv.length;
      break;
    default:
      if (arg.startsWith("-")) usage(`unknown option: ${arg}`);
      roots.push(arg);
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

if (roots.length === 0) roots.push(".");

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const esc = String.fromCharCode(27);
const c = {
  red: color ? `${esc}[31m` : "",
  yellow: color ? `${esc}[33m` : "",
  green: color ? `${esc}[32m` : "",
  dim: color ? `${esc}[2m` : "",
  off: color ? `${esc}[0m` : "",
};

/** One result per root: { root, status, errors[], warnings[], notes[], docs }. */
const results = [];
let current = null;
let errors = 0;
let warnings = 0;

function report(level, message) {
  if (!current) return;
  if (level === "error") {
    errors += 1;
    current.errors.push(message);
    process.stderr.write(`  ${c.red}✗${c.off} ${message}\n`);
  } else if (level === "warning") {
    warnings += 1;
    current.warnings.push(message);
    if (!quiet) process.stdout.write(`  ${c.yellow}!${c.off} ${message}\n`);
  } else if (!quiet) {
    current.notes.push(message);
    process.stdout.write(`  ${c.dim}· ${message}${c.off}\n`);
  }
}
const error = (message) => report("error", message);
const warn = (message) => report("warning", message);
const note = (message) => report("info", message);

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    input: options.input,
    timeout: options.timeout ?? 120_000,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

const available = (bin) => !spawnSync(bin, ["--help"], { stdio: "ignore" }).error;

const KUSTOMIZATION_FILES = ["kustomization.yaml", "kustomization.yml", "Kustomization"];

function isKustomizationRoot(dir) {
  return KUSTOMIZATION_FILES.some((name) => fs.existsSync(path.join(dir, name)));
}

/** Flags shared by `kustomize build` and `kubectl kustomize`. */
const commonFlags = loadRestrictor ? ["--load-restrictor", loadRestrictor] : [];

// Which tool renders? The standalone binary wins; `kubectl kustomize` is the
// fallback, and it pins whatever kustomize version that kubectl ships.
let renderer = null;
if (available(kustomizeBin)) {
  renderer = { kind: "kustomize", bin: kustomizeBin };
} else if (available(kubectlBin)) {
  renderer = { kind: "kubectl", bin: kubectlBin };
}
/** The argv that renders one root, e.g. `build DIR` or `kustomize DIR`. */
const buildArgs = (root) => (renderer.kind === "kustomize" ? ["build", root, ...commonFlags] : ["kustomize", root, ...commonFlags]);
if (!renderer) {
  process.stderr.write(
    `✗ neither \`${kustomizeBin}\` nor \`${kubectlBin}\` was found — install kustomize (https://kubectl.docs.kubernetes.io/installation/kustomize/) or kubectl\n`,
  );
  process.exit(2);
}
if (renderer.kind === "kubectl") {
  process.stderr.write(`! \`${kustomizeBin}\` was not found; falling back to \`${kubectlBin} kustomize\` (embedded kustomize)\n`);
}

/** Does kubectl work offline? --dry-run=client never contacts the API server. */
const kubectlAvailable = available(kubectlBin);
let kubectlSkipReason = "";
if (kubectlMode === "off") kubectlSkipReason = "--no-kubectl was passed";
else if (dryRun === "off") kubectlSkipReason = "--no-dry-run was passed";
else if (!kubectlAvailable) kubectlSkipReason = `\`${kubectlBin}\` was not found on PATH`;
else if (!process.env.KUBECONFIG && !fs.existsSync(path.join(os.homedir(), ".kube", "config"))) {
  kubectlSkipReason = "no kubeconfig found (KUBECONFIG unset and ~/.kube/config missing)";
}

// ---------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------

/** Expand a directory that holds overlays instead of a kustomization file. */
function resolveRoots(inputs) {
  const resolved = [];
  for (const input of inputs) {
    const dir = path.resolve(input);
    if (!fs.existsSync(dir)) {
      process.stderr.write(`✗ ${input}: no such directory\n`);
      process.exit(2);
    }
    if (isKustomizationRoot(dir)) {
      resolved.push(dir);
      continue;
    }
    const found = [];
    const walk = (candidate, depth) => {
      if (isKustomizationRoot(candidate)) {
        found.push(candidate);
        return;
      }
      if (depth >= 3) return;
      for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
        walk(path.join(candidate, entry.name), depth + 1);
      }
    };
    walk(dir, 0);
    if (found.length === 0) {
      process.stderr.write(
        `✗ ${input}: not a kustomization root and no ${KUSTOMIZATION_FILES[0]} in its subdirectories\n`,
      );
      process.exit(2);
    }
    found.sort();
    resolved.push(...found);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Rendered-output validation
// ---------------------------------------------------------------------------

/** Split a rendered stream on lines that are exactly a document separator. */
function splitDocuments(text) {
  const documents = [];
  let lines = [];
  for (const line of text.split("\n")) {
    if (/^---\s*$/.test(line)) {
      if (lines.some((l) => l.trim() && !l.trim().startsWith("#"))) documents.push(lines.join("\n"));
      lines = [];
    } else {
      lines.push(line);
    }
  }
  if (lines.some((l) => l.trim() && !l.trim().startsWith("#"))) documents.push(lines.join("\n"));
  return documents;
}

/**
 * Placeholders that survived rendering, as { line, text, code }.
 *
 * `$(VAR)` is always a kustomize var/nameReference that never resolved: kustomize
 * substitutes those everywhere, including inside block scalars, so one left over is a
 * bug. `${VAR}` is different — it is often deliberate shell or Helm text inside a
 * ConfigMap `data` block (an entrypoint script, a properties file). Those are reported
 * as warnings unless the value is a plain scalar in a spec field, where `${...}` is
 * far more likely to be an unrendered template. `meta.code` marks a hit that sits
 * inside a block scalar.
 */
function placeholderLines(document) {
  const found = [];
  let blockIndent = null; // indentation of the innermost open block scalar, or null
  document.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (blockIndent !== null && trimmed !== "" && indent <= blockIndent) blockIndent = null;
    const code = blockIndent !== null;
    if (trimmed && !trimmed.startsWith("#")) {
      const variable = /\$\([A-Za-z_][A-Za-z0-9_]*\)|\$\{[A-Za-z_][A-Za-z0-9_]*\}/.exec(trimmed);
      if (variable) {
        const braced = variable[0].startsWith("${");
        const literal = /** `key: "${VAR}"` is deliberate text, not an unrendered template. */ (() => {
          const value = /:\s*(.+)$/.exec(trimmed);
          return Boolean(value && /^["']/.test(value[1].trim()));
        })();
        if (!braced || (!literal && !code)) found.push({ line: index + 1, text: variable[0], code });
      }
    }
    // A line ending in a block-scalar indicator opens a block scalar for the lines below.
    if (/[|>][+-]?\s*(#.*)?$/.test(trimmed) && /:\s*[|>]|-\s+[|>]/.test(trimmed)) blockIndent = indent;
  });
  return found;
}

/** First useful line of a kustomize/kubectl error, without the `Error:` prefix. */
function firstErrorLine(text) {
  const lines = `${text}`.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("kustomize:") && !l.startsWith("verifying"));
  const preferred = lines.find((l) => /^error:/i.test(l)) ?? lines[0] ?? "";
  return preferred.replace(/^error:\s*/i, "");
}

function validateManifestStream(root, text) {
  const documents = splitDocuments(text);
  current.docs = documents.length;

  if (text.trim() === "") {
    error("rendered no output — the root builds but produces zero manifests (an empty pipeline deletes the app)");
    return;
  }
  if (documents.length === 0) {
    error("rendered no document: output has no `---` and no content that parses as a manifest");
    return;
  }
  // Two documents can only be adjacent if a `---` line is missing.
  const separators = text.split("\n").filter((l) => /^---\s*$/.test(l)).length;
  if (documents.length > 1 && separators !== documents.length - 1) {
    error(`rendered ${documents.length} documents but only ${separators} separator line(s) — documents run together`);
  }

  const identities = new Map();
  let tabLines = 0;

  for (const [index, document] of documents.entries()) {
    const first = document.split("\n").find((l) => l.trim()) ?? "";
    const label = `document ${index + 1}`;
    const kind = (/^kind:\s*["']?([A-Za-z][A-Za-z0-9]*)/m.exec(document) ?? [])[1] ?? "";
    const apiVersion = (/^apiVersion:\s*["']?([A-Za-z0-9/.-]+)/m.exec(document) ?? [])[1] ?? "";
    const name = (/^metadata:\n(?:[ \t]+.*\n)*?[ \t]+name:\s*["']?([^"'\s#]+)/m.exec(document) ?? [])[1] ?? "";
    const namespace = (/^metadata:\n(?:[ \t]+.*\n)*?[ \t]+namespace:\s*["']?([^"'\s#]+)/m.exec(document) ?? [])[1] ?? "";
    const source = (/#\s*Source:\s*(\S+)/.exec(document) ?? [])[1] ?? "";
    const where = [kind, name].filter(Boolean).join(" ") || label;

    if (!first.startsWith("---") && !/^apiVersion:/.test(first)) {
      error(`${label} (${kind || "no kind"}) does not start with \`---\` or \`apiVersion:\` — first line is \`${first.slice(0, 60)}\``);
      continue;
    }
    if (!apiVersion || !kind) {
      warn(`${label} has no apiVersion/kind — usually a stray separator or a text file that got rendered`);
      continue;
    }

    const tabs = document.split("\n").filter((l) => /^\t+|\t +\S/.test(l)).length;
    tabLines += tabs;

    const placeholders = placeholderLines(document);
    for (const hit of placeholders.slice(0, 5)) {
      if (hit.text.startsWith("${") && hit.code) {
        warn(`${where}: line ${hit.line} contains ${hit.text} inside a block scalar — fine if it is shell/Helm text, a bug if a template never rendered`);
      } else if (hit.text.startsWith("$(")) {
        error(`${where}: line ${hit.line} still contains ${hit.text} — a kustomize var or nameReference that never resolved; use replacements/ or fix the reference name`);
      } else {
        error(`${where}: line ${hit.line} still contains ${hit.text} — an unrendered placeholder reached a spec field; substitute it in an overlay or quote it if it is literal text`);
      }
    }

    if (name) {
      const identity = `${kind}/${namespace || "_cluster"}/${name}`;
      const previous = identities.get(identity);
      if (previous) {
        warn(`${identity} is rendered twice (${previous.source || previous.label} and ${source || label}) — the later document silently wins`);
      } else {
        identities.set(identity, { source, label });
      }
    }
  }

  if (tabLines > 0) {
    error(`${tabLines} rendered line(s) are indented with a tab — YAML requires spaces, and kubectl rejects it`);
  }
  if (!quiet && /\$\{/.test(text) && placeholderLines(documents.join("\n")).length === 0) {
    note("quoted `${...}` values are present and were treated as literal text");
  }
  if (!quiet) note(`${documents.length} document(s) rendered${identities.size ? `, ${identities.size} distinct resource(s)` : ""}`);
}

/** kubectl client-side dry-run. Parses locally; never contacts the API server. */
function kubectlClientDryRun(root, text) {
  if (kubectlSkipReason) {
    note(`kubectl client dry-run skipped: ${kubectlSkipReason}`);
    return;
  }
  const result = run(kubectlBin, ["apply", "--dry-run=client", "-f", "-"], {
    input: text,
    timeout: 60_000,
  });
  if (result.error) {
    warn(`kubectl apply --dry-run=client could not run: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    const message = firstErrorLine(`${result.stderr}${result.stdout}`);
    if (/couldn't get current server API group list|no configuration has been provided|couldn't get version|the server could not find/i.test(message)) {
      note(`kubectl client dry-run skipped: kubectl 1.32 validates types against the API server, which is unreachable here (${message})`);
      return;
    }
    warn(`kubectl apply --dry-run=client reported: ${message}`);
    return;
  }
  const applied = result.stdout.split("\n").filter((l) => / (created|configured|unchanged) \(dry run\)$/.test(l.trim())).length;
  note(`kubectl apply --dry-run=client accepted ${applied || "the"} manifest(s) (no cluster contact)`);
}

// ---------------------------------------------------------------------------
// Verify each root
// ---------------------------------------------------------------------------

const rootList = resolveRoots(roots);
if (!quiet) {
  const invocation = renderer.kind === "kustomize" ? "kustomize build" : "kubectl kustomize";
  process.stdout.write(`${c.dim}renderer: ${renderer.bin} (${invocation}) · ${rootList.length} root(s)${c.off}\n`);
}

for (const root of rootList) {
  const relative = path.relative(process.cwd(), root);
  const display = relative === "" ? "." : relative.startsWith("..") ? root : relative;
  current = { root: display, status: "FAIL", errors: [], warnings: [], notes: [], docs: 0 };
  results.push(current);
  if (!quiet) process.stdout.write(`\n${display}\n`);

  const build = run(renderer.bin, buildArgs(root));
  if (build.error) {
    current.status = "ERROR";
    error(`failed to run ${renderer.bin}: ${build.error.message}`);
    continue;
  }
  if (build.status !== 0) {
    const message = firstErrorLine(`${build.stderr}\n${build.stdout}`);
    error(`build failed: ${message || `exit status ${build.status}`}`);
    // The full stderr often names the offending file three lines down.
    const detail = build.stderr
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^kustomize:|^verifying/.test(l))
      .filter((l) => l !== message)
      .slice(0, 3);
    for (const line of detail) if (!quiet) process.stderr.write(`    ${c.dim}${line}${c.off}\n`);
    continue;
  }

  validateManifestStream(root, build.stdout);
  const rendered = build.stdout;
  kubectlClientDryRun(root, rendered);

  current.status = current.errors.length === 0 ? "PASS" : "FAIL";
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const failed = results.filter((r) => r.status !== "PASS");
function reportSummary() {
  const strict = strictExit && warnings > 0;
  const ok = failed.length === 0 && !strict;
  const status = ok ? `${c.green}PASS${c.off}` : `${c.red}FAIL${c.off}`;
  const detail = `${results.length - failed.length}/${results.length} root(s) rendered${failed.length ? `, ${failed.length} failed` : ""}`;
  process.stdout.write(`\n${status}: ${detail} — ${errors} error(s), ${warnings} warning(s)\n`);
  if (failed.length > 0) {
    for (const result of failed) process.stdout.write(`${c.dim}  ${result.status} ${result.root}${c.off}\n`);
    if (renderer.kind === "kubectl") {
      process.stdout.write(`${c.dim}next: install the standalone kustomize binary so CI and this check agree on the version${c.off}\n`);
    } else {
      process.stdout.write(`${c.dim}next: fix the errors above, then re-run \`${renderer.bin} build ${failed[0].root}\`${c.off}\n`);
    }
  } else if (warnings > 0) {
    process.stdout.write(`${c.dim}next: warnings are advisory; review them against what each overlay intends${c.off}\n`);
  }
  return ok;
}

const success = reportSummary();
process.exit(success ? 0 : 1);
