#!/usr/bin/env bash
#
# verify-theme.sh — pre-flight a Ghost theme before uploading it.
#
# Checks the things Ghost/GScan will reject or silently degrade, then runs the
# real build and GScan, then asserts the zip contains only shippable files.
#
# Usage:
#   scripts/verify-theme.sh [theme-dir]      # default: current directory
#
# Exits non-zero on the first failed check. Requires node + npm; GScan is run
# through npx.

set -euo pipefail

theme_dir="${1:-.}"
cd "$theme_dir"

if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; DIM=""; OFF=""
fi

ok()   { printf '%s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
fail() { printf '%s✗%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Ghost's non-negotiables
# ---------------------------------------------------------------------------

[ -f package.json ] || fail "no package.json here — a Ghost theme needs one at its root"
[ -f index.hbs ]    || fail "index.hbs is missing — Ghost requires it"
[ -f post.hbs ]     || fail "post.hbs is missing — Ghost requires it"
[ -f default.hbs ]  || fail "default.hbs is missing — it is the layout every template extends"
[ -d assets ]       || fail "no assets/ directory — the {{asset}} helper contract requires one"
ok "required files present (package.json, default.hbs, index.hbs, post.hbs, assets/)"

grep -q '{{{body}}}'   default.hbs || fail 'default.hbs must contain {{{body}}} (triple-stash)'
grep -q '{{ghost_head}}' default.hbs || fail 'default.hbs must contain {{ghost_head}} in <head>'
grep -q '{{ghost_foot}}' default.hbs || fail 'default.hbs must contain {{ghost_foot}} before </body>'
ok "default.hbs contract ({{{body}}}, {{ghost_head}}, {{ghost_foot}})"

if [ -f error.hbs ]; then
  if grep -q '{{!< *default' error.hbs; then
    warn "error.hbs extends default.hbs — Ghost's docs advise error templates to be standalone"
  fi
  if grep -qE '\{\{[#/>]?(t|foreach|get|if|is|match|has|navigation|pagination|img_url)\b' error.hbs; then
    warn "error.hbs uses theme helpers — docs allow only {{asset}} in error templates"
  fi
fi

# ---------------------------------------------------------------------------
# 2. Asset paths must go through {{asset}}
# ---------------------------------------------------------------------------

if grep -rnE '(src|href)="/(assets|content/themes)/' --include='*.hbs' . >/dev/null 2>&1; then
  grep -rnE '(src|href)="/(assets|content/themes)/' --include='*.hbs' . >&2 || true
  fail "hardcoded asset paths found — use {{asset \"...\"}} (breaks on subdirectory installs and Ghost Pro)"
fi
ok "no hardcoded asset paths in templates"

# ---------------------------------------------------------------------------
# 3. package.json ↔ template consistency
# ---------------------------------------------------------------------------

node --input-type=module - <<'NODE' || exit 1
import fs from "node:fs";
import path from "node:path";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const config = pkg.config ?? {};
const problems = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const templates = walk(".").filter((f) => f.endsWith(".hbs"));
const source = templates.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const sourceJs = walk("assets").filter((f) => /\.(js|jsx|ts|tsx|css)$/.test(f))
  .map((f) => fs.readFileSync(f, "utf8")).join("\n");

// GScan errors on declared-but-unused custom settings.
for (const key of Object.keys(config.custom ?? {})) {
  const used = new RegExp(`@custom\\.${key}\\b`).test(source) ||
               new RegExp(`["']${key}["']`).test(sourceJs);
  if (!used) problems.push(`config.custom.${key} is declared but never used (GScan reports this as an error)`);
}

// Every size passed to img_url must be a declared key.
const declared = new Set(Object.keys(config.image_sizes ?? {}));
const usedSizes = [...source.matchAll(/img_url[^}]*size="([^"]+)"/g)].map((m) => m[1]);
for (const size of new Set(usedSizes)) {
  if (declared.size > 0 && !declared.has(size)) {
    problems.push(`size="${size}" is used in a template but not declared in config.image_sizes`);
  }
}
if (declared.size > 10) problems.push(`config.image_sizes declares ${declared.size} sizes; Ghost recommends at most 10`);

const customCount = Object.keys(config.custom ?? {}).length;
if (customCount > 20) problems.push(`config.custom declares ${customCount} settings; the maximum is 20`);

if (problems.length) {
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\u2713 package.json and templates agree (custom settings used, image sizes declared)");
NODE

# ---------------------------------------------------------------------------
# 4. Build, then GScan
# ---------------------------------------------------------------------------

if node -e "process.exit(require('./package.json').scripts?.build ? 0 : 1)" 2>/dev/null; then
  npm run --silent build >/dev/null || fail "npm run build failed"
  ok "build succeeded"
fi

if [ -f partials/vite_assets/head.hbs ] || [ -f partials/vite_assets/foot.hbs ]; then
  for f in partials/vite_assets/head.hbs partials/vite_assets/foot.hbs; do
    [ -f "$f" ] || continue
    if grep -qE 'assets/built/assets/' "$f"; then
      fail "$f references assets/built/assets/ — set build.assetsDir = \".\" in vite.config.js (GScan warns otherwise)"
    fi
  done
  if grep -qE 'index-[A-Za-z0-9_-]+\.(js|css)' partials/vite_assets/*.hbs 2>/dev/null; then
    ok "asset partials reference hashed Vite output"
  else
    warn "asset partials do not reference hashed Vite output — did the build run?"
  fi
fi

npx --yes gscan . || fail "GScan reported errors — fix them before uploading"
ok "GScan passed"

# ---------------------------------------------------------------------------
# 5. Zip hygiene (only if a zip exists or a zip script is available)
# ---------------------------------------------------------------------------

list_zip() {
  if command -v unzip >/dev/null 2>&1; then unzip -Z1 "$1"; return; fi
  if command -v python3 >/dev/null 2>&1; then python3 -c 'import sys,zipfile;print("\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))' "$1"; return; fi
  return 1
}

if node -e "process.exit(require('./package.json').scripts?.zip ? 0 : 1)" 2>/dev/null; then
  npm run --silent zip >/dev/null 2>&1 || warn "npm run zip failed — skipping archive checks"
  archive="$(ls -t dist/*.zip 2>/dev/null | head -1 || true)"
  if [ -n "$archive" ]; then
    contents="$(list_zip "$archive" || true)"
    if [ -n "$contents" ]; then
      for banned in node_modules/ lib/ scripts/ dist/ assets/css/ assets/js/; do
        if printf '%s\n' "$contents" | grep -q "^$banned"; then
          fail "$archive ships development files ($banned) — the zip should contain only built assets, templates, partials, members, locales, and package.json"
        fi
      done
      printf '%s\n' "$contents" | grep -q '^package.json$' || fail "$archive is missing package.json"
      printf '%s\n' "$contents" | grep -qE '^assets/built/' || fail "$archive has no built assets — Ghost cannot run your bundler"
      printf '%s\n' "$contents" | grep -qE '\.hbs$' || fail "$archive contains no templates"
      ok "zip hygiene ($archive)"
    else
      warn "could not list $archive (need unzip or python3)"
    fi
  fi
fi

printf '\n%sTheme verified.%s Upload the zip at Ghost Admin → Settings → Design → Change theme.\n' "$GREEN" "$OFF"
