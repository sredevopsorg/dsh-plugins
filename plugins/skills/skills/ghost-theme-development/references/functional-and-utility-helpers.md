# Ghost functional and utility helpers

Source of truth: official Ghost theme documentation, read page by page. Each helper cites its page; facts are not reconstructed from memory. Footnotes (`[^x]`) carry caveats, limits and deprecation notes taken literally from those pages.

Helper families in Ghost: **functional** helpers are "used to work with data objects"; **data** helpers are "used to output data from your site" (out of scope here — see the [data helper index](https://docs.ghost.org/themes/helpers/data/)); **utility** helpers are "used to perform minor, optional tasks" ([helpers index](https://docs.ghost.org/themes/helpers.md)).

## 1. How helpers work

Ghost themes use Handlebars, which "creates a strong separation between templates (the HTML) and any JavaScript logic with the use of helpers"; Ghost also uses `express-hbs`, "which adds some additional features to Handlebars, such as layouts and partials" ([Ghost Handlebars Themes](https://docs.ghost.org/themes.md)).

**Block vs inline.** *Block* helpers wrap a body: `{{#name ...}} ... {{/name}}`. *Inline* (output) helpers only emit a value: `{{name ...}}`. The docs mark this per helper: `{{#foreach data}}{{/foreach}}` "is a block helper"; `{{#get "posts"}}{{/get}}` "is a special block helper"; `{{encode value}}` "is a simple output helper"; `{{#split}}` "can be used in block or inline mode". Two helpers are inherently pairs: `{{{block "section"}}}` with `{{#contentFor "section"}}...{{/contentFor}}`.

**Hash attributes.** Options are `name="value"` pairs after positional arguments: `{{#foreach posts limit="3"}}`, `{{excerpt words="26"}}`, `{{> "call-to-action" heading="Sign up now"}}`. Values can be data paths or helper results: `{{#get "posts" limit=@config.posts_per_page}}`, `{{link_class for="/about/" activeClass="active"}}`. Partial hash attributes "provide the option to set contextual values per use case".

**Positional arguments.** Before the hash: the resource in `{{#get "posts"}}`, the context list in `{{#is "post, page"}}`, `{{color_to_rgba color alpha}}`, `{{concat "a" "b" "c"}}`, `{{#match a "=" b}}`.

**`else`.** All block helpers support `{{else}}`. `foreach`: "Like all block helpers, `{{#foreach}}` supports adding an `{{else}}` block, which will be executed if there is no data to iterate over". `if`, `unless`, `has`, `match` and `is` all document it. `get` documents a twist: for `{{#get}}`, `{{else}}` "only happens if there's an error and is mostly useful for debugging" — the empty-results case is handled by an inner `{{#foreach}}`/`{{else}}`.

**Negation with `^`.** Documented for `if`, `unless`, `has`, `match`: "using `^` instead of `#` for negation - this means the `{{#if}}` and `{{else}}` blocks are reversed if you use `{{^if}}`". `is` documents `{{^is "paged"}}`. `foreach` and `get` document no `^` form.

**Chained `else` (switch style).** `{{else if ...}}`, `{{else has ...}}` and `{{else match ...}}` each "chain together multiple options like a switch statement".

**Escaping `{{ }}` vs `{{{ }}}`.** Double-stache HTML-escapes output; triple-stache emits raw HTML. Ghost uses triple-stache exactly where raw markup must survive: `{{{block "scripts"}}}`, `{{{body}}}`, and in the translate docs `{{{t "Proudly published with {ghostlink}" ghostlink="<a href=\"https://ghost.org\">Ghost</a>"}}}` — triple-stached because the placeholder value is an anchor element.

**Subexpressions.** "The concept of subexpressions allows you to invoke multiple helpers in one expression", written in parentheses: `{{#foreach (split "hello, world" separator=",")}}`, `{{plural ../pagination.total empty=(t "No posts") singular=(t "1 post") plural=(t "% posts")}}`. Parenthesised helpers can also supply dynamic partial names.

**Block params.** `as |name|` renames the object under iteration: `{{#foreach posts as |my_post|}}`, `{{#get "posts" as |articles pages|}}`, `{{#split "hello,world" as |elements|}}`. For `get`, "The first entry refers to your returned data collection. The second entry refers to your pagination object." Block parameters "are entered between pipe symbols (`|`)".

**Handlebars limitations Ghost imposes (as documented).**

- `{{#foreach}}` "is context-aware and should **always** be used instead of Handlebars `each` when working with Ghost themes."
- Helpers are not callable inside filters: "To filter based on dates, use the data attributes, e.g. `{{published_at}}`, not the `{{date}}` helper, as helper functions do not get called inside of a filter."
- "Inherited template files, files that contain `{{{block "block-name"}}}`, cannot be templates used directly by Ghost. `post.hbs`, `page.hbs` `index.hbs` can inherit other template files and used the `contentFor` helper but cannot contain block definitions."
- Inline dynamic partials "throws a page error and breaks the rendered page"; only the block form falls back.
- Required helpers: "you must make use of the required helpers: `{{asset}}`, `{{body_class}}`, `{{post_class}}`, `{{ghost_head}}`, `{{ghost_foot}}`" ([structure](https://docs.ghost.org/themes/structure.md)).
- Production caching: "In production mode, template files are loaded and cached by the server. For any changes in a `hbs` file to be reflected, use the `ghost restart` command." Validation happens via GScan and the admin upload check.
- Context decides data: "the context also determines what dynamic data the helper outputs" ([contexts](https://docs.ghost.org/themes/contexts.md)).

## 2. Functional helpers

Index: `foreach`, `get`, `has`, `if`, `is`, `match`, `unless` ([functional helper index](https://docs.ghost.org/themes/helpers/functional.md)).

### foreach

**Purpose.** "Loop helper designed for working with lists of posts" (also tags, users, or any collection). [src](https://docs.ghost.org/themes/helpers/functional/foreach.md)

**Signature.** `{{#foreach data}}{{/foreach}}` — block helper. Hash attributes: `limit`, `from`, `to`, `visibility`, `columns`. Optional block param `as |item|`.

**Options.**

- `limit` (number as string, e.g. `limit="3"`; no default — iterates everything) — "will tell it to stop after a certain number of iterations".
- `from` (number as string, 1-indexed, inclusive; default: start of collection).
- `to` (number as string, 1-indexed, inclusive; default: end of collection) — "Both attributes are 1-indexed and inclusive, so `from="2"` means from and including the 2nd post".
- `visibility` (`"all"` | `"none"`; default: public data only) — "By default, `foreach` only displays data that is public. This means that data like hidden tiers and internal tags won't be included. Set `visibility` to `all` to show all data or to `none` to show hidden data."
- `columns` (number as string, e.g. `columns="3"`; not set by default) — has no dedicated docs section; documented via the data variables: "`@rowStart` and `@rowEnd` return `true` at the beginning and end of a column respectively when the `columns` value is set in a `#foreach`."

**Loop metadata variables.**

- `@index` (number) — "the 0-based index of the current iteration"
- `@number` (number) — "the 1-based index of the current iteration"
- `@key` (string) — "if iterating over an object, rather than an array, this contains the object key"
- `@first` (boolean) — "true if this is the first iteration of the collection"
- `@last` (boolean) — "true if this is the last iteration of the collection"
- `@odd` (boolean) — "true if the @index is odd"
- `@even` (boolean) — "true if the @index is even"
- `@rowStart` (boolean) — "true if `columns` is passed and this iteration signals a row start"
- `@rowEnd` (boolean) — "true if `columns` is passed and this iteration signals a row's end"

**`else`.** Yes — runs "if there is no data to iterate over".

```handlebars
{{#foreach posts}}
<article class="{{post_class}}">
  <h2 class="post-title"><a href="{{url}}">{{title}}</a></h2>
  <p>{{excerpt words="26"}} <a class="read-more" href="{{url}}">»</a></p>
</article>
{{/foreach}}

{{! slicing and visibility }}
{{#foreach posts from="2" to="5" limit="3"}}{{title}}{{/foreach}}
{{#foreach tags visibility="all"}}<p>{{name}}</p>{{/foreach}}

{{! else when the collection is empty }}
{{#foreach tags}}<a href="{{url}}">{{name}}</a>{{else}}<p>There were no tags...</p>{{/foreach}}

{{! columns drive @rowStart / @rowEnd }}
{{#foreach posts columns="3"}}
    {{#if @rowStart}}<div class="column">{{/if}}
        <a href="{{url}}">{{title}}</a>
    {{#if @rowEnd}}</div>{{/if}}
{{/foreach}}

{{! zebra striping and block params }}
{{#foreach posts}}<div class="{{#if @even}}even{{else}}odd{{/if}}">{{title}}</div>{{/foreach}}
{{#foreach posts as |my_post|}}{{#my_post}}<h1>{{title}}</h1>{{/my_post}}{{/foreach}}
```

> **Caveats** — because `foreach` "is only passively iterating over data, not actively fetching it", a `limit` larger than the collection "will have no effect"[^foreach-limit]; `@key` has "no real use case this in Ghost at present"[^foreach-key]; always prefer it over `each`[^foreach-each].

[^foreach-limit]: [foreach — The `limit` attribute](https://docs.ghost.org/themes/helpers/functional/foreach.md)
[^foreach-key]: [foreach — Data Variables](https://docs.ghost.org/themes/helpers/functional/foreach.md)
[^foreach-each]: [foreach — introduction](https://docs.ghost.org/themes/helpers/functional/foreach.md)

### get

**Purpose.** "a special block helper that makes a custom query to the Ghost API to fetch publicly available data" — "These requests are made server-side before your templates are rendered." [src](https://docs.ghost.org/themes/helpers/functional/get.md)

**Signatures.** Browse: `{{#get "posts"}}{{/get}}`. Read (single item by resource field such as `id` or `slug`): `{{#get "posts" id="2" include="tags,authors" as |post|}}{{/get}}`. With block params: `{{#get "posts" as |articles pages|}}`.

**Resources.** `posts` — "any published post"; `tags` — "any tag that has a post associated with it"; `authors` — "any author who has published a post"; `tiers` — "any membership tier"; `newsletters` — "any newsletter". (The intro sentence names posts/tags/authors/tiers; the Resources list adds newsletters.)[^get-resources]

**Attributes.** "Available attributes are identical to those used with the Ghost Content API." Browse requests accept any or all of them; "Read" requests (fetching a single item by **id** or **slug**) "only accept the **include** attribute".

- `limit` (number; default `15`; "Allowed values: 1-100"; "Requesting more than 100 items will return a maximum of 100 items").
- `page` (number; no default) — "Choose which page of that collection you want to get with the `page` attribute."
- `order` (string, `field asc` or `field desc`; no default) — "You can choose any valid resource *field* in ascending (`asc`) or descending (`desc`) order."
- `include` (comma-separated string; default: base resource data only) — posts: `authors`, `tags`; author and tag: `count.posts`; tiers: `monthly_price`, `yearly_price`, `benefits`.
- `filter` (string; no default) — "`,` for *or*, `+` for *and*, and `-` for *negation*"; full syntax in [Content API filtering](/content-api/filtering/#syntax-reference).

Only the above are enumerated on this page; `id`/`slug` trigger read requests. Parameters that exist in the Content API but are not listed there (for example `fields`) are covered only by the blanket statement of equivalence.[^get-fields]

**Global `posts_per_page`.** "It's possible to use the global `posts_per_page` setting, which is **5** by default. Configure the setting in the active theme's `package.json` file. This global value is available via the `@config` global as `@config.posts_per_page`."[^get-ppp]

**`{{else}}` behaviour.** With `{{#get}}`, `{{else}}` fires only on error and is "mostly useful for debugging while developing"; for no results, nest `{{#foreach}}` and use its `{{else}}`.

```handlebars
{{#get "posts" filter="featured:true"}}
    {{#foreach posts}}
        {{title}}
    {{else}}
       <p>No posts!</p>
    {{/foreach}}
{{else}}
  <p class="error">{{error}}</p>
{{/get}}

{{! block params: collection + pagination object }}
{{#get "posts" as |articles pages|}}
    {{#foreach articles}}{{title}}{{/foreach}}
    {{pages.total}}
{{/get}}

{{! browse options }}
{{#get "posts" limit="20" page="4" order="published_at asc" include="authors,tags"}}{{/get}}
{{#get "posts" limit=@config.posts_per_page}}{{/get}}
{{#get "tags" limit="100" include="count.posts" order="count.posts desc"}}{{#foreach tags}}{{name}}{{/foreach}}{{/get}}

{{! read request: only include is accepted, plus the resource field }}
{{#get "posts" id="2" include="tags,authors" as |post|}}{{#post}}{{title}}{{/post}}{{/get}}

{{! passing template data into filter }}
{{#post}}
    {{#get "posts" filter="authors:{{primary_author.slug}}+id:-{{id}}" limit="3"}}{{/get}}
    {{#get "posts" filter="published_at:<='{{published_at}}'+id:-{{id}}" limit="3"}}{{/get}}
    {{#get "posts" filter="primary_tag:{{primary_tag.slug}}" limit="3"}}{{/get}}
    {{#get "posts" filter="primary_author:{{primary_author.slug}}" limit="3"}}{{/get}}
{{/post}}

{{! tiers, ordered by count, filtered by membership type / visibility }}
{{#get "tiers" include="monthly_price,yearly_price,benefits" limit="100" as |tiers|}}
    {{#foreach tiers}}{{name}}{{/foreach}}
{{/get}}
{{#get "tiers" filter="type:paid"}}{{/get}}
{{#get "tiers" filter="visibility:public"}}{{/get}}

{{! newsletter picker }}
{{#get "newsletters"}}{{#foreach newsletters}}<label>{{name}}</label>{{/foreach}}{{/get}}
```

> **Caveats** — every call runs server-side before render, so it adds work to the render path on top of "what is provided by default in each context"[^get-perf]; read requests only accept `include`[^get-read]; `count.posts` is the documented ordering hook[^get-count]; helpers are not called inside `filter`, so use data attributes such as `{{published_at}}` rather than `{{date}}`[^get-filter-date]; values containing spaces (`title`, dates) must be single-quoted inside `filter`[^get-filter-quote].

[^get-resources]: [get — Resources](https://docs.ghost.org/themes/helpers/functional/get.md)
[^get-fields]: [get — Attributes](https://docs.ghost.org/themes/helpers/functional/get.md)
[^get-ppp]: [get — `limit`](https://docs.ghost.org/themes/helpers/functional/get.md)
[^get-perf]: [get — introduction](https://docs.ghost.org/themes/helpers/functional/get.md)
[^get-read]: [get — Attributes](https://docs.ghost.org/themes/helpers/functional/get.md)
[^get-count]: [get — `include`](https://docs.ghost.org/themes/helpers/functional/get.md)
[^get-filter-date]: [get — Passing data to `filter`](https://docs.ghost.org/themes/helpers/functional/get.md)
[^get-filter-quote]: [get — Passing data to `filter`](https://docs.ghost.org/themes/helpers/functional/get.md)

### has

**Purpose.** "Like `{{#if}}` but with the ability to do more than test a boolean" — ask questions about the current context.[^has-src] [src](https://docs.ghost.org/themes/helpers/functional/has.md)

**Signatures (as listed in the docs).** `{{#has tag="value1,value2" author="value"}}`, `{{#has slug=../slug}}`, `{{#has number="nth:3"}}`, `{{#has any="twitter, facebook"}}`, `{{#has all="twitter, facebook"}}` — all block form.

**Semantics.** Four documented question types: "Post has tag or author", "Context has slug or id", "Context has any or all properties set", "Foreach loop number or index". "You can pass multiple attributes, and the `{{#has}}` helper will always treat this as an `OR`." Comma-separated values within an attribute are also OR; AND "being achieved by nesting helpers". `else`, `^` negation and `{{else has ...}}` chaining are supported.

- **tag / author** — comma-separated lists, OR semantics. "Tag and author matching is a lowercase match on the tag name or author name, which ignores special characters."
- **counting** — "The `author` and `tag` attribute accepts a counting value. You can choose between: `count:[number]`, `count:>[number]`, `count:<[number]`."
- **slug / id** — "you can use the `{{#has}}` helper to do an exact match. Similarly for all objects that have an ID." Accepts a quoted string or a Handlebars path.
- **any / all** — `any` "will return true if **any** one of the properties is set in the current context, with support for paths and globals"; `all` "will return true only when **all** of the properties are set".
- **number / index** — `number="3"` (single number), `number="3, 6, 9"` (list), `number="nth:3"` ("special syntax for nth item"). "All of these work exactly the same for index", referring to `@index` (0-based) and `@number` (1-based).

```handlebars
{{#post}}
  {{#has tag="#link"}}
     {{> "link-card"}}
  {{else}}
    {{> "post-card"}}
  {{/has}}
{{/post}}

{{! OR attributes, OR comma lists, AND via nesting }}
{{#has slug="welcome" tag="getting started"}}{{/has}}
{{#has tag="General, News"}}{{/has}}
{{#has tag="photo, video, audio"}}{{else}}other posts{{/has}}
{{#has tag="photo"}}{{#has tag="panorama"}}{{! both tags }}{{/has}}{{/has}}

{{! counting, paths, any/all, globals, id }}
{{#has tag="count:1"}}{{/has}}
{{#has tag="count:>1"}}{{/has}}
{{#has author="count:<2"}}{{/has}}
{{#has slug=../post.slug}}{{/has}}
{{#has slug=../../slug}}{{/has}}
{{#has id=post.id}}{{/has}}
{{#has any="twitter, facebook, website"}}{{/has}}
{{#has any="author.facebook, author.twitter,author.website"}}{{/has}}
{{#has any="@site.facebook, @site.twitter"}}{{/has}}
{{#has all="@labs.subscribers,@labs.publicAPI"}}{{/has}}

{{! nth-item widget inside a loop }}
{{#foreach posts}}
  {{#has number="nth:3"}}{{> "widget"}}{{/has}}
  {{> "post-card"}}
{{/foreach}}
```

> **Caveats** — multiple *attributes* are OR, not AND; use nesting[^has-or]; tag/author matching is lowercased and ignores special characters, so it is not a raw string comparison[^has-match]; counts are the documented way to branch on how many tags or authors a post has[^has-count].

[^has-src]: [has](https://docs.ghost.org/themes/helpers/functional/has.md)
[^has-or]: [has — Usage](https://docs.ghost.org/themes/helpers/functional/has.md)
[^has-match]: [has — Post tag or author](https://docs.ghost.org/themes/helpers/functional/has.md)
[^has-count]: [has — Counting](https://docs.ghost.org/themes/helpers/functional/has.md)

### if / unless

**Purpose.** `{{#if}}` "comes built in with Handlebars" and "allows for testing very simple conditionals"; `{{#unless}}` "is essentially the opposite of `{{#if}}`".[^if-src][^unless-src] [if src](https://docs.ghost.org/themes/helpers/functional/if.md) · [unless src](https://docs.ghost.org/themes/helpers/functional/unless.md)

**Signatures.** `{{#if featured}}{{/if}}` and `{{#unless featured}}{{/unless}}` — block helpers, no documented hash attributes.

**Evaluation rules (shared).** "Any passed in value which is equivalent to `false`, `0`, `undefined`, `null`, `""` (an empty string) or `[]` (an empty array) is considered false, and any other value is considered true."

- "Any boolean value, like the featured flag on a post, will evaluate to true or false as you expect."
- "Any string value will be true, as long as it is not null or empty"
- "All numerical values, with the exception of `0` evaluate to true, 0 is the same as false"
- "Any property which doesn't exist or is not set will always evaluate false"
- "Empty arrays or objects will be false"

**`else`, negation, chaining.** `if` "supports adding an `{{else}}` block or using `^` instead of `#` for negation"; "it is possible to do `{{else if ...}}`, to chain together multiple options like a switch statement". `unless` "works exactly the same as `{{#if}}` and supports both `{{else}}` and `^` negation", and "uses the exact same conditional evaluation rules".

**Comparison operators inside `{{#if}}`.** The `if` page does **not** document comparison syntax such as `{{#if a "=" b}}`; it states only that `{{#if}}` allows "testing very simple conditionals" whose "conditionals that can be tested are very simple, essentially only checking for 'truthiness'". Comparisons are documented for `{{#match}}` (`=`, `!=`, `>`, `>=`, `<`, `<=`, `~`, `~^`, `~$`).[^if-compare]

```handlebars
{{#post}}
  {{#if featured}}...do something if the post is featured...{{/if}}
{{/post}}

{{#post}}
  {{#if feature_image}}
     <img src="{{img_url feature_image}}" />
  {{else}}
     <img src="{{asset "img/default-img.jpg"}}" />
  {{/if}}
{{else}}
<p>No posts to display!</p>
{{/post}}

{{#unless featured}}...do something...{{/unless}}

<!-- This is identical to if, but with the blocks reversed -->
{{#unless featured}}...do thing 1...{{else}}...do thing 2...{{/unless}}
```

> **Caveats** — only truthiness is tested, so there is no documented `{{#if a "=" b}}` form; use `{{#match}}`[^if-compare]; `0` and `[]` are false, making an empty collection and a real `0` indistinguishable to `{{#if}}`[^if-rules]; for `unless`, "in the majority of cases, if you need an else, then using `{{#if}}` is more readable"[^unless-else].

[^if-src]: [if](https://docs.ghost.org/themes/helpers/functional/if.md)
[^unless-src]: [unless](https://docs.ghost.org/themes/helpers/functional/unless.md)
[^if-compare]: [if — Usage and evaluation rules](https://docs.ghost.org/themes/helpers/functional/if.md)
[^if-rules]: [if — Evaluation rules](https://docs.ghost.org/themes/helpers/functional/if.md)
[^unless-else]: [unless — Example code](https://docs.ghost.org/themes/helpers/functional/unless.md)

### is

**Purpose.** "allows you to check the context of the current route, i.e. is this the home page, or a post, or a tag listing page", useful "when using shared partials or layouts". [src](https://docs.ghost.org/themes/helpers/functional/is.md)

**Signature.** `{{#is "contexts"}}` — block helper taking "a single parameter of a comma-separated list containing the contexts to check for". "the comma behaves as an `or` statement, with `and` being achieved by nesting helpers".

**`else` / negation.** "As with all block helpers, it is possible to use an else statement"; reverse with `{{^is "paged"}}`.

**Accepted context values (complete documented list).**

- `home` — "true only on the home page"
- `index` — "true for the main post listing, including the home page"
- `post` — "true for any individual post page, where the post is not a static page"
- `page` — "true for any static page"
- `tag` — "true for any page of the tag list"
- `author` — "true for any page of the author list"
- `paged` — "true if this is page 2, page 3 of a list, but not on the first page"
- `private` — "true if this is the private page shown for password protected sites"

```handlebars
{{#is "post, page"}}
   ... content to render if the current route represents a post or a page ...
{{/is}}

{{#is "home"}}
  ... output something special for the home page ...
{{else}}
  ... output something different on all other pages ...
{{/is}}

{{^is "paged"}}
 ...if this is *not* a 2nd, 3rd etc page of a list...
{{/is}}
```

> **Caveats** — how it differs from `{{#if}}`: `is` branches on the **route context**, not on the truthiness of a value; "the context also determines what dynamic data the helper outputs"[^is-vs-if]; the eight values above are the complete documented set (no `error` value is documented for `is`)[^is-contexts].

[^is-vs-if]: [is — Usage](https://docs.ghost.org/themes/helpers/functional/is.md)
[^is-contexts]: [is — Contexts](https://docs.ghost.org/themes/helpers/functional/is.md)

### match

**Purpose.** "allows for simple comparisons, and executing different template blocks depending on the outcome" — "handy when paired with custom theme settings using `@custom`". [src](https://docs.ghost.org/themes/helpers/functional/match.md)

**Signature.** `{{#match value operator compare}} ... {{/match}}`, operator optional (equality is the default); usable bare as a truthiness test: `{{#match featured}}...{{else}}...{{/match}}`.

**Operators (complete documented list).**

- `=` — "equals (default when no operator provided)"
- `!=` — "not equals"
- `>` — "greater than"
- `>=` — "greater than or equals"
- `<` — "less than"
- `<=` — "less than or equals"
- `~` — "contains"
- `~^` — "starts with"
- `~$` — "ends with"

**`else` / negation / chaining.** "supports adding an `{{else}}` block or using `^` instead of `#` for negation"; "it is possible to do `{{else match ...}}`, to chain together multiple options like a switch statement".

**Evaluation rules.** "Values passed to `match` are tested according to their *value* as well as their *type*." The string operators "use the same syntax as NQL filtering".

```handlebars
{{!-- Adds the 'font-alt' class when the Typography setting is set to 'Elegant serif' --}}
<body class="{{body_class}} {{#match @custom.typography "Elegant serif"}}font-alt{{/match}}">

{{#match @custom.color_scheme "=" "Dark"}} class="dark-mode"{{/match}}
{{#match @custom.color_scheme "!=" "Dark"}}...{{else}}...{{/match}}
{{!-- Equality can be shortened to: --}}
{{#match @custom.color_scheme "Dark"}}...{{else}}...{{/match}}

{{!-- slug starts with #episode- --}}
{{#match slug "~^" "hash-episode-"}}{{/match}}

{{!-- numeric comparison --}}
{{#match posts.length ">" 1}}...{{else}}...{{/match}}

{{!-- Returns true/false --}}
{{#match feature_image true}}...{{else}}...{{/match}}
{{!-- Always returns false --}}
{{#match feature_image 'true'}}...{{else}}...{{/match}}
```

> **Caveats** — type matters: the boolean `true` and the string `'true'` are not equal, and comparing against the string "Always returns false"[^match-type]; string operators follow NQL operator syntax[^match-nql]; with no operator `match` tests truthiness: "Default behaviour is to test if a value is truthy"[^match-truthy].

[^match-type]: [match — Evaluation rules](https://docs.ghost.org/themes/helpers/functional/match.md)
[^match-nql]: [match — String comparisons](https://docs.ghost.org/themes/helpers/functional/match.md)
[^match-truthy]: [match — Evaluation rules](https://docs.ghost.org/themes/helpers/functional/match.md)

## 3. Utility helpers

Index order follows [Utility Helpers](https://docs.ghost.org/themes/helpers/utility.md): asset, block, body_class, color_to_rgba, concat, contrast_text_color, encode, ghost_head/ghost_foot, json, link_class, log, pagination, partials, plural, post_class, prev_post/next_post, reading_time, search, split, translate.

### asset

**Purpose.** "Outputs cachable and cache-busting relative URLs to various asset types". [src](https://docs.ghost.org/themes/helpers/utility/asset.md)

**Signature.** `{{asset "asset-path"}}` — inline. Attribute: `hasMinFile` (boolean passed as a string, e.g. `hasMinFile='true'`; default off) — "Serving a minified asset in production and unminified file in development using hasMinFile". The path is "relative to the `assets` folder".

**Documented behaviour.** It "ensures that the relative path to an asset is always correct, regardless of how Ghost is installed" (including subdirectories, without absolute URLs); "All assets are served with a `?v=#######` query string which currently changes when Ghost is restarted"; "it imposes a little bit of structure on themes by requiring an `assets` folder".

```handlebars
<!-- Styles -->
<link rel="stylesheet" type="text/css" href="{{asset 'css/style.css'}}" />
<!-- Serving a minified asset in production and unminified file in development using hasMinFile -->
<link rel="stylesheet" type="text/css" href="{{asset 'css/style.css' hasMinFile='true'}}" />
<!-- Scripts -->
<script type="text/javascript" src="{{asset 'js/index.js'}}"></script>
<!-- Images -->
<img src="{{asset 'images/my-image.jpg'}}" />
```

> **Caveats** — the cache-busting token "currently changes when Ghost is restarted", so it is tied to restarts rather than file contents[^asset-cache]; `{{asset}}` is a required helper[^asset-required].

[^asset-cache]: [asset — introduction](https://docs.ghost.org/themes/helpers/utility/asset.md)
[^asset-required]: [structure — Helpers](https://docs.ghost.org/themes/structure.md)

### block

**Purpose.** "Used along with `{{contentFor}}` to pass data up and down the template hierarchy" — creates a placeholder/slot that inheriting templates may fill. [src](https://docs.ghost.org/themes/helpers/utility/block.md)

**Signatures.** `{{{block "section"}}}` (inline, triple-stache, slot definition); `{{#contentFor "section"}} content {{/contentFor}}` (block, filler); `{{{body}}}` — "behaves in a similar fashion to a defined block helper, but doesn't require a corresponding `contentFor` helper in the inheriting template file".

**Semantics.** The parent template is referenced with `{{!< template-name}}` at the top of the child file. "If the `contentFor` is not used then the block will be gracefully skipped."

```handlebars
<!-- default.hbs -->
<body>
    <!-- ... -->
    {{{block "scripts"}}}
</body>
<!-- page.hbs -->
{{!< default}}
{{#contentFor "scripts"}}
    <script>
        runPageScripts();
    </script>
{{/contentFor}}
<!-- default.hbs, body slot -->
<div class="site-wrapper">
    {{{body}}}
</div>
```

> **Caveats** — "Inherited template files, files that contain `{{{block "block-name"}}}`, cannot be templates used directly by Ghost. `post.hbs`, `page.hbs` `index.hbs` can inherit other template files and used the `contentFor` helper but cannot contain block definitions."[^block-limit]; a missing `contentFor` is skipped silently[^block-skip].

[^block-limit]: [block — `{{{body}}}` helper](https://docs.ghost.org/themes/helpers/utility/block.md)
[^block-skip]: [block — introduction](https://docs.ghost.org/themes/helpers/utility/block.md)

### body_class

**Purpose.** "Outputs dynamic CSS classes intended for the `<body>` tag in your `default.hbs` or other layout file, and is useful for targeting specific pages (or contexts) with styles". [src](https://docs.ghost.org/themes/helpers/utility/body_class.md)

**Signature.** `{{body_class}}` — inline, no documented attributes. Different classes are output "depending on what context the page belongs to".

**Static classes.** `home-template` — "The class applied when the template is used for the home page"; `post-template` — "The class applied to all posts"; `page-template` — "The class applied to all pages"; `tag-template` — "The class applied to all tag index pages"; `author-template` — "The class applied to all author pages"; `private-template` — "The class applied to all page types when password protected access is activated".

**Dynamic classes.** `page-{slug}` — "A class of `page-` plus the page slug added to all pages"; `tag-{slug}` — "A class of `tag-` plus the tag page slug added to all tag index pages"; `author-{slug}` — "A class of `author-` plus the author page slug added to all author pages".

```handlebars
<!-- default.hbs -->
<html>
    <head>...</head>
    <body class="{{body_class}}">
    ...
    {{{body}}}
    ...
    </body>
</html>
```

> **Caveats** — `{{body_class}}` is a required helper[^body-required]; it is commonly combined with `match` on the same tag: `<body class="{{body_class}} {{#match @custom.typography "Elegant serif"}}font-alt{{/match}}">`[^body-match].

[^body-required]: [structure — Helpers](https://docs.ghost.org/themes/structure.md)
[^body-match]: [match — Example usage](https://docs.ghost.org/themes/helpers/functional/match.md)

### color_to_rgba

**Purpose.** "Converts a color value into an RGBA color string" — "useful when your theme stores a color as a hex value, such as `@site.accent_color`, but your CSS needs an alpha channel". [src](https://docs.ghost.org/themes/helpers/utility/color_to_rgba.md)

**Signature.** `{{color_to_rgba color alpha}}` — inline, two positional arguments. `color`: "Accepts any valid color value supported by Ghost's color utilities". `alpha` (number): "Pins the alpha value to the valid range between `0` and `1`".

```handlebars
<div style="--accent-soft: {{color_to_rgba @site.accent_color 0.25}};">
    ...
</div>
```

If `@site.accent_color` is `#FF1A75`, the helper outputs `rgba(255, 26, 117, 0.25)`.

> **Caveat** — "Falls back to `rgba(21, 23, 26, 0.25)` if the color is invalid or missing".[^rgba-fallback]

[^rgba-fallback]: [color_to_rgba — Notes](https://docs.ghost.org/themes/helpers/utility/color_to_rgba.md)

### concat

**Purpose.** "Concatenate and link multiple things together" — it takes "all of the items passed to it, treat them as strings, and concatenate them together without any spaces". [src](https://docs.ghost.org/themes/helpers/utility/concat.md)

**Signature.** `{{concat "a" "b" "c"}}` — inline; "There can be an unlimited amount of items passed to the helper". Accepts "Strings, variables and other helpers". Attribute: `separator` (string; default `""`, nothing between items) — "The `separator=""` attribute inserts the value provided between each string."

```handlebars
{{concat "hello world" "!" }}          {{! outputs: hello world! }}
{{concat "my-class" slug }}            {{! outputs: my-classmy-post }}
{{concat "hello" "world" separator=" "}} {{! outputs: hello world }}
```

> **Caveats** — "designed for strings. If an object is passed it will output `[object Object]` in true JavaScript™️ fashion"; "if `{{concat}}` is passed an empty variable, the output will be an empty string".[^concat-notes]

[^concat-notes]: [concat — Simple examples](https://docs.ghost.org/themes/helpers/utility/concat.md)

### contrast_text_color

**Purpose.** "Returns a readable text color for a given background" — "a high-contrast text color for a given background color", for "when your theme supports configurable brand or accent colors and you need readable text on top of them". [src](https://docs.ghost.org/themes/helpers/utility/contrast_text_color.md)

**Signature.** `{{contrast_text_color color}}` — inline, one positional argument.

```handlebars
<button
    style="background: {{@site.accent_color}}; color: {{contrast_text_color @site.accent_color}};"
>
    Subscribe
</button>
```

For a dark background such as `#15171A` it outputs `#FFFFFF`; for a light background such as `#FFFFFF` it outputs `#000000`.

> **Caveats** — "Helps keep text readable on dynamic background colors"; "Works well with `@site.accent_color`"; "Falls back to `#FFFFFF` if the color is invalid or missing".[^contrast-notes]

[^contrast-notes]: [contrast_text_color — Notes](https://docs.ghost.org/themes/helpers/utility/contrast_text_color.md)

### encode

**Purpose.** "Encode text to be safely used in a URL" — "a simple output helper which will encode a given string so that it can be used in a URL". [src](https://docs.ghost.org/themes/helpers/utility/encode.md)

**Signature.** `{{encode value}}` — inline, one positional argument.

```handlebars
<a class="icon-twitter" href="https://twitter.com/share?text={{encode title}}&url={{url absolute='true'}}"
    onclick="window.open(this.href, 'twitter-share', 'width=550,height=235');return false;">
    <span class="hidden">Twitter</span>
</a>
```

> **Caveat** — "Without using the `{{encode}}` helper on the post's title, the spaces and other punctuation in the title will not be handled correctly."[^encode-note]

[^encode-note]: [encode — Usage](https://docs.ghost.org/themes/helpers/utility/encode.md)

### ghost_head & ghost_foot

**Purpose.** "Outputs vital system information at the top and bottom of the document, and provide hooks to inject additional scripts and styles". [src](https://docs.ghost.org/themes/helpers/utility/ghost_head_foot.md)

**Signatures.** `{{ghost_head}}` and `{{ghost_foot}}` — inline, no documented attributes.

**`{{ghost_head}}`** "belongs just before the `</head>` tag in `default.hbs`" and outputs: "Meta description"; "Structured data Schema.org microformats in JSON/LD - no need to clutter your theme markup!"; "Structured data tags for Facebook Open Graph and Twitter Cards."; "RSS url paths to make your feeds easily discoverable by external readers."; "Scripts to enable the Ghost API"; "Anything added in the `Code Injection` section globally, or at a page-level".

**`{{ghost_foot}}`** "belongs just before the `</body>` tag in `default.hbs`" and outputs: "Anything added in the `Code Injection` section globally, or at a page-level".

> **Caveats** — both are required helpers[^gh-required]; `default.hbs` is the documented home for both, since it "contains the boring bits of HTML that exist on every page such as `<html>`, `<head>` or `<body>` as well as the required `{{ghost_head}}` and `{{ghost_foot}}`"[^gh-default].

[^gh-required]: [structure — Helpers](https://docs.ghost.org/themes/structure.md)
[^gh-default]: [structure — default.hbs](https://docs.ghost.org/themes/structure.md)

### json

**Purpose.** "Safely serialize values for inline JSON output". [src](https://docs.ghost.org/themes/helpers/utility/json.md)

**Signatures.** `{{json value}}` for a single value (`{{json @site}}`); `{{json foo="bar" count=1}}` — "If you pass hash arguments, `{{json}}` serializes those named values instead". Inline helper, no other attributes.

```handlebars
<script id="theme-config" type="application/json">
    {{json accent=@site.accent_color title=@site.title}}
</script>
{{!-- outputs escaped JSON that is safe to embed inline: {"accent":"#FF1A75","title":"My site"} --}}
{{json @site}}
{{json title=@site.title url=@site.url membersEnabled=@site.members_enabled}}
```

> **Caveats** — "Returns `null` when the input value is `undefined`"; "Escapes unsafe characters such as `<`, `>` and `&` for inline script safety"; "Intended for JSON output, not for formatting arbitrary HTML".[^json-notes]

[^json-notes]: [json — Notes](https://docs.ghost.org/themes/helpers/utility/json.md)

### link_class

**Purpose.** "Add dynamic classes depending on the currently viewed page". [src](https://docs.ghost.org/themes/helpers/utility/link_class.md)

**Signature.** `{{link_class for="/about/"}}` — inline. Attributes:

- `for` (string, e.g. `"/about/"`; required) — "If the page slug (e.g. `/about/`) matches the value given to the `for` attribute the helper will output a `nav-current` class. A `for` value must be provided."
- `activeClass` (string, or `false`; default `nav-current`) — "can be overwritten with the `activeClass` attribute"; `activeClass=false` "will output an empty string. Effectively turning off the behaviour."
- `class` (string; no default) — "will add whatever value has been provided when the link is the active URL, `nav-current` (the default active class value) will be added last".

```html
<li class="nav {{link_class for="/about/"}}">About</li>
<!-- on /about/  -> --> <li class="nav nav-current">About</li>
<!-- otherwise  -> --> <li class="nav ">About</li>

<li class="nav {{link_class for="/about/" activeClass="active"}}">About</li>
<!-- -> --> <li class="nav active">About</li>

<li class="nav {{link_class for="/about/" class="current-about"}}">About</li>
<!-- -> --> <li class="nav current-about nav-current">About</li>
```

**Parent URLs.** "If a user navigates to `/tags/toast/` then `{{link_class}}` can provide an active class to `/tags/` as well as `/tags/toast/`."

```html
<li class="nav {{link_class for="/tags/"}}">Tags</li>
<!-- on /tags/       -> --> <li class="nav nav-current">Tags</li>
<!-- on /tags/toast/ -> --> <li class="nav nav-parent">Tags</li>
```

> **Caveats** — a `for` value is mandatory[^linkclass-for]; parent matches emit `nav-parent` rather than the active class, so style both if you rely on this[^linkclass-parent]; `activeClass=false` disables the active class entirely[^linkclass-active].

[^linkclass-for]: [link_class — Usage](https://docs.ghost.org/themes/helpers/utility/link_class.md)
[^linkclass-parent]: [link_class — Parent URLs](https://docs.ghost.org/themes/helpers/utility/link_class.md)
[^linkclass-active]: [link_class — `activeClass`](https://docs.ghost.org/themes/helpers/utility/link_class.md)

### log

**Purpose.** "In development mode, output data in the console" — specifically "to output debug messages to the server console", including "the details of objects or the current context". [src](https://docs.ghost.org/themes/helpers/utility/log.md)

**Signature.** `{{log value}}` — inline, one positional argument.

```handlebars
{{log this}}

{{#foreach posts}}
   {{log post}}
{{/foreach}}
```

> **Caveats** — development only, and "If you're developing a theme and running an install using Ghost-CLI, you must use `NODE_ENV=development ghost run` to make debug output visible in the console."; output goes to the **server** console, not the browser console[^log-note].

[^log-note]: [log — Usage](https://docs.ghost.org/themes/helpers/utility/log.md)

### pagination

**Purpose.** "Helper which outputs formatted HTML for pagination links" — "HTML for 'newer posts' and 'older posts' links if they are available and also says which page you are on". [src](https://docs.ghost.org/themes/helpers/utility/pagination.md)

**Signature.** `{{pagination}}` — inline, no documented attributes. "You can override the HTML output by the pagination helper by placing a file called `pagination.hbs` inside of `content/themes/your-theme/partials`."

**Pagination attributes.** `page` — "the current page number"; `prev` — "the previous page number"; `next` — "the next page number"; `pages` — "the number of pages available"; `total` — "the number of posts available"; `limit` — "the number of posts per page".

**Default template (as printed in the docs).**

```html
<nav class="pagination" role="navigation">
    {{#if prev}}
        <a class="newer-posts" href="{{page_url prev}}">← Newer Posts</a>
    {{/if}}
    <span class="page-number">Page {{page}} of {{pages}}</span>
    {{#if next}}
        <a class="older-posts" href="{{page_url next}}">Older Posts →</a>
    {{/if}}
</nav>
```

**Unique helpers within this context.** `{{page_url}}` — "accepts `prev`, `next` and `$number` to link to a particular page"; `{{page}}` — "outputs the current page number"; `{{pages}}` — "outputs the total number of pages".

> **Caveats** — the data "is generated based on the post list that is being output (index, tag posts, author posts etc) and always exists at the top level of the data structure"; a fully translatable theme needs `pagination.hbs` in `content/themes/mytheme/partials`[^pag-i18n].

[^pag-i18n]: [translate — Ensure templates exist](https://docs.ghost.org/themes/helpers/utility/translate.md)

### partials

**Purpose.** "Include chunks of reusable template code" — useful "for any repeating elements, such as a post card design, or for splitting out components like a header". [src](https://docs.ghost.org/themes/helpers/utility/partials.md)

**Signatures.** `{{> "partial-name"}}`; `{{> "call-to-action" heading="Sign up now"}}` (hash properties); `{{#> (concat "icons/" type)}} ... {{/undefined}}` (dynamic partial, block form).

**Semantics.** "All partials are stored in the `partials/` directory of the theme. Partials will inherit context and make that context available within the partial file." Properties "provide the option to set contextual values per use case" and are read inside the partial as ordinary values.

```handlebars
{{#foreach posts}}
  {{> "post-card"}}
{{/foreach}}

{{> "call-to-action" heading="Sign up now"}}
```

```html
<!-- partials/post-card.hbs -->
<article class="post-card.hbs">
  <h2 class="post-card-title">
    <a href="{{url}}">{{title}}</a>
  </h2>
  <p>{{excerpt words="30"}}</p>
</article>

<!-- partials/call-to-action.hbs -->
<aside>
  {{#if heading}}
    <h2>{{heading}}</h2>
  {{/if}}
  <form><!-- ... --></form>
</aside>
```

**Dynamic partials.** "You can pick a partial name dynamically with a sub-expression rather than a string literal."

```handlebars
{{#> (concat "icons/" type)}}
  {{!-- Fallback rendered when no matching partial exists --}}
  <span class="icon icon-default">{{name}}</span>
{{/undefined}}
```

> **Caveats** — "Use the **block form** for dynamic partials, not the inline form. The block form falls back to its inner content when the named partial doesn't exist; the inline form throws a page error and breaks the rendered page."; "the closing tag must be `{{/undefined}}`. This looks unusual, but it's the only form Handlebars accepts when closing a dynamic partial block."[^partials-dynamic]

[^partials-dynamic]: [partials — Dynamic partials](https://docs.ghost.org/themes/helpers/utility/partials.md)

### plural

**Purpose.** "Output different text based on a given input" — "a formatting helper for outputting strings which change depending on whether a number is singular or plural". [src](https://docs.ghost.org/themes/helpers/utility/plural.md)

**Signature.** `{{plural value empty="" singular="" plural=""}}` — inline. Attributes: `empty` (string; no default documented — used for the empty case), `singular` (string; no default documented) and `plural` (string; no default documented), the latter two supporting `%`. "`%` is parsed by Ghost and will be replaced by the number of posts. This is a specific behaviour for the helper."

```handlebars
{{plural pagination.total empty='No posts' singular='% post' plural='% posts'}}
```

> **Caveats** — the documented use case is `pagination.total`, which "themes have access to … on the homepage, a tag page or an author page"; for i18n pass `(t)` subexpressions: `{{plural ../pagination.total empty=(t "No posts") singular=(t "1 post") plural=(t "% posts")}}`[^plural-i18n].

[^plural-i18n]: [translate — Plural helper](https://docs.ghost.org/themes/helpers/utility/translate.md)

### post_class

**Purpose.** "Outputs classes intended for your post container, useful for targeting posts with styles". [src](https://docs.ghost.org/themes/helpers/utility/post_class.md)

**Signature.** `{{post_class}}` — inline, no documented attributes. Classes: "`post` - All posts automatically get a `post` class."; "`featured` - All posts marked as featured get the `featured` class."; "`page` - Any static page gets the `page` class."; "`tag-:slug` - For each tag associated with the post, the post get a tag in the format `tag-:slug`."

Documented worked examples: "A post which is not featured or a page, but has the tags `photo` and `panoramic` would get `post tag-photo tag-panoramic`"; "A featured post with a tag of `photo` would get `post tag-photo featured`"; "A featured page with a tag of `photo` and `panoramic` would get `post tag-photo tag-panoramic featured page`."

```html
<article class="{{post_class}}">
  {{content}}
</article>
```

> **Caveats** — required helper[^postclass-required]; "Setting a post as featured or as a page can be done from the post settings menu."[^postclass-settings]

[^postclass-required]: [structure — Helpers](https://docs.ghost.org/themes/structure.md)
[^postclass-settings]: [post_class — Usage](https://docs.ghost.org/themes/helpers/utility/post_class.md)

### prev_post & next_post

**Purpose.** "Within the `post` scope, returns the URL to the previous or next post" — each "performs a query against the API to fetch the next or previous post in accordance with the chronological order of the site". [src](https://docs.ghost.org/themes/helpers/utility/prev_next_post.md)

**Signatures.** `{{#prev_post}}{{title}}{{/prev_post}}` and `{{#next_post}}{{title}}{{/next_post}}` — block helpers. Attribute: `in` (string, e.g. `"primary_tag"`; default: whole site in chronological order) — "You can also scope where to pull the previous and next posts from using the `in` parameter".

**Semantics.** "Inside of the opening and closing tags of the `{{#next_post}}{{/next_post}}` or `{{#prev_post}}{{/prev-post}}` helper, the normal helpers for outputting posts will work, but will output the details of the post that was fetched from the API, rather than the original post." Note the docs' own closing-tag typo in that sentence (`{{/prev-post}}`); the working example uses `{{/prev_post}}`.

```handlebars
{{#post}}
	{{#prev_post}}
		<a href="{{url}}">{{title}}</a>
	{{/prev_post}}

	{{#next_post}}
		<a href="{{url}}">{{title}}</a>
	{{/next_post}}

	{{! scoped to the same primary tag }}
	{{#prev_post in="primary_tag"}}<a href="{{url}}">{{title}}</a>{{/prev_post}}
	{{#next_post in="primary_tag"}}<a href="{{url}}">{{title}}</a>{{/next_post}}
{{/post}}
```

> **Caveats** — valid only "when in the scope of a post", and each use issues an API query[^prevnext-scope]; no `{{else}}` block is documented for these helpers, so guard the first/last post with `{{#if}}` or `{{#has}}`[^prevnext-else].

[^prevnext-scope]: [prev_post & next_post — Usage](https://docs.ghost.org/themes/helpers/utility/prev_next_post.md)
[^prevnext-else]: [prev_post & next_post — Usage](https://docs.ghost.org/themes/helpers/utility/prev_next_post.md)

### reading_time

**Purpose.** "Renders the estimated reading time for a post". [src](https://docs.ghost.org/themes/helpers/utility/reading_time.md)

**Signature.** `{{reading_time}}` — inline. Attributes `minute` (string; defaults to the helper's singular text `1 min read`) and `minutes` (string with `%`; defaults to the helper's plural text `x min read`).

**Documented algorithm.** "The helper counts the words in the post and calculates an average reading time of 275 words per minute. For the first image present, 12s is added, for the second 11s is added, for the third 10, and so on. From the tenth image onwards every image adds 3s." Default output: "`x min read` for estimated reading time longer than one minute; `1 min read` for estimated reading time shorter than or equal to one minute". "Singular minute and plural minutes labelling can be customised using the options `minute` and `minutes`, using `%` as the plural minutes value."

```handlebars
{{#post}}
    {{reading_time}}
{{/post}}

{{reading_time minute="Only a minute" minutes="Takes % minutes"}}
```

> **Caveats** — both labels must be supplied to override both cases; `%` is the plural minutes placeholder; the i18n pattern is `{{reading_time minute=(t "1 min read") minutes=(t "% min read")}}`[^reading-i18n].

[^reading-i18n]: [translate — Reading time helper](https://docs.ghost.org/themes/helpers/utility/translate.md)

### search

**Purpose.** "Output a working, pre-styled search button & icon" — "outputs a search icon button that launches Ghost search when clicked". [src](https://docs.ghost.org/themes/helpers/utility/search.md)

**Signature.** `{{search}}` — inline, no documented attributes.

```handlebars
{{search}}
```

Output markup (as printed in the docs; inline styles included):

```html
<button class="gh-search-icon" aria-label="search" data-ghost-search style="display: inline-flex; justify-content: center; align-items: center; width: 32px; height: 32px; padding: 0; border: 0; color: inherit; background-color: transparent; cursor: pointer; outline: none;">
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M14.949 14.949a1 1 0 0 1 1.414 0l6.344 6.344a1 1 0 0 1-1.414 1.414l-6.344-6.344a1 1 0 0 1 0-1.414Z" fill="currentColor"/><path d="M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm-9 7a9 9 0 1 1 18 0 9 9 0 0 1-18 0Z" fill="currentColor"/></svg>
</button>
```

> **Caveats** — "The color of the icon uses the `currentColor` CSS property, meaning it will match the color of text around it."; "The styling can be overriden by using the `.gh-search-icon` class plus `!important`."[^search-note]

[^search-note]: [search — Usage](https://docs.ghost.org/themes/helpers/utility/search.md)

### split

**Purpose.** "Split a string into one or more iterable strings" — "designed to split a string into separate strings. It can be used in block or inline mode." [src](https://docs.ghost.org/themes/helpers/utility/split.md)

**Signatures.** Block: `{{#split "apple-banana-pear" separator="-"}} ... {{/split}}` (optional `as |elements|`). Inline/subexpression: `(split "hello, world" separator=",")`. "The `{{#split}}` helper returns an array, suitable for iteration with `{{#foreach}}`, with individual elements of the array suitable for any helper that expects a string." "Individual elements of the array may be addressed as `{{this}}` within a `{{#foreach}}` loop."

**Attribute.** `separator` (string; default `","` — "By default, strings are split at each `,`") — "allows settings the split location to an arbitrary value. Passing an empty string for the separator results in splitting to single characters. Separators may be multiple characters."

```handlebars
{{! block mode }}
{{#split "hello,world" as |elements|}}
  {{#foreach elements}}
    |{{this}}|
  {{/foreach}}
{{/split}}
{{! Outputs: |hello||world| }}

{{! inline mode }}
{{#foreach (split "hello, world" separator=",")}}
   {{this}} {{#unless @last}}<br>{{/unless}}
{{/foreach}}
{{! Outputs: hello<br> world }}

{{! empty separator -> single characters; multi-character separator }}
{{#foreach (split "remove-this-from-my-slug" separator="remove-this-")}}{{this}}{{/foreach}}
{{! Outputs: from-my-slug }}

{{! from a custom setting }}
{{#foreach (split @custom.list-of-tags)}}{{> tag-loop slug=this}}{{/foreach}}
```

> **Caveats** — "Split filters the array to exclude any empty strings from the final result. Sequential separators will not result in empty strings." (documented example `{{#foreach (split ",banana,,apple,")}}` outputs `(banana)(apple)`, "Not: ()(banana)()(apple)()"); "designed for strings. If it receives a non-string, it attempts to convert it to a string first."[^split-notes]

[^split-notes]: [split — No empty strings](https://docs.ghost.org/themes/helpers/utility/split.md)

### translate

**Purpose.** "Output text in your site language (the backbone of i18n)" — `{{t}}` "is a helper to output text in your site language". [src](https://docs.ghost.org/themes/helpers/utility/translate.md)

**Signatures.** `{{t "Subscribe"}}`; `{{t "Subscribe to {blogtitle}" blogtitle=@site.title}}`; `{{{t "Proudly published with {ghostlink}" ghostlink="<a href=\"https://ghost.org\">Ghost</a>"}}}` (triple-stache for HTML placeholder values); as a subexpression `(t "No posts")`, `(t "Page %")`.

**Documented setup.** 1) "Create a folder called `locales`" with language files such as `locales/en.json` and `locales/es.json`; "A valid language code must be used." 2) Add key/value pairs keyed by the readable English source text, e.g. `"Back": "Back"`, `"Page {page} of {pages}": "Page {page} of {pages}"`, `"1 min read": "1 min read"`. 3) "Verify that the `.json` translation file for your active theme is in place and then activate the language in the General settings of Ghost admin." 4) "To ensure that your theme is fully translatable, two core templates must exist in your theme": `pagination.hbs` and `navigation.hbs`, "exists in `content/themes/mytheme/partials`". 5) "Any plain text in your theme must be wrapped in the `{{t}}` translation helper". 6) Add `<html lang="{{@site.locale}}">` to `default.hbs`. 7) "run `ghost restart`".

**Placeholders.** "Placeholders are dynamic values that are replaced on runtime, and can be implemented using single braces." Data attributes are also supported: `{{t "Subscribe to {blogtitle}" blogtitle=@site.title}}`.

**Subexpressions.** "a `(t)` subexpression (instead of normal `{{t}}` helper) can be used as a parameter inside another helper such as `{{tags}}`. This can be used to translate the prefix or suffix attribute of the `{{tags}}`, `{{authors}}` or `{{tiers}}` helper."

```handlebars
<a href="#/portal/signup" data-portal="signup">{{t "Subscribe"}}</a>
{{! output when Ghost Admin is set to "en" for English }}
<a href="#/portal/signup" data-portal="signup">Subscribe</a>
{{! output when Ghost Admin is set to "es" for Spanish }}
<a href="#/portal/signup" data-portal="signup">Suscríbete</a>

{{! integrations }}
{{plural ../pagination.total empty=(t "No posts") singular=(t "1 post") plural=(t "% posts")}}
{{reading_time minute=(t "1 min read") minutes=(t "% min read")}}
<title>{{meta_title page=(t "Page %")}}</title>
```

> **Caveats** — "It's possible to use any translation key on the left, but readable English is advised in order to take advantage of the fallback option inside the `{{t}}` translation helper when no translation is available."; "Dates, with month names, are automatically translated. You don't need to include them in the translation files."; "Use HTML entities instead of characters, for example `&lt;` instead of `<`."[^t-notes]; `{{meta_title}}` "accepts a page parameter that can be used in conjunction with translations", hence `page=(t "Page %")`[^t-meta].

[^t-notes]: [translate — Making a theme translatable](https://docs.ghost.org/themes/helpers/utility/translate.md)
[^t-meta]: [translate — Pagination](https://docs.ghost.org/themes/helpers/utility/translate.md)

## 4. Quick reference table

| Helper | Type | Typical use | One-line signature |
| - | - | - | - |
| `foreach` | functional | Loop posts/tags/authors with metadata and slicing | `{{#foreach data limit="3" from="1" to="5" visibility="all" columns="3" as \|item\|}}{{/foreach}}` |
| `get` | functional | Server-side extra data from the Content API | `{{#get "posts" limit="15" page="1" order="published_at desc" include="tags,authors" filter="featured:true" as \|posts pages\|}}{{/get}}` |
| `has` | functional | Ask context questions | `{{#has tag="a,b" author="Name" slug="x" id=post.id any="a,b" all="a,b" number="nth:3"}}{{else}}{{/has}}` |
| `if` | functional | Truthiness test | `{{#if value}}{{else}}{{/if}}` |
| `unless` | functional | Inverse truthiness test | `{{#unless value}}{{else}}{{/unless}}` |
| `is` | functional | Branch on current route context | `{{#is "home, index, post, page, tag, author, paged, private"}}{{else}}{{/is}}` |
| `match` | functional | Typed comparison / `@custom` branching | `{{#match value "=" "other"}}{{else match x ">" 1}}{{/match}}` |
| `asset` | utility | Cache-busted path under `assets/` | `{{asset 'css/style.css' hasMinFile='true'}}` |
| `block` | utility | Named slot filled by child templates | `{{{block "scripts"}}}` + `{{#contentFor "scripts"}}{{/contentFor}}` |
| `body_class` | utility | Dynamic classes for `<body>` | `{{body_class}}` |
| `color_to_rgba` | utility | Hex color to RGBA string | `{{color_to_rgba color alpha}}` |
| `concat` | utility | Join values as strings | `{{concat "a" "b" separator=" "}}` |
| `contrast_text_color` | utility | Readable text color for a background | `{{contrast_text_color color}}` |
| `encode` | utility | URL-encode a value | `{{encode value}}` |
| `ghost_head` | utility | Required head output (meta, schema, RSS, injection) | `{{ghost_head}}` |
| `ghost_foot` | utility | Required footer output (code injection) | `{{ghost_foot}}` |
| `json` | utility | Safe inline JSON | `{{json value}}` or `{{json key=value}}` |
| `link_class` | utility | Active/parent nav classes | `{{link_class for="/about/" activeClass="nav-current" class="extra"}}` |
| `log` | utility | Server-console debugging in development | `{{log value}}` |
| `pagination` | utility | Newer/older post links | `{{pagination}}` (override `partials/pagination.hbs`) |
| `partials` | utility | Reusable template chunks | `{{> "name" key="value"}}` / `{{#> (concat "dir/" x)}}{{/undefined}}` |
| `plural` | utility | Singular/plural/empty text | `{{plural value empty="" singular="" plural=""}}` |
| `post_class` | utility | Post container classes | `{{post_class}}` |
| `prev_post` | utility | Previous post (optionally scoped) | `{{#prev_post in="primary_tag"}}{{title}}{{/prev_post}}` |
| `next_post` | utility | Next post (optionally scoped) | `{{#next_post in="primary_tag"}}{{title}}{{/next_post}}` |
| `reading_time` | utility | Estimated reading time | `{{reading_time minute="" minutes=""}}` |
| `search` | utility | Search button/icon markup | `{{search}}` |
| `split` | utility | Split a string into an iterable array | `{{#split value separator="," as \|items\|}}{{/split}}` |
| `t` (translate) | utility | i18n text output | `{{t "Text {placeholder}" placeholder=value}}` |
