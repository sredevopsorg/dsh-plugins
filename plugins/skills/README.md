# Skills for DeepSeek Harness

One DSH plugin that installs **every skill maintained in this repository** into a profile
at once. It packages the Markdown skill bundles and registers a host-wide skill provider,
so `dsh plugin add` is the only install step — no symlinks, no `customSkillDirs`, no
copying `SKILL.md` files around.

The plugin is dependency-free plain ESM with no build step and no install scripts: the
files under `skills/` are the exact skills the provider serves.

## Install

Install from this repository (the release tag is immutable, so the command reproduces the
same package contents):

```sh
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#skills-v0.2.0&path:/plugins/skills"
```

Or install from the repository's plugin index, which the Web **Plugins → Discover** tab
reads; add `https://raw.githubusercontent.com/sredevopsorg/dsh-plugins/main/index.json`
as an index source, then install the version from the card. See
[`docs/plugin-index.md`](../../docs/plugin-index.md).

Or install the local checkout while developing:

```sh
dsh plugin --profile web add ./plugins/skills
```

Quote the spec: the shell must not interpret `&`. `dsh plugin` forwards to pnpm; a Git
install needs `git` and pnpm 9 or newer. Restart a running DSH after installing; the skill
catalog is rebuilt at startup.

## What it provides

| Skill | Use it for |
|---|---|
| [`software-architecture`](skills/software-architecture/SKILL.md) | Choosing the simplest sufficient design, patterns to apply or skip, engineering practices, tool/skill selection |
| [`fullstack-development`](skills/fullstack-development/SKILL.md) | Container-based Python and Node.js/TypeScript backends, frontends, monorepos, Docker, e2e testing |
| [`supabase`](skills/supabase/SKILL.md) | Anything touching Supabase: DB, Auth, Edge Functions, Realtime, Storage, CLI, MCP, logs, debugging |
| [`supabase-postgres-best-practices`](skills/supabase-postgres-best-practices/SKILL.md) | Postgres schema, migrations, RLS, indexes, locking, query plans — load *before* touching a database |
| [`ghost-theme-development`](skills/ghost-theme-development/SKILL.md) | Authoring Ghost Handlebars themes: templates, contexts, helpers, settings, routing, GScan |
| [`ghost-theme-modern-frontend`](skills/ghost-theme-modern-frontend/SKILL.md) | Wiring a Ghost theme to Vite, Tailwind CSS, and React/Vue/Svelte islands |
| [`helm-chart-development`](skills/helm-chart-development/SKILL.md) | Creating, editing and improving Helm charts: templates, values.yaml, helpers, hooks, CRDs, subcharts |
| [`kubernetes-kubectl-operations`](skills/kubernetes-kubectl-operations/SKILL.md) | Safe kubectl operations, cluster triage, and opt-in Kubernetes MCP inspection |
| [`kustomize`](skills/kustomize/SKILL.md) | Base/overlay layout, strategic and JSON patches, generators, images, components, replacements, remote bases, rendering for GitOps |
| [`github-actions-security-audit`](skills/github-actions-security-audit/SKILL.md) | Auditing and hardening GitHub Actions workflows: token permissions, script injection, `pull_request_target`, action pinning, runners, supply chain |

Every skill is model- and user-invocable (no `disable-model-invocation` /
`user-invocable: false` in the current frontmatter), so each appears in the session
catalog and under `/` in the composer.

## How it works

`cordis.patch.yml` inserts one host-wide row:

```yaml
- insert:
    - id: skills
      name: '@sredevopsorg/dsh-skills'
```

`index.js` is that row's plugin. Its `apply(ctx)` calls
`ctx.skills.registerProvider(...)`, and the provider:

1. discovers top-level directory bundles (`skills/<name>/SKILL.md`) and flat files
   (`skills/<name>.md`) in the packaged `skills/` directory;
2. parses each frontmatter block with the same contract as
   `@deepseek-ai/dsh-skill-filesystem` — `name` (kebab-case, matching the directory or
   file), `description`, optional `whenToUse`, optional `disable-model-invocation` /
   `user-invocable`, optional `metadata`; invalid files are dropped with a warning;
3. lists candidates with `source: "bundled"`, the packaged directory as `resourceBase`,
   and the standard bundled-provider rank `600`, so a project-local skill root (rank
   100/200) still overrides a packaged skill of the same name;
4. loads the body from disk on demand. The body keeps its resource base, so
   `references/`, `scripts/`, and `assets/` paths written in `SKILL.md` resolve as
   written.

### Why no peerDependencies

The official bundled badge skill imports `BUNDLED_SKILL_RANK` from
`@deepseek-ai/dsh-skill` and declares that package as a peer dependency. That works for a
package shipped inside the DSH installation. This plugin is installed from Git into a
profile, where a workspace-linked package cannot resolve bare `@deepseek-ai/*` specifiers
unless its manifest declares them — and declaring them would make `dsh plugin add`
depend on resolving the host's internal packages at install time.

Instead the rank is the documented literal `600` (`BUNDLED_SKILL_RANK`) with this comment
and note. The plugin has **no runtime or peer dependencies at all**, which matches the
repository convention for installable bundles. If DSH ever changes the bundled rank, the
only effect is duplicate-name precedence against other packaged providers; update the
constant in `index.js` with the DSH release.

## Adding or editing a skill

Skills live **inside this package** so that editing one is automatically part of the
installable plugin. Create `plugins/skills/skills/<kebab-case-name>/SKILL.md` (directory
bundle; supporting files welcome) or `plugins/skills/skills/<kebab-case-name>.md` (flat
file). Do not create a `SKILL.md` anywhere else in the repository —
`scripts/validate-skills.mjs` fails when one is outside this package.

Frontmatter rules and conventions are documented in the
[root README](../../README.md#authoring-a-skill). After adding or editing a skill, run:

```sh
node scripts/validate-skills.mjs   # frontmatter + packaging + npm pack contents
cd plugins/skills && npm test      # provider test: every packaged skill parses and lists
```

`plugins/skills/README.md` and the root README must carry the pinned install command for
the current version; `scripts/validate-github-install.mjs` enforces it on release.

## Migrating from `install.sh`

`install.sh` at the repository root is kept as a legacy/manual alternative; it now links
from `plugins/skills/skills/`. If you previously linked the skills into `~/.dsh/skills`
or a project root, remove those links once so the plugin's copy is the one in use:

```sh
./install.sh --uninstall
```

A per-skill symlink at the user root has rank 400 and would otherwise win duplicate-name
precedence over the packaged provider at rank 600. Leaving it works, but a later package
update would not be reflected until the link is removed or its target updated.

## Configuration

The bundle adds no configuration. The provider always scans the packaged `skills/`
directory; disable the `skills` row in a profile's `cordis.patch.yml` to remove the
packaged skills from that profile. The plugin does not watch files: skills are static
package contents, so restart DSH after installing an updated version.

## Verification

```sh
node scripts/validate-skills.mjs                     # repository contract + npm pack
cd plugins/skills && npm test                        # provider and frontmatter tests
npm pack --dry-run --json                            # all SKILL.md + references shipped
dsh --profile web --dump-config                      # composes without booting
```

The provider test asserts the package lists all 10 skills, that each parsed name matches
its directory, that each body loads, and that referenced resources are packaged.
