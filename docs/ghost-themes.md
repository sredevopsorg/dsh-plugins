# Ghost theme skills

Two agent skills for building and editing Ghost themes with modern frontend tooling
(Tailwind CSS, Vite, React and other islands).

They live in this repository's [`skills/`](../skills/) directory. That directory is **not** one
of DSH's scanned skill roots, so they are not discovered by a bare clone — run
[`install.sh`](../install.sh) or see [Installing](#installing) below.

## Skills

### `ghost-theme-development` — authoring

Create, edit, and validate Ghost Handlebars themes: file layout, contexts and their data,
helpers, custom settings, image sizes, routing, members/search/comments, translations, and
GScan compliance. Use it whenever the task is *what a template should say*.

| Resource | Contents |
|---|---|
| `SKILL.md` | Non-negotiables, context→template→data table, helper traps, `package.json`/custom settings rules, feature checklist, create and edit workflows, anti-patterns |
| `references/theme-structure-and-routing.md` | File layout, documented `package.json` fields, per-context data, global objects (`@site`, `@config`, `@page`, `@custom`), required helpers, worked `routes.yaml`/`redirects.yaml`, `{{img_url}}` sizes |
| `references/functional-and-utility-helpers.md` | `foreach`, `get`, `has`, `if`/`unless`, `is`, `match`, and every utility helper with signatures, options, examples, caveats |
| `references/data-helpers-and-features.md` | Post/author/tag/tier helpers, meta/navigation/images, members + Portal attributes, search, sharing, editor card markup, custom-settings schema |

### `ghost-theme-modern-frontend` — toolchain

Wire a theme to Vite, Tailwind, and framework islands without breaking Ghost's
server-rendered Handlebars contract. Use it whenever the task is *how the assets are built*.

| Resource | Contents |
|---|---|
| `SKILL.md` | Theme-vs-headless decision, hard constraints, recommended stack, the manifest→partials bridge, React island rules, workflows (new theme, retrofit, add island, dev loop), verification checklist, failure table |
| `references/vite-tailwind-pipeline.md` | Annotated `vite.config.js`, the manifest plugin source, Tailwind v4 and v3 setups, dev-server/watch workflows, static assets, locale merging |
| `references/react-islands.md` | When to use a framework, registry/mounting, data handoff, Content API use, alternatives (Preact/Vue/Svelte/Alpine), Portal safety, performance, anti-patterns |
| `references/build-and-ship.md` | Zip contents, GScan in CI, GitHub Actions, versioning, install/update, local Ghost, marketplace metadata, release checklist |
| `scripts/scaffold-theme.mjs` | Generates a GScan-clean theme wired for Vite, optional Tailwind and React |
| `scripts/verify-theme.sh` | Builds, runs GScan, and asserts the zip contains only shippable files |

## Quick start

```bash
# Scaffold a Vite + Tailwind + React-islands theme
node skills/ghost-theme-modern-frontend/scripts/scaffold-theme.mjs \
  --name my-theme --out ./themes --react

cd themes/my-theme
npm install
npm run build
npm test                      # build + GScan

# Or run the fuller pre-flight (build → GScan → zip → archive assertions)
bash "$OLDPWD/skills/ghost-theme-modern-frontend/scripts/verify-theme.sh" .
```

`scaffold-theme.mjs --help` documents the flags (`--no-tailwind`, `--react`, `--out`,
`--force`).

## Installing

Skill discovery only sees DSH's roots — `<projectRoot>/.dsh/skills`,
`<projectRoot>/.agents/skills`, `customSkillDirs`, `~/.dsh/skills`, `~/.agents/skills` —
never this repository's `skills/`. Link the two Ghost skills into the root you want:

```bash
# user scope, available from every project
./install.sh ghost-theme-development ghost-theme-modern-frontend

# or project scope
./install.sh --project /path/to/your/ghost/project \
  ghost-theme-development ghost-theme-modern-frontend

# preview without changing anything
./install.sh --dry-run
```

`install.sh` creates per-skill symlinks, skips real files, and only ever removes links that
point back into this repository. Re-run it with `--uninstall` to detach.

## Provenance

- The three `ghost-theme-development` references were built by fetching the official
  documentation at `docs.ghost.org` (structure, contexts, helpers, routing, custom settings,
  GScan) and citing each section; documented contradictions and gaps are flagged rather than
  smoothed over.
- The toolchain guidance is grounded in the community Vite + Tailwind reference theme
  [christopher-b/vapour](https://github.com/christopher-b/vapour) (MIT) and the Ghost docs on
  assets and GScan.

## Verification performed

The scaffold was validated end to end for two configurations — Vite + Tailwind v4 + React
islands, and Vite only:

1. Fresh scaffold → `npm install` → `npm run build` (Vite 7 / Tailwind 4 / React 19).
2. `gscan .` → **compatible with Ghost 6.x, zero errors and zero warnings**.
3. `npm run zip` → archive contains only `package.json`, `assets/built/**`, `partials/**`, `*.hbs`.
4. `scripts/verify-theme.sh` → passes, and fails correctly on planted faults (unused custom
   setting, hardcoded asset path).

Templates were also corrected against the docs during that loop: styled `.kg-width-wide` /
`.kg-width-full` (a GScan error), consumed the custom-font variables, honoured
`@page.show_title_and_feature_image`, made `error.hbs` standalone (the docs forbid helpers
there), and replaced a recursive `{{navigation}}` call inside `partials/navigation.hbs` with the
documented `{{#if isSecondary}}` + `{{#foreach navigation}}` pattern.
