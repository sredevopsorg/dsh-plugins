# SRE DevOps Writer for OpenCode

This folder is a standalone, OpenCode-compatible port of the DSH plugin at
`plugins/sredevops-writer/`. It contains three editorial skills in OpenCode's
standard directory-based layout, the reference files each skill reads, and a
minimal plugin registration.

It does not import from, modify, or depend on the DSH package. You can copy this
folder into an OpenCode project or into a global OpenCode configuration
directory and use it on its own.

## Layout

OpenCode derives a skill's ID from its directory name, so
`skills/sredevops-article/SKILL.md` has the ID `sredevops-article`. The
frontmatter `name` is the display label and `description` is what OpenCode uses
to decide when to advertise the skill. `whenToUse` is preserved from the DSH
skill as advisory metadata; OpenCode does not document it as a standard field.

```text
.opencode/
├── README.md
├── opencode.json
├── skills/
│   ├── sredevops-article/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── voice-and-style.md
│   │       ├── ghost-package.md
│   │       ├── research-and-citations.md
│   │       ├── editorial-memory.md
│   │       └── site-examples.md
│   ├── sredevops-translate/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── es-cl-voice.md
│   │       └── glossary.md
│   └── sredevops-editorial-memory/
│       ├── SKILL.md
│       └── references/
│           └── editorial-memory.md
└── sredevops-writer-plugin/
    └── index.ts
```

| Skill | File | What it does |
| --- | --- | --- |
| `sredevops-article` | `skills/sredevops-article/SKILL.md` | Drafts, rewrites, researches, structures, and packages an SRE/DevOps article for sredevops.org in English or Chilean Spanish, including Ghost-ready metadata and the mandatory file-plus-chat delivery. |
| `sredevops-translate` | `skills/sredevops-translate/SKILL.md` | Translates articles, excerpts, titles, and Ghost packages between English and Chilean Spanish while preserving Markdown, code, links, identifiers, and technical meaning. |
| `sredevops-editorial-memory` | `skills/sredevops-editorial-memory/SKILL.md` | Saves, reviews, and removes durable editorial corrections in the shared memory file, including terminology overrides, tone adjustments, and structural preferences. |

## Install

### Project-local (recommended for a checkout)

Copy the whole `.opencode/` directory to the root of the project where you run
OpenCode. OpenCode automatically discovers `.opencode/skills/` and
`.opencode/opencode.json`; the `skills` entry in `opencode.json` makes the
registration explicit.

### Global

Copy the skill directories into the global skills location and merge the config:

```bash
# Either location works; OpenCode V2 documents the second one.
mkdir -p ~/.opencode/skills
cp -R .opencode/skills/. ~/.opencode/skills/

# or:
mkdir -p ~/.config/opencode/skills
cp -R .opencode/skills/. ~/.config/opencode/skills/
```

Then merge `.opencode/opencode.json` into your OpenCode config
(`~/.opencode/opencode.json` or `~/.config/opencode/opencode.json`), keeping any
existing keys:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "skills": ["./skills"],
  "plugin": ["./sredevops-writer-plugin"]
}
```

Adjust the paths to the location you used:

- `skills`: `"./skills"` resolves next to the config file, so it is correct for
  both `~/.opencode/` and `~/.config/opencode/` once the copy above is done.
- `plugin`: `"./sredevops-writer-plugin"` resolves next to the config file too.
  Copy the plugin directory next to the config
  (`cp -R .opencode/sredevops-writer-plugin ~/.config/opencode/`) or drop the
  `plugin` entry entirely. The skills do not depend on it.

OpenCode watches configuration and skill files and reloads them without a
restart. If a change does not appear, run `/reload`.

## Tool mapping

The DSH preset declares tool rows in `cordis.patch.yml`. OpenCode already ships
equivalent built-in tools, so this port does not reimplement them. The mapping
is documented as a comment in `sredevops-writer-plugin/index.ts`:

| DSH row | DSH behavior | OpenCode equivalent |
| --- | --- | --- |
| `time-context` | Injects the current date/time context | Built-in date/environment context; no tool |
| `tool-web` | `web_search`, `web_fetch` | `websearch`, `webfetch` |
| `tool-fs` | Read, write, edit files | `read`, `write`, `edit` |
| `tool-fs-search` | File search | `glob`, `grep` |
| `skill-filesystem` + `tool-skill` | Skill catalog and loader | Built-in skill discovery and the `skill` tool |
| `tool-ask-user` | Ask the user a question | `question` |
| `present` | Present a written file | No direct OpenCode equivalent; deliver in chat, or implement your own tool |
| `compaction` | Context compaction | Built-in compaction |

The skill bodies are faithful to the DSH originals and still mention
`present`, `web_search`, and `web_fetch`. In OpenCode, read `present` as "the
file is already written and the content is posted in chat", and the web calls as
`websearch` / `webfetch`.

## Path normalization

The DSH skills use directory bundles, so the layout matches the source. Only the
support-file paths were adjusted:

- Each skill reads its own `references/<file>.md`, relative to its directory.
- `sredevops-translate` reads `../sredevops-article/references/ghost-package.md`
  and `../sredevops-editorial-memory/references/editorial-memory.md`, because
  those files live in the sibling skills.
- `sredevops-editorial-memory` reads
  `../sredevops-translate/references/glossary.md` for terminology updates.
- In `sredevops-translate/references/glossary.md`, the memory pointer is
  `../../sredevops-editorial-memory/references/editorial-memory.md`.

No instruction, rule, example, or editorial behavior was changed.

## Editorial memory

The mutable memory file ships twice:

- `skills/sredevops-editorial-memory/references/editorial-memory.md` — the copy
  the editorial-memory skill edits.
- `skills/sredevops-article/references/editorial-memory.md` — the copy the
  article skill reads.

After saving a rule, sync the article copy so drafts pick it up:

```bash
cp .opencode/skills/sredevops-editorial-memory/references/editorial-memory.md \
   .opencode/skills/sredevops-article/references/editorial-memory.md
```

If you prefer a single source of truth, point the article skill at
`../sredevops-editorial-memory/references/editorial-memory.md` and delete its
local copy.

## Standalone copy

- No imports from `plugins/sredevops-writer/`; no build step and no npm install.
- The DSH persona/system prompt and the `cordis.patch.yml` preset wiring are not
  part of this port. If you want the same always-on voice, add the persona text
  from `cordis.patch.yml` as an agent `system` prompt in `opencode.json`.
- The editorial memory is a normal file you can edit.
- License: MIT, the same as the source plugin.
