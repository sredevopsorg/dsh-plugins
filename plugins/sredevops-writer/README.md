# SRE DevOps Writer

A DeepSeek Harness agent preset for the `sredevops.org` editorial voice: a Senior SRE/DevOps engineer with 15+ years of cloud-native and Kubernetes experience who writes in English and Chilean Spanish with dry wit, sharp sarcasm, and technically grounded prose.

The preset is a bundle: one persona, three on-demand skills, and reference files that hold the detailed editorial rules. It can also learn from review: durable corrections are stored in a shared editorial memory and applied to future drafts.

## What it contains

```text
plugins/sredevops-writer/
├── package.json              # @sredevopsorg/dsh-sredevops-writer
├── cordis.patch.yml          # the preset declaration
├── index.js                  # skill provider: registers ./skills on ctx.skills
├── README.md
├── icon.svg
├── locale/en.json            # display title and description for market surfaces
├── test/                     # manifest and patch consistency tests (node --test)
├── references/
│   └── editorial-memory.md   # standing corrections from editor review
└── skills/
    ├── sredevops-article/    # draft, refine, and package an article
    │   ├── SKILL.md
    │   └── references/
    │       ├── voice-and-style.md
    │       ├── ghost-package.md
    │       ├── research-and-citations.md
    │       └── site-examples.md
    ├── sredevops-translate/  # bidirectional EN ↔ ES-CL translation
    │   ├── SKILL.md
    │   └── references/
    │       ├── es-cl-voice.md
    │       └── glossary.md
    └── sredevops-editorial-memory/  # save, review, remove corrections
        └── SKILL.md
```

- **Preset id:** `sredevops-writer`
- **Display name:** SRE DevOps Writer
- **Roster order:** 20
- **Skills:** `sredevops-article`, `sredevops-translate`, `sredevops-editorial-memory`

## Install

Install the bundle from a pinned release tag:

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#sredevops-writer-v0.1.1&path:/plugins/sredevops-writer"
```

From a local checkout, while developing:

```bash
dsh plugin --profile web add ./plugins/sredevops-writer
```

From Discover, install **SRE DevOps Writer** from the sredevopsorg index.

Installation writes the dependency into the `web` profile and runs the profile's package installation. The preset is available only to **new** sessions; existing sessions keep the composition they started with. Select **SRE DevOps Writer** when creating the session.

## Uninstall

```bash
dsh plugin --profile web remove @sredevopsorg/dsh-sredevops-writer
```

Or use the plugin manager with `action: remove_bundle` and the same target. Removing the bundle does not touch drafts already written into your workspaces.

## Learning from reviews

When you review a draft and state a durable rule ("never use X", "from now on...", "remember..."), the agent:

1. applies the correction to the current draft;
2. adds one dated line to `references/editorial-memory.md`;
3. updates the glossary when the rule is a terminology override;
4. confirms the saved rule in one line.

Rules in the memory override the glossary and style references where they conflict. The file is read on the next article or translation; no reinstall is needed. The seed rule keeps `multi-tenant` in English and bans `multiinquilino`.

Ask **"what rules have you learned?"** to review them, or **"remove the multi-tenant rule"** to delete one. One-off edits are not saved unless you ask, and the agent should not turn every review comment into a standing rule. The memory file is capped at roughly 6k characters; when it grows, older or superseded rules are merged or dropped with a note.

## Customize

- **Voice, audience, or persona rules:** edit the `persona` prefix in `cordis.patch.yml`, then reinstall the bundle.
- **Article structure, humor limits, or Ghost fields:** edit `skills/sredevops-article/SKILL.md` or its references. Skill bodies and references are re-read on every load, so a session started after the edit sees it without reinstalling.
- **Translation register or glossary:** edit `skills/sredevops-translate/references/`.
- **Learned corrections:** edit `references/editorial-memory.md` directly, or tell the agent to review/remove a rule. No reinstall is needed.
- **Plugin set:** edit the `plugins` list in `cordis.patch.yml`, then reinstall.

### How the skills are located

`cordis.patch.yml` declares two rows. The preset row (`preset-sredevops-writer`) carries the persona and the tools; the host row (`sredevops-writer-skills`) mounts this package, and `index.js` registers a skill provider on `ctx.skills`. The provider finds `skills/` from `import.meta.url`, so its location follows the installed package wherever the profile or a checkout puts it. No session's working directory and no install layout affects the lookup.

The host row registers the three skills in DSH's global skill layer, so every agent sees `sredevops-article`, `sredevops-translate`, and `sredevops-editorial-memory`, not only sessions started with this preset. Older revisions computed the path inside a `!!js` expression with `createRequire(process.cwd())`. That resolved to `<session cwd>/plugins/sredevops-writer/skills` from any session started outside this checkout, and because a missing skill root is silent, the three skills simply disappeared from the catalog. Keep paths out of the patch: `test/preset.test.mjs` fails if it gains a `customSkillDirs` entry, an evaluated expression, or a `process.cwd()` call.

Keep the persona under roughly 800 words. Keep each `SKILL.md` and reference file under roughly 6.8k characters: the tool-result pruner trims results over 8192 characters, and a `read` result includes line numbers and wrappers. The persona is system-prompt text and is not pruned.

## Notes

- Changes to the **persona or the plugin list** need a reinstalled bundle. Changes to a **skill body, a reference, or the editorial memory** are read on the next load; they need no reinstall, unless you installed from a pinned tag, in which case pull a later release.
- The preset mounts the default skill roots, so workspace and user skills (including the bundled `dsh-doc`) remain visible alongside the three editorial skills. The three editorial skills themselves come from the bundle's host-level provider, so they are available in every session, not only in this preset.
- The preset has no shell or publishing credentials. It writes drafts with the file tools, never claims to have executed code, and writes every article to disk as well as posting it in chat.

## Delivery

Every article, rewrite, and translation is delivered twice: written to `<slug>.md` in the session working directory, then pasted in full in chat. The write is part of delivering, not a separate request the user has to make.

- The agent calls `write` first, then `present`, then posts the package. It never claims a file exists unless `write` returned success.
- Re-delivering in a language already on disk overwrites that file instead of adding a numbered or dated copy.
- The English and Spanish versions coexist under their own slugs; writing one never overwrites the other.
- Partial elements (a headline, an excerpt, a tag set, feedback) and explicit "chat only" requests skip the file.
- If the write fails, the chat delivery still happens and the agent adds one line explaining the failure.

Relative filenames resolve against the session working directory, so opening a session in your `posts` folder puts drafts there without any extra configuration.

- The site's outbound-link convention (`?ref=sredevops.org` on vendor product/docs links, `&ref=` when a query already exists) is documented in `skills/sredevops-article/references/research-and-citations.md`; change it there if the policy changes.
