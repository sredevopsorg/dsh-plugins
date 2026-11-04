# React (and other frameworks) as islands in a Ghost theme

A Ghost theme is server-rendered Handlebars. React can add interactivity to it, but it must
never take over rendering, routing, or content — Ghost already produced the HTML, and the
parts you would duplicate (SEO metadata, membership gating, Portal, comments, search) are
managed by Ghost.

## 1. Decide first: do you actually need React?

| Need | Use | Why |
|---|---|---|
| Styling | Tailwind / CSS | No runtime |
| Menu, theme toggle, copy button, scroll effect | Vanilla JS or Alpine | A few hundred bytes; islands are overkill |
| Small interactive widget with state (tabs, calculator, filters) | Preact (~4 kB) or vanilla | React's runtime (~45 kB gzip with `react-dom`) is hard to justify |
| Several stateful, reused components, or a team already writing React | React islands | Familiarity and reuse win; ship it as islands, not as a takeover |
| Whole-site rendering (Next.js/Remix/SvelteKit) | **Not a theme** — headless Ghost via the Content API | You keep Ghost as a CMS; you lose theme-based routing, members gating, and admin routing |

State the trade-off to the user explicitly when the request is ambiguous. A "React Ghost
theme" almost always means islands.

## 2. The island contract

1. **Templates own the document.** React mounts into an element inside `{{{body}}}`.
2. **Server HTML is the source of truth for content.** Do not re-render post bodies,
   titles, or lists in React.
3. **Mount points are declarative and named.** Templates say what they want, not how it works.
4. **Nothing breaks when JS fails.** The page must be complete and readable without the island.

```hbs
{{! post.hbs — a mount point with no data plumbing }}
<div data-island="ReadingProgress" data-target=".gh-content"></div>
```

## 3. Registry and mounting

```jsx
// assets/js/islands.jsx
import { createRoot } from "react-dom/client";
import ReadingProgress from "./islands/ReadingProgress.jsx";
import TableOfContents from "./islands/TableOfContents.jsx";

const registry = { ReadingProgress, TableOfContents };

for (const el of document.querySelectorAll("[data-island]")) {
  const Component = registry[el.dataset.island];
  if (!Component) {
    // A template typo must not break every page.
    console.warn(`[islands] unknown island: ${el.dataset.island}`);
    continue;
  }
  createRoot(el).render(<Component {...el.dataset} />);
}
```

`assets/js/index.js` imports this module so Vite emits it with the main entry:

```js
import "../css/index.css";
import "./islands.jsx";
```

## 4. Getting data into an island

**Prefer DOM over props.** If the data is already rendered (post content, headings, links),
read it — that is why the example island takes `target=".gh-content"` instead of a post object.

**Scalars: data attributes.** Handlebars escapes attribute values, so this is injection-safe:

```hbs
<div data-island="Toc" data-target=".gh-content" data-max-depth="3"></div>
```

**Structured data: a JSON script block.** The documented `{{json}}` helper "safely serializes a
value to JSON for inline output", including from hash arguments:

```hbs
<script id="post-data" type="application/json">
    {{json title=title url=url readingTime=reading_time}}
</script>
```

```jsx
const props = JSON.parse(document.getElementById("post-data")?.textContent ?? "{}");
```

Reach for this only when the component genuinely needs server data the DOM does not expose.
Every JSON block is payload on every page load, and it duplicates what is already rendered.

**Never** interpolate server values straight into a `<script>` body with `{{{…}}}` unless you
have verified the escaping for a `</script>` payload — `{{json}}` is the documented safe path.

## 5. Client-side data from the Content API

For "load more", live filtering, or search facets, use the public Content API rather than
embedding data:

```
GET {site}/ghost/api/content/posts/?key={content_api_key}&limit=15&page=2&include=tags,authors
```

- The **Content API key is public by design** (read-only, published content only). Get it from
  Settings → Integrations, and pass it to the island as a data attribute or via an inline
  config block:

```hbs
<div data-island="LoadMore" data-endpoint="{{@site.url}}/ghost/api/content/" data-key="YOUR_CONTENT_KEY"></div>
```

- Prefer Ghost's native search (`data-ghost-search`, `Cmd/Ctrl+K`) over building search — it is
  already wired to taxonomies and the search index. Use the API only for genuinely custom
  queries the helpers cannot express.
- Client-side fetching means **no server-rendered HTML** for that content: it is invisible to
  crawlers and flashes in after load. Use `{{#get}}` in the template when the content can be
  rendered server-side instead.

## 6. Other frameworks

The pattern is framework-agnostic; only the mount call changes:

| Framework | Mount | Rough gzip runtime |
|---|---|---|
| Preact | `render(<App {...props}/>, el)` | ~4 kB |
| Vue 3 | `createApp(App, props).mount(el)` | ~35 kB |
| Svelte | `new App({ target: el, props })` | ~2–10 kB |
| Alpine | markup-only directives (`x-data`) | ~15 kB |
| Vanilla | `el.appendChild(render(props))` | 0 |

Registering a second framework in the same theme is possible but ships two runtimes; pick one.

## 7. Do not break Ghost's injected features

`{{ghost_head}}` injects Portal (membership UI), card assets, code injection, and API scripts.
Islands must not:

- Replace or re-render the `<body>`/`<main>` subtree (Portal anchors and member state live there).
- Swallow clicks meant for `data-portal`, `data-members-form`, or `data-ghost-search` elements.
- Assume they are the only script on the page — Ghost's own scripts load independently.
- Interfere with Ghost's comment embed (`{{comments}}`), which manages its own iframe.

If a component needs to react to member state, read it from the rendered DOM (e.g. the
`gh-portal-*` classes Ghost adds) or use Portal's API rather than re-implementing auth.

## 8. Performance rules

- **Mount lazily.** For below-the-fold islands, use `IntersectionObserver` and mount on first
  visibility; for heavy ones, `await import()` the component in the observer callback.
- **Reserve space.** Give the mount element a min-height so hydration does not shift layout
  (CLS is a ranking and UX cost).
- **Guard against missing targets** (the registry above does) and against double mounting when
  a script is included twice.
- **Keep the content readable without JS**: never hide server-rendered content behind a
  React-only render path.
- **Watch the budget.** A Vite build with React is ~220 kB uncompressed / ~70 kB gzip for the
  runtime alone; verify with `npm run build` before shipping.

```jsx
// Lazy island mounting
const io = new IntersectionObserver(async (entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    io.unobserve(entry.target);
    const { default: Component } = await import(`./islands/${entry.target.dataset.island}.jsx`);
    createRoot(entry.target).render(<Component {...entry.target.dataset} />);
  }
}, { rootMargin: "200px" });
document.querySelectorAll("[data-island-lazy]").forEach((el) => io.observe(el));
```

## 9. Anti-patterns

- Rendering the post body, title, or list in React "so it can be dynamic" — duplicates Ghost's
  work and breaks SEO/members.
- Client-side routing that intercepts links — you now maintain Ghost's routing in JS.
- Passing large objects through data attributes (`data-post='{{json post}}'` in an attribute)
  instead of a JSON script block.
- One React root per component without cleanup, or mounting on `document.body`.
- Assuming the island runs before Ghost's scripts — do not depend on Portal internals.
- Shipping React to render static markup that Handlebars already rendered.

## 10. Testing islands

- Disable JS and confirm the page is complete and readable.
- Check the built page for exactly one `<script type="module">` from `vite_assets/foot.hbs`.
- Confirm each mount element is non-empty after load (a failed island leaves an empty div).
- Watch console warnings — the registry logs unknown island names, which catches template typos.

## Sources

- [Ghost: Structure](https://docs.ghost.org/themes/structure) and [Content](https://docs.ghost.org/themes/content) — server-rendered templates and editor output
- [Ghost: `{{json}}` helper](https://docs.ghost.org/themes/helpers/utility/json), [Search](https://docs.ghost.org/themes/search), [Members](https://docs.ghost.org/themes/members)
- [Ghost Content API](https://docs.ghost.org/content-api) — public read-only key and caching
- Reference pipeline: [christopher-b/vapour](https://github.com/christopher-b/vapour)
