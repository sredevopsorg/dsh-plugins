---
name: sredevops-article
description: Draft, write, rewrite, or improve an SRE/DevOps article for sredevops.org in English or Chilean Spanish, including research, structure, and Ghost-ready metadata. Use for article briefs, drafts, rewrites, headlines, excerpts, tags, or editorial feedback.
whenToUse: The user asks to write, draft, rewrite, refine, outline, or package an article, news piece, tutorial, or opinion post for sredevops.org or an SRE/DevOps audience.
---

# Write an article for sredevops.org

## Before you start

Read `references/voice-and-style.md` and `references/ghost-package.md` before drafting, and `references/research-and-citations.md` before researching claims. Read `../../references/editorial-memory.md` and apply every standing correction; it overrides the glossary and style guide where they conflict. Open one or two files in `references/site-examples.md` only when calibration helps; do not copy lines or structure mechanically. If the user gives a durable correction during review, load `sredevops-editorial-memory` and persist it.

## Step 1: Parse the brief

Identify:

- **Mode** — new draft, rewrite, or light edit. If the user supplies text and says "improve", "fix", "review", or "edit", it is a rewrite, not a blank-page draft.
- **Language** — English or Spanish. Match the user's request or the source draft. If neither is clear, ask one short question and wait.
- **Topic and angle** — the specific claim, change, or question the article answers. "Kubernetes" is not an angle; "why the new Node Readiness Controller changes scheduling gates" is.
- **Audience** — practitioner by default; adjust for decision-makers.
- **Length** — follow `references/ghost-package.md`. Default 600–1500 words, excluding code and references.
- **Sources** — anything the user supplied, plus what you must find.

Ask at most two questions, and only when the topic, language, or factual scope cannot be inferred. Do not interview the user for a brief they already gave. If you assume something, state it in an editor note after the references.

## Step 2: Research

Use `web_search` and `web_fetch`; prefer official docs and release notes, primary vendor engineering posts, NVD/CVE/RFC/standards, then independent analysis. Community posts are sentiment, not fact. For each claim capture the source URL, the version/date it applies to, and whether you actually read the page. Meet the sourcing minimums in `references/research-and-citations.md`; if you cannot, narrow the claims. Never invent a URL, quote, benchmark, or version. Unreachable or paywalled pages go in the editor notes.

## Step 3: Outline

Build a short outline: a concrete hook (not a definition), context, three to six H2 sections that each make one point, an operational takeaway, and a close that leaves the trade-off open. For a tutorial, use prerequisites, steps, verification, cleanup, and the failure modes readers will actually hit.

## Step 4: Draft

Follow the voice reference. In particular:

- Sentence-case headings in both languages.
- Short paragraphs. One idea per paragraph.
- Concrete nouns and numbers. Replace "significant performance improvements" with the measured number and its conditions, or cut the claim.
- Code fences with a language identifier. Copy or trim snippets from the cited source; mark any adaptation untested. Never include real credentials, cluster names, or account IDs.
- Tables for comparisons and version matrices, not for prose.
- Inline links on descriptive text. No "click here", no bare URLs in the body.
- Bold for the one sentence that matters, not for decoration. No emoji unless the user's brief uses them.

Do not write a generic introduction, a "key takeaways" box, or a conclusion that repeats the headings.

## Step 5: Self-review

- [ ] Every factual claim has a source you read, or is marked opinion/unverified.
- [ ] Versions, dates, CVE IDs, and flags are correct; every link resolves.
- [ ] Code is copied from documentation or marked untested; you did not claim to run it.
- [ ] The piece says something specific and the jokes do not undercut a safety warning.
- [ ] Spanish is Chilean Spanish with `tú` and consistent technical terms.
- [ ] Word count and Ghost fields are within limits; the body has no H1, except in body-only mode.
- [ ] `write` returned success for `<slug>.md`, and the same content is pasted in the reply.

## Step 6: Deliver

Deliver the package **twice**: as a file and in chat.

1. **Write the file first.** Call the `write` tool with the full Markdown and `<slug>.md` as a relative filename; it resolves against the session working directory. This step is mandatory: the user does not have to ask for a file.
2. **Call `present`** with that file.
3. **Post the package in chat**: the `**Ghost fields**` block, a horizontal rule, the body from the introduction with no H1, references (`## Referencias` in Spanish, `## References` in English), and optional three-bullet editor notes.

The chat reply is the primary deliverable. Do not replace it with a pointer to the file, and do not paste the content a third time. Never say a file was written unless `write` returned success; if it fails, say so and still deliver the full package in chat.

For a headline, excerpt, tag set, or feedback only, return just that element (three options for a headline) and write no file.

No preamble, no "I hope this helps", no restating the brief.

## Rewrite mode

When the user supplies a draft:

1. Read the whole draft before changing anything.
2. Preserve the argument, intended audience, and claims unless the user asks you to change them.
3. Fix structure, transitions, false claims, weak sourcing, and filler.
4. Add sources for existing claims where possible; do not add new claims to make the piece feel bigger.
5. Apply the house voice; keep the author's own voice only if the user explicitly asks.
6. Deliver the full revised package as in Step 6, then up to three bullets under `**What changed**` (or `**Qué cambió**`).

If the draft is factually wrong, correct it and flag the correction in the change note. Do not silently rewrite history. When the revision starts from a file you wrote earlier, overwrite that file instead of creating a second one.

## Body-only and other output modes

Body-only Markdown keeps the H1 and drops the Ghost fields block; it still gets its `<slug>.md` file. Chat only when the user asks for that.

## Failure modes

- **No usable sources** — say what is missing and ask for a source or permission to write an opinion piece instead. Do not fill the gap with plausible-sounding detail.
- **Topic too broad** — propose two or three specific angles and ask the user to pick one.
- **User asks for a hit piece** — keep the criticism factual and aimed at the decision or the vendor behavior, not at a person.
- **User asks you to claim you tested something** — refuse and mark the snippet untested.
