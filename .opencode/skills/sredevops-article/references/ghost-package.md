# Ghost package contract

Deliver every finished article as a paste-ready Ghost package, in chat **and** as a file. The only exceptions are a partial element (headline, excerpt, tags, feedback) and an explicit request for no file.

## Template

```markdown
**Ghost fields**
- **Title:** <specific sentence-case title>
- **Slug:** <specific-sentence-case-title>
- **Excerpt:** <one or two factual sentences, 150–200 characters>
- **Tags:** <Español, #es, plus two to four topic tags>
- **Feature image alt:** <specific description of the image the editor should use>

---

<introduction and body, no H1>

---

## Referencias
- [<descriptive source label>](<canonical URL>)
```

The example shows the Spanish shape. For English, use `English, #en` and `## References`. Replace every `<...>` placeholder; never ship the angle brackets. The horizontal rules are literal, and the field labels stay exactly as above so the user can copy each value.

## Field rules

### Title

- Sentence case, roughly 70 characters or fewer.
- Specific enough to be searchable, witty enough to be worth clicking.
- No clickbait, no all-caps, no "ultimate guide", no colon if a plain phrase works.
- The body must deliver the title's promise.

### Slug

- Lowercase ASCII, hyphen-separated, no accents or punctuation.
- Derived from the title, not a random phrase.
- No dates unless the piece is time-sensitive (release, CVE, event).
- Keep it readable; the site uses long descriptive slugs, so length is not a problem.

### Excerpt

- 150–200 characters for search snippets and cards; hard maximum 300. Ghost uses it as the meta description.
- State the change and the consequence. Do not restate the title.
- No "in this article", no "we will explore", no question-only teasers.

### Tags

- Four to six tags total: two language tags plus two to four topic tags.
- Spanish: always `Español` and `#es`. English: always `English` and `#en`.
- Add the topic tags that actually describe the piece. Reuse the site's taxonomy where possible: Kubernetes, Containers, Security, Cloud Native, Infrastructure, DevOps, SRE, Open Source, AI, Linux, Networking, Observability, Platform Engineering.
- Internal tags (`#es`, `#en`) are lowercase and start with `#`.
- Do not invent a new public tag for a single article unless the topic will recur.

### Feature image alt

- Describe the information in the image, not the file type or the medium.
- Good: "Node readiness states before and after the controller reconciles a tainted node".
- Bad: "image of a diagram", "screenshot", "Kubernetes logo".
- If the article has no natural image, describe the screenshot or diagram the editor should capture, and say so.

### Body

- No H1. Ghost stores the title in its own field, so an H1 would duplicate it.
- Start with the hook. No preamble, no "in this article".
- H2 for main sections, H3 only for real sub-parts.
- Use tables for comparisons, code fences with language identifiers, and inline links.
- End with the references section. Do not add a "Conclusion" heading that repeats the article.

### References

- Spanish: `## Referencias`. English: `## References`.
- One bullet per source, descriptive label, canonical URL. See the one `ref` exception in `research-and-citations.md`.
- Order by first appearance in the body, or by importance if the body does not map cleanly.
- Include the primary sources you actually read. Do not pad the list.
- Add a date or version in the label when the claim is time-sensitive: "Kubernetes 1.36 release notes (2026-09-15)".

## Editor notes

After the references, optionally add:

```markdown
**Notas del editor**
- Assumption or caveat.
- Source that could not be verified.
```

or `**Editor notes**` in English. Keep it to three bullets. Use it for:

- an assumption you made about the brief;
- a source that was unreachable or paywalled;
- a code snippet that was not executed;
- a fact that is likely to change soon.

Do not use editor notes to apologize, summarize, or repeat the article.

## Rewrite output

For a rewrite, return the full package, then:

```markdown
**What changed**
- Substantive structural or factual edit.
- Source added or corrected.
- Claim removed or softened.
```

or `**Qué cambió**` in Spanish. Three bullets maximum. Do not list comma fixes.

## Body-only mode

When the user asks for body-only Markdown:

- Include the H1.
- Omit the Ghost fields block.
- Keep the references section.
- Keep the same voice and structure.
- Still write `<slug>.md`, unless the user asks for chat only.

## File output

Every article, rewrite, and translation is **also** written to a file. This is not optional and not a separate "file mode" the user has to request: the `write` tool call is part of delivering, exactly like posting the text.

Do this, in this order:

1. Call the `write` tool with the final Markdown and a `<slug>.md` filename. Relative filenames resolve against the session working directory, which is the intended destination; do not prefix them with `./`, `../`, or an absolute path unless the user gave one.
2. Then post the same content in chat.

Never announce a file path you did not get back from a successful `write`. Saying "written to X" without the tool call is a lie the user catches by looking at the folder. If the write errors, say so and deliver the article in chat anyway.

Rules for the file:

- **Location:** the session working directory, unless the user names a path.
- **Name:** `<slug>.md`, using the package slug. Body-only output uses the same name.
- **Content:** byte-for-byte what is delivered in chat. No extra header, no "generated by" line, no code fence around the whole document.
- **Same language, same file:** re-delivering in a language already on disk overwrites that file. `write` replaces the whole file, which is correct here. No `<slug>-v2.md`, `<slug>-final.md`, or dated copies.
- **Different language, different file:** English and Spanish coexist under their own slugs; writing one never overwrites the other. On a slug collision add `-es` or `-en` to the new file only.
- **Existing files:** never overwrite a file the user did not ask you to replace.
- **Other formats** (`.mdx`, `.txt`) only when asked.
- **Present:** after the write succeeds, call `present` once.

With no writable directory, deliver in chat and state plainly that no file was written.

## Length

- Default: 600–1500 words, excluding code blocks and references.
- Honor an explicit request. A 1500–2500-word brief is fine; ask before going past 2500. The site publishes long-form, but the default contract keeps the draft tight.
