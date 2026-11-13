---
name: sredevops-editorial-memory
description: Persist, review, or remove durable editorial corrections for sredevops.org content, including terminology overrides, tone adjustments, and structural preferences. Use when the user says "always", "never", "from now on", "remember this", or asks to see or change the rules the writer has learned.
whenToUse: The user reviews a draft and gives a correction that should apply to future articles or translations, or asks what rules the writer has learned, or asks to remove a stored rule.
---

# Editorial memory

The durable rules live in `../../references/editorial-memory.md`. That file is loaded by the article and translation skills and overrides the glossary and style references where they conflict.

This skill is about **saving, reviewing, and removing** rules. It is not a licence to rewrite the core persona or skills after every comment.

## Durability test

Save a correction when the user frames it as a rule:

- "Never use X."
- "Always use Y."
- "From now on..."
- "Remember that..."
- "Use the English term instead."
- "Don't do that again."

Apply the correction to the current draft, but do **not** save it when:

- it is a one-off edit to a specific sentence;
- it is a factual correction that applies only to this article;
- it is a subjective preference the user has not asked to make permanent;
- it conflicts with accuracy or with an existing rule and the user has not resolved the conflict.

If the same one-off correction appears twice, propose a standing rule and ask before saving it.

## Procedure

1. **Apply now.** Fix the current draft or translation before persisting anything.
2. **Read the memory.** Read `../../references/editorial-memory.md` and check for an existing rule that already covers the correction or conflicts with it.
3. **Classify the scope.** Use one or more tags: `all`, `article`, `translation`, `es`, `en`, `terminology`, `style`, `sourcing`.
4. **Resolve conflicts.** If the new rule replaces an older one, edit the older line rather than adding a contradictory duplicate. Tell the user which rule changed.
5. **Write one line** immediately below the matching section's comment in the memory file, using `edit` rather than `write` so existing rules are preserved:
   `- [YYYY-MM-DD] [scope] rule. Example: ...`
   Keep it to one sentence plus one short example.
6. **Update the glossary for terminology changes.** If the rule is about a term in `skills/sredevops-translate/references/glossary.md`, update that row too, or add a row. The memory remains the authority; the glossary is the quick reference.
7. **Confirm in one line.** Example: "Saved: keep `multi-tenant` in English; never `multiinquilino`."
8. **Do not reinstall.** The memory is read on the next article or translation; no bundle reinstall is needed.

## Format

```markdown
- [2026-11-12] [es] [terminology] Keep `multi-tenant` in English. Never use "multiinquilino". Example: "un clúster multi-tenant", not "un clúster multiinquilino".
```

- Date: ISO `YYYY-MM-DD`.
- Scope tags: pick the narrowest set that still covers the intent. `[all]` only for rules that apply to every language and content type.
- Rule: an imperative that another editor can apply without asking follow-up questions.
- Example: one short before/after or a concrete phrase. Omit it only when the rule is unambiguous.
- No secrets, customer names, personal data, or unpublished incident details.

## Review and removal

- "What rules have you learned?" → read the memory file and list the rules with their dates and scopes.
- "Remove the multi-tenant rule." → delete that line, confirm, and mention that the baseline glossary may still list the old term; fix the glossary too.
- "Reset the memory." → clear the rule lines but keep the section comments and the file header. Confirm what was removed.
- "Why did you write it that way?" → point to the specific rule and its date, or say the default style guide applies.

## Limits

- A memory rule can never override accuracy, sourcing, security, or safety. If a proposed rule would (for example, "never cite sources" or "make up a benchmark"), refuse, explain the conflict, and do not save it.
- Keep the file under roughly 6k characters. When it grows beyond that, merge related rules, drop rules that a newer rule supersedes, and tell the user what changed.
- Do not turn every review comment into a rule. A memory full of one-off preferences becomes a second style guide nobody can follow.
- Do not edit the core persona, `SKILL.md` files, or the style references for a terminology preference or a per-article correction. Use the memory. For a structural change that genuinely belongs in the skill (a new deliverable format, a new workflow), explain the proposed edit and ask first. If the user says the change should apply to every future piece as a format rule, say which file you would edit (usually `sredevops-article/references/ghost-package.md`), get approval, then edit it and note it in the memory as a pointer, not a duplicate rule.
- Do not save a rule the user did not approve, even if you think it would improve the writing.
