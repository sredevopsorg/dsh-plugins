# DSH Plugins

Custom **skills, plugins, and tools** for [DeepSeek Harness (DSH)](https://github.com/sredevopsorg), maintained by [sredevopsorg](https://github.com/sredevopsorg).

DSH loads three kinds of extension:

| Kind | What it is | Where it lives here |
|---|---|---|
| **Skill** | A `SKILL.md` (or flat `<name>.md`) instruction bundle discovered from a skills root and loaded on demand by the model or with `/name`. | [`skills/`](skills/) |
| **Plugin** | A Cordis plugin package loaded into a DSH profile (`dsh plugin …`). | [`plugins/`](plugins/) |
| **Tool** | A model-facing tool registered by a plugin via `ctx.tools`. Usually shipped inside a plugin package. | [`plugins/<name>/`](plugins/suggest-resources/) |

> Verified against `@deepseek-ai/dsh` **0.2.x** (`0.2.0-rc.2`). The CLI version gate is strict, so check `dsh --version` before reporting plugin issues.

---

## Contents

### Skills

| Skill | Surface | Use it for |
|---|---|---|
| [`software-architecture`](skills/software-architecture/SKILL.md) | model + user | Choosing the simplest sufficient design, patterns to apply or skip, engineering practices, tool/skill selection |
| [`fullstack-development`](skills/fullstack-development/SKILL.md) | model + user | Container-based Python and Node.js/TypeScript backends, frontends, monorepos, Docker, e2e testing |
| [`supabase`](skills/supabase/SKILL.md) | model + user | Anything touching Supabase: DB, Auth, Edge Functions, Realtime, Storage, CLI, MCP, logs, debugging |
| [`supabase-postgres-best-practices`](skills/supabase-postgres-best-practices/SKILL.md) | model + user | Postgres schema, migrations, RLS, indexes, locking, query plans — load *before* touching a database |
| [`ghost-theme-development`](skills/ghost-theme-development/SKILL.md) | model + user | Authoring Ghost Handlebars themes: templates, contexts, helpers, settings, routing, GScan |
| [`ghost-theme-modern-frontend`](skills/ghost-theme-modern-frontend/SKILL.md) | model + user | Wiring a Ghost theme to Vite, Tailwind CSS, and React/Vue/Svelte islands |
| [`helm-chart-development`](skills/helm-chart-development/SKILL.md) | model + user | Creating, editing and improving Helm charts: templates, values.yaml, helpers, hooks, CRDs, subcharts |
| [`flaresolverr-workspace`](skills/flaresolverr-workspace/SKILL.md) | model + user | Operating a disposable FlareSolverr workspace: the v1 API contract, lifecycle and teardown, the User-Agent trap, and the failure playbook |

### Plugins and tools

| Plugin | Kind | Use it for |
|---|---|---|
| [`suggest-resources`](plugins/suggest-resources/README.md) | bundle + tool | Ranking the available tools, plugins, MCP servers, and skills against a task |
| [`flaresolverr`](plugins/flaresolverr/README.md) | bundle + tool | Running a disposable, loopback-only FlareSolverr container to solve Cloudflare and DDoS-Guard challenges |

---

## Repository layout

```
.
├── README.md
├── LICENSE
├── NOTICE.md                              # third-party attribution
├── install.sh                             # register skills with a DSH skill root
├── .shellcheckrc
├── scripts/
│   └── validate-skills.mjs                # frontmatter contract check (CI)
├── .github/workflows/ci.yml
├── docs/
│   └── ghost-themes.md                    # repo doc — NOT a skill
├── skills/
│   ├── software-architecture/
│   │   └── SKILL.md
│   ├── fullstack-development/
│   │   └── SKILL.md
│   ├── supabase/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   └── assets/
│   ├── supabase-postgres-best-practices/
│   │   ├── SKILL.md
│   │   └── references/                    # one file per rule + _sections/_template/_contributing
│   ├── ghost-theme-development/
│   │   ├── SKILL.md
│   │   └── references/
│   ├── ghost-theme-modern-frontend/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   └── scripts/                       # scaffold-theme.mjs, verify-theme.sh
│   └── helm-chart-development/
│       ├── SKILL.md
│       ├── references/                    # template-language, chart-structure, functions, debugging
│       └── scripts/                       # verify-chart.mjs
├── plugins/
│   ├── suggest-resources/
│   │   ├── package.json                   # name, license, exports, dsh.bundle.patch
│   │   ├── cordis.patch.yml               # the plugin row
│   │   ├── index.js                       # suggest_resources tool + capability discovery
│   │   ├── catalog.js                     # MCP server catalogue + plugin seeds
│   │   ├── locale/en.json                 # display title/description
│   │   ├── icon.svg
│   │   └── README.md                      # configuration table + observable behavior
│   └── flaresolverr/
│       ├── package.json                   # name, license, exports, dsh.bundle.patch
│       ├── cordis.patch.yml               # the plugin row + defaults
│       ├── index.js                       # flaresolverr tool: policy, ownership, rendering
│       ├── docker.js                      # Docker CLI adapter (the only module that executes)
│       ├── flare.js                       # FlareSolverr wire-protocol adapter
│       ├── locale/en.json
│       ├── icon.svg
│       └── README.md
```

A skill directory may carry any supporting files — `references/`, `scripts/`, `assets/` — because the whole directory is the skill's resource base.

---

## Requirements

- **DSH** — `npx @deepseek-ai/dsh …`, or a global `dsh` install (`@deepseek-ai/dsh`).
- **Node.js ≥ 18** and **npm/npx** — for the Ghost and Helm toolchain scripts and for `npx gscan`.
- **Ghost 6.x + `gscan`** — only for the two Ghost theme skills.
- **Helm 3+** — only for `helm-chart-development`. No cluster or network needed;
  `scripts/verify-chart.mjs` shells out to `helm lint` and `helm template`.
- **Docker Engine** with a reachable daemon — only for the `flaresolverr` plugin and its
  `flaresolverr-workspace` skill. The plugin creates containers, networks, and loopback-only
  published ports, so the daemon must be running and the user must be able to reach the socket.
  Missing CLI, a stopped daemon, and a permission error are each detected and reported with the
  specific fix.
- **`pnpm`** — only when installing DSH plugin packages (`dsh plugin …` forwards to pnpm).

---

## Installing the skills

DSH's filesystem skill provider scans these roots, in precedence order:

| Rank | Root |
|---|---|
| 100 | `<projectRoot>/.dsh/skills` |
| 200 | `<projectRoot>/.agents/skills` |
| 300 | `customSkillDirs` (configured) |
| 400 | `~/.dsh/skills` |
| 500 | `~/.agents/skills` |

`<projectRoot>` is the nearest ancestor containing `.git`.

**This repository's `skills/` directory is not one of those roots**, so cloning alone does not register anything. Pick one of the options below.

### Option A — `install.sh` (recommended)

```bash
./install.sh                                   # all skills -> ~/.dsh/skills
./install.sh --project /path/to/your/project   # -> <project>/.dsh/skills (rank 100)
./install.sh ghost-theme-development \         # only a subset
             ghost-theme-modern-frontend
./install.sh --dry-run                         # show what would change
./install.sh --uninstall                       # detach again
```

It links each skill by symlink, skips anything that is not a managed link, and refuses to overwrite real files. After installing into the user root, restart DSH so the catalog is rebuilt.

### Option B — manual symlinks

```bash
# into a project (rank 100)
PROJECT=/path/to/your/project
mkdir -p "$PROJECT/.dsh/skills"
for d in skills/*/; do
  [ -f "${d}SKILL.md" ] || continue
  ln -sfn "$PWD/${d%/}" "$PROJECT/.dsh/skills/$(basename "$d")"
done

# or into the user root (rank 400), available from every project
mkdir -p ~/.dsh/skills
for d in "$PWD"/skills/*/; do
  [ -f "${d}SKILL.md" ] || continue
  ln -sfn "${d%/}" ~/.dsh/skills/
done
```

### Option C — configure `customSkillDirs`

Point the filesystem provider at this repository's `skills/` directory in your profile's `cordis.patch.yml`:

```yaml
- name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - /absolute/path/to/dsh-plugins/skills
```

The provider watches roots, so new, renamed, or deleted skills appear without restarting DSH. **Restart DSH** after changing `customSkillDirs` itself, since that is plugin configuration.

### Using a skill

- **Model-invoked** — skills with `modelInvocable` appear in the session catalog; the agent calls the `skill` tool with the exact kebab-case name before acting.
- **User-invoked** — type `/` in the composer and pick a skill, or type `/software-architecture` directly.

`install.sh` deliberately skips `docs/ghost-themes.md` and any `_`- or `.`-prefixed entry, so repository documentation is never registered as a skill.

---

## Quick start — Ghost theme toolchain

`scaffold-theme.mjs` generates a GScan-clean theme wired for Vite, optional Tailwind, and optional React islands. It needs only plain Node ≥ 18.

```bash
# Scaffold a Vite + Tailwind + React-islands theme
node skills/ghost-theme-modern-frontend/scripts/scaffold-theme.mjs \
  --name my-theme --out ./themes --react

cd themes/my-theme
npm install
npm run build
npm test          # build + GScan

# Fuller pre-flight: build → GScan → zip → archive assertions
bash "$OLDPWD/skills/ghost-theme-modern-frontend/scripts/verify-theme.sh" .
```

```bash
node skills/ghost-theme-modern-frontend/scripts/scaffold-theme.mjs --help
```

Flags: `--name`, `--out`, `--react`, `--no-tailwind`, `--force`.

---

## Quick start — FlareSolverr workspace

`flaresolverr` gives a session a disposable, loopback-only FlareSolverr container. FlareSolverr has
**no authentication**, so the plugin publishes it on `127.0.0.1` only, on a kernel-assigned port,
and tears it down with the session.

```bash
dsh plugin --profile web add plugins/flaresolverr
dsh --profile web --dump-config          # the flaresolverr row is present
```

Then in a session:

```
flaresolverr action=start
flaresolverr action=request cmd=request.get url="https://protected.example/" disableMedia=true
flaresolverr action=stop
```

The result carries `solution.cookies` **and** `solution.userAgent`. A Cloudflare clearance cookie
only works for the User-Agent that earned it — reuse `solution.userAgent` verbatim downstream, or
the challenge reappears.

Prove the whole path (Docker, pull, start, `/health`, loopback-only, `request.get`, teardown, and
the assertion that nothing leaked):

```bash
bash skills/flaresolverr-workspace/scripts/verify-workspace.sh
bash skills/flaresolverr-workspace/scripts/verify-workspace.sh --help
```

---

## Authoring a skill

Create `skills/<kebab-case-name>/SKILL.md` (directory bundle) or `skills/<kebab-case-name>.md` (flat file). A directory bundle may include any supporting files; nested `**/SKILL.md` files are **not** discovered.

Frontmatter:

```yaml
---
name: my-skill                     # required — must match the kebab-case directory/file name
description: >-                    # required — shown in the catalog, capped (~500 chars)
  One paragraph on what the skill does and when it should trigger.
whenToUse: >-                      # optional — extra routing guidance
  Use when …
metadata:                          # optional, free-form
  author: sredevopsorg
  version: "1.0.0"
disable-model-invocation: false    # optional — keep out of model-facing catalogs
user-invocable: true               # optional — keep out of `/` commands
---
# Skill title

Instructions…
```

Rules the provider enforces:

- `name` and `description` are mandatory; a skill missing either is dropped.
- `*invocable` keys accept YAML booleans and `true/false`, `yes/no`, `on/off`, `1/0`. A rejected spelling drops the **whole skill** with a warning.
- Prefer `disable-model-invocation: true` for human-only workflows and `user-invocable: false` for model-only ones.
- Keep `description` trigger-focused — it is the only thing the model sees before loading the body.

Conventions used in this repo:

- One skill per concern; put long material in `references/` and load it from `SKILL.md`.
- Frontmatter first line, fenced by `---`; no BOM, no leading blank line.
- The `name` must match its directory (or flat-file) name exactly — `scripts/validate-skills.mjs` enforces this.
- Scripts live in `scripts/`, are dependency-light, and document `--help`.
- Cite upstream sources in the body when guidance is derived from official docs.

Run `node scripts/validate-skills.mjs` before committing; see [Verifying](#verifying).

---

## Plugins and tools

A DSH plugin is an npm package that Cordis loads; a **bundle** additionally declares its patch layer:

```json
{
  "name": "@sredevopsorg/dsh-<name>",
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

Install and select it into a profile:

```bash
dsh plugin --profile web add <package-spec>      # pnpm args are forwarded
dsh plugin --profile web list
dsh --profile web --dump-config                   # inspect the composed tree, no boot
```

Conventions this repository follows:

```
plugins/<name>/
├── package.json          # name, license, exports, dsh.bundle.patch
├── cordis.patch.yml      # plugin rows / config
├── index.js              # plugin entry: export apply() / inject / (optional) Config
├── <support>.js          # plain-ESM support modules, imported relatively
├── locale/en.json        # display title + description for management surfaces
├── icon.svg              # optional, referenced by package.json "icon"
└── README.md             # configuration table + observable behavior
```

The first plugin here, [`suggest-resources`](plugins/suggest-resources/README.md), ships plain ESM
with **no dependencies and no build step**. That is deliberate: a workspace-linked plugin cannot
resolve bare `@deepseek-ai/*` specifiers unless its manifest declares them as `peerDependencies`, so
a dependency-free package keeps `dsh plugin add` free of both a toolchain and install-script
approval. Add a build only when a plugin genuinely needs one.

Model-facing tools are registered from a plugin via `ctx.tools`; they should declare a JSON-schema input, fail with actionable messages, and never leak stack traces.

---

## Verifying

```bash
node scripts/validate-skills.mjs            # frontmatter contract; exits 1 on errors
node scripts/validate-skills.mjs --json     # machine-readable results
node scripts/validate-skills.mjs --strict   # warnings become failures
```

`validate-skills.mjs` reproduces the checks DSH's filesystem provider makes at discovery, where a
malformed skill is dropped with only a log line. It enforces the frontmatter contract and flags
nested `SKILL.md` files, duplicate names, unknown keys, and descriptions the catalog will truncate.
[CI](.github/workflows/ci.yml) runs it on every push and pull request.

Beyond the validator:

- `dsh --version` matches the peer range you target.
- Start a session and confirm the skill appears in the catalog (`/` in the composer lists user-invocable skills).
- Load it once by exact name to confirm the body parses and the resource paths resolve.
- For plugins: `dsh --profile <name> --dump-config` composes without booting.
- For the plugin in this repository: install it with `dsh plugin --profile <name> add plugins/suggest-resources`, confirm `suggest_resources` appears in the tool list, then disable the bundle and confirm it disappears — that proves the registration belongs to the plugin's context.
- For FlareSolverr: `bash skills/flaresolverr-workspace/scripts/verify-workspace.sh` proves the workspace path end to end and asserts no container or network is left behind.
- For Ghost themes: `bash skills/ghost-theme-modern-frontend/scripts/verify-theme.sh <theme-dir>`.

---

## Contributing

1. Branch from `main`; keep one concern per branch.
2. Add or update the skill/plugin **and** this README's catalog table in the same change.
3. Run `node scripts/validate-skills.mjs` — CI runs it too, and a malformed skill is invisible until discovery.
4. Verify the skill loads in a real DSH session (frontmatter errors are only visible at discovery).
5. Keep shell scripts `shellcheck`-clean and preserve their executable bits.
6. Never commit secrets, tokens, personal paths, or session data.

---

## Provenance and license

Released under the [MIT License](LICENSE). Third-party attribution is listed in
[NOTICE.md](NOTICE.md).

- `supabase` and `supabase-postgres-best-practices` are derived from Supabase's published agent skills (MIT). Metadata is preserved in each `SKILL.md`.
- `ghost-theme-development` and `ghost-theme-modern-frontend` are grounded in the official `docs.ghost.org` documentation and the MIT-licensed community reference theme [christopher-b/vapour](https://github.com/christopher-b/vapour).
- `helm-chart-development` is grounded in the official Helm documentation — the [Chart Template Developer's Guide](https://helm.sh/docs/chart_template_guide/), [Charts](https://helm.sh/docs/topics/charts/), [Best Practices](https://helm.sh/docs/chart_best_practices/) and [Hooks](https://helm.sh/docs/topics/charts_hooks/) — which is published under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Examples and function signatures were verified against Helm 4.3.
