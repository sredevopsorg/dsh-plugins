# Ghost data helpers and theme features

Source of truth: the official Ghost documentation pages fetched for this file. Option names, defaults, output shapes and code examples are reproduced literally; nothing is reconstructed from memory. Facts taken from Ghost source rather than a docs page (gscan validation rules, the Portal package, the Lexical code-block renderer) are cited as source and labelled.

Fetched pages, all HTTP 200: [data helper index](https://docs.ghost.org/themes/helpers/data.md) and every per-helper page linked from it ([authors](https://docs.ghost.org/themes/helpers/data/authors.md), [comments](https://docs.ghost.org/themes/helpers/data/comments.md), [content](https://docs.ghost.org/themes/helpers/data/content.md), [date](https://docs.ghost.org/themes/helpers/data/date.md), [excerpt](https://docs.ghost.org/themes/helpers/data/excerpt.md), [social_accounts](https://docs.ghost.org/themes/helpers/data/social_accounts.md), [social_url](https://docs.ghost.org/themes/helpers/data/social_url.md), [img_url](https://docs.ghost.org/themes/helpers/data/img_url.md), [link](https://docs.ghost.org/themes/helpers/data/link.md), [meta_data](https://docs.ghost.org/themes/helpers/data/meta_data.md), [navigation](https://docs.ghost.org/themes/helpers/data/navigation.md), [post](https://docs.ghost.org/themes/helpers/data/post.md), [price](https://docs.ghost.org/themes/helpers/data/price.md), [readable_url](https://docs.ghost.org/themes/helpers/data/readable_url.md), [recommendations](https://docs.ghost.org/themes/helpers/data/recommendations.md), [tags](https://docs.ghost.org/themes/helpers/data/tags.md), [tiers](https://docs.ghost.org/themes/helpers/data/tiers.md), [title](https://docs.ghost.org/themes/helpers/data/title.md), [total_members](https://docs.ghost.org/themes/helpers/data/total_members.md), [total_paid_members](https://docs.ghost.org/themes/helpers/data/total_paid_members.md), [url](https://docs.ghost.org/themes/helpers/data/url.md)); features [Content](https://docs.ghost.org/themes/content.md), [Search](https://docs.ghost.org/themes/search.md), [Share](https://docs.ghost.org/themes/share.md), [Members](https://docs.ghost.org/themes/members.md), [Custom Settings](https://docs.ghost.org/themes/custom-settings.md). Supporting pages: [post context](https://docs.ghost.org/themes/contexts/post.md), [author context](https://docs.ghost.org/themes/contexts/author.md), [tag context](https://docs.ghost.org/themes/contexts/tag.md), [Structure](https://docs.ghost.org/themes/structure.md), [Assets](https://docs.ghost.org/themes/responsive-images.md), [@site](https://docs.ghost.org/themes/helpers/data/site.md), [@custom](https://docs.ghost.org/themes/helpers/data/custom.md), [@config](https://docs.ghost.org/themes/helpers/data/config.md), [@page](https://docs.ghost.org/themes/helpers/data/page.md), [foreach](https://docs.ghost.org/themes/helpers/functional/foreach.md), [has](https://docs.ghost.org/themes/helpers/functional/has.md), [get](https://docs.ghost.org/themes/helpers/functional/get.md), [search helper](https://docs.ghost.org/themes/helpers/utility/search.md), [ghost_head/foot](https://docs.ghost.org/themes/helpers/utility/ghost_head_foot.md), [post_class](https://docs.ghost.org/themes/helpers/utility/post_class.md), [reading_time](https://docs.ghost.org/themes/helpers/utility/reading_time.md), [link_class](https://docs.ghost.org/themes/helpers/utility/link_class.md), and [Moment.js format tokens](https://momentjs.com/docs/#/displaying/format/) (the page Ghost links to for date formatting).

---

## 1. Post and content objects

### `{{#post}}` (block) and `{{#foreach posts}}` (block)

`{{#post}} ... {{/post}}` opens the post object for the current route; the docs describe it as "More `object` than helper – Contains all data for a specific post" ([post](https://docs.ghost.org/themes/helpers/data/post.md)). It is used on `post.hbs` / `page.hbs`; static pages use the same block. Test featured posts with `{{#if featured}}{{/if}}` ("Featured posts get an extra class so that they can be styled differently. They are not moved to the top of the post list").

`{{#foreach posts}}{{/foreach}}` iterates a list ("is the common way to iterate through the list" on `index.hbs`/`tag.hbs`); `{{#foreach}}` "is a special loop helper designed for working with lists of posts. It can also iterate over lists of tags or users if needed" and "should **always** be used instead of Handlebars `each` when working with Ghost themes" ([foreach](https://docs.ghost.org/themes/helpers/functional/foreach.md)). Both forms place you "inside the post scope" with the same attributes and helpers ([post](https://docs.ghost.org/themes/helpers/data/post.md)).

`{{#foreach}}` options ([foreach](https://docs.ghost.org/themes/helpers/functional/foreach.md)):

| Name | Values | Documented behaviour |
| - | - | - |
| `limit` | `limit="3"` | Stop after that many iterations; ignored if larger than the collection. |
| `from` | `from="2"` | 1-indexed and inclusive. |
| `to` | `to="5"` | 1-indexed and inclusive; may be used with or without `from`. |
| `visibility` | `all` or `none` | Default shows public data only ("hidden tiers and internal tags won't be included"); `all` shows everything, `none` shows hidden data. |
| `columns` | `columns="3"` | Enables `@rowStart` / `@rowEnd`. |
| `as \|name\|` | block param | Names the current item inside the loop. |

Iteration variables: `@index` (0-based), `@number` (1-based), `@key` (object key), `@first`, `@last`, `@odd`, `@even`, `@rowStart`, `@rowEnd`; `{{else}}` runs when there is no data.

```handlebars
{{#post}}
<article class="{{post_class}}">
  <h1 class="post-title">{{title}}</h1>
  <time datetime="{{date format='YYYY-MM-DD'}}">{{date format="DD MMMM YYYY"}}</time>
  {{tags prefix=" on "}}
  <section class="post-content">{{content}}</section>
</article>
{{/post}}

{{#foreach posts limit="3"}}
<article class="{{post_class}}"><a href="{{url}}">{{title}}</a> {{excerpt words="26"}}</article>
{{else}}<p>No posts.</p>{{/foreach}}
```

### Post object attributes

From [post context](https://docs.ghost.org/themes/contexts/post.md) ("Post object attributes"):

| Attribute | Meaning |
| - | - |
| `id` / `comment_id` | Object ID; `comment_id` is the old pre-1.0 incremental id if present, else the new Object ID |
| `title` / `slug` | Title; slugified title (used in urls and useful as a class name) |
| `excerpt` / `content` | Short preview; post content |
| `url` | Post URL (always output with the `{{url}}` helper, not `{{post.url}}`) |
| `feature_image` / `feature_image_alt` / `feature_image_caption` | Cover image URL; alt text; caption (supports basic html) |
| `featured` / `page` | Featured flag, defaults to `false`; `true` if the post is a page, defaults to `false` |
| `meta_title` / `meta_description` | Custom meta values from the post settings |
| `published_at` / `updated_at` / `created_at` | Publication, last-update and creation timestamps |
| `primary_author` / `tags` / `primary_tag` | Formatted first author; list of tags; reference to the first tag |

Post-context helpers: `{{title}}`, `{{content}}`, `{{url}}`, `{{author}}`, `{{date}}`, `{{excerpt}}`, `{{img_url}}`, `{{post_class}}`, `{{tags}}`. Template hierarchy: `post-:slug.hbs` → selected `custom-*.hbs` → `post.hbs`.

### `{{title}}` (inline)

"Outputs a post title ensuring it displays correctly" ([title](https://docs.ghost.org/themes/helpers/data/title.md)). Signature `{{title}}`; no options.

```handlebars
{{#post}}<h1 class="post-title">{{title}}</h1>{{/post}}
```

### `{{content}}` (inline)

Outputs post HTML ([content](https://docs.ghost.org/themes/helpers/data/content.md)). Signature `{{content}}`; option `words` — `{{content words="100"}}` "will output just 100 words of HTML with correctly matched tags". On members-enabled sites, visitors without access get "a default upgrade/sign up CTA", overridable via `./partials/content-cta.hbs`.

```handlebars
{{#post}}<section class="post-content">{{content}}</section>{{/post}}
{{content words="100"}}
```

### `{{excerpt}}` (inline)

Outputs the summary with HTML stripped ([excerpt](https://docs.ghost.org/themes/helpers/data/excerpt.md)). Signature `{{excerpt}}`. Literal resolution rules: if `custom_excerpt` is set it is always output, "ignoring the `words` & `characters` attributes"; "When both `html` and `custom_excerpt` properties are not set (for example, when member content gating strips the `html`) the output is generated from the post's `excerpt` property"; the `excerpt` property "is limited to the first 500 characters of the post's plaintext output". Options: `words` (`{{excerpt words="50"}}` → 50 words, up to the generated excerpt length), `characters` (`{{excerpt characters="140"}}` → 140 characters, "rounding to the end of the current word").

```handlebars
{{excerpt words="26"}}
{{excerpt characters="140"}}
```

### `{{url}}` (inline)

Outputs the relative URL for a post inside the post scope ([url](https://docs.ghost.org/themes/helpers/data/url.md)). Signature `{{url}}`; option `absolute` — `{{url absolute="true"}}` forces an absolute URL.

```handlebars
{{#post}}<a href="{{url absolute="true"}}">{{title}}</a>{{/post}}
```

### `{{date}}` (inline)

Signature `{{date value format="formatString"}}` ([date](https://docs.ghost.org/themes/helpers/data/date.md)). Positional `value` is a date property such as `published_at`; attributes: `format` (Moment format string), `timezone`, `locale`, `timeago="true"`.

Defaults: "If you call `{{date}}` without a format, it will default to a short localised format, `ll`." Without a value: (1) uses `published_at` if available, (2) otherwise the current date. The docs warn: "If you use the `timeago` flag on a site that uses caching - as on Ghost(Pro) - dates will be displayed relative to when the page gets cached rather than relative to the visitor's current time."

```handlebars
{{date published_at format="MMMM DD, YYYY"}}            {{! July 11, 2016 }}
{{date published_at locale="fr-fr" timezone="Europe/Paris"}}
{{date published_at timeago="true"}}                    {{! 5 mins ago }}
<time datetime="{{date format="YYYY-MM-DD"}}">{{date format="DD MMMM YYYY"}}</time>
<p>© {{date format="YYYY"}}</p>
```

Localized preset tokens (Moment.js "Localized formats", linked from the Ghost date page):

| Token | Output | Meaning |
| - | - | - |
| `LT` / `LTS` | 8:30 PM / 8:30:25 PM | Time; time with seconds |
| `L` / `l` | 09/04/1986 / 9/4/1986 | Month numeral, day of month, year (lowercase = short) |
| `LL` / `ll` | September 4, 1986 / Sep 4, 1986 | Month name, day of month, year (`ll` is Ghost's default) |
| `LLL` / `lll` | September 4, 1986 8:30 PM / Sep 4, 1986 8:30 PM | …plus time |
| `LLLL` / `llll` | Thursday, September 4, 1986 8:30 PM / Thu, Sep 4, 1986 8:30 PM | …plus day of week |

Custom format tokens (Moment.js [Display/Format](https://momentjs.com/docs/#/displaying/format/): "It takes a string of tokens and replaces them with their corresponding values"). Tokens are case-sensitive; escape literal text in square brackets, e.g. `format="[Today is] dddd"`.

| Group | Tokens → documented output |
| - | - |
| Month | `M` `1..12` · `Mo` `1st 2nd..` · `MM` `01..12` · `MMM` `Jan Feb..` · `MMMM` `January February..` |
| Quarter | `Q` `1 2 3 4` · `Qo` `1st 2nd 3rd 4th` |
| Day of Month | `D` `1..31` · `Do` `1st..31st` · `DD` `01..31` |
| Day of Year | `DDD` `1..365` · `DDDo` ordinal · `DDDD` `001..365` |
| Day of Week | `d` `0..6` · `do` ordinal · `dd` `Su Mo..` · `ddd` `Sun Mon..` · `dddd` `Sunday Monday..` |
| Day of Week (Locale / ISO) | `e` `0..6` · `E` `1..7` |
| Week of Year | `w` `1..53` · `wo` ordinal · `ww` `01..53` |
| Week of Year (ISO) | `W` `1..53` · `Wo` ordinal · `WW` `01..53` |
| Year | `YY` `70 71..` · `YYYY` `1970 1971..` · `YYYYYY` expanded years · `Y` ISO 8601 past year 9999 |
| Era Year / Era | `y` `1 2..2020` · `N`/`NN`/`NNN` `BC AD` · `NNNN` `Before Christ, Anno Domini` · `NNNNN` narrow era |
| Week Year / (ISO) | `gg` `gggg` · `GG` `GGGG` → `70 71..` / `1970 1971..` |
| AM/PM | `A` `AM PM` · `a` `am pm` |
| Hour | `H` `0..23` · `HH` `00..23` · `h` `1..12` · `hh` `01..12` · `k` `1..24` · `kk` `01..24` |
| Minute / Second | `m` `0..59` · `mm` `00..59` · `s` `0..59` · `ss` `00..59` |
| Fractional Second | `S` `0..9` · `SS` `00..99` · `SSS` `000..999` · `SSSS ... SSSSSSSSS` (3 significant digits, rest zero-filled) |
| Time Zone | `z`/`zz` (`EST CST..`; deprecated for plain moments, works with moment-timezone) · `Z` `-07:00` · `ZZ` `-0700` |
| Unix Timestamp | `X` `1360013296` · `x` `1360013296123` |

### `{{reading_time}}` (inline)

Renders the estimated reading time ([reading_time](https://docs.ghost.org/themes/helpers/utility/reading_time.md)). "counts the words in the post and calculates an average reading time of 275 words per minute. For the first image present, 12s is added, for the second 11s is added, for the third 10, and so on. From the tenth image onwards every image adds 3s." Default text: `x min read` above one minute, `1 min read` at or below one minute. Options: `minute`, `minutes` (plural uses `%` as the minutes value).

```handlebars
{{#post}}{{reading_time}}{{/post}}
{{reading_time minute="Only a minute" minutes="Takes % minutes"}}
```

### `{{post_class}}` (inline)

Outputs classes for the post container ([post_class](https://docs.ghost.org/themes/helpers/utility/post_class.md)): `post` (all posts), `featured`, `page`, and `tag-:slug` for each tag. Documented examples: `post tag-photo tag-panoramic`; `post tag-photo featured`; `post tag-photo tag-panoramic featured page`.

```handlebars
<article class="{{post_class}}">{{content}}</article>
```

---

## 2. Authors, tags, tiers, and plans

### `{{authors}}` (inline)

"A formatting helper for outputting a linked list of authors for a particular post. It defaults to a comma-separated list (without list markup) but can be customised to use different separators, and the linking can be disabled. The authors are output in the order they appear on the post" ([authors](https://docs.ghost.org/themes/helpers/data/authors.md)).

| Option | Documented behaviour |
| - | - |
| `separator` | `{{authors separator=" \| "}}` → `sam \| carl \| tobias`. |
| `prefix` / `suffix` | Prepended/appended text; HTML allowed; usable with the translation helper. |
| `autolink="false"` | "turn this off" — authors are no longer linked to their author pages. |
| `limit` | `{{authors limit="1"}}` outputs just the first author. |
| `from` / `to` | 1-indexed ranges, usable together or alone; "Using `to` will override the `limit` attribute". `{{authors from="1" to="1"}}` equals `{{authors limit="1"}}`. |
| `visibility` | Defaults to the string `"public"`; any other value, a comma-separated list, or `"all"` may be passed; "if there is no matching value for `visibility` nothing will be output". |

```handlebars
{{authors separator=" • " prefix="More about:"}}
{{authors autolink="false"}}
{{authors limit="1"}}
{{authors from="2"}}

{{#post}}
  {{#if authors}}
    <ul>{{#foreach authors}}<li><a href="{{url}}" class="author author-{{id}} {{slug}}">{{name}}</a></li>{{/foreach}}</ul>
  {{/if}}
{{/post}}
```

Author attributes ([authors](https://docs.ghost.org/themes/helpers/data/authors.md), [author context](https://docs.ghost.org/themes/contexts/author.md)): `id`, `name`, `slug`, `profile_image`, `cover_image`, `bio`, `website`, `location`, `facebook`, `twitter`, `threads`, `bluesky`, `mastodon`, `tiktok`, `youtube`, `instagram`, `linkedin`, `meta_title`, `meta_description`, `url`.

### `{{#author}}` (block) and `{{primary_author}}`

`{{#author}} ... {{/author}}` is the author scope on `author.hbs`; the author context provides the author object, an array of posts, and a pagination object, with templates `author-:slug.hbs` → `author.hbs` → `index.hbs` ([author context](https://docs.ghost.org/themes/contexts/author.md)). `{{primary_author}}` outputs the singular first author and also works as a block ([authors](https://docs.ghost.org/themes/helpers/data/authors.md)).

```handlebars
{{#primary_author}}<div class="author"><a href="{{url}}">{{name}}</a><span class="bio">{{bio}}</span></div>{{/primary_author}}

{{#author}}
  {{#if profile_image}}<img src="{{img_url profile_image}}" alt="{{name}}'s Picture" />{{/if}}
  <h1 class="author-title">{{name}}</h1>
  {{#if bio}}<h2 class="author-bio">{{bio}}</h2>{{/if}}
{{/author}}
```

### `{{tags}}` (inline)

"A formatting helper for outputting a linked list of tags ... defaults to a comma-separated list (without list markup)"; tags keep their post order. "The `{{tags}}` helper does not output internal tags. This can be changed by passing a different value to the `visibility` attribute." ([tags](https://docs.ghost.org/themes/helpers/data/tags.md)).

| Option | Documented behaviour |
| - | - |
| `separator` | `{{tags separator=" \| "}}` → `my-tag \| my-other-tag \| more tagging`; HTML allowed. |
| `prefix` / `suffix` | `{{tags separator=" \| " prefix="Tagged in:"}}`; HTML allowed; usable with the translation helper. |
| `autolink="false"` | Disables linking each tag to its tag page. |
| `limit` | `{{tags limit="1"}}` outputs just the first tag. |
| `from` / `to` | 1-indexed; `to` overrides `limit`; `{{tags from="1" to="1"}}` equals `{{tags limit="1"}}`. |
| `visibility` | Defaults to `"public"`; `"internal"` outputs only internal tags; comma-separated lists and `"all"` supported; no match outputs nothing. |

```handlebars
{{tags separator=" | " prefix="Tagged in:"}}
{{tags autolink="false"}}
{{tags limit="1"}}
{{tags visibility="all"}}

{{#post}}
  {{#if tags}}<ul>{{#foreach tags}}<li><a href="{{url}}" class="tag tag-{{id}} {{slug}}">{{name}}</a></li>{{/foreach}}</ul>{{/if}}
{{/post}}
```

Tag attributes: `id`, `name`, `slug`, `description`, `feature_image`, `meta_title`, `meta_description`, `url`, `accent_color`. `{{primary_tag}}` opens the first tag as a scope; indexed access is 0-based: `{{tags.[1].name}}` is the second tag and `{{#tags.[1]}} ... {{/tags.[1]}}` opens it ([tags](https://docs.ghost.org/themes/helpers/data/tags.md)).

```handlebars
{{#primary_tag}}<div class="primary-tag"><a href="{{url}}">{{name}}</a><span class="description">{{description}}</span></div>{{/primary_tag}}
{{tags.[1].name}}
```

### `{{#tag}}` in `tag.hbs` (block)

On tag archives, "Use the block expression (`{{#tag}}{{/tag}}`) to drop into the tag scope and access all of the attributes." Templates: `tag-:slug.hbs` → `tag.hbs` → `index.hbs` ([tag context](https://docs.ghost.org/themes/contexts/tag.md)).

```handlebars
<!-- tag.hbs -->
{{#tag}}
  {{#if feature_image}}<img src="{{feature_image}}" alt="{{name}}" />{{/if}}
  <h1>{{name}}</h1>
  {{#if description}}<h2>{{description}}</h2>{{/if}}
{{/tag}}
<main role="main">{{> "loop"}}</main>
{{pagination}}
```

### `{{tiers}}` (inline)

Formats tier names ([tiers](https://docs.ghost.org/themes/helpers/data/tiers.md)). Signature `{{tiers}}` / `{{tiers prefix=":" separator=" - " lastSeparator=", " suffix='options'}}`. "It defaults to a comma-separated list with `and` as the last separator and `tier(s)` as the suffix"; output is "in ascending order by price"; values are white-space sensitive. Options `prefix`, `separator`, `lastSeparator`, `suffix` all "accept HTML values".

```handlebars
{{tiers}}                          {{! "bronze, silver and gold tiers" }}
{{tiers prefix="Access with:"}}    {{! "Access with: bronze, silver and gold tiers" }}
{{tiers separator=" | "}}          {{! "bronze | silver and gold tiers" }}
{{tiers lastSeparator=" plus "}}   {{! "bronze, silver plus gold tiers" }}
{{tiers suffix="options"}}         {{! "bronze, silver and gold options" }}
```

Formatting only; fetch tier data with `{{#get "tiers" include="monthly_price,yearly_price,benefits" limit="100" as |tiers|}}` then `{{#foreach tiers}}` ([tiers](https://docs.ghost.org/themes/helpers/data/tiers.md), [get](https://docs.ghost.org/themes/helpers/functional/get.md)).

### `{{price}}` (inline)

Formats monetary values "from their smallest denomination to a human readable denomination with currency formatting" ([price](https://docs.ghost.org/themes/helpers/data/price.md)). Signature `{{price plan}}` (outputs `$5`); static values work too — `{{price 4200}}` outputs `42`.

| Option | Default | Values |
| - | - | - |
| `currency` | `plan.currency` when passed a `plan` object | e.g. `"USD"` |
| `locale` | `@site.locale` | locale string |
| `numberFormat` | `"short"` | `"short"` (`$5`) or `"long"` (`$5.00`) |
| `currencyFormat` | `"symbol"` | `"symbol"` (`$5`), `"code"` (`EUR 5`) or `"name"` (`5 euros`) |

The documented default behaviour is `{{price plan.amount currency=plan.currency locale=@site.locale numberFormat="short" currencyFormat="symbol"}}`. Passing a currency without a price outputs only the symbol: `{{price currency="USD"}}` → `$`.

```handlebars
{{#foreach tiers}}
  {{#if monthly_price}}<a href="javascript:" data-portal="signup/{{id}}/monthly">Monthly – {{price monthly_price currency=currency}}</a>{{/if}}
  {{#if yearly_price}}<a href="javascript:" data-portal="signup/{{id}}/yearly">Yearly – {{price yearly_price currency=currency}}</a>{{/if}}
{{/foreach}}

{{#foreach @member.subscriptions}}<span>{{price plan}}/{{plan.interval}}</span>{{/foreach}}
```

### `{{total_members}}` / `{{total_paid_members}}` (inline)

Rounded, humanised totals; no options ([total_members](https://docs.ghost.org/themes/helpers/data/total_members.md), [total_paid_members](https://docs.ghost.org/themes/helpers/data/total_paid_members.md)). "If you have 1225 members, it will output `1,200+`." "For values above 100,000 it will output `100k+` and `3m+` respectively."

```handlebars
{{total_members}}
{{total_paid_members}}
```

---

## 3. Metadata, URLs, and navigation

### `{{meta_title}}`, `{{meta_description}}`, `{{canonical_url}}` (inline)

"Ghost generates automatic meta data by default, but it can be overridden with custom content in the post settings menu. Meta data is output by default in [ghost_head]" ([meta_data](https://docs.ghost.org/themes/helpers/data/meta_data.md)). Definitions: `{{meta_title}}` – "the meta title specified for the post or page in the post settings"; `{{meta_description}}` – "the meta description specified for the post or page in the post settings"; `{{canonical_url}}` – "the custom canonical URL set for the post".

```handlebars
<title>{{meta_title}}</title>
<meta name="description" content="{{meta_description}}">
<link rel="canonical" href="{{canonical_url}}">
```

Site-level equivalents on `@site`: `meta_title`, `meta_description`, `og_title`, `og_description`, `og_image`, `twitter_title`, `twitter_description`, `twitter_image` ([@site](https://docs.ghost.org/themes/helpers/data/site.md)).

### `{{readable_url}}` (inline)

Signature `{{readable_url URL}}`; "outputs a human-readable URL by stripping out its protocol, www, query paramters, and hash fragments. It doesn't strip out any subdomains or pathnames." Documented outputs: `https://google.com` → `google.com`; `www.google.com` → `google.com`; `https://google.com?foo=bar&dog=love` → `google.com`; `https://google.com#section-1` → `google.com`; `https://ghost.org/about` → `ghost.org/about`; `https://account.ghost.org` → `account.ghost.org` ([readable_url](https://docs.ghost.org/themes/helpers/data/readable_url.md)).

```handlebars
{{readable_url rec.url}}
```

### `{{#link}}` (block)

"Creates links with dynamic classes ... it will create an anchor element that wraps around any kind of string, HTML or handlebars constructed HTML. With additional options it can have an active `class` or `target` behaviour, or `onclick` JavaScript events. A `href` attribute must be included or an error will be thrown." "All attributes associated with the `<a></a>` element can be used in `{{#link}}`." `activeClass` default output is `nav-current` (`{{#link href="/about/" activeClass="current"}}` → `<a href="/about/" class="current">`), and `activeClass=false` "will output an empty string. Effectively turning off the behaviour." Variables do not need quotation marks: `{{#link href=@site.url}}Home{{/link}}` ([link](https://docs.ghost.org/themes/helpers/data/link.md)).

```handlebars
{{#link href="/about/"}}About{{/link}}
{{#link href="/about/" activeClass="current"}}About{{/link}}
{{#foreach posts}}{{#link href=(url) class="post-link" activeClass="active"}}{{title}}{{/link}}{{/foreach}}
```

Related `{{link_class for="/about/"}}`: outputs `nav-current` when the viewed URL matches `for`; `class="current-about"` adds an extra class when active ("`nav-current` ... will be added last"); parent URLs get `nav-parent` (`/tags/` is parent-active on `/tags/toast/`); `activeClass=false` disables ([link_class](https://docs.ghost.org/themes/helpers/utility/link_class.md)).

### `{{navigation}}` / `{{navigation type="secondary"}}` (inline)

Outputs formatted HTML for menus defined in Settings > Design > Navigation; "There are two types of navigation, primary and secondary, which you can access using `{{navigation}}` and `{{navigation type="secondary"}}`" ([navigation](https://docs.ghost.org/themes/helpers/data/navigation.md)). Default markup:

```html
<ul class="nav">
    <li class="nav-home nav-current"><a href="/">Home</a></li>
    <li class="nav-about"><a href="/about/">About</a></li>
    <li class="nav-contact"><a href="/contact/">Contact</a></li>
    ...
</ul>
```

Customising: "creating a new file at `./partials/navigation.hbs`. If this file exists, Ghost will load it instead of the default template." Note: "Creating a new `navigation.hbs` will overwrite both the main navigation as and secondary navigation. To customise the secondary navigation differently use the `{{#if isSecondary}}...{{/if}}` helper."

```handlebars
{{! partials/navigation.hbs }}
{{#if isSecondary}}
    <ul class="nav" role="menu">
        {{#foreach navigation}}<li class="nav-{{slug}}" role="menuitem"><a href="{{url}}">{{label}}</a></li>{{/foreach}}
    </ul>
{{else}}
    <ul class="nav" role="menu">
        {{#foreach navigation}}
        <li class="{{link_class for=(url) class=(concat "nav-" slug)}}" role="menuitem"><a href="{{url absolute="true"}}">{{label}}</a></li>
        {{/foreach}}
    </ul>
{{/if}}
```

Navigation item attributes, usable "only ... inside the `{{#foreach navigation}}` loop inside `./partials/navigation.hbs`": `{{label}}` (link text), `{{url}}` (see url helper), `{{current}}` (boolean, URL matches the current page), `{{slug}}` (slugified name, e.g. `about-us`, usable as a class). "The navigation helper doesn't output anything if there are no navigation items"; the same data is global as `@site.navigation` and `@site.secondary_navigation` ([navigation](https://docs.ghost.org/themes/helpers/data/navigation.md)).

```handlebars
{{#if @site.navigation}}<a class="menu-button" href="#"><span class="word">Menu</span></a>{{/if}}
{{#if @site.secondary_navigation}}<a class="menu-button" href="#"><span class="word">Menu</span></a>{{/if}}
```

### `{{#social_accounts}}` (block)

Iterates connected social accounts; "The source must be passed as a positional argument" — `@site`, `this` inside `{{#foreach authors}}`, or `author` on an author page ([social_accounts](https://docs.ghost.org/themes/helpers/data/social_accounts.md)). Per-account variables: `type` (platform key, e.g. `x`, `bluesky`), `href` (full profile URL), `username` (raw stored handle or URL fragment), `name` (human-readable platform label). Iteration variables `@index`, `@number`, `@first`, `@last`, `@odd`, `@even`; supports `{{else}}` when no accounts are connected. Supported platforms: `x`, `facebook`, `linkedin`, `bluesky`, `threads`, `mastodon`, `tiktok`, `youtube`, `instagram` ("Platforms without a value set on the source are skipped").

```handlebars
{{#social_accounts @site}}
<a href="{{href}}" target="_blank" rel="noopener" aria-label="{{name}}"><span class="icon icon-{{type}}">{{name}}</span></a>
{{else}}<p>No social accounts connected yet.</p>{{/social_accounts}}

{{#foreach authors}}{{#social_accounts this}}<a href="{{href}}">{{name}}</a>{{/social_accounts}}{{/foreach}}
{{#author}}{{#social_accounts author}}<a href="{{href}}">{{name}}</a>{{/social_accounts}}{{/author}}
```

Dynamic per-platform icon partials must use the block form: "The inline form (`{{> (concat "icons/" type)}}`) looks tempting, but it throws a page error if the named partial doesn't exist ... gscan rejects the inline form on purpose for this reason." The closing tag must be `{{/undefined}}`.

```handlebars
{{#social_accounts @site}}
<a href="{{href}}" target="_blank" rel="noopener" aria-label="{{name}}">
  {{#> (concat "icons/" type)}}<span class="icon icon-web">{{name}}</span>{{/undefined}}
</a>
{{/social_accounts}}
```

### `{{social_url}}` (inline)

Signature `{{social_url type="platform"}}`. Lookup: "When called inside an author scope (e.g. `{{#author}}` or `{{#foreach authors}}`), the helper looks up the platform on the current author first, then falls back to the sitewide value from `@site`. Outside an author scope, it reads directly from `@site`. If neither has a value, the helper outputs nothing." Supported platforms on this page: `facebook`, `twitter`, `linkedin`, `threads`, `bluesky`, `mastodon`, `tiktok`, `youtube`, `instagram` (the `{{#social_accounts}}` page lists `x` instead of `twitter`; both lists are reproduced literally) ([social_url](https://docs.ghost.org/themes/helpers/data/social_url.md)).

```handlebars
{{#author}}{{#if threads}}<a href="{{social_url type="threads"}}">Follow me on Threads</a>{{/if}}{{/author}}
{{#if @site.bluesky}}<a href="{{social_url type="bluesky"}}">Follow us on Bluesky</a>{{/if}}
```

---

## 4. Images

### `{{img_url}}` (inline)

"Outputs the correctly calculated URL for the provided image property. You **must** tell the `{{img_url}}` helper which image you would like to output." ([img_url](https://docs.ghost.org/themes/helpers/data/img_url.md)).

| Option | Value | Notes |
| - | - | - |
| (positional) | image property: `feature_image`, `profile_image`, `@custom.cta_background_image`, … | Required. |
| `absolute` | `"true"` | "Force the image helper to output an absolute URL ... This is almost never needed." Default relative. |
| `size` | a key from the theme's `config.image_sizes` | "pass in [dynamic image sizes] via the `size` option". |
| `format` | `webp`, `avif`, `png`, `jpg`, `jpeg`, or `gif` | "only works in combination with the `size` option." |

```handlebars
{{#post}}
  {{#if feature_image}}<img src="{{img_url feature_image}}">{{/if}}
  <img src="{{img_url feature_image size="small"}}">
  <img src="{{img_url feature_image size="small" format="webp"}}">
  <img src="{{img_url author.profile_image absolute="true"}}">
  {{#author}}<img src="{{img_url profile_image}}">{{/author}}
{{/post}}
<img src="{{img_url @custom.cta_background_image size="large"}}" />
```

### Documented sizes and responsive configuration

Sizes are declared in `package.json` under `config.image_sizes`, each entry an object with `width`. "Ghost automatically generates copies of images at the specified sizes, and works like a cache ... It's recommended to have no more than 10 image sizes" ([Assets](https://docs.ghost.org/themes/responsive-images.md)).

```json
"config": { "image_sizes": {
    "xxs": { "width": 30 }, "xs": { "width": 100 }, "s": { "width": 300 },
    "m": { "width": 600 }, "l": { "width": 1000 }, "xl": { "width": 2000 }
} }
```

```handlebars
<img class="post-image"
    srcset="{{img_url feature_image size="s"}} 300w, {{img_url feature_image size="m"}} 600w,
            {{img_url feature_image size="l"}} 1000w, {{img_url feature_image size="xl"}} 2000w"
    sizes="(max-width: 1000px) 400px, 700px"
    src="{{img_url feature_image size="m"}}"
    alt="{{#if feature_image_alt}}{{feature_image_alt}}{{else}}{{title}}{{/if}}" />
```

Format caveats (literal): converting PNG/GIF/JPEG to WebP "can reduce its size by ~25% without any visible loss of quality"; AVIF compresses better but "isn't supported in all browsers"; "while image conversion changes the file type, the file extension stays the same. For example, an AVIF image will retain the `.jpg` extension." Use `<picture>` with `type="image/avif"` and `type="image/webp"` sources plus the original as fallback. Compatibility: "Dynamic image sizes are *not* compatible with externally hosted images (except inserted images from Unsplash)." ([Assets](https://docs.ghost.org/themes/responsive-images.md)).

### Feature-image fields

`feature_image`, `feature_image_alt`, `feature_image_caption` ("supports basic html"), `featured` ([post context](https://docs.ghost.org/themes/contexts/post.md)); authors have `profile_image` and `cover_image`; tags have `feature_image` and `accent_color`.

```handlebars
{{#post}}
  {{#if feature_image}}
    <figure>
      <img src="{{img_url feature_image size="l"}}" alt="{{feature_image_alt}}" />
      {{#if feature_image_caption}}<figcaption>{{feature_image_caption}}</figcaption>{{/if}}
    </figure>
  {{/if}}
{{/post}}
```

---

## 5. Members, subscriptions, and paywalls

Members can be activated by any theme through Portal, "an embeddable memberships feature that can be enabled and customised from the Admin UI" ([Members](https://docs.ghost.org/themes/members.md)).

### Portal links and `{{ghost_head}}` injection

`{{ghost_head}}` "belongs just before the `</head>` tag in `default.hbs`" and outputs meta description, "Structured data Schema.org microformats in JSON/LD", Facebook Open Graph and Twitter Card tags, RSS url paths, "Scripts to enable the Ghost API", and code injection; `{{ghost_foot}}` "belongs just before the `</body>` tag" and outputs code injection ([ghost_head & ghost_foot](https://docs.ghost.org/themes/helpers/utility/ghost_head_foot.md)). Portal is injected by Ghost, so `data-portal` and `#/portal/...` links work without extra scripts.

```html
<a href="https://example.com/#/portal/signup">Subscribe</a>  {{! absolute: homepage + Portal }}
<a href="#/portal/signup">Subscribe</a>                      {{! relative: Portal on current page }}
```

- `data-portal="signup/TIER_ID/monthly"` and `data-portal="signup/TIER_ID/yearly"` direct visitors to a Stripe payment form pre-filled with the selected plan; "The data attribute for monthly/yearly plan of a tier can be fetched from Portal settings" ([Members](https://docs.ghost.org/themes/members.md)).
- `data-portal="recommendations"` opens the recommendations modal ([recommendations](https://docs.ghost.org/themes/helpers/data/recommendations.md)).
- "When using the `data-portal` data attribute to control the Portal UI, additional classes `gh-portal-open` and `gh-portal-close` are added to the element to allow custom styling of open and closed states." Portal page identifiers from source: `signin`, `signup`, `accountHome`, `accountPlan`, `accountProfile`, `accountEmail`, `signupNewsletter`, `unsubscribe`, `magiclink`, `offer`, `feedback`, `support`, `recommendations`, `gift`, `share` ([apps/portal/src/pages.js](https://github.com/TryGhost/Ghost/blob/main/apps/portal/src/pages.js)).

```handlebars
<a href="javascript:" data-portal="signup/TIER_ID/monthly">Monthly plan</a>
<a href="javascript:" data-portal="signup/TIER_ID/yearly">Yearly plan</a>
<button data-portal="recommendations">Show all recommendations</button>
```

### Signup, sign-in and account forms

Documented data attributes ([Members](https://docs.ghost.org/themes/members.md)):

| Attribute | Element | Meaning |
| - | - | - |
| `data-members-form` | form | Standard email collection signup form. |
| `data-members-form="signin"` | form | "sends a signin email to existing members when a valid email is entered." |
| `data-members-form="signup"` | form | "sends a signup email to new members. Uses 'sign up' in email text. If a valid email is present, a signin email is sent instead." |
| `data-members-form="subscribe"` | form | "sends a subscribe email. Uses 'subscription' in email text. If a valid email is present, a signin email is sent instead." |
| `data-members-email` | input | Email field. |
| `data-members-name` | input | Capture a member's name at signup. |
| `data-members-newsletter` | input | Value is a newsletter name; multiple inputs (hidden, radio or checkbox) subscribe to multiple newsletters. |
| `data-members-label` | hidden input | Applies a label from the form, e.g. `value="Early Adopters"`. |
| `data-members-error` | child of form or anchor | Error message container ("Errors could include too many attempts to sign up or trying to subscribe to a newsletter that no longer exists"). |
| `data-members-autoredirect` | form | `"false"`: "the user will be redirected to the publication's homepage when logging in"; `true` (the default): back to the page where they signed up. |
| `data-members-otc="true"` | form | Adds a one-time-code option alongside the default magic link. |
| `data-members-signout` | anchor/button | Sign out: `<a href="javascript:" data-members-signout>Sign out</a>`. |
| `data-members-manage-billing` | anchor | Links to the Stripe customer billing portal. |
| `data-members-return` | anchor | "direct the member to a different URL when they close the billing portal". |

```handlebars
<form data-members-form>
  <label>Name <input data-members-name /></label>
  <label>Email <input data-members-email type="email" required="true"/></label>
  <input data-members-newsletter type="hidden" value="Weekly Threads" />
  <input data-members-label type="hidden" value="Early Adopters" />
  <button type="submit">Subscribe</button>
  <p data-members-error></p>
</form>

<form data-members-form="signin" data-members-otc="true">
  <input data-members-email type="email" required="true" placeholder="jamie@example.com" />
  <button type="submit">Sign in</button>
</form>
```

Form states are emitted as classes on the form: `loading`, `success`, `error`. Newsletter checkboxes can be generated with the get helper ([Members](https://docs.ghost.org/themes/members.md), [get](https://docs.ghost.org/themes/helpers/functional/get.md)):

```handlebars
<form data-members-form>
  <input type="email" required data-members-email>
  {{#get "newsletters"}}{{#foreach newsletters}}<label><input type="checkbox" value="{{name}}" data-members-newsletter />{{name}}</label>{{/foreach}}{{/get}}
  <button type="submit">Subscribe</button>
</form>
```

### The `@member` object

| Attribute | Meaning |
| - | - |
| `@member` | "The member object, evaluates to `true` or `false` if the viewer is a member or not". |
| `@member.paid` | "The member's payment status, returns `true` or `false` if the member has an active paid subscription." True for states "active", "trialing", "unpaid" and "past_due". |
| `@member.email` / `@member.name` / `@member.firstname` | Email; full name; "everything before the first whitespace character in the member's full name". |
| `@member.uuid` | "A unique identifier for a member for use with analytics tracking such as Google Tag Manager". |
| `@member.subscriptions` | Array of the member's Stripe subscriptions. |

```handlebars
{{#if @member.paid}}<p>Thanks for becoming a paying member</p>
{{else if @member}}<p>Thanks for being a member</p>
{{else}}<p>You should totally sign up...</p>{{/if}}

{{#if @member}}<a href="javascript:" data-members-signout>Sign out</a>
{{else}}<form data-members-form="signin"><input data-members-email type="email" required="true"/><button type="submit">Sign in</button></form>{{/if}}
```

### Site-level membership flags (`@site`)

`allow_self_signup` (true if members can sign up themselves), `comments_access` (`all`, `paid`, `off`), `comments_enabled`, `members_enabled` ("True if subscription access is not set to 'Nobody'"), `members_invite_only` ("Only people I invite"), `members_support_address`, `paid_members_enabled` ("True if members is enabled and Stripe is connected"), `portal_button_icon`, `portal_button_signup_text`, `portal_button_style` ("`Icon and text`, `Icon only`, or `Text only`"), `portal_button`, `portal_name`, `portal_plans`, `portal_signup_checkbox_required`, `portal_signup_terms_html`, `recommendations_enabled`, `signup_url` ("URL for members signup via Portal or Feedly RSS subscription based on subscription access setting") ([@site](https://docs.ghost.org/themes/helpers/data/site.md)).

```handlebars
{{#unless @site.members_invite_only}}
<form data-members-form><input data-members-email type="email" required="true"/><button type="submit">Continue</button></form>
{{/if}}
```

### Gating: `access`, `visibility`, and `{{#has}}`

- `access` "calculates the access level of the member viewing the post and the access level setting applied to the post. `access` will return `true` if the member's access matches, or exceeds, the access level of the post, and `false` if it doesn't match."
- `visibility` "is relative to the post or page ... `visibility` has 3 possible values: `public`, `members` or `paid`."
- Default CTA: "visitors who don't have access to a post (determined by the `access` property) will see a default call to action in the content area instead, prompting users to upgrade their subscription." Override with `./partials/content-cta.hbs`.
- Archives: "By default, all posts ... will appear in post archives unless the `visibility` parameter is included with the `#foreach` helper". "The content of the posts is still restricted based on the access level of the logged in member." ([Members](https://docs.ghost.org/themes/members.md)).

```handlebars
{{#post}}
  <h1>{{title}}</h1>
  {{#if access}}<p>Thanks for being a member...</p>{{else}}<p>You need to become a member in order to read this post...</p>{{/if}}
  {{content}}
{{/post}}

<article class="post post-access-{{visibility}}"><h1>{{title}} <svg><use xlink:href="#icon-{{visibility}}"></use></svg></h1></article>

{{#foreach visibility="paid"}}<article><h2><a href="{{url}}">{{title}}</a></h2></article>{{/foreach}}

{{#foreach posts}}
  <article>{{#has visibility="paid"}}<span class="premium-label">Premium</span>{{/has}}<h2><a href="{{url}}">{{title}}</a></h2></article>
{{/foreach}}
```

### Subscription data, `next_payment`, offers and cancellation

`@member.subscriptions` attributes ([Members](https://docs.ghost.org/themes/members.md)): `id`; `avatar_image` ("pulled in from Gravatar. If there is not one set for their email a transparent `png` will be returned as a default"); `customer.id`, `customer.name`, `customer.email`; `plan.id`, `plan.nickname` ("currently only 'Monthly' or 'Yearly'"), `plan.interval` ("currently only 'month' or 'year'"), `plan.currency`, `plan.amount` ("in the smallest currency denomination (e.g. USD $5 would be '500' cents)"); `status` ("active", "trialing", "unpaid", "past_due", "canceled"); `start_date`; `default_payment_card_last4`; `cancel_at_period_end`; `current_period_end`; `tier.name`, `tier.description`; `next_payment`; `offer`; `offer_redemptions`.

`next_payment` properties: `amount` ("Amount after discounts, in the smallest currency unit"), `original_amount`, `interval` (`"month"` or `"year"`), `currency`, `discount` ("Active discount details, or `null` when no discount applies"). "`next_payment` is `null` for inactive subscriptions (canceled, expired, etc.), so always guard access with `{{#if}}`." Discount properties: `discount.end` ("When the discount ends (date string), or `null` for forever discounts"), `discount.type` (`"percent"` or `"fixed"`), `discount.amount`, `discount.duration` (`"once"`, `"repeating"`, or `"forever"`), `discount.duration_in_months`. Offer properties: `display_title`, `display_description`, `type` (`"percent"`, `"fixed"`, or `"trial"`), `amount`, `duration`, `cadence`.

```handlebars
{{#foreach @member.subscriptions}}
  <p>Plan: {{plan.nickname}} — {{price plan}}/{{plan.interval}} · Status: {{status}}</p>
  {{#if next_payment}}
    <p>Next payment: {{price next_payment}}/{{next_payment.interval}}
      {{#if next_payment.discount.end}}— Ends {{date next_payment.discount.end format="D MMM YYYY"}}{{else}}— Forever{{/if}}
    </p>
  {{/if}}
  {{#if offer}}<p>Signed up with: {{offer.display_title}}</p>{{/if}}
  <a href="javascript:" data-members-manage-billing data-members-return="/billing-management-closed/">Manage billing &amp; receipts</a>
  {{cancel_link}}
{{/foreach}}
```

`{{cancel_link}}` "must be used in the `@member.subscriptions` context"; it "wraps all of the internals needed to cancel an active subscription or to continue the subscription if it was previously canceled". Options and defaults: `class` = `gh-subscription-cancel`; `errorClass` = `gh-error gh-error-subscription-cancel`; `cancelLabel` = `Cancel subscription`; `continueLabel` = `Continue subscription` ([Members](https://docs.ghost.org/themes/members.md)).

```handlebars
{{cancel_link class="cancel-link" errorClass="cancel-error" cancelLabel="Cancel!" continueLabel="Continue!"}}
```

### `{{comments}}` and `{{comment_count}}` (inline)

"Outputs Ghost's member-based commenting system." "Comments are visible only when they have been (1) enabled by the publication owner and (2) the person visiting the page has access to the post." ([comments](https://docs.ghost.org/themes/helpers/data/comments.md)).

`{{comments}}` attributes:

| Name | Description | Options | Default |
| - | - | - | - |
| `title` | Header text for comment section | Any string | Member discussion |
| `count` | Boolean to toggle comment count on or off | `true` or `false` | `true` |
| `mode` | Set light or dark mode for comments | auto, light, or dark | auto (determined by the parent element's CSS `color` property) |
| `saturation` | Set saturation of avatar background color | `number` | `60` |

`{{comment_count}}` attributes:

| Name | Description | Options | Default |
| - | - | - | - |
| `singular` | The singular name for a comment | Any string | comment |
| `plural` | The plural name for comments | Any string | comments |
| `empty` | What to output when there are no comments | Any string | Output is empty when comment count equals zero |
| `autowrap` | Wraps comment count in an HTML tag | `HTML tag` or `false` | `span` |
| `class` | Add a custom class to wrapper element | Any string | "" |

"`{{#if comments}}` returns true when (1) comments have been enabled and (2) the reader has access to the post."

```handlebars
{{comments title="Join the club" count=false mode="light" saturation=80}}
{{comment_count empty="" singular="comment" plural="comments" autowrap="span" class=""}}  {{! <span>5 comments</span> }}
{{comment_count singular="" plural=""}}   {{! <span>5</span> }}
{{comment_count empty="0"}}               {{! <span>0</span> }}
{{comment_count autowrap="false"}}        {{! 5 comments (just text!) }}

{{#if comments}}
   <h2>Discussion</h2><a href="/guides">Community guidelines</a>{{comment_count}}
   {{comments title="" count=false mode="light" saturation=80}}
{{/if}}
```

### `{{recommendations}}` (inline)

Outputs a list of recommended sites configured in Ghost Admin ([recommendations](https://docs.ghost.org/themes/helpers/data/recommendations.md)).

| Attribute | Default | Documented behaviour |
| - | - | - |
| `limit` | `5` | "Specify the maximum number of recommendations to display." |
| `order` | `created_at desc` | "Order recommendations based on any valid resource field (like `title`) in ascending (`asc`) or descending (`desc`) order." |
| `page` | — | "When the total number of recommendations exceeds the number defined in `limit`, recommendations become paginated." |
| `filter` | — | Logic-based query, e.g. `filter="favicon:-null"`. |

The `recommendation` object contains `id` ("Recommendation ID used to track the number of clicks"), `url`, `favicon`, `featured_image`, `title`, `description`, `created_at`, `updated_at`. Override the default template with `partials/recommendations.hbs`; the default template loops `{{#each recommendations as |rec|}}` and outputs `.recommendations`, `.recommendation`, `.recommendation-favicon`, `.recommendation-title`, `.recommendation-url`, `.recommendation-description`, with `data-recommendation="{{rec.id}}"` and `{{readable_url rec.url}}`.

```handlebars
{{recommendations limit="10" order="title asc" page="2" filter="favicon:-null"}}

{{#match @site.recommendations_enabled}}
    <h2>Recommendations</h2>{{recommendations}}
{{/match}}
<button data-portal="recommendations">Show all recommendations</button>
```

---

## 6. Native search

Sources: [Search](https://docs.ghost.org/themes/search.md), [search helper](https://docs.ghost.org/themes/helpers/utility/search.md).

- "Ghost has a native search feature that can be accessed via URL or implemented directly into themes using a single data attribute."
- URL: "The easiest way to get started with search is by adding a `#/search` URL to the navigation or anywhere on the site."
- Data attribute: "add the `data-ghost-search` data attribute to any element in the theme." Casper example: `<button class="gh-search" data-ghost-search>{{> "icons/search"}}</button>`.
- `{{search}}` "outputs a search icon button that launches Ghost search when clicked." The icon "uses the `currentColor` CSS property, meaning it will match the color of text around it"; override styling with `.gh-search-icon` plus `!important`. It renders:

```html
<button class="gh-search-icon" aria-label="search" data-ghost-search style="display: inline-flex; justify-content: center; align-items: center; width: 32px; height: 32px; padding: 0; border: 0; color: inherit; background-color: transparent; cursor: pointer; outline: none;"><svg width="20" height="20" fill="none" viewBox="0 0 24 24">…</svg></button>
```

```handlebars
{{search}}
<button class="gh-search" data-ghost-search>{{> "icons/search"}}</button>
```

Keyboard and documented limitations: "Both methods allow visitors to search content by clicking on the element to open the search modal or by using the shortcut `Cmd/Ctrl + K`." / "Taxonomies for tags and authors must be present for search results to include tags and authors." / "The post title and excerpt are used to search post content from the most recent 10,000 posts. (Excerpts are excluded for member-only posts)." Larger sites ("more than 10,000 posts, a complex data structure, or require advanced search functionality") should use Algolia via the Algolia Ghost CLI and Algolia Netlify packages.

---

## 7. Social sharing

Source: [Share](https://docs.ghost.org/themes/share.md).

- "Ghost includes a native share modal that lets readers share posts to social platforms without any custom UI or JavaScript in your theme."
- Trigger: "The share modal is triggered by linking to `#/share` on any URL. When a reader clicks a link that ends with `#/share`, Ghost opens a default modal with share options. Selecting a platform opens it with the current post's title and link pre-populated in a draft, ready to publish."
- Wiring: "add a link to `#/share` anywhere in your theme" — "a post footer, a floating share bar, a menu, or inline within post content." "That's it — no additional JavaScript or UI needed."
- Compatibility: "Themes without a `#/share` link will continue to work as normal. All official Ghost themes already include a share link out of the box."
- Portal also exposes `data-portal="share"` (equivalent to `#/share`); on pages where `{{ghost_head}}` is rendered the share preview auto-resolves URL (canonical URL, else current URL), title (Open Graph title, else document title) and image (Open Graph image, else Twitter image) from DOM tags ([apps/portal/README.md](https://github.com/TryGhost/Ghost/blob/main/apps/portal/README.md)).

```html
<a href="#/share">Share</a>
<button type="button" data-portal="share">Share</button>
```

---

## 8. Content and the editor output

Source: [Content](https://docs.ghost.org/themes/content.md).

### What `{{content}}` emits

"For author-specified options to work, themes need to support the HTML markup and CSS classes that are output by the `{{content}}` helper." Images and embeds use `<figure>`/`<figcaption>`:

```html
<figure class="kg-image-card">
    <img class="kg-image" src="https://casper.ghost.org/v1.25.0/images/koenig-demo-1.jpg" width="1600" height="2400" loading="lazy" sizes="...">
    <figcaption>An example image</figcaption>
</figure>
```

Required classes: `.kg-image-card` on the `<figure>` for all image cards; `.kg-image` on the `<img>` for all image cards; `.kg-embed-card` on the `<figure>` for all embed cards. "themes must also support images and embeds that are not wrapped in `<figure>` elements to maintain compatibility with the Markdown and HTML cards."

Image sizes: "The editor allows three size options for images: normal, wide and full width. These size options are achieved by adding `kg-width-wide` and `kg-width-full` classes to the `<figure>` elements in the HTML output." Normal width adds no class. Width/height attributes "correspond to the size and aspect ratio of the source image and do not change when selecting different size options in the editor. *If your theme has a `max-width` style set for images it's important to also have `height: auto`*". Where possible images carry `srcset`/`sizes`:

```html
<figure class="kg-card kg-image-card kg-width-wide">
    <img class="kg-image" src="…/coastline.jpg" alt="A rugged coastline" loading="lazy" width="2000" height="3000" sizes="(min-width: 720px) 720px">
</figure>
```

```css
article img { display: block; max-width: 100%; height: auto; }
.kg-width-wide img { max-width: 85vw; }
.kg-width-full img { max-width: 100vw; }
article figure { margin: 0; }
article figcaption { text-align: center; }
/* breakout alternative documented for themes that need it */
.kg-width-wide { position: relative; width: 85vw; min-width: 100%; margin: auto calc(50% - 50vw); transform: translateX(calc(50vw - 50%)); }
.kg-width-full { position: relative; width: 100vw; left: 50%; right: 50%; margin-left: -50vw; margin-right: -50vw; }
```

GScan-facing requirements (from this skill, not a docs page): `.kg-width-wide` and `.kg-width-full` must be styled — GScan treats their absence as an error — and the content root should be styled as `.gh-content`.

### Card assets (CSS/JS Ghost injects)

"Each of the content cards available in the editor require CSS and Javascript to display and function correctly. These default CSS and Javascript assets are provided automatically by Ghost, and output as `cards.min.css` and `cards.min.js` in the `{{ghost_head}}` helper." Exclude individual cards or all of them via `package.json`:

```json
"card_assets": { "exclude": ["bookmark", "gallery"] }
"card_assets": false
```

`false` disables all cards ("the default is true"). Available card asset names: `audio`, `blockquote`, `bookmark`, `button`, `callout`, `file`, `gallery`, `header`, `nft`, `product`, `toggle`, `video`, `signup`. Code blocks are **not** in this list.

### Card class names

| Card | Class / selector |
| - | - |
| Audio | `.kg-audio-card` |
| Blockquote | `blockquote` or `.kg-blockquote-alt` |
| Bookmark | `.kg-bookmark-card` |
| Button | `.kg-button-card` |
| Callout | `.kg-callout-card` |
| File | `.kg-file-card` |
| Gallery | `.kg-gallery-card` |
| Header | `.kg-header-card` |
| NFT | `.kg-nft-card` |
| Product | `.kg-product-card` |
| Toggle | `.kg-toggle-card` |
| Video | `.kg-video-card` |
| Signup | `.kg-signup-card` |

```css
.kg-product-card .kg-product-card-container { background-color: #f0f0f0; }
```

### Gallery card

"The image gallery card requires some CSS and JS in your theme to function correctly. Themes will be validated to ensure they have styles for the gallery markup": `.kg-gallery-container`, `.kg-gallery-row`, `.kg-gallery-image`.

```html
<figure class="kg-card kg-gallery-card kg-width-wide">
    <div class="kg-gallery-container">
        <div class="kg-gallery-row">
            <div class="kg-gallery-image"><img src="/content/images/1.jpg" width="6720" height="4480" loading="lazy" sizes="..."></div>
            <div class="kg-gallery-image"><img src="/content/images/2.jpg" width="4946" height="3220" loading="lazy" sizes="..."></div>
        </div>
    </div>
</figure>
```

### Bookmark, embed, button, callout, toggle, blockquote

```html
<figure class="kg-card kg-bookmark-card">
    <a href="/" class="kg-bookmark-container">
        <div class="kg-bookmark-content">
            <div class="kg-bookmark-title">The bookmark card</div>
            <div class="kg-bookmark-description">Lorem ipsum dolor sit amet…</div>
            <div class="kg-bookmark-metadata">
                <img src="/content/images/author-icon.jpg" class="kg-bookmark-icon">
                <span class="kg-bookmark-author">David Darnes</span><span class="kg-bookmark-publisher">Ghost</span>
            </div>
        </div>
        <div class="kg-bookmark-thumbnail"><img src="/content/images/article-image.jpg"></div>
    </a>
</figure>

<figure class="kg-card kg-embed-card"><iframe ...></iframe></figure>

<div class="kg-card kg-button-card kg-align-center"><a href="https://example.com/signup/" class="kg-btn kg-btn-accent">Sign up now</a></div>

<div class="kg-card kg-callout-card kg-callout-card-accent">
    <div class="kg-callout-emoji">&#9733;</div><div class="kg-callout-text">Did you know about the callout card?</div>
</div>

<div class="kg-card kg-toggle-card" data-kg-toggle-state="close">
    <div class="kg-toggle-heading"><h4 class="kg-toggle-heading-text">Do you give any discounts ?</h4><button class="kg-toggle-card-icon"><svg …></svg></button></div>
    <div class="kg-toggle-content">Yes, we give 20% off on annual subscriptions.</div>
</div>

<blockquote>Standard blockquote style</blockquote>
<blockquote class="kg-blockquote-alt">Alternative blockquote style</blockquote>
```

```css
.fluid-width-video-wrapper { position: relative; overflow: hidden; padding-top: 56.25%; }
.fluid-width-video-wrapper iframe, .fluid-width-video-wrapper object, .fluid-width-video-wrapper embed {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
```

### Header, signup, NFT, audio, video, file cards

- Header card: `<div class="kg-card kg-header-card kg-width-full kg-size-<size> kg-style-<style>" data-kg-background-image="…">` with `.kg-header-card-header`, `.kg-header-card-subheader`, `.kg-header-card-button`. "The main card can have a `kg-size-` class of either: `kg-size-small`, `kg-size-medium` or `kg-size-large` and a `kg-style-` class of either `kg-style-dark`, `kg-style-light`, `kg-style-accent`, or `kg-style-image`."
- Signup card: `.kg-card.kg-signup-card.kg-width-<size>` with `data-lexical-signup-form`, `.kg-signup-card-content`, `.kg-signup-card-image`, `.kg-signup-card-heading`, `.kg-signup-card-subheading`, `.kg-signup-card-form`/`data-members-form="signup"`, `.kg-signup-card-input`/`data-members-email`, `.kg-signup-card-button`, `.kg-signup-card-success`, `.kg-signup-card-error`. "For `kg-width-<size>`, `size` can be `kg-width-regular`, `kg-width-wide`, or `kg-width-full`." "Full-width and split-layout with contained image cards provide a `kg-content-wide` class"; "Split-layout signup cards ... provide the `kg-layout-split` class."
- NFT card: `.kg-card.kg-embed-card.kg-nft-card` containing `.kg-nft-image`, `.kg-nft-metadata`, `.kg-nft-header`, `.kg-nft-title`, `.kg-nft-creator`, `.kg-nft-creator-name`.
- Audio card: `.kg-card.kg-audio-card` with `.kg-audio-thumbnail`, `.kg-audio-player-container`, `.kg-audio-title`, `.kg-audio-play-icon`, `.kg-audio-pause-icon`, `.kg-audio-current-time`, `.kg-audio-duration`, `.kg-audio-seek-slider`, `.kg-audio-playback-rate`, `.kg-audio-unmute-icon`, `.kg-audio-mute-icon`, `.kg-audio-volume-slider`, `.kg-audio-hide`; full markup and reference CSS/JS are in the docs page.
- Video card: `.kg-card.kg-video-card` with `.kg-video-container`, `.kg-video-overlay`, `.kg-video-large-play-icon`, `.kg-video-player-container`, `.kg-video-play-icon`, `.kg-video-pause-icon`, `.kg-video-current-time`, `.kg-video-duration`, `.kg-video-seek-slider`, `.kg-video-playback-rate`, unmute/mute icons, `.kg-video-volume-slider`.
- File card: `.kg-card.kg-file-card` with `.kg-file-card-container`, `.kg-file-card-title`, `.kg-file-card-caption`, `.kg-file-card-filename`, `.kg-file-card-filesize`, `.kg-file-card-icon`.

The docs page includes the full markup for each and links Ghost's reference CSS/JS per card.

### Code blocks

The Content page names "code" among the editor's dynamic blocks but does not print the markup, and `code` is absent from the `card_assets` list. The markup comes from Ghost's Lexical renderer: an empty code node renders an empty container; otherwise a `<pre>` containing a `<code>` element; a caption wraps the `<pre>` in `<figure class="kg-card kg-code-card">` with a `<figcaption>`; `class="language-<language>"` is set on `<code>` only when a language is set ([kg-default-nodes codeblock-renderer.js](https://cdn.jsdelivr.net/npm/@tryghost/kg-default-nodes@latest/build/esm/nodes/codeblock/codeblock-renderer.js), read from the published npm package, not a docs page).

```html
<pre><code class="language-javascript">const x = 1;</code></pre>

<figure class="kg-card kg-code-card">
  <pre><code class="language-javascript">const x = 1;</code></pre>
  <figcaption>A caption</figcaption>
</figure>
```

A theme must style `pre` / `pre code` itself and may target `.kg-code-card` for captioned code blocks.

### Page-level card layout

`@page.show_title_and_feature_image` is "`true` (default) or `false` boolean toggle set on the page settings panel in the editor", letting editors hide a page's title and feature image ([@page](https://docs.ghost.org/themes/helpers/data/page.md)). Documented styling rules when hidden: remove spacing between top navigation and content if the page starts with a full-width card (`.kg-width-full`); remove spacing between stacked full-width cards on posts and pages; remove spacing between content and footer if content ends with a full-width card on pages. Cards that can be full width: header, signup, image, video. "When an image or video has a caption, it will have the class `.kg-card-hascaption`, and maintaining spacing is desirable in this case."

```handlebars
{{#match @page.show_title_and_feature_image}}…content…{{/match}}
```

---

## 9. Custom theme settings (package.json)

Source: [Custom Settings](https://docs.ghost.org/themes/custom-settings.md); validation rules read from [gscan](https://github.com/TryGhost/gscan) `lib/checks/010-package-json.js` (labelled as source); [@custom](https://docs.ghost.org/themes/helpers/data/custom.md).

### Where settings live and how they surface

- Declared "in the `package.json` file at the `config.custom` key". "Themes are limited to a total of 20 custom settings" (gscan fails themes with more than 20).
- The key "is used as the display name in Ghost Admin, and as the property name on the `@custom` object": `"cta_text"` displays as **CTA Text** and is read as `@custom.cta_text`. "Setting keys must be all lowercase with no special characters and in `snake_case` where each space is represented by an `_`" (gscan enforces snake_case).
- "Changing a setting's key when releasing a new theme version is a breaking change ... The setting with the old key is removed, losing any value entered by the site owner, and a new setting with the current key is created with its default value."
- Groups: "By default, all custom settings appear in the **Site wide** category. Custom settings that are specific to the homepage or post display are defined with an optional `"group"` property with the value `"homepage"` or `"post"`." gscan's known groups are exactly `post` and `homepage`.
- `description`: "Give users more information about what a custom setting does ... Description must be fewer than 100 characters." gscan enforces ≤ 100 characters.

### The five types

"There are five types of custom theme settings available: `select`, `boolean`, `color`, `image`, `text`." gscan's known type set is exactly `['select', 'boolean', 'color', 'image', 'text']`; "All custom settings require a valid `"type"` — an unknown type causes a theme validation error." There is **no documented `textarea` type**; do not emit one.

| Type | Renders | Required keys | Validation (docs + gscan) |
| - | - | - | - |
| `select` | select input | `options` (array of strings), `default` | "`options` is required and must be an array of strings"; gscan requires "at least 2 `options`"; "`default` is required and must match one of the defined options." |
| `boolean` | checkbox toggle | `default` | "`default` is required and must be either `true` or `false`". |
| `color` | color picker | `default` | "`default` is required and must be a valid hexadecimal string"; gscan tests `^#[0-9a-f]{6}$` (e.g. `#15171a`). |
| `image` | image uploader | — | "`default` is not allowed"; in themes "the value will be blank or a URL". |
| `text` | text input | — | "`default` is optional"; "The value may be blank or free-form text." |

Optional keys on any type: `group`, `description`, `visibility`.

### Reading settings in Handlebars

```handlebars
<body class="{{body_class}} {{#match @custom.typography "Elegant serif"}}font-alt{{/match}}">
    <section class="footer-cta">
        {{#if @custom.cta_text}}<h2>{{@custom.cta_text}}</h2>{{/if}}
        <a href="#portal/signup">Sign up now</a>
    </section>
</body>
```

- `select` → `{{#match @custom.feed_layout "Dynamic grid"}} … {{/match}}`.
- `boolean` → `{{#if @custom.recent_posts}} … {{/if}}`.
- `color` → CSS custom property:

```handlebars
<style>:root { {{#if @custom.button_color}}--button-bg-color: {{@custom.button_color}};{{/if}} }</style>
```

- `image` → direct use or through the image helper:

```handlebars
<section class="footer-cta" {{#if @custom.cta_background_image}}style="background-image: url({{@custom.cta_background_image}});"{{/if}}>…</section>
<img src="{{img_url @custom.cta_background_image size="large"}}" />
```

- `text` fallbacks: "The default text for a text setting should be specified in `package.json` instead of adding it in the theme code as a fallback." The exception is text the theme must have, which uses an `{{else}}` fallback:

```handlebars
<h2>{{#if @custom.copyright_text_override}}{{@custom.copyright_text_override}}{{else}}{{@site.title}} © {{date format="YYYY"}}{{/if}}</h2>
```

### Setting visibility (dependent settings)

"Include the `visibility` key on the dependent setting. This key specifies the conditions that must be met for the setting to be displayed. ... You can also use any [NQL syntax] for this — the same syntax used for filtering with the `get` helper." "Note that when the visibility condition isn't met, the dependent setting will render as `null` in the theme." gscan validates that the value parses as NQL and that it only references known custom setting keys.

```json
{
  "header_style": {
    "type": "select",
    "options": ["Landing", "Highlight", "Magazine", "Search", "Off"],
    "default": "Landing",
    "group": "homepage"
  },
  "use_publication_cover_as_background": {
    "type": "boolean",
    "default": false,
    "description": "Cover image will be used as a background when the header style is Landing or Search",
    "group": "homepage",
    "visibility": "header_style:[Landing, Search]"
  },
  "post_feed_style": { "type": "select", "options": ["List", "Grid"], "default": "List", "group": "homepage" },
  "show_images_in_feed": {
    "type": "boolean",
    "default": true,
    "description": "Toggles thumbnails of the post cards when the post feed style is List",
    "group": "homepage",
    "visibility": "post_feed_style:List"
  }
}
```

### Custom fonts

"If you'd like to give users the possibility to select custom fonts, you'll need make sure your theme supports it." Ghost loads the fonts via `{{ghost_head}}` and sets two CSS variables:

```html
<link rel="preconnect" href="https://fonts.bunny.net">
<link rel="stylesheet" href="https://fonts.bunny.net/css?family=fira-mono:400,700|ibm-plex-serif:400,500,600">
<style>:root { --gh-font-heading: Fira Mono; --gh-font-body: IBM Plex Serif; }</style>
```

```css
body { font-family: var(--gh-font-body, Helvetica); }
h1, h2, h3, h4, h5, h6 { font-family: var(--gh-font-heading, var(--theme-font-heading)); }
```

"Selected font names are also injected into `{{body_class}}`", e.g. `<body class="gh-font-heading-fira-mono gh-font-body-ibm-plex-serif">`, allowing per-font fine tuning.

### Complete worked `package.json`

Combines the documented `package.json` shell ([Structure](https://docs.ghost.org/themes/structure.md)), image sizes ([Assets](https://docs.ghost.org/themes/responsive-images.md)), card assets ([Content](https://docs.ghost.org/themes/content.md)) and at least one setting of each of the five types ([Custom Settings](https://docs.ghost.org/themes/custom-settings.md)):

```json
{
    "name": "your-theme-name",
    "description": "A brief explanation of your theme",
    "version": "0.5.0",
    "license": "MIT",
    "author": { "email": "your@email.here" },
    "screenshots": {
        "desktop": "assets/screenshot-desktop.jpg",
        "mobile": "assets/screenshot-mobile.jpg"
    },
    "config": {
        "posts_per_page": 10,
        "image_sizes": {
            "xxs": { "width": 30 },
            "xs": { "width": 100 },
            "s": { "width": 300 },
            "m": { "width": 600 },
            "l": { "width": 1000 },
            "xl": { "width": 2000 }
        },
        "card_assets": { "exclude": ["bookmark", "gallery"] },
        "custom": {
            "typography": {
                "type": "select",
                "options": ["Modern sans-serif", "Elegant serif"],
                "default": "Modern sans-serif",
                "description": "Define the default font used for the publication"
            },
            "feed_layout": {
                "type": "select",
                "options": ["Dynamic grid", "Simple grid", "List"],
                "default": "Dynamic grid",
                "group": "homepage",
                "description": "The layout of the post feed on the homepage, tag, and author pages"
            },
            "recent_posts": { "type": "boolean", "default": true },
            "button_color": { "type": "color", "default": "#15171a" },
            "cta_background_image": { "type": "image" },
            "cta_text": {
                "type": "text",
                "default": "Sign up for more like this",
                "group": "post",
                "description": "Used in a large CTA on the homepage and small one on the sidebar as well"
            },
            "header_style": {
                "type": "select",
                "options": ["Landing", "Highlight", "Magazine", "Search", "Off"],
                "default": "Landing",
                "group": "homepage"
            },
            "use_publication_cover_as_background": {
                "type": "boolean",
                "default": false,
                "description": "Cover image will be used as a background when the header style is Landing or Search",
                "group": "homepage",
                "visibility": "header_style:[Landing, Search]"
            }
        }
    }
}
```

### `@config` (the other package.json surface)

"`@config` will pass through the special theme config that is added in the theme's `package.json` ... At the moment, there is only one property which will be passed through": `{{@config.posts_per_page}}` – "the number of posts per page" (default 5) ([@config](https://docs.ghost.org/themes/helpers/data/config.md)). Supported `config` keys: `config.posts_per_page`, `config.image_sizes`, `config.card_assets`, `config.custom`. "Changes to the `package.json` require a restart using the `ghost restart` command" ([Structure](https://docs.ghost.org/themes/structure.md)).

```handlebars
<a href="{{page_url "next"}}">Show next {{@config.posts_per_page}} posts</a>
{{#get "posts" filter="featured:true" limit=@config.posts_per_page}}{{#foreach posts}}<h1>{{title}}</h1>{{/foreach}}{{/get}}
```

### Documented guidelines

- Settings "should compliment the primary use case of the theme": visual changes (colors, fonts, images) are appropriate ("Simple visual changes"); "Complex layout settings" that alter the theme's primary use case are not.
- Avoid "Repeated settings" (micro-adjustments to single elements) and "Functional settings" (pagination style, removing the primary tag).
- Integrations: ask for "a simple piece of information such as a tracking ID, rather than adding HTML code into a custom text setting"; asking users to paste an embed code is explicitly discouraged.
- "The total number of settings is limited to 20!"
