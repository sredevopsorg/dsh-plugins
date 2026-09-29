# Building, validating, and shipping a Ghost theme

## 1. What goes in the zip

Ghost **does not run a build** and does not install dependencies, so the archive is the entire
runtime. The theme docs do not publish a forbidden-file list (verified against
`themes/structure` and `themes/gscan`); the table below is what Ghost actually needs at
runtime, matching the community reference implementation
[christopher-b/vapour](https://github.com/christopher-b/vapour).

| Include | Exclude | Why |
|---|---|---|
| `package.json` | `node_modules/` | Ghost reads `config`/`custom`; it never runs npm |
| `*.hbs` (root) | `dist/`, `*.zip` | templates are root-level |
| `partials/**` (incl. generated `vite_assets/`) | `lib/` | build-time plugins are not runtime |
| `members/**` | `scripts/` | dev tooling |
| `locales/**` | `assets/css/`, `assets/js/` | source is compiled into `assets/built/` |
| `assets/built/**` | `vite.config.js`, `tailwind.config.js`, `postcss.config.js` | build config only |
| `assets/images/**`, `assets/fonts/**` (if templates reference them) | `.git/`, `.github/`, logs, editor config | not runtime |
| `routes.yaml` (if you ship routing) | `package-lock.json` / `yarn.lock` | harmless but pointless |

Keep the archive small — Ghost's upload limit and theme-marketplace review both care, and a
`node_modules/` in a zip is the classic mistake.

## 2. Packaging

The scaffold ships `scripts/zip.mjs` (uses `archiver`), which rebuilds first and then includes
exactly the shippable set:

```js
const include = ["assets/built", "partials", "members", "locales", "package.json"];
const globs = ["*.hbs"];
const extraDirs = ["assets/images", "assets/fonts", "assets/icons"];
```

```bash
npm run zip        # → dist/<theme-name>.zip
```

Without a script, the same with the `zip` CLI (note the explicit `assets/built`, not `assets`):

```bash
npm run build
zip -r dist/theme.zip *.hbs partials members locales package.json assets/built \
  -x '*.map'
```

Always build in the same command/CI step that zips. A stale `partials/vite_assets/*.hbs`
pointing at a previous content hash is the most common "works locally, 404s in production".

## 3. GScan — the acceptance test

GScan is the same validator Ghost runs on upload; fatal errors block activation.

```bash
npx gscan .                     # a theme directory
npx gscan -z dist/theme.zip     # the archive you are about to upload
npx gscan . --ghost-version 5.0.0
```

GScan error classes worth internalising (all observed in practice):

| GScan finding | Fix |
|---|---|
| `.kg-width-wide` / `.kg-width-full` CSS class required | style both; this is an **error**, not a warning |
| "Use or remove the unused `config.custom` setting" | every declared setting must be referenced as `@custom.<key>` |
| Warning: missing support for custom fonts | consume `--gh-font-heading` / `--gh-font-body` |
| Warning: support `{{@page.show_title_and_feature_image}}` | wrap a page's title/feature image in that flag |
| Warning: nested `assets/built/assets/**` | `build.assetsDir = "."` in `vite.config.js` |
| Missing `index.hbs` / `post.hbs` / `assets/` | required files |

The bundled `scripts/verify-theme.sh` wraps the checks GScan does not give clear messages for
(hardcoded asset paths, image sizes used but not declared, stale asset partials, dev files in
the zip):

```bash
scripts/verify-theme.sh .        # build → GScan → zip → archive assertions
```

## 4. CI

```yaml
# .github/workflows/theme.yml
name: theme
on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npx gscan .
      - run: npm run zip
      - uses: actions/upload-artifact@v4
        with:
          name: theme-zip
          path: dist/*.zip
```

Deploy-to-Ghost from CI requires the Admin API (a custom integration with an Admin API key)
rather than theme upload in the browser; keep the artifact upload as the baseline and add
deployment only if the project actually needs automated releases.

## 5. Versioning

- Bump `version` in `package.json` for every release; Ghost shows it in the Design pane.
- Tag the release in git with the same version and attach the zip.
- Note breaking `@custom` key changes in the changelog — **renaming a custom setting key drops
  the stored value**, and the docs treat it as a breaking change.
- Keep a `CHANGELOG.md`; theme-marketplace submissions are expected to document changes.

## 6. Installing and updating

**In Ghost Admin** (the normal path): Settings → Design → Change theme → Upload theme → pick
`dist/<theme>.zip` → Activate.

**Via ghost-cli**, for a local install:

```bash
ghost restart          # after copying theme files or editing package.json
```

**During development**, symlink the working copy into the Ghost content directory:

```bash
ln -s "$PWD" /path/to/ghost/content/themes/my-theme
```

Remember: production Ghost caches compiled templates, so `.hbs` and `package.json` edits need
`ghost restart`. Uploading through Admin triggers GScan automatically.

## 7. A local Ghost to test against

```bash
npm install -g ghost-cli
mkdir ghost-local && cd ghost-local
ghost install local          # sqlite, no nginx/systemd, http://localhost:2368
ghost start
```

Then symlink the theme into `content/themes/<name>` and activate it in Admin. Docker Compose
with the official `ghost` image works equally well when you want to keep the host clean.

Validate against the oldest Ghost version you claim to support
(`engines.ghost` in `package.json`), since GScan's rules move with Ghost.

## 8. Marketplace metadata (ecosystem, not theme docs)

The reference implementation carries a `gpm` block:

```json
"gpm": { "type": "theme", "categories": ["Minimal", "Magazine"] }
```

This is used by the official theme marketplace tooling, **not** documented in the themes
guide — treat it as ecosystem convention: harmless, but not required for installation.
Documented, useful package fields for a published theme are `docs` (its URL appears in Admin)
and `screenshots` (`desktop`/`mobile`, pointing into `assets/`).

## 9. Release checklist

- [ ] `npm run build` clean; `assets/built/manifest.json` present.
- [ ] `npx gscan .` — zero errors; warnings triaged deliberately.
- [ ] `scripts/verify-theme.sh .` passes (zip contents asserted).
- [ ] Installed on a real Ghost instance and clicked through: home, paginated, post, page,
      tag, author, 404, and members pages if enabled.
- [ ] Members/Portal, search (`Cmd/Ctrl+K`), and comments work if the theme advertises them.
- [ ] Page renders fully with JavaScript disabled.
- [ ] Images use `{{img_url}}` with declared sizes and responsive `srcset`.
- [ ] `package.json` version bumped, changelog updated, zip attached to the git tag.
- [ ] No dev files in the archive (`node_modules/`, `lib/`, `scripts/`, `dist/`).

## Sources

- [Ghost: Structure](https://docs.ghost.org/themes/structure), [GScan](https://docs.ghost.org/themes/gscan), [Custom settings](https://docs.ghost.org/themes/custom-settings), [Routing](https://docs.ghost.org/themes/routing)
- [Ghost CLI](https://docs.ghost.org/install/local)
- Community reference for packaging/build: [christopher-b/vapour](https://github.com/christopher-b/vapour) (`package.json` scripts, `zip` include list)
