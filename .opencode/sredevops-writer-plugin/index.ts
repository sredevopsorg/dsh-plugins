import { Plugin } from "@opencode/plugin"

/**
 * Minimal OpenCode registration for the sredevops-writer port.
 *
 * The editorial behaviour lives in the directory-based skills:
 *
 *   skills/sredevops-article/SKILL.md
 *   skills/sredevops-translate/SKILL.md
 *   skills/sredevops-editorial-memory/SKILL.md
 *
 * OpenCode discovers those skills natively, so this plugin registers no tools
 * and injects no prompt. It exists only so `opencode.json` has a valid local
 * plugin entry and so the DSH-to-OpenCode tool mapping is documented next to
 * the code that used to declare it in a non-standard `options.tools` block.
 *
 * DSH preset row  ->  OpenCode built-in
 * ---------------------------------------------------------------
 * web             ->  webfetch, websearch
 * fs              ->  read, write, edit
 * fs-search       ->  glob, grep
 * skill           ->  skill (built-in discovery + loader)
 * ask-user        ->  question
 * present         ->  no built-in; deliver the written file in chat
 * time-context    ->  built-in date/environment context
 * compaction      ->  built-in compaction
 *
 * OpenCode provides all of these natively, so none of them are re-registered
 * here. The skill bodies still say `present` and `web_search` / `web_fetch`
 * because they are faithful ports of the DSH originals: read `present` as
 * "the file is already written and the content is posted in chat", and the web
 * calls as `websearch` / `webfetch`.
 */
export default Plugin.define({
  id: "sredevops-writer",
  setup() {
    // No tools, providers, or system prompt to add: the skills carry the
    // editorial contract and OpenCode supplies the built-ins listed above.
  },
})
