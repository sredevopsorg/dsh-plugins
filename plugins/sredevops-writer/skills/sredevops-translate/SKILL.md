---
name: sredevops-translate
description: Translate SRE/DevOps articles between English and Chilean Spanish for sredevops.org while preserving Markdown, code, links, and technical meaning. Use for translation requests, localized article versions, or bilingual Ghost packages.
whenToUse: The user asks to translate an article, post, excerpt, title, or Ghost package between English and Spanish, or asks for an English/Spanish version of existing content.
---

# Translate for sredevops.org

## Before you start

Read:

- `references/es-cl-voice.md` — the Spanish register and typography.
- `references/glossary.md` — the term map.
- `../sredevops-article/references/ghost-package.md` — the field, tag, and references contract for Ghost packages.
- `../../references/editorial-memory.md` — standing corrections; these override the glossary and typography where they conflict. If the user gives a durable correction during review, load `sredevops-editorial-memory` and persist it.

## Direction

- Detect the source language and target the other one. English → Chilean Spanish, or Chilean Spanish → English.
- If the source mixes languages, translate the prose and leave the embedded English technical terms alone.
- If the target language is ambiguous (for example, the user says "translate this" with no target and the source is bilingual), ask one short question.
- Do not translate into Portuguese. That is out of scope.

## Preserve exactly

- Markdown structure: heading levels and order, lists, tables, blockquotes, horizontal rules, fenced code blocks, inline code, HTML, and shortcodes.
- Code, commands, flags, file paths, environment variables, API kinds, resource names, and identifiers. These stay byte-identical.
- URLs, image paths, and link targets. Translate link labels and alt text, never the destination.
- Frontmatter keys and Ghost field labels. Translate only the values that are prose.
- Numbers, version strings, CVE IDs, and date values. Do not change the value; in prose, localize number and date formatting per `es-cl-voice.md`.
- Heading text is normalized to sentence case even if the source used Title Case. This is a style normalization, not a structural change.

Do not "fix" a code block, even if it looks wrong. If the code is wrong, note it outside the translation only when the user asks for a review; otherwise translate the surrounding prose faithfully.

## Translate

- Prose, headings, captions, alt text, table headers, callouts, and link labels.
- Ghost fields when the source includes them: title, excerpt, tags, feature-image alt. Keep the source slug by default; localize it only when the user asks for a separate localized URL.
- Language tags swap: `English` / `#en` → `Español` / `#es`, and the reverse. Keep technical tags in the form the site uses (usually English: Kubernetes, Security, Containers).
- The author's voice: keep the register, the irony, and the pacing. Adapt a joke so it lands in the target language; do not translate it word for word. Never add a joke that was not there.
- Technical terms: the glossary is the tie-breaker for ordinary nouns. Keep product names, API kinds, CLI commands, flags, and paths in English.
- Spanish output uses `tú`, neutral LATAM Spanish. At most two Chilean expressions per article, zero is fine, and only when the source register is informal. No profanity, no insults.
- English output is conversational and dry, not literal. Remove Spanish discourse markers that do not survive the trip.

## Do not

- Add claims, examples, caveats, or sources that are not in the source.
- Remove claims because they seem wrong. Translate them; if the user asked for a review, flag the issue separately.
- Summarize, expand, or "improve" the argument.
- Translate code comments, log strings, or error messages inside code blocks.
- Add a preamble, a closing, or an explanation of your translation choices.

## Output contract

- **Write the translation to a file first.** Call the `write` tool with the full translated Markdown and `<slug>.md` as a relative filename; it resolves against the session working directory. This is mandatory — the user does not have to ask for a file. Then call `present`.
- Output the translated Markdown in chat, in full.
- Apply the file rules in `../sredevops-article/references/ghost-package.md` under "File output": a translation in the target language overwrites the existing file for that language and never the source-language file.
- If the source came from a file path the user gave you, write the translation next to it with the target-language slug rather than overwriting the source.
- If the user asks for chat only, skip the file and say so in one line.
- Never claim a file was written unless `write` returned success. On failure, say so and still deliver the translation in chat.
- If the source includes the `**Ghost fields**` block, return a translated `**Ghost fields**` block, the horizontal rule, the translated body, and the translated references heading. Keep the field labels in English exactly as the article contract specifies. Translate the prose values, and localize the tags per the tag rules.
- If the source includes `**Editor notes**` / `**Notas del editor**` or `**What changed**` / `**Qué cambió**`, translate the labels and their bullets and keep the same count and order. Never drop a block.
- If the source is body-only, return body-only.
- No "Here is the translation", no notes, no bilingual side-by-side unless the user explicitly asks for one. The only text outside the translation is the one-line file path.
- If a term is genuinely untranslatable, keep the English term and move on. A single short first-use gloss is allowed when it prevents confusion; do not gloss every term.

## Ambiguity

If a sentence has two plausible readings and the difference matters, choose the reading that adds the least meaning and preserves the source's uncertainty. A faithful translation of an ambiguous sentence is better than a confident translation of the wrong one.

If the source contains a factual error, translate it faithfully. The translation skill is not the fact-checking skill. Only when the user asks for a review should you add a separate note about the error.

## Quality check

- [ ] No untranslated prose left behind, except intentional technical terms.
- [ ] Code, URLs, and identifiers are byte-identical to the source.
- [ ] Headings keep their level and order and use sentence case.
- [ ] No Ghost field, editor-note, or change-note block was dropped.
- [ ] The tone matches the source, including the jokes.
- [ ] Spanish reads naturally to a Chilean reader and does not sound like a translation.
- [ ] No commentary outside the translated content.
- [ ] The `write` call returned success, the file is named `<slug>.md`, and the other language's file is untouched.
