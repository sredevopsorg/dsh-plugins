# DSH Plugins

Custom **skills and plugins** for [DeepSeek Harness (DSH)](https://github.com/sredevopsorg), maintained by [sredevopsorg](https://github.com/sredevopsorg).

The repository publishes two things:

- **Skills** — `SKILL.md` instruction bundles packaged by the **skills plugin** under [`plugins/skills/skills/`](plugins/skills/skills/). Install that one plugin and every skill is registered; [`install.sh`](install.sh) remains a legacy/manual symlink alternative.
- **DSH plugins** — self-contained bundles under [`plugins/`](plugins/), installed from this repository's release tags **or** browsed from the repository's [plugin market index](#the-plugin-index-discover).

| Kind | What it is | Where it lives here |
|---|---|---|
| **Skill** | A `SKILL.md` (or flat `<name>.md`) instruction bundle loaded on demand by the model or with `/name`. Skills are packaged and served by a DSH skill-provider plugin. | [`plugins/skills/skills/`](plugins/skills/skills/) |
| **Plugin** | A Cordis plugin package loaded into a DSH profile (`dsh plugin …`). | [`plugins/`](plugins/) |
| **Tool** | A model-facing tool registered by a plugin via `ctx.tools`, shipped inside a plugin package. | [`plugins/entire/`](plugins/entire/) |

The repository also publishes [`index.json`](index.json), a **format-1 plugin market index** that [@deepseek-ai/dsh-experimental-plugin-market-bundle](https://github.com/deepseek-ai/deepseek-harness) reads in the Web **Plugins → Discover** tab.

> Verified against `@deepseek-ai/dsh` **0.2.x**, currently **`0.2.2-rc.1`**. The CLI version gate is strict, so check `dsh --version` before reporting plugin issues. Bundle patches are checked against the installed DSH by `scripts/validate-bundles.mjs`.

---

## Contents

### Skills

All nine skills ship in the single [`skills`](plugins/skills/README.md) plugin. Install it
(see [Installing the skills](#installing-the-skills)) and the catalog lists every row below.

| Skill | Surface | Use it for |
|---|---|---|
| [`software-architecture`](plugins/skills/skills/software-architecture/SKILL.md) | model + user | Choosing the simplest sufficient design, patterns to apply or skip, engineering practices, tool/skill selection |
| [`fullstack-development`](plugins/skills/skills/fullstack-development/SKILL.md) | model + user | Container-based Python and Node.js/TypeScript backends, frontends, monorepos, Docker, e2e testing |
| [`supabase`](plugins/skills/skills/supabase/SKILL.md) | model + user | Anything touching Supabase: DB, Auth, Edge Functions, Realtime, Storage, CLI, MCP, logs, debugging |
| [`supabase-postgres-best-practices`](plugins/skills/skills/supabase-postgres-best-practices/SKILL.md) | model + user | Postgres schema, migrations, RLS, indexes, locking, query plans — load *before* touching a database |
| [`ghost-theme-development`](plugins/skills/skills/ghost-theme-development/SKILL.md) | model + user | Authoring Ghost Handlebars themes: templates, contexts, helpers, settings, routing, GScan |
| [`ghost-theme-modern-frontend`](plugins/skills/skills/ghost-theme-modern-frontend/SKILL.md) | model + user | Wiring a Ghost theme to Vite, Tailwind CSS, and React/Vue/Svelte islands |
| [`helm-chart-development`](plugins/skills/skills/helm-chart-development/SKILL.md) | model + user | Creating, editing and improving Helm charts: templates, values.yaml, helpers, hooks, CRDs, subcharts |
| [`kubernetes-kubectl-operations`](plugins/skills/skills/kubernetes-kubectl-operations/SKILL.md) | model + user | Safe kubectl operations, cluster triage, and opt-in Kubernetes MCP inspection |
| [`github-actions-security-audit`](plugins/skills/skills/github-actions-security-audit/SKILL.md) | model + user | Auditing and hardening GitHub Actions workflows: token permissions, script injection, `pull_request_target`, action pinning, runners, supply chain |

### Plugins and tools

| Plugin | Kind | Use it for |
|---|---|---|
| [`code-editor`](plugins/code-editor/README.md) | bundle + web editor | Browsing a Session's workspace and editing UTF-8 files from a right-sidebar tab, with sandbox-aware saves and optimistic conflict detection |
| [`entire`](plugins/entire/README.md) | bundle + tool | Reading Entire sessions, checkpoints, search, trails, and code history, plus capturing DSH sessions as Entire checkpoints |
| [`peak-rate-footer`](plugins/peak-rate-footer/README.md) | bundle + web footer | A green/orange footer showing whether DeepSeek API usage is currently billed at peak or off-peak rates, with a local clock, next-change countdown, and in-footer time-zone picker |
| [`skills`](plugins/skills/README.md) | bundle + 9 skills | Installing every skill in this repository as one plugin: a packaged skill provider serving the architecture, fullstack, Supabase/Postgres, Ghost theme, Helm, Kubernetes, and GitHub Actions skills |
| [`superagent`](plugins/superagent/README.md) | bundle + web panel | A vendored fork of DeepSeek Harness's `dsh-superagent` research prototype: a proactive agent for one GitHub repository (optionally Feishu) that runs tickets in their own DSH sessions and answers in the original conversation |

---

## Repository layout

```
.
├── README.md
├── LICENSE
├── NOTICE.md                              # third-party attribution
├── index.json                             # published format-1 plugin market index
├── install.sh                             # legacy/manual: symlink packaged skills into a DSH skill root
├── .shellcheckrc
├── scripts/
│   ├── validate-skills.mjs                # frontmatter + packaging contract check (CI)
│   ├── validate-bundles.mjs               # bundle/patch compatibility check (CI)
│   ├── validate-github-install.mjs        # GitHub install metadata + tarball check (CI)
│   ├── validate-market-index.mjs          # plugin index format and pinning check (CI)
│   ├── build-market-index.mjs             # regenerate index.json from release tags
│   └── release-tag.mjs                    # validate and tag one plugin release
├── .github/
│   ├── CODEOWNERS                         # review gate for workflow changes
│   ├── dependabot.yml                     # weekly GitHub Actions pin updates
│   └── workflows/
│       ├── ci.yml
│       ├── compat-canary.yml
│       ├── release.yml                    # tag-driven release + index update PR
│       └── version-plugins.yml            # tag merged plugin versions, dispatch releases
├── docs/
│   ├── ghost-themes.md                    # repo doc — NOT a skill
│   ├── entire-dsh-audit.md                # root-cause audit of the Entire/DSH capture automation
│   ├── installing-plugins-from-github.md  # install addresses, pinning, troubleshooting
│   └── plugin-index.md                    # publishing and maintaining index.json
└── plugins/
    ├── code-editor/
    │   ├── package.json                   # name, license, exports, dsh.bundle.patch
    │   ├── cordis.patch.yml               # inserts the authenticated write-endpoint row
    │   ├── index.js                       # Host route: auth, workspace containment, version guard
    │   ├── client.js                      # browser bundle: right-sidebar file browser and editor
    │   ├── test/                          # host route and packaging tests (node --test)
    │   ├── locale/en.json, locale/es.json
    │   ├── icon.svg
    │   └── README.md
    ├── entire/
    │   ├── package.json                   # name, license, exports, dsh.bundle.patch
    │   ├── cordis.patch.yml               # the plugin row + capture defaults
    │   ├── index.js                       # tools, approval policy, prompt section, bridge wiring
    │   ├── lib/                           # commands, policy, exec, config, text, session bridge
    │   ├── test/                          # unit tests (node --test)
    │   ├── locale/en.json
    │   ├── icon.svg
    │   └── README.md
    ├── peak-rate-footer/
    │   ├── package.json                   # name, license, exports, dsh.bundle.patch, dsh.client
    │   ├── cordis.patch.yml               # inserts the Host row whose Client half fills shell.bottom
    │   ├── index.js                       # empty Host half; the Client module owns rendering
    │   ├── client.js                      # schedule, holiday data, local clock, time-zone picker
    │   ├── test/schedule.test.mjs         # peak/holiday/transition/time-zone tests (node --test)
    │   ├── locale/en.json, locale/es.json, locale/zh.json
    │   ├── icon.svg
    │   └── README.md
    ├── superagent/                        # vendored fork of deepseek-ai/dsh-superagent-prototype
    │   ├── package.json                   # @sredevopsorg/dsh-superagent, build + bundle patch
    │   ├── cordis.patch.yml               # plugin rows and worker/router agent presets
    │   ├── src/                           # TypeScript source (91 modules)
    │   ├── tests/                         # vitest suites
    │   ├── lib/                           # committed build output — what a Git install ships
    │   ├── prompts/, skills/, docs/       # executor prompts, its own two skills, numbered docs
    │   ├── locale/en.json, icon.svg, NOTICE.md, LICENSE
    │   └── README.md
    └── skills/
        ├── package.json                   # name, license, exports, dsh.bundle.patch, files: skills
        ├── cordis.patch.yml               # inserts the host-wide skill-provider row
        ├── index.js                       # provider: discovers/parses/serves packaged skills
        ├── test/skills.test.mjs           # provider + frontmatter tests (node --test)
        ├── locale/en.json
        ├── icon.svg
        ├── README.md
        └── skills/                        # the 9 packaged skills — add new skills here
            ├── software-architecture/SKILL.md
            ├── fullstack-development/SKILL.md
            ├── supabase/{SKILL.md,references/,assets/}
            ├── supabase-postgres-best-practices/{SKILL.md,references/}
            ├── ghost-theme-development/{SKILL.md,references/}
            ├── ghost-theme-modern-frontend/{SKILL.md,references/,scripts/}
            ├── kubernetes-kubectl-operations/{SKILL.md,references/,scripts/}
            ├── helm-chart-development/{SKILL.md,references/,scripts/}
            └── github-actions-security-audit/SKILL.md
```

A skill directory may carry any supporting files — `references/`, `scripts/`, `assets/` — because the whole directory is the skill's resource base. That directory is also what `npm pack` ships: a repository skill outside `plugins/skills/skills` is not installable and fails [`scripts/validate-skills.mjs`](scripts/validate-skills.mjs).

---

## Requirements

- **DSH** — `npx @deepseek-ai/dsh …`, or a global `dsh` install (`@deepseek-ai/dsh`). The Discover flow additionally needs the experimental **Custom plugin indexes** bundle (`@deepseek-ai/dsh-experimental-plugin-market-bundle`), enabled from the Web Plugins page.
- **Node.js ≥ 18** and **npm/npx** — for the Ghost and Helm toolchain scripts, `npx gscan`, and the optional Kubernetes MCP server (`npx -y kubernetes-mcp-server@latest`).
- **Ghost 6.x + `gscan`** — only for the two Ghost theme skills.
- **Helm 3+** — only for `helm-chart-development`. No cluster or network needed;
  `scripts/verify-chart.mjs` shells out to `helm lint` and `helm template`.
- **`kubectl` + a kubeconfig** — only for `kubernetes-kubectl-operations`. The skill
  inspects and, with explicit confirmation, changes a cluster;
  `scripts/verify-kube-access.sh` is a read-only preflight and accepts
  `--kubeconfig <path>`. Set `KUBERNETES_MCP_KUBECONFIG` to an absolute path for a
  dedicated, preferably read-only kubeconfig; when the optional Kubernetes MCP row is
  enabled, it passes that value to the server as `KUBECONFIG`. Without it, the server
  uses `KUBECONFIG` or `~/.kube/config`.
- **Entire CLI** (`entire`) on `PATH` — only for the `entire` plugin. It records agent sessions and
  checkpoints and backs every tool; session capture additionally needs the `entire-agent-dsh`
  binary and `entire agent add dsh` in the target repository. Search, trails, and recap also need
  an authenticated login and OS keyring access.
- **`git`** and **`pnpm` 9 or newer** — only when installing DSH plugin packages from this
  repository (`dsh plugin …` forwards to pnpm; `path:` subdirectory installs need pnpm 9).
  No npm publish is involved. `superagent` also fetches its two runtime dependencies
  (`zod`, `proper-lockfile`) from the npm registry.
- **A DSH Web profile** — only for the Web plugins: the built-in right Sidebar for
  `code-editor`, whose browser bundle contributes a right-sidebar tab and whose Host half
  serves the browser-only workspace write endpoint, and the built-in bottom frame seat for
  `peak-rate-footer`, whose Client module contributes the rate-status footer.
- **Node.js 22.19+ or 24+, `git`, GitHub CLI 2.48+, `tmux`, and Python 3.8+** — only for the
  [`superagent`](plugins/superagent/README.md) fork, whose managed-service script and
  executor sessions need them. It requires a Web profile (the management panel is a web
  plugin) and its own `stateDir` configuration; `SETUP.md` in the plugin drives the
  deployment. Its optional session capture additionally needs the `entire` plugin in the
  same profile and `entire agent add dsh` in the target repository — see
  [`docs/entire-dsh-audit.md`](docs/entire-dsh-audit.md) for the current root causes.

---

## Installing the skills

Every skill is packaged in one plugin, [`plugins/skills`](plugins/skills/README.md). Its
bundle patch inserts one host-wide row, and that row registers a skill provider on
`ctx.skills` that discovers and serves the packaged `plugins/skills/skills/` directory.
Installing the plugin is the supported path: no filesystem root to configure and no
per-skill symlink to maintain.

### Option A — install the skills plugin (recommended)

From this local checkout:

```bash
dsh plugin --profile web add ./plugins/skills
```

Or from the pinned GitHub release (the tag is immutable, so the contents are reproducible;
quote the `&` or the shell will split it):

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#skills-v0.1.0&path:/plugins/skills"
```

Or add the repository's [plugin index](#the-plugin-index-discover) source once and install
the version from the **Discover** card. `dsh --profile web list` shows the installed
package and `dsh --profile web --dump-config` composes the tree without booting. Restart a
running DSH after installing; the skill catalog is built at startup.

The packaged provider uses the standard bundled rank `600` and `source: bundled`. A
project-local or user filesystem root still wins duplicate-name precedence (ranks 100–500),
so a project can override a packaged skill of the same name.

### Option B — `install.sh` (legacy/manual alternative)

For setups that cannot install a plugin, [`install.sh`](install.sh) links the same packaged
skills from `plugins/skills/skills/` into a DSH filesystem root:

```bash
./install.sh                                   # all skills -> ~/.dsh/skills
./install.sh --project /path/to/your/project   # -> <project>/.dsh/skills (rank 100)
./install.sh ghost-theme-development \         # only a subset
             ghost-theme-modern-frontend
./install.sh --dry-run                         # show what would change
./install.sh --uninstall                       # detach again
```

It links each skill by symlink, skips anything that is not a managed link, and refuses to
overwrite real files. After installing into the user root, restart DSH so the catalog is
rebuilt. A user-root link has rank 400, which beats the packaged provider's rank 600, so
`--uninstall` hands a skill back to the plugin.

### Option C — manual symlinks

```bash
# into a project (rank 100)
PROJECT=/path/to/your/project
mkdir -p "$PROJECT/.dsh/skills"
for d in plugins/skills/skills/*/; do
  [ -f "${d}SKILL.md" ] || continue
  ln -sfn "$PWD/${d%/}" "$PROJECT/.dsh/skills/$(basename "$d")"
done

# or into the user root (rank 400), available from every project
mkdir -p ~/.dsh/skills
for d in "$PWD"/plugins/skills/skills/*/; do
  [ -f "${d}SKILL.md" ] || continue
  ln -sfn "${d%/}" ~/.dsh/skills/
done
```

### Option D — configure `customSkillDirs`

Point the filesystem provider at the packaged skills directory in your profile's
`cordis.patch.yml`:

```yaml
- name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - /absolute/path/to/dsh-plugins/plugins/skills/skills
```

The provider watches roots, so new, renamed, or deleted skills appear without restarting
DSH. **Restart DSH** after changing `customSkillDirs` itself, since that is plugin
configuration.

### Using a skill

- **Model-invoked** — skills with `modelInvocable` appear in the session catalog; the agent calls the `skill` tool with the exact kebab-case name before acting.
- **User-invoked** — type `/` in the composer and pick a skill, or type `/software-architecture` directly.

`install.sh` deliberately skips `docs/ghost-themes.md` and any `_`- or `.`-prefixed entry, so repository documentation is never registered as a skill.

---

## Installing plugins

Every plugin under [`plugins/`](plugins/) ships as a self-contained DSH bundle (two are
no-toolchain plain ESM; the forked `superagent` commits its build output). Two install paths
resolve to the same package:

### From Discover (plugin index)

Add the repository's index once; **Discover** then lists every published plugin version and
installs it after confirmation:

1. Open **Plugins** in the Web sidebar and switch on **Custom plugin indexes** under
   **Experimental plugins**.
2. Select **Discover → Add index source** and enter:

   ```
   https://raw.githubusercontent.com/sredevopsorg/dsh-plugins/main/index.json
   ```

3. Pick a plugin and version and confirm the install. Each entry pins its exact Git commit.

The index and its maintenance are documented in [`docs/plugin-index.md`](docs/plugin-index.md).

### From a pinned GitHub release tag

The same package installs with pnpm's Git subdirectory parameter, pinned to an immutable
release tag:

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#entire-v0.2.0&path:/plugins/entire"
```

Quote the spec: the shell must not interpret `&`. Replace `web` with your profile.
`dsh --profile web list` shows the installed package, and
`dsh --profile web --dump-config` composes the tree without booting.

Requirements, full-URL and commit-pinned variants, update/uninstall commands,
and troubleshooting are in
[`docs/installing-plugins-from-github.md`](docs/installing-plugins-from-github.md).
For local development, install a checkout instead:
`dsh plugin --profile web add ./plugins/entire`.

---

## Quick start — Ghost theme toolchain

`scaffold-theme.mjs` generates a GScan-clean theme wired for Vite, optional Tailwind, and optional React islands. It needs only plain Node ≥ 18.

```bash
# Scaffold a Vite + Tailwind + React-islands theme
node plugins/skills/skills/ghost-theme-modern-frontend/scripts/scaffold-theme.mjs \
  --name my-theme --out ./themes --react

cd themes/my-theme
npm install
npm run build
npm test          # build + GScan

# Fuller pre-flight: build → GScan → zip → archive assertions
bash "$OLDPWD/plugins/skills/skills/ghost-theme-modern-frontend/scripts/verify-theme.sh" .
```

```bash
node plugins/skills/skills/ghost-theme-modern-frontend/scripts/scaffold-theme.mjs --help
```

Flags: `--name`, `--out`, `--react`, `--no-tailwind`, `--force`.

---

## Authoring a skill

Create `plugins/skills/skills/<kebab-case-name>/SKILL.md` (directory bundle) or `plugins/skills/skills/<kebab-case-name>.md` (flat file). A directory bundle may include any supporting files; nested `**/SKILL.md` files are **not** discovered.

Skills **must** live inside the packaged plugin. `scripts/validate-skills.mjs` fails when a
`SKILL.md` exists anywhere outside `plugins/skills/skills` (including a resurrected
top-level `skills/`), when the package manifest does not ship the skills directory, when
`npm pack --dry-run` would omit a packaged skill file, or when two skills share a name.
That is what keeps "every new or edited skill" inside the single installable plugin.

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

Rules the skill provider enforces (identical to `@deepseek-ai/dsh-skill-filesystem` and the packaged provider in `plugins/skills/index.js`):

- `name` and `description` are mandatory; a skill missing either is dropped.
- `*invocable` keys accept YAML booleans and `true/false`, `yes/no`, `on/off`, `1/0`. A rejected spelling drops the **whole skill** with a warning.
- Prefer `disable-model-invocation: true` for human-only workflows and `user-invocable: false` for model-only ones.
- Keep `description` trigger-focused — it is the only thing the model sees before loading the body.

Conventions used in this repo:

- One skill per concern; put long material in `references/` and load it from `SKILL.md`.
- Frontmatter first line, fenced by `---`; no BOM, no leading blank line.
- The `name` must match its directory (or flat-file) name exactly — `scripts/validate-skills.mjs` enforces this.
- Skills live only in `plugins/skills/skills/`; the packaged provider serves them, so there is nothing to copy or symlink.
- Scripts live in `scripts/`, are dependency-light, and document `--help`.
- Cite upstream sources in the body when guidance is derived from official docs.

After adding or editing a skill, run `node scripts/validate-skills.mjs` and
`cd plugins/skills && npm test` before committing; see [Verifying](#verifying).

---

## Plugins and tools

A DSH plugin is an npm package that Cordis loads; a **bundle** additionally declares its patch layer:

```json
{
  "name": "@sredevopsorg/dsh-<name>",
  "type": "module",
  "exports": { ".": "./index.js" },
  "engines": { "dsh": "^0.2.1-rc.2" },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

`engines.dsh` is the compatibility gate the installer, the market index, and the launcher enforce; omit it and an unsupported DSH version installs silently and fails later at activation. A bundle that only adds configuration needs no `index.js` or `.` export — declare the patch, plus `./package.json`, `./locale/*.json`, and `./icon.svg` for management and market display.

Install and select it into a profile — from Discover, from GitHub with a pinned release tag, or from a local checkout while developing:

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#code-editor-v0.1.0&path:/plugins/code-editor"
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#entire-v0.2.0&path:/plugins/entire"
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#peak-rate-footer-v0.1.0&path:/plugins/peak-rate-footer"
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#skills-v0.1.0&path:/plugins/skills"
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#superagent-v0.1.2&path:/plugins/superagent"
dsh plugin --profile web add ./plugins/code-editor # local checkout
dsh plugin --profile web add ./plugins/entire   # local checkout
dsh plugin --profile web add ./plugins/peak-rate-footer # local checkout
dsh plugin --profile web list
dsh --profile web --dump-config                 # inspect the composed tree, no boot
```

`dsh plugin` forwards its arguments to pnpm. See
[Installing plugins from GitHub](docs/installing-plugins-from-github.md) for the
tag scheme, pinning, and troubleshooting, and [Publishing the plugin index](docs/plugin-index.md)
for how a released version reaches Discover.

Conventions this repository follows:

```
plugins/<name>/
├── package.json          # name, license, engines.dsh, exports, dsh.bundle.patch
├── cordis.patch.yml      # plugin rows / config
├── index.js              # plugin entry: export apply() / inject / (optional) Config
├── <support>.js          # plain-ESM support modules, imported relatively
├── locale/en.json        # display title + description for management and market surfaces
├── icon.svg              # optional, referenced by package.json "icon"
├── test/                 # unit tests where the plugin has logic to test
└── README.md             # configuration table + observable behavior
```

[`entire`](plugins/entire/README.md) and [`skills`](plugins/skills/README.md) ship plain ESM
with **no dependencies and no build step**. That is deliberate: a workspace-linked plugin
cannot resolve bare `@deepseek-ai/*` specifiers unless its manifest declares them as
`peerDependencies`, so a dependency-free package keeps `dsh plugin add` free of both a
toolchain and install-script approval.

[`superagent`](plugins/superagent/README.md) is the deliberate exception: it is a vendored
fork of an upstream TypeScript project, so it keeps that project's `tsdown` build and
`vitest` suites for development. Its **built `lib/` is committed**, which keeps the Git
install toolchain-free (no build or lifecycle script runs when pnpm fetches it); CI
rebuilds it and fails when the committed output drifts from the source. Its importable
surfaces resolve inside its own package, and its bundle rows name the package itself, so
the plugin loads from a profile like any other bundle.

The [`skills`](plugins/skills/README.md) bundle is the packaging pattern for skills: its
`cordis.patch.yml` inserts one host-wide row, `index.js` registers a provider via
`ctx.skills.registerProvider`, and the Markdown skill bundles ship inside the npm package
unchanged. The provider uses the literal bundled rank `600` (`BUNDLED_SKILL_RANK`) instead
of importing `@deepseek-ai/dsh-skill`, precisely so the package stays dependency-free; see
the plugin README for the trade-off.

Model-facing tools are registered from a plugin via `ctx.tools`; they should declare a JSON-schema input, fail with actionable messages, and never leak stack traces.

---

## The plugin index (Discover)

[`index.json`](index.json) is a **format-1 plugin market index**. It lists each published
plugin version with its display metadata and an exact install source pinned to the
release-tag commit, so the experimental **Custom plugin indexes** bundle can browse and
install this repository's plugins without npm publishing.

```json
{
  "format": 1,
  "title": { "en": "sredevopsorg DSH plugins" },
  "plugins": [
    {
      "name": "@sredevopsorg/dsh-entire",
      "versions": [
        {
          "version": "0.2.0",
          "publishTimestamp": 1793651934,
          "source": {
            "type": "git",
            "url": "https://github.com/sredevopsorg/dsh-plugins",
            "commit": "<40-hex commit of the entire-v0.2.0 tag>",
            "path": "plugins/entire"
          },
          "engines": { "dsh": "^0.2.1-rc.2" }
        }
      ]
    }
  ]
}
```

`index.json` is generated from the package manifests and Git release tags; do not edit it
by hand:

```bash
node scripts/build-market-index.mjs          # regenerate index.json
node scripts/build-market-index.mjs --check  # fail when it is stale
node scripts/validate-market-index.mjs       # validate format, pins, metadata, freshness
```

The validator resolves `@deepseek-ai/dsh-plugin-market-index` from your DSH installation
(`--dsh-root <node_modules/@deepseek-ai>` or `DSH_INSTALL`). Release tags must be present:
use a full clone (`git fetch --tags`), as CI does.

Every merged version bump is tagged by
[`version-plugins.yml`](.github/workflows/version-plugins.yml), which then runs
[`release.yml`](.github/workflows/release.yml) for each new tag; the release workflow
creates the GitHub release and opens a pull request that republishes `index.json` with the
new version. See [`docs/plugin-index.md`](docs/plugin-index.md) for the full workflow.

---

## Verifying

```bash
node scripts/validate-skills.mjs            # frontmatter + packaging; exits 1 on errors
node scripts/validate-skills.mjs --json     # machine-readable results
node scripts/validate-skills.mjs --strict   # warnings become failures
node scripts/validate-skills.mjs --no-pack  # skip the npm pack contents check

node scripts/validate-bundles.mjs           # bundle compatibility with the installed DSH
node scripts/validate-bundles.mjs --strict  # drift and metadata warnings become failures
node scripts/validate-bundles.mjs --json    # machine-readable results

node scripts/validate-github-install.mjs        # GitHub install metadata + npm pack contents
node scripts/validate-github-install.mjs --strict
node scripts/validate-github-install.mjs --json
node scripts/validate-github-install.mjs --tag entire-v0.2.0   # release-tag check
node scripts/validate-github-install.mjs --tag skills-v0.1.0   # skills plugin release tag
node scripts/validate-github-install.mjs --tag superagent-v0.1.2 # superagent release tag

node scripts/build-market-index.mjs --check     # index.json matches the release tags
node scripts/validate-market-index.mjs          # index format, pins, metadata, freshness
node scripts/validate-market-index.mjs --strict # unlisted release tags become failures
```

Plugin package checks run from inside each package:

```bash
(cd plugins/code-editor && npm test) # host route + packaging tests (node --test)

(cd plugins/skills && npm test)      # provider + frontmatter tests (node --test)

(cd plugins/superagent && pnpm install --frozen-lockfile && pnpm check)
# `pnpm check` = typecheck + vitest + tsdown build; CI additionally fails when the
# committed lib/ differs from a fresh build.
```

`validate-skills.mjs` reproduces the checks DSH's filesystem provider makes at discovery, where a malformed skill is dropped with only a log line. It enforces the frontmatter contract and flags nested `SKILL.md` files, duplicate names, unknown keys, and descriptions the catalog will truncate. It also enforces the packaging rule: every repository skill's `SKILL.md` must live under `plugins/skills/skills` — another plugin package may vendor its own `plugins/<name>/skills/` assets, but nothing else may contain a `SKILL.md`; `plugins/skills/package.json` must ship the skills directory, and `npm pack --dry-run` must include every packaged skill file (`--no-pack` skips only the last check).

`validate-bundles.mjs` parses every `plugins/*/cordis.patch.yml`, resolves each referenced package and subpath from the installed DSH, validates each row's `Config` against the live schema, and checks `engines.dsh`. It resolves `yaml` and `semver` from the DSH installation, so this repository stays dependency-free. Pass `--dsh-root <path-to-node_modules/@deepseek-ai>` when `dsh` is not the one on `PATH`.

`validate-github-install.mjs` checks the packaging contract behind the GitHub addresses: repository metadata, self-contained manifests (no workspace/file dependencies or install scripts), export targets, `npm pack --dry-run` contents, the pinned docs commands, and the release tag against the package version. It needs only Node and npm, so it runs without a DSH installation. `--tag` is the mode used by the release workflow.

`validate-market-index.mjs` validates `index.json` against the DSH installation's format-1 validator, checks that every listed version is a release tag pinned to its commit, committer time, name, version, and `engines.dsh`, and fails when the file differs from `build-market-index.mjs` output. It treats a not-yet-published release tag as a warning: the release workflow opens the index update. Use a full checkout with tags (`fetch-depth: 0`), as CI does.

[CI](.github/workflows/ci.yml) runs all four validators, installs the plugins that have a lockfile, rebuilds `superagent` and fails when its committed `lib/` drifts, and runs the plugin unit tests on every branch push and pull request; a weekly compatibility run repeats the strict bundle and index validators against the pinned DSH release; [`version-plugins.yml`](.github/workflows/version-plugins.yml) tags merged versions and dispatches [`release.yml`](.github/workflows/release.yml). Every workflow installs and verifies `@deepseek-ai/dsh@0.2.2-rc.1`, pins third-party actions to full commit SHAs, and grants write permissions only to the job that needs them. Dependabot keeps the action pins current, and CODEOWNERS asks the maintainer to review workflow changes.

Beyond the validators:

- `dsh --version` matches the peer range you target.
- Start a session and confirm the skill appears in the catalog (`/` in the composer lists user-invocable skills).
- Load it once by exact name to confirm the body parses and the resource paths resolve.
- For plugins: `dsh --profile <name> --dump-config` composes without booting.
- For the `entire` plugin: install it (from Discover or the pinned GitHub spec above), confirm
  `entire` appears in the tool list, then disable the bundle and confirm it disappears —
  that proves the registration belongs to the plugin's context. The plugin README has the
  full verification checklist.
- For the `superagent` plugin: install it into a scratch profile, run
  `dsh --profile <name> --dump-config` and confirm the `dsh-superagent` row and both presets
  compose; then start DSH, open the **Superagent** sidebar entry, and save a `stateDir` if
  setup asks for it. `cd plugins/superagent && pnpm check` runs the typecheck, test suites
  and build. Its deployment, Feishu setup and capture caveats are in its README, `SETUP.md`
  and [`docs/entire-dsh-audit.md`](docs/entire-dsh-audit.md).
- For the `code-editor` plugin: install it into a scratch Web profile, open the right Sidebar
  guide, pick **Code editor**, edit and save a UTF-8 workspace file, and confirm the conflict
  banner after changing that file on disk while an unsaved draft exists.
  `cd plugins/code-editor && npm test` covers the Host route and package contract.
- For the `skills` plugin: install it into a scratch profile, restart/rebuild the catalog,
  and confirm all 9 skills are listed with parsed descriptions; `cd plugins/skills && npm test`
  asserts the same thing without a running DSH. `npm pack --dry-run --json` in
  `plugins/skills` proves the skills ship in the tarball.
- For Kubernetes: `bash plugins/skills/skills/kubernetes-kubectl-operations/scripts/verify-kube-access.sh --kubeconfig "$KUBERNETES_MCP_KUBECONFIG" --require-read-only` is a read-only access preflight; it warns when the context can write, in which case the Kubernetes MCP should not be enabled for exploratory inspection.
- For Ghost themes: `bash plugins/skills/skills/ghost-theme-modern-frontend/scripts/verify-theme.sh <theme-dir>`.
- For the plugin index: add
  `https://raw.githubusercontent.com/sredevopsorg/dsh-plugins/main/index.json` as a Discover
  index source and confirm the listed versions and sources match the release tags.

---

## Contributing

1. Branch from `main`; keep one concern per branch.
2. Add or update the skill/plugin **and** this README's catalog table in the same change.
3. Put new or edited skills in `plugins/skills/skills/` only; `validate-skills.mjs` fails on
   stray `SKILL.md` files and on skills missing from the npm package.
4. Run `node scripts/validate-skills.mjs`, `node scripts/validate-github-install.mjs --strict`,
   `node scripts/validate-bundles.mjs`, and `node scripts/validate-market-index.mjs` — CI runs
   all four plus the plugin tests (`plugins/*/npm test`, including `plugins/skills`).
5. Verify the skill loads in a real DSH session (frontmatter errors are only visible at discovery).
6. Keep shell scripts `shellcheck`-clean and preserve their executable bits.
7. Never commit secrets, tokens, personal paths, or session data.

### Releasing a plugin

Plugin versions are independent, and a release is one annotated tag named
`<plugin-directory>-v<version>`:

1. Bump `version` in `plugins/<dir>/package.json`.
2. Update the install tables in this README (and the plugin README) with the new pinned
   command; `validate-github-install.mjs` fails until both match.
3. Run the validators, commit on `main`, and push.

[`version-plugins.yml`](.github/workflows/version-plugins.yml) then tags every merged plugin
version that has no tag yet and dispatches [`release.yml`](.github/workflows/release.yml),
which revalidates the tag/version pair, creates the GitHub release, and opens a pull request
that republishes [`index.json`](index.json) with the new version. Merge that pull request to
make the version appear in Discover. Never move a published tag — release a new version.

When the versioning workflow is unavailable, tag by hand after the bump merges:

```bash
node scripts/release-tag.mjs --plugin code-editor --push
node scripts/release-tag.mjs --plugin entire --push
node scripts/release-tag.mjs --plugin skills --push
node scripts/release-tag.mjs --plugin superagent --push
```

The tag push starts `release.yml` directly. `superagent` keeps its committed `lib/` in the
tag commit, so the release checkout needs no build step.

---

## Provenance and license

Released under the [MIT License](LICENSE). Third-party attribution is listed in
[NOTICE.md](NOTICE.md).

- `supabase` and `supabase-postgres-best-practices` are derived from Supabase's published agent skills (MIT). Metadata is preserved in each `SKILL.md`.
- `ghost-theme-development` and `ghost-theme-modern-frontend` are grounded in the official `docs.ghost.org` documentation and the MIT-licensed community reference theme [christopher-b/vapour](https://github.com/christopher-b/vapour).
- `helm-chart-development` is grounded in the official Helm documentation — the [Chart Template Developer's Guide](https://helm.sh/docs/chart_template_guide/), [Charts](https://helm.sh/docs/topics/charts/), [Best Practices](https://helm.sh/docs/charts_best_practices/) and [Hooks](https://helm.sh/docs/charts_hooks/) — which is published under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Examples and function signatures were verified against Helm 4.3.
- `github-actions-security-audit` is grounded in GitHub's [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) (GitHub Docs, CC-BY-4.0).
- `kubernetes-kubectl-operations` is grounded in the official Kubernetes documentation at <https://kubernetes.io/docs/> (source: <https://github.com/kubernetes/website>), published under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), and the `containers/kubernetes-mcp-server` documentation (Apache-2.0).
- `plugins/superagent` is a fork of the DeepSeek Harness research prototype [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) (MIT, upstream commit `8c32a9d`). Upstream copyright remains with the DeepSeek Harness Team; the fork's changes are listed in its README and [NOTICE.md](NOTICE.md).
- The nine skills are vendored unchanged inside the [`skills`](plugins/skills/README.md) plugin package; moving them did not change their provenance.
