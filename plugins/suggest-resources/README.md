# suggest-resources

A DSH Host plugin that registers one model-facing tool, **`suggest_resources`**.

The tool takes a description of what the user wants to do and returns ranked
suggestions across four capability categories — **tools**, **plugins**,
**MCP servers**, and **skills** — each with the terms that matched and a hint
for acting on it. It exists to answer a question the model cannot answer from
its own context: *what could this deployment do that it is not currently
doing?*

Suggestions are advisory. The plugin never enables a plugin, installs a
bundle, connects an MCP server, or appends session events.

## What it searches

| Category | Source | Notes |
|---|---|---|
| `tool` | `ctx.tools.schemas(agent)` | The agent-scoped tool list, minus `suggest_resources` itself. |
| `plugin` | `ctx.pluginManager.listPlugins()`, `ctx.pluginManager.listBundles()` | Live rows (enabled **and** disabled) plus supplied-but-unselected bundles. Falls back to a small seed list when `pluginManager` is absent. |
| `mcp` | `mcp__<server>__<tool>` tool names, `@deepseek-ai/dsh-mcp-client` Loader rows, `catalog.js` | Distinguishes `connected`, `configured`, and `available to connect`. |
| `skill` | `ctx.skills.list({ scope, cwd, signal })` | Model-invocable skills only — a user-only skill is not actionable by the `skill` tool. |

Plugin rows win over bundle entries, which win over seeds, when two candidates
share an id.

## Configuration

Set these under the row's `config` in `cordis.patch.yml`. Every key is
optional; a wrong-typed or out-of-range value falls back to its default instead
of failing activation. The plugin declares no `Config` schema, so
`cordis_inspect_query Config.listConfigs` reports status `absent` for this row
— that is expected, not an error.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `limit` | integer | `5` | Maximum suggestions per category, 1–20. |
| `kinds` | array | all four | Which categories to search: `tool`, `plugin`, `mcp`, `skill`. |
| `mcpServers` | array | `[]` | Extra MCP catalogue entries, merged over the built-ins by `name`. |
| `extraPlugins` | array | `[]` | Extra `{ spec, description, tags }` seed entries, merged by `spec`. |
| `promptSection` | boolean | `true` | Register the one-sentence system-prompt section. |
| `maxTaskChars` | integer | `4000` | Task characters considered; the rest is truncated. |

### Example

```yaml
- id: suggest-resources
  name: '@sredevopsorg/dsh-suggest-resources'
  config:
    limit: 8
    kinds: [plugin, mcp]
    mcpServers:
      - name: linear
        description: Issues and projects from Linear.
        transport: streamable-http
        url: https://mcp.linear.app/mcp
        tags: [issues, tracker, project, tickets]
    extraPlugins:
      - spec: '@acme/dsh-notion-bundle'
        description: Notion pages and databases.
        tags: [notion, docs, wiki, database]
```

## Prompt section

When `promptSection` is `true` (the default) the plugin adds one sentence to
the system prompt telling the model to call `suggest_resources` before
declaring a task impossible. It is scoped so it disappears when the tool is
restricted away, and it deliberately does not restate the tool description.

Set `promptSection: false` to remove it — the tool keeps working, but the model
is less likely to reach for it unprompted.

## Output

A single JSON string, bounded to about 12 KB:

```json
{
  "task": "schedule a recurring report and fetch a web page",
  "taskTruncated": false,
  "counts": { "tool": 31, "plugin": 188, "mcp": 0, "skill": 6 },
  "suggestions": [
    {
      "kind": "plugin",
      "source": "bundle",
      "id": "@deepseek-ai/dsh-experimental-schedule-bundle",
      "title": "Scheduled tasks",
      "state": "installed, not selected",
      "why": ["schedule", "recurring"],
      "score": 6,
      "action": "plugin_manager set_bundle target=\"...\" enabled=true"
    }
  ],
  "omitted": { "tool": 3 },
  "notes": []
}
```

`why` lists the task terms that matched, so a suggestion can be judged rather
than trusted. `score` is deterministic: the highest field weight a term matches
(name 3, title 2, tags 2, description 1) summed over distinct terms, then
sorted by id for ties. A category with no keyword match returns up to three
entries flagged `"reason": "no keyword match"` so the space is still visible.

`notes` names any category that could not be searched — an absent
`pluginManager` or `skills` service, or a throwing source — so a partial answer
is never mistaken for a complete one.

## Design notes

- **No dependencies, no build step.** The plugin ships plain ESM. A
  workspace-linked plugin cannot resolve bare `@deepseek-ai/*` specifiers
  unless its manifest declares them as `peerDependencies`, so this package
  imports nothing but its own `catalog.js` and registers a raw tool definition
  instead of using `defineTool`. That keeps `dsh plugin add` free of both a
  toolchain and install-script approval.
- **Read-only.** It recommends `plugin_manager` invocations but never performs
  them, so it needs no approval path and changes no profile state.
- **Degrades gracefully.** Missing optional services (`pluginManager`,
  `skills`, `loader`, `systemPrompt`) skip one category and add a note rather
  than failing the call.
- **Replay-safe.** All state is derived per call; the plugin appends no session
  events and keeps no cache.

## The MCP catalogue is a snapshot

`catalog.js` lists the official reference MCP servers from
<https://modelcontextprotocol.io/examples>. It is hand-maintained and will go
stale; treat the URL as the authority and verify a server before connecting it.
Servers the MCP project has archived are marked `archived: true` rather than
presented as current. `envHint` names a credential *environment variable* only
— never put a secret value in configuration or in conversation text.

## Verifying

```bash
dsh plugin --profile <name> add /path/to/plugins/suggest-resources
dsh --profile <name> --dump-config      # the suggest-resources row is present
```

Then ask the model to use a capability it does not yet have; it should call
`suggest_resources`. Disabling the bundle removes the tool, confirming the
registration is owned by the plugin context.
