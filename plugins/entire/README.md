# Entire for DeepSeek Harness

A Host-only DSH plugin that exposes the [Entire](https://docs.entire.com/) CLI's feature surface to the agent: sessions, checkpoints, hybrid search, code history, trails, reviews, the `entire-graph` code graph, and a classified passthrough for setup, plugins, accounts, repositories, and the authenticated API.

The plugin reads Entire's data. It also closes the capture loop: in a repository that carries `.entire/dsh-hooks.json`, it forwards DSH session lifecycle events to `entire-agent-dsh`, an external agent binary implementing the [Agent Integration Protocol](https://docs.entire.com/agents/agent-integration-protocol/overview). DSH session start, turns, compaction and session end then become Entire sessions and checkpoints, and commits carry `Entire-Checkpoint` trailers.

## Install

Install from this repository (the release tag is immutable, so the command reproduces the same package contents):

```sh
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#entire-v0.2.0&path:/plugins/entire"
```

Or install from the repository's plugin index, which the Web **Plugins → Discover** tab
reads; add `https://raw.githubusercontent.com/sredevopsorg/dsh-plugins/main/index.json`
as an index source, then install the version from the card. See
[`docs/plugin-index.md`](../../docs/plugin-index.md).

Or install the local checkout:

```sh
dsh plugin add ./plugins/entire
```

Either way the package is linked from the profile; there is no build step and no runtime dependency. The same address works with the `plugin_manager` tool's `install_bundle`.

Entire must be installed and on `PATH` (`entire --version` should print a version), or set `binary` to its absolute path. Session capture additionally needs `entire-agent-dsh` on `PATH` and `entire agent add dsh` in the target repository.

## Configuration

The bundle patch inserts one row, `entire`. Override its `config` in the profile's `cordis.patch.yml`:

| Key | Default | Meaning |
|---|---|---|
| `binary` | `entire` | CLI executable name or absolute path. |
| `repoPath` | `""` | Pin a repository/worktree. Empty uses the Session's current directory. |
| `allowWrites` | `false` | Permit repository-scoped mutations after approval. |
| `allowAdmin` | `false` | Permit machine/account/control-plane commands after approval; implies `allowWrites`. |
| `timeoutMs` | `600000` | Default per-call budget. Reads cap lower; review runs cap at 30 minutes. |
| `maxOutputChars` | `24000` | Head/tail truncation budget. |
| `promptSection` | `true` | Add the Entire guidance section to the system prompt. |

A malformed value falls back to its default instead of failing activation.

## Tools

| Tool | What it covers |
|---|---|
| `entire_status` | `status`, `version`, `doctor`, `activity`, `agent-help` |
| `entire_sessions` | `session list/current/info/tokens/stop/attach/adopt/resume` |
| `entire_checkpoints` | `checkpoint list/explain/tokens/delete`, `tokens profile` |
| `entire_search` | `search` work and `--code` search |
| `entire_history` | `blame`, `why`, `experts`, `recap`, `dispatch` |
| `entire_trails` | trail list/show/approvals/findings/create/update/comment/approve/link/unlink/checkout/resume/merge |
| `entire_review` | `review` run/list/agents/models/findings/configure |
| `entire_graph` | graph query/neighbors/impact/def/explain/context/commit/diff/checkpoint/capabilities/health/agent-guide/setup/index/verify |
| `entire_run` | Remaining CLI commands and `entire api`, with read/write/admin classification |

Every command also accepts `--help` through `entire_run`.

## Permissions

Reads never prompt. Two gates control everything else:

- `allowWrites` — `session stop/attach/adopt/resume`, `checkpoint delete` (when `dryRun:false`), trail writes, `review run/configure`, `graph setup/index/verify`, and task-driven `entire_run` commands.
- `allowAdmin` — `enable`/`disable`/`configure`/`clean`, agent/plugin/auth/org/project/repo/cluster commands, non-GET API calls, and unrecognized commands. It implies writes.

Enabled actions still ask through the Harness approval pipeline. When approval support is absent, the ask becomes a denial. A disabled gate returns a message naming the exact config key.

Dangerous defaults are deliberate: `checkpoint delete` and `trail merge` run as dry runs until the caller passes `dryRun: false`. `graph verify` executes the test command it is given and is treated as a write. `entire_run` refuses interactive logins, `entire mcp`, and shell completion.

The executor uses `execFile` with an explicit argv — never a shell — closes stdin so prompts cannot hang, kills on timeout/cancellation, and truncates large output with an explicit marker.

## Examples

```json
{"action": "status"}
{"action": "info", "sessionId": "019ed5fe-ec49-7a72-89fd-f38e323f5448"}
{"action": "explain", "target": "a1b2c3d4e5f6", "short": true}
{"action": "blame", "file": "src/auth.go", "line": "42"}
{"action": "query", "query": "where is the token refresh implemented?"}
{"action": "list", "project": "gh/acme"}
```

```json
{"argv": ["plugin", "list"]}
{"argv": ["api", "/api/v1/clusters"]}
```

## Limitations

- Web-only Entire surfaces (CI checks, gates, mirrors, Brain) are reachable only through their REST endpoints via `entire_run` + `entire api`; they are not modeled as typed actions.
- Entire's keyring and network access must be available to the Host process. A sandboxed environment can block both; the plugin reports that rather than treating it as a logout.
- JSON payloads are passed through, not modeled, so a changed Entire response shape is visible to the agent instead of breaking the plugin.
- No Web UI panel: capability is model-facing only.

## Capture (DSH sessions into Entire)

Entire cannot see DSH sessions on its own. This plugin closes the loop: in a
repository that carries \`.entire/dsh-hooks.json\` (written by
\`entire-agent-dsh install-hooks\`, which \`entire agent add dsh\` runs), the
plugin forwards session-start, turn, compaction and session-end events to
\`entire hooks dsh <hook>\`. The external agent binary \`entire-agent-dsh\` on
\`PATH\` normalizes each payload through the Entire Agent Integration Protocol.

The effect: DSH sessions show up in \`entire session list\`, each turn produces a
checkpoint, and commits carry an \`Entire-Checkpoint\` trailer, so
\`entire checkpoint list/explain\`, \`blame\`, \`why\` and \`search\` work.

| Key | Default | Meaning |
|---|---|---|
| \`capture\` | \`true\` | Forward DSH session lifecycle events to \`entire hooks dsh\`. |
| \`captureMarker\` | \`.entire/dsh-hooks.json\` | Repository marker that scopes capture; empty means every repository. |
| \`captureTimeoutMs\` | \`10000\` | Timeout for one forwarded hook call. |

Capture is inert where the marker is missing, and it needs \`entire-agent-dsh\`
on \`PATH\` (install it, then \`entire agent add dsh\` per repository).

## Tests

```sh
node --test test/*.test.mjs
```
