---
name: ghost-theme-development
description: Create, edit, and validate Ghost Handlebars themes — file layout, template contexts and the data each provides, functional/data/utility helpers, custom theme settings, image sizes, routes.yaml, members/search/comments, translations, and GScan compliance.
whenToUse: Use when creating a Ghost theme or adding a template/partial, editing or debugging `.hbs` files, deciding which template renders a URL, adding or fixing a Handlebars helper, declaring custom theme settings or image sizes, writing routes.yaml, wiring members/search/comments/translations, or diagnosing a theme that GScan rejects or that uploads but renders wrong.
---

# Ghost theme development

A Ghost theme is static Handlebars templates plus assets. Ghost resolves a URL to a
*context*, picks a template by a fixed fallback order, injects the data for that context,
and renders. There is no server-side app code in a theme: if you need a build step or a
client framework, that is a separate skill (`ghost-theme-modern-frontend`).

Two things decide whether your work succeeds: **using the right template for the context**
and **using helpers the way Ghost defines them**. Everything else is styling.

## 1. Non-negotiables

- **`{{ghost_head}}` goes just before `</head>`; `{{ghost_foot}}` just before `</body>`.**
  They emit meta description, Schema.org JSON-LD, Open Graph/Twitter tags, RSS paths, the
  Ghost API scripts, and code injection. Omitting them breaks SEO, Portal, and admin code injection.
- **`{{{body}}}` (triple-stash) must appear in `default.hbs`** — that is where every child
  template's output is injected. Child templates start with `{{!< default}}`.
- **`index.hbs`, `post.hbs`, and an `assets/` directory are required.** `default.hbs` is
  required in practice, because it owns `{{{body}}}`.
- **Output URLs through the `{{url}}` helper, never as a data attribute.** `{{post.url}}` and
  `{{url}}` are not equivalent; the docs say to open a context and use `{{url}}` explicitly
  for every resource (`{{#post}}{{url}}{{/post}}`).
- **Reference assets only through `{{asset "path/inside/assets"}}`.** It produces an
  install-location-correct URL with a `?v=#######` cache-busting query that changes on
  Ghost restart. Never hardcode `/assets/...`.
- **In production Ghost caches compiled templates.** Any `.hbs` or `package.json` change
  requires `ghost restart`. Editing a template and refreshing the browser proves nothing.
- **Uploading a theme triggers GScan; fatal errors prevent activation.** Make GScan part of
  the loop, not a final surprise: `npx gscan .` (or `gscan -z theme.zip`).

## 2. File layout

```
theme-root/
├── package.json          required — theme metadata + config
├── default.hbs           layout: {{{body}}}, {{ghost_head}}, {{ghost_foot}}
├── index.hbs             required — post list (home, collections, fallback)
├── post.hbs              required — single post
├── page.hbs              static pages (falls back to post.hbs if absent)
├── tag.hbs               tag archives (falls back to index.hbs)
├── author.hbs            author archives (falls back to index.hbs)
├── error.hbs             all 4xx/5xx (see §3 — special rules)
├── home.hbs              optional, home page only (else index.hbs)
├── custom-*.hbs          optional, selected by routes.yaml
├── partials/             {{> "name"}} — nested paths allowed: {{> "components/card"}}
├── members/              optional member pages: signin.hbs, signup.hbs, account.hbs
├── locales/<lang>.json   translations for {{t}}
└── assets/               {{asset}} root (css/, js/, images/, built/, fonts/)
```

Templates are resolved by fallback, so you can ship a working theme with only
`default.hbs`, `index.hbs`, and `post.hbs` and add the rest deliberately.

## 3. Contexts — which template, what data, which body class

Detect the context with `{{#is "..."}}`; accepted values are `home`, `index`, `post`,
`page`, `tag`, `author`, `paged`, `private` (comma-separate for OR).

| Context | Template fallback order | Data | `{{body_class}}` |
|---|---|---|---|
| home | `home.hbs` → `index.hbs` | posts page 1, `pagination`, `@site` | `home-template` |
| index | `index.hbs` (or the collection's `template`) | `posts`, `pagination`, `@site` | — |
| post | `post-:slug.hbs` → `custom-<name>.hbs` → `post.hbs` | post object, `@site` | `post-template` |
| page | `page-:slug.hbs` → `page.hbs` → `post.hbs` | page object (a page is a post) | `page-template`, `page-{slug}` |
| tag | `tag-:slug.hbs` → `tag.hbs` → `index.hbs` | tag object, `posts`, `pagination` | `tag-template`, `tag-{slug}` |
| author | `author-:slug.hbs` → `author.hbs` → `index.hbs` | author object, `posts`, `pagination` | `author-template`, `author-{slug}` |
| error | `error-404.hbs` / `error-4xx.hbs` / `error-5xx.hbs` → `error.hbs` | `statusCode`, `message`, `errorDetails` | — |

Post attributes: `id`, `title`, `slug`, `excerpt`, `content`, `url`, `feature_image`,
`feature_image_alt`, `feature_image_caption`, `featured`, `page`, `meta_title`,
`meta_description`, `published_at`, `updated_at`, `created_at`, `primary_author`, `tags`,
`primary_tag`. Author adds `bio`, `location`, `profile_image`, `cover_image`, `website`,
and social handles (`twitter`, `threads`, `bluesky`, `mastodon`, `linkedin`, …). Tag adds
`description`, `feature_image`, `accent_color`.

**Error templates are special.** They must not extend `default.hbs` and must not use theme
helpers — `{{asset}}` is the documented exception — because a helper failure while rendering
an error produces a misleading report. Only `error-404.hbs` may use helpers. A standalone
`error.hbs` with inline CSS also stays readable when the asset pipeline is what broke.

## 4. Helpers: the ones that matter, and how they go wrong

Full signatures, every option, and examples: `references/functional-and-utility-helpers.md`
and `references/data-helpers-and-features.md`.

| Need | Use | Watch out |
|---|---|---|
| Loop the current list | `{{#foreach posts}}` | Loop metadata: `@index`, `@number`, `@first`, `@last`, `@odd`, `@even`; options `limit`, `from`, `to`, `visibility`, `columns` |
| Fetch *other* content | `{{#get "posts" filter="featured:true" limit="3" as \|posts\|}}` | Default `limit` 15, max 100; `{{else}}` fires on error, not on empty |
| Ask a context question | `{{#has tag="news" author="Ada"}}` | Counting forms: `number="nth:3"`, `count:>2` |
| Branch on the route | `{{#is "post"}}` | Not the same as `{{#if}}`; `{{else}}` supported |
| Compare two values | `{{#match @custom.layout "=" "Wide"}}` | **There is no `{{#if a "=" b}}`** — comparisons belong to `match` |
| Truthiness | `{{#if}}` / `{{#unless}}` | Empty strings/arrays are falsy |
| Post data in a list item | `{{> "card"}}` | Factoring the loop into a partial avoids tag/author/index drift |

Data helpers worth memorising: `{{title}}`, `{{content}}`, `{{excerpt words="25"}}`,
`{{date format="D MMMM YYYY"}}`, `{{reading_time}}`, `{{img_url}}`, `{{navigation}}`,
`{{pagination}}`, `{{tags separator=", "}}`, `{{#tag}}`/`{{#author}}`, `{{plural}}`,
`{{t}}`, `{{comments}}`, `{{recommendations}}`, `{{search}}`, `{{> "partial"}}`,
`{{#contentFor}}`/`{{{block}}}`, `{{body_class}}`, `{{post_class}}`,
`{{prev_post}}`/`{{next_post}}`, `{{json}}`, `{{color_to_rgba}}`, `{{contrast_text_color}}`.

Three traps seen in real themes:

1. **`partials/navigation.hbs` overrides navigation for *both* primary and secondary menus.**
   Handle both with `{{#if isSecondary}} … {{else}} … {{/if}}` and loop
   `{{#foreach navigation}}` using `{{label}}`, `{{url}}`, `{{current}}`, `{{slug}}`.
   **Never call `{{navigation}}` inside this file — it is the navigation template.** (Ghost
   does not warn about the resulting recursion; GScan stays green.)
2. **`{{pagination}}` needs `partials/pagination.hbs` to be translatable.** Inside it you get
   `page`, `prev`, `next`, `pages`, `total`, `limit`, plus `{{page_url prev|next|N}}`.
3. **`{{img_url value size="m"}}` only knows the sizes your theme declares** (see §5), and the
   docs are inconsistent about size names — trust your `package.json`, not the examples.

## 5. package.json: config and custom settings

Only four `config` keys are supported:

```json
{
  "name": "my-theme",
  "description": "What makes this theme different",
  "version": "0.1.0",
  "license": "MIT",
  "author": { "email": "you@example.com" },
  "docs": "https://example.com/my-theme-docs",
  "screenshots": { "desktop": "assets/screenshot-desktop.jpg", "mobile": "assets/screenshot-mobile.jpg" },
  "config": {
    "posts_per_page": 12,
    "card_assets": true,
    "image_sizes": {
      "xxs": { "width": 30 }, "xs": { "width": 100 }, "s": { "width": 300 },
      "m": { "width": 600 }, "l": { "width": 1000 }, "xl": { "width": 2000 }
    },
    "custom": {
      "accent_color": { "type": "color", "default": "#2563eb", "description": "Accent colour" },
      "show_cover_image": { "type": "boolean", "default": true },
      "header_layout": {
        "type": "select", "options": ["Left aligned", "Centered"], "default": "Left aligned"
      }
    }
  }
}
```

Rules that cause real damage when broken:

- **`config.image_sizes` is theme-defined.** Ghost has no built-in vocabulary; every
  `size="…"` must match a declared key or the helper silently misbehaves. Keep to ≤10 sizes.
- **`config.custom` allows at most 20 settings**, typed `select`, `boolean`, `color`,
  `image`, or `text`. Keys must be `snake_case` because the key *is* the `@custom` property
  name and the Admin label. **Renaming a key is a breaking change** — the old value is dropped.
- **Every declared custom setting must be used**, or GScan reports an error. Use
  `{{#match @custom.header_layout "=" "Centered"}}…{{/match}}` and `{{@custom.accent_color}}`.
- `select` requires `options` and a `default` that is one of them; `boolean` and `color`
  require a `default`; `image` must **not** have one; `text` may.
- `group` (`"homepage"` / `"post"`, else "site wide") and `visibility` (NQL, e.g.
  `"header_style:[Landing]"`) organise the Design pane. An unmet `visibility` yields `null`.
- Read settings through `@custom.<key>`; read site data through `@site`, theme config through
  `@config` (e.g. `@config.posts_per_page`), page flags through `@page`.

## 6. Features a real theme is expected to support

- **Members / paywall** — `@site.members_enabled`, `@site.paid_members_enabled`,
  `{{#if @member}}`, and Portal links (`#/portal/signup`, `#/portal/signin`,
  `#/portal/account`, `data-portal="signup/TIER_ID/monthly"`). Portal is injected by
  `{{ghost_head}}`; deep-link with `data-members-*` attributes for custom forms.
- **Native search** — one attribute on any element: `<button data-ghost-search>`, or the
  `{{search}}` helper. `Cmd/Ctrl+K` opens it. Tag/author taxonomies must exist for those to
  appear in results.
- **Comments** — `{{comments}}` guarded by `{{#if @site.comments_enabled}}`.
- **Recommendations / social** — `{{recommendations}}`, `{{#social_accounts}}`,
  `{{social_url type="bluesky"}}`.
- **Content cards** — the editor emits `.kg-*` markup. **`.kg-width-wide` and `.kg-width-full`
  must be styled; GScan treats their absence as an error.** Also handle `.kg-card`,
  captions, galleries, and embeds, and style `.gh-content` as the content root.
- **Custom fonts** — Ghost injects `--gh-font-heading` / `--gh-font-body` and adds
  `gh-font-*` classes to `{{body_class}}`. Consume the variables, or GScan warns.
- **`@page.show_title_and_feature_image`** — a page-level toggle; when `false`, hide the
  title and feature image (and collapse the related spacing). GScan warns if you ignore it.
- **Translations** — wrap plain text in `{{t}}` (`{{t "Page {page} of {pages}" page=page pages=pages}}`),
  ship `locales/<lang>.json`, set `<html lang="{{@site.locale}}">`, and provide
  `partials/pagination.hbs` + `partials/navigation.hbs`; then `ghost restart`.

## 7. Routing

Default routes: posts `/:slug/`, pages `/page-slug/`, `/tag/:slug/`, `/author/:slug/`,
`/rss/`, `/sitemap.xml`. Override structure with `content/themes/<theme>/routes.yaml`:

```yaml
routes:
  /about/: page-about
  /podcast/: podcast

collections:
  /blog/:
    permalink: /blog/{slug}/
    template: index
    filter: tag:blog
  /portfolio/:
    permalink: /portfolio/{slug}/
    template: portfolio-item
    data: tag.portfolio

taxonomies:
  tag: /topic/{slug}/
  author: /writer/{slug}/
```

Documented top-level keys are exactly `routes`, `collections`, `taxonomies` — there is no
`terms` key, and **redirects do not live in routes.yaml**; they go in
`content/data/redirects.yaml`. Channels (filter-only permanent streams, e.g. `/podcast/`)
are defined under `routes` with a `filter`/`template`, and get `/rss/` automatically.
Collection filters must stay unique: overlapping filters break post URLs and pagination.
`data: tag.<slug>` imports a tag's data (and pulls its template metadata) into the route.

## 8. Create a theme

1. **Confirm the shape**: post-list + single-post + static pages is the minimum useful theme.
   Ask which contexts matter (members? comments? search?) rather than building everything.
2. **Write `package.json` and `default.hbs` first**, with `{{ghost_head}}`, `{{ghost_foot}}`,
   `{{body_class}}` and `{{{body}}}`.
3. **Write `index.hbs`, `post.hbs`, `page.hbs`, `tag.hbs`, `author.hbs`, `error.hbs`** using
   the context data above; factor the repeated item into `partials/card.hbs`.
4. **Declare every custom setting and image size you actually use** (§5).
5. **Add `partials/navigation.hbs` and `partials/pagination.hbs`** — navigation because it is
   how you control menu markup, pagination for translatability. Never call `{{navigation}}`
   from inside `navigation.hbs`.
6. **Style `.gh-content` and the `.kg-*` card classes**, including `.kg-width-wide` and
   `.kg-width-full`.
7. **Run `npx gscan .`, then install it in a local Ghost and click through every context**
   (home, paged, post, page, tag, author, 404, and members pages if enabled).
8. For a modern build pipeline (Vite/Tailwind/React islands), use the
   `ghost-theme-modern-frontend` skill instead of hand-rolling bundling.

## 9. Edit a theme

1. **Read the file before changing it**, and note which context renders it — the same markup
   in `index.hbs` and `post.hbs` sees different data.
2. **Prefer partials over copy-paste.** If a block appears in `index.hbs`, `tag.hbs`, and
   `author.hbs`, change it once in `partials/`.
3. **Keep the contract**: do not remove `{{ghost_head}}`/`{{ghost_foot}}`/`{{{body}}}`, do not
   replace `{{asset}}` with a literal path, do not add helpers to `error.hbs`.
4. **When adding a custom setting, use it in the same change** (GScan errors on unused ones),
   and never rename an existing key.
5. **Validate**: `npx gscan .`, then `ghost restart` and reload — template caching hides
   errors otherwise.

## 10. Anti-patterns

- Building a client-side SPA inside a theme — you lose server-rendered SEO, membership
  gating, and admin-driven routing. That is a headless integration, not a theme.
- `{{#if a "=" b}}` for comparisons (use `{{#match}}`), or `{{#has}}` where `{{#is}}` is meant.
- Hardcoded asset URLs, hashed filenames, or `assets/built/assets/**` nesting.
- Relying on sizes, custom settings, or helpers that the theme never declared.
- Shipping `node_modules/` (or any dev file) inside the theme zip.
- Editing `.hbs` and testing without `ghost restart`.
- Using helpers in `error.hbs` "just for the layout".

## References

- `references/theme-structure-and-routing.md` — file layout, `package.json` fields, context table and per-context data, global objects (`@site`, `@config`, `@page`, `@custom`), required helpers, routes.yaml/redirects worked examples, assets and `{{img_url}}` sizes.
- `references/functional-and-utility-helpers.md` — every functional and utility helper with signatures, options, examples, caveats, plus a quick-reference table.
- `references/data-helpers-and-features.md` — post/author/tag/tier data helpers, meta/navigation/images, members and Portal attributes, search, sharing, editor card markup, and the `config.custom` schema.

Both sibling skills build on this one: `ghost-theme-modern-frontend` for Vite/Tailwind/React
tooling, and GScan itself as the acceptance test for everything above.
