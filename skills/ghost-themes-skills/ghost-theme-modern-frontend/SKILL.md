---
name: ghost-theme-modern-frontend
description: Wire a Ghost theme to a modern frontend pipeline — Vite bundling, Tailwind CSS, and React/Vue/Svelte islands — while keeping Ghost's server-rendered Handlebars contract, members features, and GScan validation working.
whenToUse: Use when a Ghost theme needs a build step or modern styling/JS tooling — adding Tailwind CSS or Vite to a theme, migrating a theme off legacy gulp/SASS, scaffolding a new theme intended to use Tailwind/React, adding interactive components to Handlebars templates, or deciding whether a request for "Ghost with React/Next.js" should be a theme or a headless frontend.
---

# Ghost themes on a modern frontend pipeline

A Ghost theme is **server-rendered Handlebars plus static assets**. Ghost does not run
your bundler and does not execute a JavaScript framework server-side. Everything below
follows from that one fact: modern tooling is welcome, but only as a *build-time* and
*progressive-enhancement* layer on top of templates Ghost renders itself.

For template/helper/context correctness (which helpers exist, what data a context has,
what GScan requires), load `ghost-theme-development`. This skill covers the toolchain.

## 1. Decide the architecture before writing config

| The request | What it actually is | Do this |
|---|---|---|
| "Ghost theme with Tailwind / Vite / React components" | A **theme**: Ghost renders HTML, modern tooling builds assets and adds islands | This skill |
| "Next.js / Remix / SvelteKit **as the frontend** for Ghost content" | **Headless Ghost**: a separate app consuming the Content API | Not a theme — do not put it in `content/themes/`. Use the Content API; Ghost keeps admin and members |
| "React/Vue SPA that replaces the theme" | Headless with extra steps | Same as above; expect to reimplement routing, SEO metadata, members, and comments |

Say this out loud to the user before choosing. A theme that tries to own routing and
rendering through a client framework loses Ghost's SEO output, membership gating,
portal, search, and admin-driven routing — and fails GScan.

Three integration levels, cheapest first:

1. **Styling only** — Tailwind over the existing `.hbs` markup. Highest value, lowest risk.
2. **Bundling** — Vite builds CSS/JS with hashed filenames; templates load them.
3. **Islands** — a client framework mounts isolated interactive components into
   `data-island` mount points. Ghost still renders all content.

## 2. Hard constraints (violating these is what breaks themes)

- **Ghost ships and serves the theme; it never runs `npm install` or your build.** The
  uploaded zip must already contain compiled assets. Anything not in the zip does not exist.
- **`package.json` and the `.hbs` templates must sit at the theme root.** There is no
  `src/` or `templates/` directory in Ghost's resolution.
- **`default.hbs` must contain `{{{body}}}`** (triple-stash) plus `{{ghost_head}}` in
  `<head>` and `{{ghost_foot}}` before `</body>`. Child templates start with `{{!< default}}`.
- **Never hardcode asset paths.** Use `{{asset "built/app.js"}}`; Ghost resolves the theme
  asset URL and appends its own cache-busting hash. Hardcoded `/assets/...` paths break on
  Ghost Pro, subdirectory installs, and cache bumps.
- **Do not ship `node_modules/`, `dist/`, `lib/`, `scripts/`, or source assets in the zip.** Ship
  `assets/built/**` plus any static `assets/images|fonts|icons/**`, `partials/**`, `members/**`,
  `*.hbs`, `package.json`, and `locales/**` only.
- **Do not emit `assets/built/assets/**`.** Vite's default `assetsDir` nests hashed files
  one level down and GScan flags it; set `build.assetsDir = "."`.
- **GScan must parse every template.** A helper or block that Ghost does not know is an
  error, not a warning — a bundler alias does not help, because Handlebars runs first.
- **Custom theme settings are capped at 20** (declared in `package.json` under `config.custom`,
  five types: `select`, `boolean`, `color`, `image`, `text`). Do not model build/dev flags as
  many custom settings; use one (`development_mode`) if you need any.
- **Image sizes are theme-defined.** Ghost has no fixed size vocabulary: every
  `{{img_url … size="m"}}` must match a key you declare under `config.image_sizes`, or the
  helper silently falls back. Declare the Casper set (`xxs` 30, `xs` 100, `s` 300, `m` 600,
  `l` 1000, `xl` 2000) and keep to ≤10 sizes.
- **Assets referenced only from JS must still resolve at runtime.** Vite's hashed output
  changes every build; if the URL must appear in Handlebars, generate it at build time
  (see §4) rather than guessing the hash.

## 3. Recommended stack

| Concern | Choice | Why |
|---|---|---|
| Bundler | **Vite** | Fast, emits a manifest you can turn into Handlebars partials |
| CSS | **Tailwind CSS v4** via `@tailwindcss/vite` | No PostCSS config needed; `@source` globs can scan `.hbs` files |
| Typography | `@tailwindcss/typography` | Ghost's editor output renders into `.gh-content`; `prose` handles it |
| Interactivity | **Islands** — React, Preact, Vue, Svelte, Alpine, or vanilla | Mounts into server-rendered markup; no routing takeover |
| Validation | `gscan` (via `npx gscan .`) | The same checker Ghost uses on upload |

Prefer plain JS/Alpine if the only need is a menu, theme toggle, or scroll effect. Reach
for React when the component genuinely has state and reuse; every framework runtime is
shipped to every reader.

## 4. The Vite ↔ Handlebars bridge (the one non-obvious part)

Vite hashes output filenames; Handlebars cannot read `manifest.json` at render time. The
standard solution is a tiny build-time plugin that rewrites static partials from the
manifest, which the templates then include. The bundled scaffold implements exactly this
in `lib/vite/ghost-manifest-partials.js`; the essential config is:

```js
// vite.config.js
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import ghostManifestPartials from "./lib/vite/ghost-manifest-partials.js";

export default defineConfig({
  base: "./",              // Ghost serves assets from a hashed path — keep URLs relative
  publicDir: false,        // no public/ dir in a theme
  build: {
    outDir: "assets/built",
    assetsDir: ".",        // never emit assets/built/assets/** (GScan warning)
    emptyOutDir: true,
    manifest: "manifest.json",
    rollupOptions: { input: "assets/js/index.js" },
  },
  plugins: [
    ghostManifestPartials(
      "assets/built/manifest.json",
      "partials/vite_assets/head.hbs",   // <link rel="stylesheet"> + preload
      "partials/vite_assets/foot.hbs",   // <script type="module">
    ),
    tailwindcss(),
  ],
});
```

Then in `default.hbs`:

```hbs
<head>
    {{> "vite_assets/head"}}
    {{ghost_head}}
</head>
<body class="{{body_class}}">
    {{{body}}}
    {{> "vite_assets/foot"}}
    {{ghost_foot}}
</body>
```

Commit the generated partials *or* always build before zipping — the scaffold's
`npm run zip` builds first, so the zip is never stale.

**Tailwind v4 entry** (`assets/css/index.css`) must scan templates, not just JS:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";

@source "../../*.hbs";
@source "../../partials/**/*.hbs";
@source "../../members/**/*.hbs";
@source "../js/**/*.{js,jsx}";

@layer components {
  .gh-content { @apply prose prose-slate max-w-none dark:prose-invert; }
}
```

Tailwind v3 still works: drop `@tailwindcss/vite`, add `tailwindcss postcss autoprefixer`,
write `postcss.config.js`, and set `content: ["./*.hbs", "./partials/**/*.hbs", "./members/**/*.hbs", "./assets/js/**/*.{js,jsx}"]`
in `tailwind.config.js`. See `references/vite-tailwind-pipeline.md`.

## 5. React (or any framework) as islands

Rules that keep islands from breaking the theme:

1. **Templates own the document.** React mounts into a `div`, never into `body`.
2. **Markup is the contract, not props serialization.** Prefer reading existing DOM
   (`document.querySelector(".gh-content")`) over passing data through Handlebars.
3. **Scalars via data attributes.** Handlebars escapes attribute values, so
   `<div data-island="Toc" data-target=".gh-content">` is safe.
4. **Richer payloads via the Content API or a JSON script block.** Client-side Content API
   calls need a public Content API key (`@site.url` + `/ghost/api/content/`), which is safe
   to expose. For embedding server data, a `<script type="application/json">` block filled
   by Handlebars is the usual approach — verify escaping of `</script>` before trusting it.
5. **Do not re-render server content.** Hydrate interactive widgets only; duplicate
   rendering causes layout shift and breaks portal/member state.
6. **Guard against missing mount targets** so a template change never throws on every page.

The scaffold generates `assets/js/islands.jsx` with a name→component registry and a
`ReadingProgress` example. Full patterns, including Vue/Svelte equivalents and
"when not to use React", are in `references/react-islands.md`.

## 6. Workflows

### A. New theme with the modern pipeline

```bash
node scripts/scaffold-theme.mjs --name my-theme --out ./themes --react
cd themes/my-theme && npm install && npm run build && npm test
```

The script (bundled with this skill) writes a GScan-clean theme: Vite + Tailwind config,
the manifest-partials plugin, `partials/vite_assets/` placeholders that are valid before the
first build, `*.hbs` templates (`default`, `index`, `post`, `page`, `tag`, `author`, `error`),
partials, a members-aware header, a `zip` script that ships only shippable files, and a README.
Use `--no-tailwind` for plain CSS, omit `--react` for no framework.

### B. Retrofit Vite/Tailwind onto an existing theme

1. Read `package.json` and `default.hbs` first; note current asset loading and any
   build system already present (delete gulp/SASS only after confirming nothing references it).
2. Add `vite.config.js`, `lib/vite/ghost-manifest-partials.js`, `assets/css/index.css`,
   `assets/js/index.js`, then `npm install` the dev dependencies.
3. Add the two `{{> "vite_assets/…"}}` includes to `default.hbs` and **remove** the old
   stylesheet/script tags they replace (double-loading is a common regression).
4. Set `@source` globs to the existing template layout, then build and diff visually.
5. Convert styles incrementally; leave Ghost's `.gh-content` output styled by `prose`
   rather than rewriting every card by hand.

### C. Add an island to an existing theme

1. Add the component under `assets/js/islands/`, register it in the registry.
2. Add the mount point to the relevant `.hbs` (usually `post.hbs`).
3. `npm run build`, then verify the element exists in the rendered page and that the
   script tag is emitted by `partials/vite_assets/foot.hbs`.

### D. Local development loop

- `npm run dev` gives HMR for CSS/JS, but **Ghost does not read the Vite dev server**.
  Either run the dev server and temporarily point `head.hbs`/`foot.hbs` at it behind a
  custom `development_mode` setting, or run `vite build --watch` and symlink the theme into
  `content/themes/<name>`.
- Ghost caches compiled templates: **restart Ghost after changing `.hbs` files.**
  (`vite-plugin-restart` can restart the Vite side on `**/*.hbs`; it cannot restart Ghost.)

## 7. Verify before declaring done

- [ ] `npm run build` succeeds and `assets/built/manifest.json` exists.
- [ ] `partials/vite_assets/head.hbs` and `foot.hbs` list the current hashed files.
- [ ] `npx gscan .` reports no errors (warnings triaged, not ignored).
- [ ] `zip` contains `assets/built/**` (plus any static `assets/images|fonts/**`), `partials/**`, `members/**`, `*.hbs`, `package.json` — and **no** `node_modules/`, `lib/`, `scripts/`, or source assets.
- [ ] Every asset reference in templates goes through `{{asset}}`.
- [ ] `{{ghost_head}}`/`{{ghost_foot}}`/`{{{body}}}` still present exactly once in `default.hbs`.
- [ ] Pages render with JS disabled (content is server-rendered).
- [ ] Uploaded zip installs cleanly in Ghost Admin.

## 8. Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Theme uploads but is unstyled | Built assets missing from the zip | Build before zipping; ship `assets/built/**` |
| Works locally, breaks on Ghost Pro | Hardcoded absolute asset path | Use `{{asset "…"}}` |
| GScan warning about nested assets | `assetsDir` left at default | `build.assetsDir = "."` |
| Classes missing from Tailwind output | `.hbs` files not scanned | Add `@source "../../**/*.hbs"` (v4) or `content` globs (v3) |
| Old and new styles both applied | Legacy `<link>` left in `default.hbs` | Remove the replaced tags |
| Partial not found after build | `partials/vite_assets/*.hbs` git-ignored and never generated | Run `npm run build`; commit placeholders so a fresh clone still parses |
| Script 404s after deploy | Hash changed but partials stale | Always build before zip; never hardcode hashed names |
| React content duplicated / jumps | Hydrating markup React also renders | Render interactive widgets only; let Handlebars own content |

## References

- `references/vite-tailwind-pipeline.md` — full config, Tailwind v3 and v4 variants, dev-mode wiring, locale merging, watch/restart behaviour.
- `references/react-islands.md` — island patterns, props/data handoff, Content API use, framework alternatives, anti-patterns.
- `references/build-and-ship.md` — zip contents, GScan in CI, GitHub Actions deploy, theme marketplace metadata, versioning.
- `scripts/scaffold-theme.mjs` — the generator described in §6A (`--help` for flags).
- `scripts/verify-theme.sh` — build + GScan + zip-contents assertion, suitable for CI.
