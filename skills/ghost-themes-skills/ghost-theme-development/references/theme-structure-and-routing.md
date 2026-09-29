# Ghost theme structure, contexts, and routing

Basis: official Ghost developer docs. Each section cites its pages. Where the fetched docs are silent on something a heading implies (a `gscan` package.json key, a forbidden-file list, a `terms` routing key), that gap is stated explicitly rather than filled by inference.

## 1. Theme file layout
Ghost themes are Handlebars; the theme layer adds `express-hbs` on top for layouts and partials.

```bash
.
├── /assets          # /css/screen.css, /fonts, /images, /js
├── /partials        # optional: list-post.hbs and other shared partials
├── default.hbs
├── index.hbs [required]
└── post.hbs [required]
└── package.json [required]
```

### Required vs optional files
| File | Required | Role | Fallback when absent |
| - | - | - | - |
| `index.hbs` | **Yes** | Template for a list of posts; usually extends `default.hbs`, posts rendered via `{{#foreach}}` | — |
| `post.hbs` | **Yes** | Single post; extends `default.hbs`, uses `{{#post}}` to output details | — |
| `package.json` | **Yes** | Theme metadata and `config` | — |
| `default.hbs` | No (recommended) | Base template: `<html>`, `<head>`, `<body>`, required `{{ghost_head}}`/`{{ghost_foot}}`, header/footer HTML | Templates omitting `{{!< default}}` render standalone |
| `home.hbs` | No | Special content for the home page; **only** used to render `/` | `index.hbs` |
| `page.hbs` | No | Static pages | `post.hbs` |
| `tag.hbs` | No | Tag archive pages | `index.hbs` |
| `author.hbs` | No | Author archive pages | `index.hbs` |
| `custom-{{template-name}}.hbs` | No | Custom templates selectable per-post/per-page in admin | `post.hbs` |
| `private.hbs` | No | Password form page on password-protected publications | Ghost default |
| `error.hbs` | No | Any `404`/`500` error not handled more specifically | Ghost's default error template |
| `error-{{error-class}}xx.hbs` | No | An error class, e.g. `error-4xx.hbs` | `error.hbs`, then Ghost default |
| `error-{{error-code}}.hbs` | No | A status code, e.g. `error-404.hbs` | All other error templates |
| `robots.txt` | No | Overrides Ghost's default `robots.txt` | Ghost default |

Resolution hierarchies, most specific first:

```text
post   : post-:slug.hbs   -> custom-<name>.hbs (if selected in post settings) -> post.hbs
page   : page-:slug.hbs   -> page.hbs                                         -> post.hbs
tag    : tag-:slug.hbs    -> tag.hbs                                          -> index.hbs
author : author-:slug.hbs -> author.hbs                                       -> index.hbs
error  : error-<code>.hbs -> error-<class>xx.hbs                              -> error.hbs -> Ghost default
```

Two easily confused custom-template mechanisms: `post-:slug.hbs` / `page-:slug.hbs` are automatic and bound to one slug; `custom-{{template-name}}.hbs` is a "global" custom template offered in a dropdown in the post settings menu, selectable on any post **or** page. Other facts: `/partials` is optional and shares HTML between templates; `index.hbs` also backs the tag and author contexts; `{{asset}}` requires an `assets` folder so Ghost knows where theme assets live; if layouts diverge sharply per content type, use dynamic routing or partials rather than duplicating base HTML.

In production, templates are loaded and cached by the server — any `.hbs` change requires `ghost restart`, as does any `package.json` change. Uploading a theme in Ghost admin triggers a GScan check; fatal errors prevent the theme being used. IDs are auto-generated for headings inside posts, so scope selectors (prefer `#themename-my-id` to `#my-id`).

Sources: [Structure](https://docs.ghost.org/themes/structure), [Themes overview](https://docs.ghost.org/themes/)

## 2. package.json for a theme
Must be valid JSON: double quotes around all property names, commas between properties.

```json
// package.json

{
    "name": "your-theme-name",
    "description": "A brief explanation of your theme",
    "version": "0.5.0",
    "license": "MIT",
    "author": { "email": "your@email.here" },
    "screenshots": { "desktop": "assets/screenshot-desktop.jpg", "mobile": "assets/screenshot-mobile.jpg" },
    "config": {
        "posts_per_page": 10,
        "image_sizes": {},
        "card_assets": true
    }
}
```

| Field | Type | Meaning / constraint |
| - | - | - |
| `name` | string | Theme name |
| `description` | string | Short description of the theme and what makes it unique |
| `version` | string | Theme version |
| `license` | string | Valid licence string; docs recommend `MIT` |
| `author` | object | e.g. `{ "email": "your@email.here" }` |
| `screenshots` | object | Documented keys `desktop`, `mobile`, pointing into `assets/` |
| `docs` | string (URL) | Usage-docs URL; the link appears in Ghost Admin on the **Design** page |
| `config.posts_per_page` | number | Posts per page; docs state the default is **5** |
| `config.image_sizes` | object | Responsive image sizes (section 8) |
| `config.card_assets` | boolean | Configure the card CSS and JS Ghost automatically includes |
| `config.custom` | object | Custom theme settings (below) |

The config doc enumerates exactly four supported `config` properties: `posts_per_page`, `image_sizes`, `card_assets`, `custom`. Documented inconsistency: the structure page says the default `posts_per_page` is 5, while the index-context page says the home page gets "the first 6 posts by default". Set it explicitly.

### `config.custom` (custom theme settings)
Five types: `select`, `boolean`, `color`, `image`, `text`.

```json
{
    "config": {
        "custom": {
            "typography": { "type": "select", "options": ["Modern sans-serif", "Elegant serif"], "default": "Modern sans-serif" },
            "cta_text": { "type": "text", "default": "Sign up for more like this", "group": "post" }
        }
    }
}
```

| Aspect | Rule |
| - | - |
| Key naming | All lowercase, no special characters, `snake_case`. The key is the Admin display name and the `@custom` property name. Changing a key across versions is a breaking change — the old setting is removed and its value lost. |
| `group` | Optional `"homepage"` or `"post"`; otherwise **Site wide**. Admin categories: Site wide, Homepage, Post. |
| `description` | Optional; fewer than 100 characters |
| `visibility` | Optional conditional display using NQL syntax, e.g. `"header_style:[Landing, Search]"`, `"post_feed_style:List"`. When unmet, the dependent setting renders as `null` in the theme. |
| Total limit | **20 settings maximum** |
| Unknown `type` | Causes a theme validation error |

| Type | Required | Validation |
| - | - | - |
| `select` | `type`, `options`, `default` | `options` must be an array of strings; `default` required and must match one of the options |
| `boolean` | `type`, `default` | `default` required, `true` or `false` |
| `color` | `type`, `default` | `default` required, valid hexadecimal string |
| `image` | `type` | `default` is **not allowed**; value is blank or a URL |
| `text` | `type` | `default` optional |

Custom fonts: when selected, Ghost loads fonts via `{{ghost_head}}` and sets `--gh-font-heading` / `--gh-font-body`; font names are also injected into `{{body_class}}` as `gh-font-heading-<slug>` / `gh-font-body-<slug>`.

### GScan configuration and zip contents
The pages fetched here do **not** document a `gscan` key inside `package.json`, and do **not** enumerate files forbidden from the theme zip. What they establish: GScan checks for errors, deprecations and compatibility issues; themes are checked automatically on admin upload and fatal errors prevent the theme being used; `npm install -g gscan`, then `gscan /path/to/ghost/content/themes/casper` or `gscan -z /path/to/download/theme.zip`, with https://gscan.ghost.org giving a full report. Documented constraints acting as packaging requirements: valid JSON; `index.hbs` and `post.hbs` must exist; an `assets` folder is required by the asset-helper contract; at most 20 custom settings; docs recommend at most 10 image sizes. Excluding `node_modules`, `.git`, or lockfiles from the zip is not specified in the fetched pages.

Standard npm fields such as `keywords` and `engines` are also **not** individually documented by these Ghost pages; the structure page defers to the [npm docs](https://docs.npmjs.com/files/package.json) for "specific details of `package.json` handling" and points to [Casper's package.json](https://github.com/TryGhost/Casper/blob/main/package.json/) as the working example.

Sources: [Structure](https://docs.ghost.org/themes/structure), [@config](https://docs.ghost.org/themes/helpers/data/config), [Assets](https://docs.ghost.org/themes/assets), [Custom Settings](https://docs.ghost.org/themes/custom-settings), [GScan](https://docs.ghost.org/themes/gscan)

## 3. Context table
Every page belongs to a context determined by the URL. The context decides which template renders, what data is available, and what `{{body_class}}` outputs. Context also drives helpers: `{{meta_title}}` reads `post.meta_title` in a post context and `tag.meta_title` in a tag context.

| Context | Detect with | Template (fallback order) | Data available | `{{body_class}}` output |
| - | - | - | - | - |
| `home` | `{{#is "home"}}` | `home.hbs` -> `index.hbs` | Same as `index`; posts page 1 | `home-template` |
| `index` | `{{#is "index"}}` | `index.hbs` (or the collection's `template`) | `posts` array + `pagination` + `@site` | (no dedicated class documented) |
| `post` | `{{#is "post"}}` | `post-:slug.hbs` -> `custom-<name>.hbs` -> `post.hbs` | `post` object + `@site` | `post-template` |
| `page` | `{{#is "page"}}` | `page-:slug.hbs` -> `page.hbs` -> `post.hbs` | `post` object (a page is a post) + `@site` | `page-template`, `page-{slug}` |
| `tag` | `{{#is "tag"}}` | `tag-:slug.hbs` -> `tag.hbs` -> `index.hbs` | `tag` object + `posts` + `pagination` + `@site` | `tag-template`, `tag-{slug}` |
| `author` | `{{#is "author"}}` | `author-:slug.hbs` -> `author.hbs` -> `index.hbs` | `author` object + `posts` + `pagination` + `@site` | `author-template`, `author-{slug}` |
| `error` | — (any route) | `error-<code>.hbs` -> `error-<class>xx.hbs` -> `error.hbs` -> Ghost default | `statusCode`, `message`, `errorDetails` | (not documented) |
| `private` | — | `private.hbs` | (not documented in fetched pages) | `private-template` |

`home` is a special context for page 1 of the index; if `home` is set, `index` is always set too. `{{body_class}}` additionally emits `gh-font-heading-*` / `gh-font-body-*` when custom fonts are selected.

Sources: [Contexts](https://docs.ghost.org/themes/contexts), [body_class](https://docs.ghost.org/themes/helpers/utility/body_class), [Custom Settings](https://docs.ghost.org/themes/custom-settings)

## 4. Per-context detail
### index (and home)
Detection: `{{#is "index"}}{{/is}}`. The main post list, covering the home page and subsequent pages; always paired with `home` (first page) or `page` (subsequent pages). Routes: `/` and `/page/:num/`, customisable with dynamic routing.

Data: a `posts` array plus a pagination object, plus all `@site` global data. Page size comes from `posts_per_page` in `package.json`; the array holds the correct posts for the current page, ordered chronologically newest first. Loop with `{{#foreach posts}}{{/foreach}}`, each iteration exposing all post object attributes; output pagination with `{{pagination}}`. When `tag.hbs`/`author.hbs` render similar lists, factor the item into a partial such as `{{> "loop"}}`.

```handlebars
<!-- index.hbs -->
<h1 class="page-title">{{@site.title}}</h1>
<main role="main">
  {{#foreach posts}}
    <article class="{{post_class}}">
      <h2><a href="{{url}}">{{title}}</a></h2>
      <p>{{excerpt words="26"}}</p>
    </article>
  {{/foreach}}
</main>
{{pagination}}
```

**home** — detection `{{#is "home"}}{{/is}}`, route always `/`, template `home.hbs` overriding `index.hbs`, data identical to `index`.

### page
Detection: `{{#is "page"}}{{/is}}`. Not set on posts. Routes are always `/:slug/` and **cannot** be customised, unlike post permalinks.

Data: the post object matching the route — "a page is just a special type of post, so the data object is called a post, not a page." Enter its scope with `{{#post}}{{/post}}`. Attributes: `id`, `title`, `excerpt`, `content`, `url`, `feature_image`, `feature_image_alt`, `feature_image_caption` (supports basic HTML), `featured` (defaults `false`), `page` (`true` if the post is a static page, defaults `false`), `meta_title`, `meta_description`, `published_at`, `updated_at`, `created_at`, `primary_author`, `tags`.

```html
<!-- page.hbs -->
{{#post}}
<article class="{{post_class}}">
  <h1 class="page-title">{{title}}</h1>
  {{tags prefix=" on "}}
  <section class="page-content">{{content}}</section>
</article>
{{/post}}
```

### post
Detection: `{{#is "post"}}{{/is}}`. Not set on static pages. Routes are configurable in Ghost admin; default `/:slug/`. Date-based permalinks and many other formats are available via routing.

Data: the post object matching the route plus `@site`. Attributes: `id`, `comment_id` (old pre-1.0 incremental id if present, else the Object ID), `title`, `slug`, `excerpt`, `content`, `url`, `feature_image`, `feature_image_alt`, `feature_image_caption` (supports basic HTML), `featured` (defaults `false`), `page` (`true` if the post is a page, defaults `false`), `meta_title`, `meta_description`, `published_at`, `updated_at`, `created_at`, `primary_author`, `tags`, `primary_tag`.

Special attributes: **URL** is calculated from the site permalink setting and post properties, and "should always be output using the special `{{url}}` helper rather than referenced as a data attribute" — always open a context and use `{{url}}` explicitly for *all* resources, especially in posts: `{{#post}}{{url}}{{/post}}`, not `{{post.url}}`. **Primary tag** is the first tag in `tags`, exposed as the `primary_tag` calculated property: a path expression pointing at a whole tag object, not a helper function.

```html
<!-- post.hbs -->
{{#post}}
<article class="{{post_class}}">
  <h1 class="post-title">{{title}}</h1>
  {{tags prefix=" on "}}
  <section class="post-content">{{content}}</section>
</article>
{{/post}}
```

### author
Detection: `{{#is "author"}}{{/is}}`. Set only on the list of an author's posts, never on an individual post. Routes: `/author/:slug/`, subsequent pages `/author/:slug/page/:num/`; change the structure via routing taxonomies.

Data: three objects — the author matching the route, a `posts` array, a pagination object — plus `@site`. Author attributes: `id`, `bio`, `location`, `url`, `slug`, `name`, `profile_image`, `cover_image`, `website`, `facebook`, `twitter`, `threads`, `bluesky`, `mastodon`, `tiktok`, `youtube`, `instagram`, `linkedin`, `meta_title`, `meta_description`. Social fields are documented as usernames/handles (e.g. "Facebook username (without full URL)", "Twitter/X handle"), except `mastodon` — "handle or full URL".

```html
<!-- author.hbs -->
{{#author}}
  {{#if profile_image}}<img src="{{img_url profile_image}}" alt="{{name}}'s Picture" />{{/if}}
  <h1 class="author-title">{{name}}</h1>
  {{#if bio}}<h2 class="author-bio">{{bio}}</h2>{{/if}}
{{/author}}
<main role="main">{{> "loop"}}</main>
{{pagination}}
```

The `{{plural ../pagination.total empty='No posts' singular='% post' plural='% posts'}}` form is the documented way to reach the outer pagination object from inside `{{#author}}` (the parent path).

### tag
Detection: `{{#is "tag"}}{{/is}}`. Set only on the post list for a tag, not on posts or pages carrying the tag. Routes: `/tag/:slug/`, subsequent pages `/tag/:slug/page/:num/`; the slug derives from the tag name and is configurable on the **Tags** page in Admin.

Data: the tag matching the route, a `posts` array, a pagination object, plus `@site`. Tag attributes: `id`, `name`, `slug`, `description`, `feature_image`, `meta_title`, `meta_description`, `url`, `accent_color`.

```html
<!-- tag.hbs -->
{{#tag}}
  {{#if feature_image}}<img src="{{feature_image}}" alt="{{name}}" />{{/if}}
  <h1>{{name}}</h1>
  {{#if description}}<h2>{{description}}</h2>{{/if}}
{{/tag}}
<main role="main">{{> "loop"}}</main>
{{pagination}}
```

### error
Errors can be rendered on any route. `error.hbs` renders any error when no specific template exists; `error-4xx.hbs` / `error-5xx.hbs` capture error classes; `error-404.hbs` captures a status code. If no custom error templates exist, Ghost uses its default.

Data: `{{statusCode}}` (HTTP status code), `{{message}}` (error message), `{{errorDetails}}` (an object of further details, iterated to expose `{{rule}}`, `{{ref}}`, `{{message}}`).

Critical constraint: error templates "shouldn't use any theme helpers, with the exception of `{{asset}}`, or extend the default template, to further avoid the use of template helpers", because helpers inside them can lead to misleading error reports. The only error template permitted to use helpers is `error-404.hbs`.

```html
<!-- error.hbs -->
<!doctype html>
<html lang="en">
  <head>
    <title>{{statusCode}} — {{message}}</title>
    <link rel="shortcut icon" href="{{asset "favicon.ico"}}">
    <link rel="stylesheet" href="{{asset "public/ghost.css" hasMinFile="true"}}"/>
  </head>
  <body>
    <h1 class="error-code">{{statusCode}}</h1>
    <h2 class="error-description">{{message}}</h2>
    <a class="error-link" href="{{@site.url}}">Go to the front page →</a>
    {{#if errorDetails}}{{#foreach errorDetails}}
      <em>{{{rule}}}</em>
      {{#foreach failures}}<p>Ref: {{ref}}</p><p>Message: {{message}}</p>{{/foreach}}
    {{/foreach}}{{/if}}
  </body>
</html>
```

Sources: [Index](https://docs.ghost.org/themes/contexts/index-context), [Page](https://docs.ghost.org/themes/contexts/page), [Post](https://docs.ghost.org/themes/contexts/post), [Author](https://docs.ghost.org/themes/contexts/author), [Tag](https://docs.ghost.org/themes/contexts/tag), [Error](https://docs.ghost.org/themes/contexts/error)

## 5. Global data objects
| Object | Scope | Type |
| - | - | - |
| `@site` | Everywhere | object |
| `@config` | Everywhere | object |
| `@page` | Pages | object |
| `@custom` | Everywhere | object |

### `@site` — global settings
| Property | Meaning |
| - | - |
| `@site.accent_color` | Hex code for the theme's accent color as defined in Design settings |
| `@site.admin_url` | URL for your Ghost admin |
| `@site.codeinjection_head` | Site header global code injection |
| `@site.codeinjection_foot` | Site footer global code injection |
| `@site.cover_image` | Site cover image from General settings |
| `@site.description` | Site description from General settings |
| `@site.facebook` | Facebook URL from General settings |
| `@site.icon` | Publication icon from General settings |
| `@site.locale` | Configured site language |
| `@site.logo` | Site logo from General settings |
| `@site.navigation` | Navigation information configured in Navigation settings |
| `@site.timezone` | Timezone as configured in General settings |
| `@site.title` | Site title from General settings |
| `@site.twitter` | Twitter URL from General settings |
| `@site.url` | URL specified for this site in your custom config file |

### `@site` — member data and options
| Property | Type | Meaning |
| - | - | - |
| `@site.allow_self_signup` | boolean | True if new members can sign up themselves (membership not private or turned off) |
| `@site.comments_access` | string | Membership level required to comment (`all`, `paid`, `off`) |
| `@site.comments_enabled` | boolean | True if comments enabled |
| `@site.members_enabled` | boolean | True if subscription access is not set to "Nobody" |
| `@site.members_invite_only` | boolean | True if subscription access is set to "Only people I invite" |
| `@site.members_support_address` | string | Email set for member support |
| `@site.paid_members_enabled` | boolean | True if members is enabled and Stripe is connected |
| `@site.portal_button_icon` | string | Image URL when using a custom Portal button icon |
| `@site.portal_button_signup_text` | string | Sign-up text for the Portal button |
| `@site.portal_button_style` | string | Portal button style (`Icon and text`, `Icon only`, or `Text only`) |
| `@site.portal_button` | boolean | True if Portal button is enabled |
| `@site.portal_name` | boolean | True if name field is included in signup form |
| `@site.portal_plans` | — | Portal plan names |
| `@site.recommendations_enabled` | boolean | True if recommendations are enabled |
| `@site.portal_signup_checkbox_required` | boolean | True if signup requires accepting agreement to terms |
| `@site.portal_signup_terms_html` | string (HTML) | HTML of the signup terms as set in Portal |
| `@site.signup_url` | string | URL for members signup via Portal or Feedly RSS subscription, based on subscription access setting |

### `@site` — meta data (Site Meta Settings in General Settings)
`@site.meta_title`, `@site.meta_description`, `@site.twitter_image`, `@site.twitter_title`, `@site.twitter_description`, `@site.og_image` (used when shared on Facebook and across the web), `@site.og_title`, `@site.og_description`.

```html
<!-- default.hbs -->
<html lang="{{@site.locale}}">
<nav class="main-nav overlay clearfix">
    {{#if @site.logo}}
        <a class="blog-logo" href="{{@site.url}}"><img src="{{@site.logo}}" alt="Blog Logo" /></a>
    {{/if}}
    <a class="admin-login" href="{{@site.admin_url}}">Admin</a>
</nav>
```

Members gating uses booleans directly, e.g. `{{#unless @site.members_invite_only}}<form data-members-form>...</form>{{/if}}`.

### `@config`
Passes through the special theme config from `package.json` so it can be used anywhere in Handlebars. At the moment **only one property** is passed through, because all other properties are accessed with their own helpers: `{{@config.posts_per_page}}` — the number of posts per page.

```handlebars
{{#get "posts" filter="featured:true" limit=@config.posts_per_page}}
  {{#foreach posts}}<h1>{{title}}</h1>{{/foreach}}
{{/get}}
```

```json
{ "name": "my-theme", "version": "1.0.0", "author": { "email": "my@address.here" }, "config": {} }
```

(The published snippet omits the comma after the `author` block, making it invalid JSON as printed — the above shows the corrected shape.)

### `@page`
- `@page.show_title_and_feature_image` — `true` (default) or `false` boolean toggle set on the page settings panel in the editor.

It lets editors hide a page's title and feature image per page, useful for pages that look radically different from posts (full-width headers, CTAs, landing pages); gate relevant markup in page templates for the toggle to take effect.

```handlebars
{{#match @page.show_title_and_feature_image}}
...content...
{{/match}}
```

Documented styling guidance: when the title and feature image are hidden and content starts with a full-width card (class `.kg-width-full`), remove spacing between top navigation and content on pages only; when multiple full-width cards are stacked, remove spacing between them on posts and pages; when content ends with a full-width card, remove spacing between content and footer on pages only. Full-width-capable cards: header, signup, image, video. A captioned image or video carries `.kg-card-hascaption`, where keeping spacing is desirable.

### `@custom`
Attributes are set by individual themes in `package.json`. Depending on type, `@custom` works with `{{#if}}` or `{{#match}}` to customise behaviour.

```html
<body class="{{body_class}} {{#match @custom.typography "Elegant serif"}}font-alt{{/match}}">
    <section class="footer-cta">
        {{#if @custom.cta_text}}<h2>{{@custom.cta_text}}</h2>{{/if}}
        <a href="#portal/signup">Sign up now</a>
    </section>
</body>
```

Fallbacks: default text for a `text` setting belongs in `package.json` (so blank strings are handled correctly) and is guarded with `{{#if}}`. The only exception is when the theme must have text — then add a theme-side fallback with `{{else}}`:

```handlebars
{{#if @custom.copyright_text_override}}
	{{@custom.copyright_text_override}}
{{else}}
	{{@site.title}} © {{date format="YYYY"}}
{{/if}}
```

Sources: [@site](https://docs.ghost.org/themes/helpers/data/site), [@config](https://docs.ghost.org/themes/helpers/data/config), [@page](https://docs.ghost.org/themes/helpers/data/page), [@custom](https://docs.ghost.org/themes/helpers/data/custom), [Custom Settings](https://docs.ghost.org/themes/custom-settings)

## 6. Required global helpers
Required helpers for a working theme: `{{asset}}`, `{{body_class}}`, `{{post_class}}`, `{{ghost_head}}`, `{{ghost_foot}}`.

| Helper | Required placement | Outputs |
| - | - | - |
| `{{ghost_head}}` | Just before `</head>` in `default.hbs` | Meta description; Schema.org structured data as JSON/LD; Facebook Open Graph and Twitter Card tags; RSS url paths for feed discovery; scripts to enable the Ghost API; global and page-level Code Injection |
| `{{ghost_foot}}` | Just before `</body>` in `default.hbs` | Global and page-level Code Injection |
| `{{body_class}}` | The `<body>` tag | Context classes (section 3) plus custom-font classes |
| `{{post_class}}` | The post container element | `post`, `featured`, `page`, `tag-:slug` |
| `{{asset "asset-path"}}` | Wherever a theme-file URL is needed | Correct path under `assets/`, with cache-busting query string |
| `{{> "partial"}}` | Wherever the chunk belongs | Partial inlined from `partials/`, inheriting context |
| `{{!< default}}` | Top of a child template | Declares the layout this template extends |
| `{{{block "name"}}}` / `{{#contentFor "name"}}` | Block in the layout, contentFor in the child | Named content slots |
| `{{{body}}}` | In `default.hbs` | The rendered child template body |

### ghost_head / ghost_foot
They "output vital system information at the top and bottom of the document, and provide hooks to inject additional scripts and styles."

```handlebars
<html>
    <head>...{{ghost_head}}</head>
    <body class="{{body_class}}">
        <div class="site-wrapper">{{{body}}}</div>
        {{ghost_foot}}
    </body>
</html>
```

### body_class and post_class
Static classes: `home-template` (home page template), `post-template` (all posts), `page-template` (all pages), `tag-template` (all tag index pages), `author-template` (all author pages), `private-template` (all page types when password-protected access is activated). Dynamic classes: `page-{slug}`, `tag-{slug}`, `author-{slug}`.

```handlebars
<body class="{{body_class}}">
```

`post_class` rules: every post gets `post`; featured posts get `featured`; static pages get `page`; each associated tag contributes `tag-:slug`.

| Post | Documented output |
| - | - |
| Not featured, not a page, tags `photo` and `panoramic` | `post tag-photo tag-panoramic` |
| Featured, tag `photo` | `post tag-photo featured` |
| Featured page, tags `photo` and `panoramic` | `post tag-photo tag-panoramic featured page` |

```html
<article class="{{post_class}}">{{content}}</article>
```

### asset
Purposes: (1) the relative path to an asset is always correct regardless of install location, including subdirectory installs, without absolute URLs; (2) assets can be cached — all are served with a `?v=#######` query string which currently changes when Ghost is restarted; (3) stability as Ghost's asset handling evolves; (4) it imposes structure by requiring an `assets` folder. Pass the path relative to the `assets` folder. `hasMinFile` serves a minified asset in production and the unminified file in development.

```handlebars
<link rel="stylesheet" type="text/css" href="{{asset 'css/style.css'}}" />
<!-- minified in production, unminified in development -->
<link rel="stylesheet" type="text/css" href="{{asset 'css/style.css' hasMinFile='true'}}" />
<script type="text/javascript" src="{{asset 'js/index.js'}}"></script>
<img src="{{asset 'images/my-image.jpg'}}" />
```

### partials
`{{> "partials"}}` reuses chunks of template code — post cards, headers, components. All partials live in the theme's `partials/` directory, and partials inherit context, making that context available inside the partial file. Partials take properties, e.g. `{{> "call-to-action" heading="Sign up now"}}` read inside the partial as `{{heading}}`.

```handlebars
{{#foreach posts}}{{> "post-card"}}{{/foreach}}
```

```html
<!-- partials/post-card.hbs -->
<article class="post-card">
  <h2 class="post-card-title"><a href="{{url}}">{{title}}</a></h2>
  <p>{{excerpt words="30"}}</p>
</article>
```

**Dynamic partials** pick a partial name with a sub-expression. Use the **block form**, not the inline form: the block form falls back to its inner content when the named partial doesn't exist, whereas the inline form throws a page error and breaks the rendered page. The closing tag must be `{{/undefined}}`.

```handlebars
{{#> (concat "icons/" type)}}
  {{!-- Fallback rendered when no matching partial exists --}}
  <span class="icon icon-default">{{name}}</span>
{{/undefined}}
```

### Layout inheritance, block, contentFor, body
`{{{block "block-name"}}}` creates a placeholder slot in a custom template that can optionally be filled when the template is inherited. `{{#contentFor "block-name"}}...{{/contentFor}}` populates a block defined in the inherited template. The inherited template is referenced with `{{!< template-name}}` at the top of the file. If `contentFor` is not used, the block is gracefully skipped.

```handlebars
<!-- default.hbs -->
<body>
    {{{block "scripts"}}}
</body>
```

```handlebars
<!-- page.hbs -->
{{!< default}}

{{#contentFor "scripts"}}
    <script>runPageScripts();</script>
{{/contentFor}}
```

`{{{body}}}` behaves similarly to a defined block helper but doesn't require a corresponding `contentFor` helper in the inheriting template: a child such as `post.hbs` starts with `{{!< default}}` and its markup becomes `{{{body}}}` in the layout.

### Common mistakes
| Mistake | Consequence / rule |
| - | - |
| `{{ghost_head}}` anywhere but just before `</head>` | Documented placement requirement |
| `{{ghost_foot}}` anywhere but just before `</body>` | Documented placement requirement |
| `{{post.url}}` instead of opening a context | Docs: always use the `{{url}}` helper explicitly for all resources, e.g. `{{#post}}{{url}}{{/post}}` |
| Theme helpers inside `error.hbs` / `error-4xx.hbs` / `error-5xx.hbs` | Can produce misleading error reports; only `{{asset}}` is allowed, and only `error-404.hbs` may use helpers |
| Extending `default.hbs` from a non-404 error template | Explicitly discouraged |
| Defining `{{{block}}}` inside `post.hbs`, `page.hbs`, or `index.hbs` | Templates used directly by Ghost can inherit and use `contentFor` but "cannot contain block definitions" |
| Inline form for dynamic partials | Throws a page error; use `{{#> ...}}` closed with `{{/undefined}}` |
| Editing `.hbs` or `package.json` in production expecting live reload | Requires `ghost restart` |
| Not using `{{asset}}` for theme files | Loses subdirectory correctness and cache-busting |

Sources: [Structure](https://docs.ghost.org/themes/structure), [ghost_head & ghost_foot](https://docs.ghost.org/themes/helpers/utility/ghost_head_foot), [body_class](https://docs.ghost.org/themes/helpers/utility/body_class), [post_class](https://docs.ghost.org/themes/helpers/utility/post_class), [asset](https://docs.ghost.org/themes/helpers/utility/asset), [partials](https://docs.ghost.org/themes/helpers/utility/partials), [block](https://docs.ghost.org/themes/helpers/utility/block)

## 7. Routing and URLs
All routing configuration lives in `content/settings/routes.yaml`, editable directly or uploadable/downloadable in Ghost admin under `Settings » Labs`. Manual edits need a Ghost restart; uploading in admin updates routes immediately. YAML uses indentation for structure and the **only** nesting that works is **2 spaces**; wrong type or quantity of spacing is the most common reason YAML files fail. Trailing slashes on routes are **required** for dynamic routing to work.

### Default routes.yaml
```yaml
routes:

collections:
  /:
    permalink: /{slug}/
    template: index

taxonomies:
  tag: /tag/{slug}/
  author: /author/{slug}/
```

The home route displays all posts using `index.hbs`; each post renders on a URL determined by its `{slug}`.

| Property | Description |
| - | - |
| `template` | Which Handlebars template file is used for this route. Defaults to `index.hbs` if not specified. |
| `permalink` | The generated URL for any post within a collection. Variables: `{id}` (e.g. `5982d807bcf38100194efd67`), `{slug}` (e.g. `my-post`), `{year}` (e.g. `2019`), `{month}` (e.g. `04`), `{day}` (e.g. `29`), `{primary_tag}` (slug of first tag, e.g. `news`), `{primary_author}` (slug of first author, e.g. `cameron`) |
| `filter` | Filter posts in collections and channels with Ghost Content API filter syntax, e.g. `author:cameron+tag:news` |
| `order` | `published_at desc` (*default*, newest first), `published_at asc` (oldest first), `featured desc, published_at desc` (featured first, then newest) |
| `data` | Fetch and associate Ghost API data with a route; the source route of the data is redirected to the new custom route. `post.slug` -> `{{#post}}`, `page.slug` -> `{{#page}}`, `tag.slug` -> `{{#tag}}`, `author.slug` -> `{{#author}}` |
| `rss` | Collections and channels get automatic RSS feeds; set `false` to disable |
| `content_type` | Mime-type for the route; default `HTML` (e.g. `text/xml`, `json`) |
| `controller` | Adds a custom controller; the only currently supported value is `channel` |

### Custom routes
Map individual URLs to specific template files; leave off `.hbs`. There is no default data associated with template routes — unlike posts and pages, content is not automatically loaded from Ghost. Routes can use letters, numbers, slashes, hyphens and underscores, and can simulate subdirectories.

```yaml
routes:
  /features/: features
  /guides/: guides

  # Bind a route to a Ghost page's data; the page's original URL redirects here
  /about/team/:
    template: team
    data: page.team

  # Feed / API endpoint: override the mime-type (pass json for JSON)
  /podcast/rss/:
    template: podcast-feed
    content_type: text/xml
```

The `data` example assigns all data from the Ghost **page** with slug `team` to the route, makes it available inside a `{{#page}}` block helper in `team.hbs`, and automatically redirects the original URL of the content to the new one to prevent duplicate content. Feeds are typically assembled with the `{{#get}}` helper.

### Collections
Collections are major sections of a site representing distinct content types (e.g. `blog`, `podcast`). They serve two purposes: display all contained posts on a paginated index route, and determine the URL structure of their posts. **A post can only ever be in one collection.**

```yaml
collections:
  /:
    permalink: /{slug}/
    template: index
```

A custom homepage moves the collection and points `/` at a static template — `routes: { /: home }` with `collections: /blog/: permalink: /blog/{slug}/, template: index`. Filtering collections and loading data into a collection index:

```yaml
collections:
  /blog/:
    permalink: /blog/{slug}/
    template: blog
    filter: primary_tag:blog
  /podcast/:
    permalink: /podcast/{slug}/
    template: podcast
    filter: primary_tag:podcast
  /portfolio/:
    permalink: /work/{slug}/
    template: work
    filter: primary_tag:work
    data: tag.work
```

`primary_tag` is the *first* tag entered in the tag list in the editor, so it is always unique. If posts match the filter of multiple collections this leads to problems with post rendering and collection pagination — keep collection filters unique. Multi-language sites use two collections with complementary private-tag filters, e.g. `filter: 'tag:-hash-de'` on `/` and `filter: 'tag:hash-de'` on `/de/` with `permalink: /de/{slug}/`. With `data: tag.work`, `work.hbs` gains all data and metadata from the `work` tag, and `site.com/tag/work/` redirects to `site.com/portfolio/`.

### Taxonomies
Groupings of posts by author or tag. Ghost automatically generates archives such as `/tag/getting-started/`. Unlike collections, posts can appear in multiple taxonomies and a post's URL is unaffected by them. The default configuration is `tag: /tag/{slug}/` and `author: /author/{slug}/`.

A post by `Cameron` tagged `News` appears on `site.com` (the collection index), `site.com/author/cameron`, and `site.com/tag/news/`. Each gets automatic RSS feeds via `/rss/` appended to the URL. Only prefixes can be adapted — you cannot define new or custom taxonomies. Removing taxonomies entirely means also updating templates so they no longer link to archives that will now 404.

```yaml
# Rename the prefixes
taxonomies:
  tag: /topic/{slug}/
  author: /host/{slug}/

# Or remove them entirely
taxonomies:
  ## Nothing but silence
```

### Channels
A channel is a custom stream of paginated content matching a specific filter — "a set of permanent search results." Unlike collections, channels have no influence over a post's URL or location, so posts can belong to any number of channels. Channels come with automatic RSS feeds; add `/rss/` to any channel URL.

```yaml
routes:
  /apple-news/:
    controller: channel
    filter: tag:[iphone,ipad,mac]
  /editors-column/:
    controller: channel
    filter: tag:column+primary_author:cameron
```

### `terms` and `redirects` in routes.yaml
Two items named in this section's brief are **not** documented on the fetched routing page:

- **`terms`** — no `terms` property appears in the official routing documentation fetched here. The documented top-level keys are `routes`, `collections`, `taxonomies`.
- **`redirects`** — redirects are *not* part of `routes.yaml`. They live in `content/data/redirects.yaml`, also downloadable/uploadable in Ghost Admin settings. Prior to Ghost 4.0 redirects may be JSON; both formats are supported but JSON support will be removed later. Uploading via admin is recommended; replacing the file on the server requires a restart.

Redirects are not recommended for: www or HTTP/HTTPS page rules (use your DNS provider), trailing-slash duplicate content (Ghost forces trailing slashes automatically), or changing URL structure (use dynamic routing instead — though `redirects.yaml` may still be needed to forward existing content).

### Complete worked example
```yaml
## routes.yaml — routes + collections + taxonomies + channels + rss

routes:
  /features/: features          # static custom route -> features.hbs
  /guides/: guides              # nested static route -> guides.hbs
  /about/team/:                 # bind a Ghost page's data; /team/ redirects here
    template: team
    data: page.team
  /podcast/rss/:                # custom RSS feed
    template: podcast-feed
    content_type: text/xml
  /apple-news/:                 # channels: filtered streams, post URLs unchanged
    controller: channel
    filter: tag:[iphone,ipad,mac]
    rss: false
  /editors-column/:
    controller: channel
    filter: tag:column+primary_author:cameron
    order: featured desc, published_at desc

collections:
  /:                            # main collection on the root URL
    permalink: /{slug}/
    template: index
    filter: 'tag:-hash-de'
    order: published_at desc
  /portfolio/:                  # prefixed permalink + index data from a tag
    permalink: /work/{slug}/
    template: work
    filter: primary_tag:work
    data: tag.work
  /de/:                         # locale collection
    permalink: /de/{slug}/
    template: index-de
    filter: 'tag:hash-de'

taxonomies:
  tag: /topic/{slug}/
  author: /host/{slug}/
```

Redirects go in the separate `content/data/redirects.yaml`:

```yaml
## content/data/redirects.yaml

301:
  /old-url/: /new-url/
  /legacy/post/: /blog/legacy-post/
```

### How URL patterns select templates and data
- A collection's index route uses its `template` (default `index.hbs`) and lists posts matching its `filter`; `permalink` builds each post URL from the listed variables.
- A template route with no `data` gets no Ghost content; `template` picks the file.
- `data: <model>.<slug>` binds that model into the matching block helper (`{{#post}}`, `{{#page}}`, `{{#tag}}`, `{{#author}}`) and redirects the model's native URL to the route.
- `controller: channel` turns a route into a filtered, paginated stream with RSS.
- `content_type` changes the response mime-type for feed/JSON endpoints.
- Taxonomies generate tag/author archives using the `tag.hbs` / `author.hbs` / `index.hbs` fallbacks from section 1.

### Limitations and troubleshooting
| Issue | Detail |
| - | - |
| Slugs can conflict | Routing has no concept of Ghost's slugs and vice-versa. A route `/about/` and a page `about` cannot both work; manage manually. |
| Collections must be unique | A post matching two collection filters breaks rendering and pagination; base filters on always-unique properties like `primary_tag`. |
| Trailing slashes are required | All documented routes use trailing slashes. |
| Adding custom routes | Add entries under the `routes:` key; restart Ghost for manual edits, or upload in admin for immediate effect. |

Sources: [URLs & Dynamic Routing](https://docs.ghost.org/themes/routing)

## 8. Assets and images
Ghost automatically compresses and resizes images added to post content and generates automatic responsive assets. For all other images — feature images and theme images — responsive images build srcsets into your theme and display scaled-down images where required.

### The assets/ directory and `{{asset}}` semantics
`{{asset}}` requires an `assets` folder, which is where Ghost knows theme assets live. Conventionally it holds `css/`, `fonts/`, `images/`, `js/`; theme screenshots are also placed there (e.g. `assets/screenshot-desktop.jpg`). Paths passed to `{{asset}}` are relative to `assets/`.

- Produces a correct relative path regardless of install location, including Ghost installed in a subdirectory, without absolute URLs.
- Assets are served with a `?v=#######` query string which currently changes when Ghost is restarted — this is the cache-busting mechanism.
- `hasMinFile='true'` serves a minified asset in production and the unminified file in development.
- Using `{{asset}}` insulates themes from future changes in Ghost's asset handling.

### `{{img_url}}`
Usage: `{{img_url value}}`. You **must** tell the helper which image to output, e.g. `{{img_url feature_image}}`.

| Option | Documented behaviour |
| - | - |
| `absolute="true"` | Forces an absolute URL, e.g. `{{img_url profile_image absolute="true"}}`. "This is almost never needed." |
| `size="..."` | Outputs the image resized per your theme config (`config.image_sizes`) |
| `format="..."` | Converts image format. Documented values: `webp`, `avif`, `png`, `jpg`, `jpeg`, `gif`. **Only works in combination with `size`.** |

```handlebars
{{#post}}
  {{#if feature_image}}<img src="{{img_url feature_image}}">{{/if}}
  {{!-- at a size defined in your theme's package.json --}}
  <img src="{{img_url feature_image size="small"}}">
  {{!-- size is required when converting format --}}
  <img src="{{img_url feature_image size="small" format="webp"}}">
  {{#author}}<img src="{{img_url profile_image}}">{{/author}}
{{/post}}
```

### Image size names and pixel dimensions
Ghost does **not** ship a fixed vocabulary of size names with fixed pixel dimensions. Sizes are **theme-defined** under `config.image_sizes` in `package.json`; Ghost generates copies at the specified sizes and works like a cache, so sizes can be changed at any time. Docs recommend no more than 10 image sizes so media storage doesn't grow out of control. The documented sample — the image sizes in Ghost's default Casper theme:

| Size key | Documented width (px) |
| - | - |
| `xxs` | 30 |
| `xs` | 100 |
| `s` | 300 |
| `m` | 600 |
| `l` | 1000 |
| `xl` | 2000 |

```json
// package.json

"config": {
    "image_sizes": {
        "xxs": { "width": 30 },
        "xs": { "width": 100 },
        "s": { "width": 300 },
        "m": { "width": 600 },
        "l": { "width": 1000 },
        "xl": { "width": 2000 }
    }
}
```

The `size` value must match a key your theme defines. The docs' own examples are inconsistent (`size="small"` and `size="large"` appear in helper docs while the Casper sample defines `xxs`/`xs`/`s`/`m`/`l`/`xl`). Treat your `package.json` keys as authoritative and use those exact names.

### Responsive srcset
To build full responsive images, create HTML srcsets passing multiple sizes and let the browser do the rest:

```handlebars
<img
    srcset="{{img_url feature_image size="s"}} 300w,
            {{img_url feature_image size="m"}} 600w,
            {{img_url feature_image size="l"}} 1000w,
            {{img_url feature_image size="xl"}} 2000w"
    sizes="(max-width: 1000px) 400px, 700px"
    src="{{img_url feature_image size="m"}}"
    alt="{{#if feature_image_alt}}{{feature_image_alt}}{{else}}{{title}}{{/if}}"
/>
```

The `srcset` fragment above reconstructs the documented Casper pattern: the source page's `index.hbs` snippet is rendered truncated mid-attribute in the `.md` endpoint (the `srcset=` string is cut off), so the attribute is rebuilt from the documented size keys and the pattern used in the docs' `<picture>` example below.

### Format conversion with fallbacks
Converting PNG, GIF, or JPEG to WebP reduces size by ~25% without visible quality loss. AVIF compresses better but isn't supported in all browsers (and doesn't support animation yet). WebP is supported by all modern browsers, but always add a fallback to the original file type via `<picture>`, which lets the browser choose the first format it supports:

```handlebars
<picture>
    <!-- AVIF if supported; remove when using animated images as feature images -->
    <source type="image/avif"
        srcset="{{img_url feature_image size="s" format="avif"}} 300w, {{img_url feature_image size="m" format="avif"}} 600w, {{img_url feature_image size="l" format="avif"}} 1000w, {{img_url feature_image size="xl" format="avif"}} 2000w"
        sizes="(min-width: 1400px) 1400px, 92vw">
    <!-- WebP if supported -->
    <source type="image/webp"
        srcset="{{img_url feature_image size="s" format="webp"}} 300w, {{img_url feature_image size="m" format="webp"}} 600w, {{img_url feature_image size="l" format="webp"}} 1000w, {{img_url feature_image size="xl" format="webp"}} 2000w"
        sizes="(min-width: 1400px) 1400px, 92vw">
    <!-- original format as fallback -->
    <img
        srcset="{{img_url feature_image size="s"}} 300w, {{img_url feature_image size="m"}} 600w, {{img_url feature_image size="l"}} 1000w, {{img_url feature_image size="xl"}} 2000w"
        sizes="(min-width: 1400px) 1400px, 92vw"
        src="{{img_url feature_image size="xl"}}"
        alt="{{#if feature_image_alt}}{{feature_image_alt}}{{else}}{{title}}{{/if}}">
</picture>
```

Note: image conversion changes the file type but the file extension stays the same — an AVIF image retains the `.jpg` extension.

### Compatibility
Image sizes are generated automatically for all feature images and theme images, and regenerated whenever an image changes, the image sizes configuration changes, or theme changes are made. Images are generated on the first request for each image at a particular size. Dynamic image sizes are **not** compatible with externally hosted images (except inserted images from Unsplash). With a third-party storage adapter, the returned image URL is determined by the external source.

Sources: [Assets](https://docs.ghost.org/themes/assets), [img_url](https://docs.ghost.org/themes/helpers/data/img_url), [asset](https://docs.ghost.org/themes/helpers/utility/asset)
