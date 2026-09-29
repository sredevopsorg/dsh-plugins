# Vite + Tailwind in a Ghost theme

Everything here exists because of four Ghost facts:

1. Ghost serves the theme and **never runs your build**, so the uploaded zip must already
   contain compiled assets.
2. Handlebars cannot read `manifest.json`, so hashed filenames must be resolved **at build
   time** into something static templates can include.
3. Asset URLs must be produced by `{{asset}}` (install-location correct, cache-busted).
4. GScan (and therefore Ghost's upload check) rejects structurally wrong output — notably
   nested `assets/built/assets/**`.

This pipeline is modelled on the community reference implementation
[christopher-b/vapour](https://github.com/christopher-b/vapour) (MIT), which is the
best-documented working Vite + Tailwind Ghost theme; the config below was additionally
validated end-to-end (build + GScan + zip) while writing this skill.

## 1. Source layout vs shipped layout

| Path | Role | Shipped in zip? |
|---|---|---|
| `assets/css/`, `assets/js/` | **Source** — entry points and components | No |
| `assets/built/` | Vite output that Ghost serves | **Yes** |
| `assets/images/`, `assets/fonts/` | Static files referenced via `{{asset "images/…"}}` | **Yes** |
| `partials/vite_assets/*.hbs` | Generated `<link>`/`<script>` tags | **Yes** |
| `lib/vite/` | Build-time plugins | No |
| `scripts/` | zip/verify helpers | No |
| `vite.config.js`, `tailwind.config.js`, `postcss.config.js` | Build config | No |
| `*.hbs`, `partials/**`, `members/**`, `locales/**`, `package.json` | Theme | **Yes** |

Only the bundle entry needs to be an input. CSS is imported from JS
(`import "../css/index.css";`) so Vite links and hashes it alongside the JS.

## 2. vite.config.js

```js
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import ghostManifestPartials from "./lib/vite/ghost-manifest-partials.js";

export default defineConfig({
  base: "./",        // Ghost serves assets from a hashed path; absolute URLs break
  publicDir: false,  // a theme has no public/ — static files live in assets/
  build: {
    outDir: "assets/built",
    assetsDir: ".",  // do NOT nest: assets/built/assets/** triggers a GScan warning
    emptyOutDir: true,
    manifest: "manifest.json",
    rollupOptions: { input: "assets/js/index.js" },
  },
  plugins: [
    ghostManifestPartials(
      "assets/built/manifest.json",
      "partials/vite_assets/head.hbs",
      "partials/vite_assets/foot.hbs",
    ),
    tailwindcss(),
    // react() — only for islands; see react-islands.md
  ],
});
```

Why each non-obvious line matters:

- `base: "./"` — Ghost's theme asset URL is itself hashed/versioned; root-absolute asset URLs
  break on Ghost Pro and subdirectory installs.
- `assetsDir: "."` — emits `assets/built/index-<hash>.js` instead of
  `assets/built/assets/index-<hash>.js`. The latter is what GScan complains about.
- `manifest: "manifest.json"` — the build-time index that lets the plugin map logical entries
  to hashed files.
- Single `input` — one JS entry, one CSS import; extra entries are usually unnecessary and
  multiply preloads.

## 3. The manifest → partials plugin

`lib/vite/ghost-manifest-partials.js` (shipped with the scaffold):

```js
import fs from "node:fs";

export default function ghostManifestPartials(manifestPath, headPath, footPath) {
  return {
    name: "vite-plugin-ghost-manifest-partials",
    apply: "build",
    closeBundle() {
      if (!fs.existsSync(manifestPath)) return;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      let head = "{{!-- Generated during a Vite build. Do not edit. --}}\n";
      let foot = "{{!-- Generated during a Vite build. Do not edit. --}}\n";

      for (const entry of Object.values(manifest)) {
        if (!entry.file || !entry.file.endsWith(".js")) continue;

        head += `<link rel="preload" as="script" href="{{asset "built/${entry.file}"}}">\n`;
        for (const css of entry.css ?? []) {
          head += `<link rel="stylesheet" href="{{asset "built/${css}"}}">\n`;
        }
        foot += `<script type="module" src="{{asset "built/${entry.file}"}}"></script>\n`;
      }

      fs.writeFileSync(headPath, head, "utf8");
      fs.writeFileSync(footPath, foot, "utf8");
    },
  };
}
```

The generated files are ordinary Handlebars partials:

```hbs
{{!-- partials/vite_assets/head.hbs --}}
<link rel="preload" as="script" href="{{asset "built/index-Be8pcAJ1.js"}}">
<link rel="stylesheet" href="{{asset "built/index-dmVTHp_B.css"}}">
```

Two consequences worth designing around:

- **Commit the generated partials, or always build before zipping.** A fresh clone without
  either will not parse `{{> "vite_assets/head"}}`. The scaffold ships valid placeholder
  partials so a clean checkout is never broken, and `npm run zip` rebuilds first.
- **`{{asset}}` adds its own `?v=…` on top of Vite's content hash.** That is correct: the
  content hash handles content changes, `{{asset}}` handles Ghost restarts/CDN invalidation.

## 4. Wiring default.hbs

```hbs
<!DOCTYPE html>
<html lang="{{@site.locale}}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{meta_title}}</title>
    {{> "vite_assets/head"}}
    {{ghost_head}}
</head>
<body class="{{body_class}}">
    {{{body}}}
    {{> "vite_assets/foot"}}
    {{ghost_foot}}
</body>
</html>
```

Remove any legacy `<link>`/`<script>` tags you are replacing — leaving them is the most
common cause of "why are both stylesheets applied?".

## 5. Tailwind v4 (recommended)

`assets/css/index.css`:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";

/* .hbs files are content sources — classes live in templates, not only in JS. */
@source "../../*.hbs";
@source "../../partials/**/*.hbs";
@source "../../members/**/*.hbs";
@source "../js/**/*.{js,jsx}";

@theme {
  --color-accent: oklch(0.55 0.2 260);
}

@layer base {
  body { font-family: var(--gh-font-body, ui-sans-serif, system-ui, sans-serif); }
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--gh-font-heading, var(--gh-font-body, ui-sans-serif, system-ui, sans-serif));
  }
}

@layer components {
  .gh-content { @apply prose prose-slate max-w-none dark:prose-invert; }
}

/* Required: GScan treats unstyled wide/full editor cards as an error. */
.kg-width-wide { width: min(85vw, 1100px); max-width: none; margin-inline: auto; }
.kg-width-full { width: 100vw; max-width: none; margin-left: calc(50% - 50vw); }
```

Notes:

- `@source` paths are relative to the CSS file (`assets/css/` → `../../` is the theme root).
  Without them, Tailwind's automatic detection may still find templates, but being explicit
  survives restructures and monorepos.
- `@theme` tokens generate utilities (`--color-accent` → `bg-accent`, `text-accent`). Because
  the utilities resolve to `var(--color-accent)`, an inline
  `style="--color-accent: {{@custom.accent_color}}"` in `default.hbs` overrides them from
  Ghost's custom settings with no rebuild.
- Consuming `--gh-font-*` is what silences GScan's "missing support for custom fonts" warning.

## 6. Tailwind v3 (only if you are pinned to it)

```bash
npm i -D tailwindcss@^3 postcss autoprefixer
```

```js
// postcss.config.js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

```js
// tailwind.config.js
export default {
  content: [
    "./*.hbs",
    "./partials/**/*.hbs",
    "./members/**/*.hbs",
    "./assets/js/**/*.{js,jsx}",
  ],
  theme: { extend: {} },
  plugins: [require("@tailwindcss/typography")],
};
```

Replace the v4 CSS with `@tailwind base; @tailwind components; @tailwind utilities;` and drop
`@tailwindcss/vite` from `vite.config.js` (PostCSS is picked up automatically). Everything
else in this document is unchanged.

## 7. Development loop

Ghost does not read the Vite dev server, and Ghost caches compiled templates. Two workable
setups:

**A. Build-watch (simplest, closest to production)**

```bash
npm run build -- --watch     # rebuild assets on change
# edit .hbs → ghost restart   (production-mode Ghost caches templates)
```

Symlink the theme once so Ghost serves your working copy:

```bash
ln -s "$PWD" /path/to/ghost/content/themes/my-theme
```

**B. Dev server behind a theme setting** — add a boolean custom setting
(`development_mode`) and branch in `default.hbs`:

```hbs
{{#if @custom.development_mode}}
    <script type="module" src="http://localhost:5173/@vite/client"></script>
    <script type="module" src="http://localhost:5173/assets/js/index.js"></script>
{{else}}
    {{> "vite_assets/head"}}
{{/if}}
```

This gives real HMR, at the cost of a hardcoded dev origin and one of the theme's 20 custom
settings. `vite-plugin-restart` can restart Vite when `**/*.hbs` changes; it cannot restart
Ghost.

Whichever you choose: **restart Ghost after editing `.hbs` or `package.json`**, otherwise you
are looking at cached output.

## 8. Static assets Vite does not process

Images, fonts, and favicons referenced from templates go through `{{asset}}` and therefore
live under `assets/` but are *not* build outputs:

```hbs
<img src="{{asset "images/logo.svg"}}" alt="{{@site.title}}">
<link rel="icon" href="{{asset "favicon.ico"}}">
```

They must be added to the zip explicitly — the scaffold's `scripts/zip.mjs` includes
`assets/images`, `assets/fonts`, and `assets/icons` when present, in addition to
`assets/built`. (Images imported from JS/CSS are handled by Vite and land in `assets/built`.)

Anything Ghost itself resizes (`{{img_url}}`) is uploaded through the editor, not shipped in
the theme.

## 9. Extra entries, code splitting, and member pages

- Prefer one entry. Additional entries mean additional preloads; a theme's JS should stay small.
- `manifest.json` may contain shared chunks. The bundled plugin only emits `<script>`/`<link>`
  tags for entries ending in `.js`; if you enable manual chunking with multiple entries, extend
  the plugin to skip chunk-only files (e.g. filter by `entry.isEntry`).
- `members/signin.hbs`, `signup.hbs`, and `account.hbs` are ordinary templates; they inherit
  your `default.hbs` assets, so nothing special is required.

## 10. Locales (optional build step)

The Vapour reference merges per-language JSON fragments into `locales/<lang>.json` at build
time using `@tryghost/theme-translations`, so translators can work on small files. If you do
not need that workflow, edit `locales/<lang>.json` directly — but keep `locales/**` in the zip
and remember `ghost restart` after changing translations.

## 11. Checklist

- [ ] `npm run build` produces `assets/built/manifest.json` plus hashed JS/CSS.
- [ ] `partials/vite_assets/head.hbs` / `foot.hbs` reference those hashed names.
- [ ] No `assets/built/assets/**` in the output.
- [ ] Every asset reference in `.hbs` uses `{{asset}}`.
- [ ] Classes used only in templates appear in the built CSS (grep for one to confirm).
- [ ] `npx gscan .` is clean.
- [ ] The zip contains `assets/built/**` and any static `assets/images|fonts/**`, and excludes
      `node_modules/`, `lib/`, `scripts/`, `dist/`, `assets/css/`, `assets/js/`.

## Sources

- [Vapour: A starter theme for Vite + TailwindCSS (Ghost Forum)](https://forum.ghost.org/t/vapour-a-starter-theme-for-vite-tailwindcss/61229)
- [christopher-b/vapour — vite.config.js](https://github.com/christopher-b/vapour/blob/main/vite.config.js), [ghost-manifest-partials.js](https://github.com/christopher-b/vapour/blob/main/lib/vite/ghost-manifest-partials.js), [package.json](https://github.com/christopher-b/vapour/blob/main/package.json)
- [Vite backend integration / manifest](https://vite.dev/guide/backend-integration.html)
- [Ghost: Assets](https://docs.ghost.org/themes/assets), [GScan](https://docs.ghost.org/themes/gscan)
