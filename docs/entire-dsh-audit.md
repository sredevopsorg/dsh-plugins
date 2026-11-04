# Entire × DSH capture audit: sessions, checkpoints, trails, memories

- Ticket: [sredevopsorg/dsh-plugins#15](https://github.com/sredevopsorg/dsh-plugins/issues/15) — *"Automations: Ensure entire-dsh is sending trails, sessions, memories, etc. If something is not working, explain root causes, don't try to fix immediately. Ensure needed workflows are created too."*
- Audit target: `@sredevopsorg/dsh-entire` capture bridge (`plugins/entire/**`) ↔ `entire-agent-dsh` ↔ Entire CLI 0.12.2, as running in this machine.
- Constraint honoured: **this document only explains root causes.** No plugin code, profile, hook, environment, or `.entire` state was modified as part of the audit. Write probes ran in throwaway repositories under `/tmp` and were deleted. Read-only probes in the real checkouts are listed in §12.
- Privacy: no tokens, credentials, transcript content, or private Feishu content are reproduced. Session IDs below are opaque UUIDs already recorded in Entire's own logs; only structural event counts and `source.kind` values are reported.

---

## 1. One-page verdict

The capture *pipeline itself works* — hooks reach Entire, `entire-agent-dsh` normalizes them, sessions and checkpoints are written — but only for **interactive, human-prompted sessions in a repository whose DSH profile loads the plugin and whose working tree has external agents enabled**. In this environment that intersection is empty for the work the ticket cares about:

| Surface | Status here | Primary root cause |
|---|---|---|
| DSH session capture → Entire sessions | **Works for interactive web-profile sessions**; **broken for the automations and for ticket/executor sessions** | (1) ticket/executor sessions run under the `superagent` profile, which does not load the plugin; (2) the bridge only emits `turn-start` for human-ish prompt sources, and automation sources (`schedule`, `team-message`, `agent-message`, `dsh-superagent`, …) are filtered out → Entire never registers the session |
| Checkpoints / `Entire-Checkpoint` trailers | **Works** for human sessions with file changes + commits (verified in a second repo); **never produced** by the automation path | No `turn-start` → no session state → `turn-end` reports "session state already removed… skipping checkpoint"; also no commits made from agent sessions are linked (interactive `commit_linking` prompt / dev-clone setting absent) |
| Trails | **Not working** (no trail exists, none auto-created) | Trails are explicit `entire trail create` / UI objects; the Agent Integration Protocol has no trail capability; trail listing/creation is auth-gated and the login token is unreadable without an OS keyring; the plugin's trail tools are write-gated (`allowWrites:false`) and approvals are effectively denied in this deployment |
| Memories (Entire Brain) | **Not working** | `entire-brain` v0.4.0 and `entire-graph` v0.6.0 are installed as Entire CLI plugins but never set up for the repo (`entire brain setup` not run; no manifest, no agent guide, daemon not installed, 0 memories); brain's "no captured sessions yet" is downstream of the session gap; memories are not an AIP capability at all |
| Search / activity / recap | **Blocked on auth**, not on capture | `entire activity`, `entire recap`, `entire search` fail refreshing the login token via `org.freedesktop.secrets` (no Secret Service D-Bus provider). Local capture does not need this. |
| Capture observability | **Silent** | Bridge warns once per repo through `ctx.logger.warn`; there are no current DSH host logs to read (`~/.dsh/logs` newest entry 2026-10-26), so a failing hook is invisible |

Two additional defects found in the current setup:

- **Fresh worktrees cannot capture at all**: the committed `.entire/settings.json` does **not** set `external_agents:true`, and the file that does (`.entire/settings.local.json`) is git-ignored and absent from the primary checkout and both ticket worktrees. A worktree with only the committed `.entire` files answers `entire hooks dsh session-start` with **exit 1, `unknown agent "dsh" (not found as built-in or external plugin)`** (reproduced in a throwaway repo).
- **Installed runtime is a DSH pre-release channel**: plugin declares `engines.dsh: "^0.2.1-rc.2"`; the installed runtime is `0.2.2-alpha.3`. Under strict npm/pnpm semver the range is **not** satisfied (prerelease tuple mismatch); the repo's own validator only passes because it calls `semver.satisfies(..., { includePrerelease: true })`. No DSH API used by the bridge has changed, so this is version skew / coverage risk, not the functional blocker.

---

## 2. Environment observed (facts used below)

| Fact | Evidence |
|---|---|
| Two DSH Hosts running | `ps`: `dsh --profile=web` (pid 56191, port **3080**) and `dsh --profile superagent --no-open` (pid 56480, port **3082**, the GUI URL in this session) |
| Host PATH can see Entire | `/proc/<pid>/environ` PATH contains `/home/ngeorger/.local/bin`, which holds `entire` (CLI 0.12.2) and the `entire-agent-dsh` launcher script |
| `web` profile loads the capture plugin | `~/.dsh/profiles/web/package.json` bundles `@sredevopsorg/dsh-entire`; `dsh plugin --profile web list` → `@sredevopsorg/dsh-entire@0.2.0` |
| `superagent` profile does **not** load it | `~/.dsh/profiles/superagent/package.json` bundles `@deepseek-ai/dsh-base`, `dsh-web-app`, `dsh-superagent`, plugin-market, forge, agent-team-profile; `dsh plugin --profile superagent list` → only `dsh-superagent@link:…` |
| Ticket/executor sessions run under `superagent` | their session headers are `agentPreset: "dsh-superagent-worker"`, sessions under `~/.dsh/sessions/--home-ngeorger-src-tickets-forked-…--/`; superagent state at `~/.dsh/state/superagent` |
| Ticket worktree carries the marker on its branch | `git ls-tree -r HEAD .entire` → `.entire/.gitignore`, `.entire/dsh-hooks.json`, `.entire/settings.json`; `settings.json` = `{enabled:true, telemetry:true, checkpoints:{primary:{type:git-refs}}}` |
| Ticket worktree has **no** local Entire enablement file | `.entire/` contains only those three tracked files — no `settings.local.json`, no `logs/`, no `metadata/`, no `.git/entire-sessions` |
| `~/.dsh/plugins/entire` is not referenced by either profile | it is a staging copy identical to the repo plugin (same file hashes); neither profile's `node_modules` nor `package.json` points at it. Do not treat it as activation. |
| Installed plugin copy is functionally identical to HEAD for capture | `lib/bridge.js` sha256 identical in (a) release tag `entire-v0.2.0`, (b) ticket HEAD, (c) web-profile installed copy, (d) `~/.dsh/plugins/entire`. Only `README.md` and a comment in `lib/config.js` drifted after the tag. |

---

## 3. The capture pipeline, end to end

### 3.1 What the plugin subscribes to (repo HEAD)

`plugins/entire/lib/bridge.js`:

| DSH Host event | Bridge mapping | Entire hook | Entire Event type |
|---|---|---|---|
| `session/created` | session start | `session-start` | 1 SessionStart |
| `session/event` with `user/message` **and** `data.source.kind ∈ {human, user, prompt}` | `turn-start` (carries `user_prompt`) | `turn-start` | 2 TurnStart |
| `session/event` with `turn/end` | `turn-end` (raw `{turn, reason}`) | `turn-end` | 3 TurnEnd |
| `session/event` with `compaction/end` | `compaction` | `compaction` | 4 Compaction |
| `session/disposed` | session end | `session-end` | 5 SessionEnd |

Payload sent to `entire hooks dsh <hook>` on stdin:

```json
{"hook_type":"turn_end","session_id":"…","timestamp":"…","user_prompt":"…?","raw_data":{"dsh":{}}}
```

The bridge never sets `session_ref`; `entire-agent-dsh` resolves the DSH transcript from `session_id` + `ENTIRE_REPO_ROOT` (`findSessionFileById` fallback), then normalizes with `parse-hook`. Activation is repo-scoped: a session is captured only when its `header.cwd` contains `.entire/dsh-hooks.json`.

Hooks are fired with `execFile('entire', ['hooks','dsh',hook])`, cwd = session `header.cwd`, 10 s timeout, serialized per repository, failures logged once per repo via `ctx.logger.warn` and otherwise swallowed.

### 3.2 What installed DSH 0.2.2-alpha.3 actually emits

Verified in the installed packages (`…/@deepseek-ai/dsh/node_modules/@deepseek-ai/`):

- `dsh-session/lib/types/index.d.ts` declares the same event signatures the bridge uses:
  `session/created(session)`, `session/event(session, event)`, `session/disposed(session)`, and `Session.header: SessionHeader` (`header.cwd`).
- Event vocabulary in a real session log includes `turn/start`, `turn/end`, `step/start|end`, `user/message`, `assistant/message`, `tool/call`, `tool/result`, `compaction/*`, `session/title`, `agent/inbox/spliced`, `tool-jobs` events, etc.
- `user/message.data.source.kind` is a broad union, not just human input. Installed DSH declares kinds including `user`, `user-rpc` (→ `kind:"user"`), `runtime-context`, `skill-catalog`, `time-context`, `user-approval`, `schedule`, `webhook`, `agent-message`, `team-message`, `working-directory`, `model-selection`, `tool-jobs`, … A custom source kind `dsh-superagent` is emitted in this deployment.

Conclusion: **no breaking API drift for the three events the bridge subscribes to**; the drift is semantic — the set of `source.kind` values is much richer than the bridge's 3-value allowlist.

### 3.3 DSH session sources that exist here (structural, no content)

From decoding the local `session.v4.jsonl.zstd` files (header + `source.kind` counts only):

| Session group | Host/profile | `user/message` source kinds | Consequence |
|---|---|---|---|
| Web-host automation session (`session-4304…`, the repo's automation run) | web (plugin loaded) | `schedule:6, runtime-context:2, skill-catalog:1, time-context:4, user-approval:1, repeat-tool-reminder:1` — **zero human** | bridge suppresses **all** `turn-start` hooks |
| Ticket worker sessions (this audit's executor host) | superagent (no plugin) | first prompt `dsh-superagent:1` / `user:1`, plus `runtime-context`, `skill-catalog`, `time-context`, `agent-message`, `tool-jobs` | plugin absent → no hooks at all; and even with the plugin, `dsh-superagent` is filtered |
| Older human sessions in the same repo (pre-hook-install) | web | `user:N`, plus context kinds | can't be captured retroactively |

### 3.4 Whole pipeline in this environment

```
DSH session (superagent profile) ──► no @sredevopsorg/dsh-entire ──► bridge never runs ──► nothing
DSH session (web profile) ──► bridge runs ──► session-start + turn-end hook calls ──► Entire CLI
    turn-start suppressed for machine sources ──► Entire never persists session state
    ──► "session state already removed; token usage for checkpoint-less turn not recorded"
    ──► skip checkpoint ("no files modified…") ──► no sessions, no checkpoints, no trailers
```

---

## 4. Evidence: capture in the real repositories

### 4.1 `/home/ngeorger/dsh-plugins` (dev clone, same commit as ticket HEAD, web profile, `.entire/logs` present)

`entire.log` summary since hooks were installed (2026-11-02):

```
5  "session-start"     (5 hooks accepted)
5  "turn-end"          (5 hooks accepted)
5  "no files modified during session, skipping checkpoint"
5  "session state already removed; token usage for checkpoint-less turn not recorded"
0  "turn-start"
0  "session-end"
```

Read-only queries in that repo:

- `entire session list --json` → `[]`
- `entire checkpoint list` → `branch main`, `checkpoints 0`
- `git for-each-ref refs/entire` → empty
- `.git/entire-sessions/` contains only `<session>.agent` + `<session>.trail-scope.json`; **no `<session>.json` session state** (the state file is created on TurnStart)
- `.entire/metadata/<session>/full.jsonl` contains a transcript copy (written at TurnEnd)

Interpretation: hooks fire and are accepted, but because no `turn-start` is ever sent for these automation/seed sessions, Entire never creates session state, never lists a session, and can never make a checkpoint from those turns. The warning text is Entire's own diagnostic for "TurnEnd arrived while no session turn state exists" — a direct consequence of the missing TurnStart.

### 4.2 `/home/ngeorger/deepseek-kubernetes-sandbox-v2` (second repo, web profile, human sessions)

The same bridge and CLI produced the healthy path:

```
9  "turn-start"   13  "turn-end"   2  "session-end"
2  "checkpoint saved"   2  "finalize: checkpoint updated with full transcript"
2  "prepare-commit-msg: trailer added"   2  "session condensed"
```

- `.git/entire-sessions/<session>.json` session state files exist
- `git for-each-ref refs/entire` shows 3 `refs/entire/checkpoints/*` refs
- transcript metadata exists for 2 sessions

Interpretation: sessions/checkpoints are **not** globally broken. They work exactly where (a) the profile loads the plugin, (b) the session has human prompts → `turn-start`, and (c) the session changes files/creates a linked commit.

### 4.3 The ticket worktree (`/home/ngeorger/src/tickets/forked-plugin-skill-package-bc67f1c40aa9`)

- `.entire/` has only the three committed files; **no** `.entire/logs`, **no** `.entire/metadata` → the bridge has never fired here.
- No `entire-sessions` state under the shared git dir / worktree gitdir.
- Sessions belonging to this worktree are `dsh-superagent-worker` sessions under the `superagent` profile (§3.3) — the profile that has no plugin.
- Deleting/adding `.entire/settings.local.json` matters: see §5.3 (`unknown agent "dsh"`).

---

## 5. Root causes (ranked; separated by class)

### 5.1 (a) Activation/profile gap — **blocking every ticket/executor session**

**Cause.** DSH capture is a Host plugin: it must be present in the profile of the Host process that hosts the session. The web Host (3080) has it; the superagent Host (3082) — which hosts this audit and, per the ticket setup, the agent/executor sessions — does not. A plugin in one profile cannot observe another profile's Host context. `~/.dsh/plugins/entire` is not loaded by either profile.

**Evidence (strong).**
- Profile dependency lists (§2).
- Session headers/presets for all four sessions in the ticket worktree are `dsh-superagent-worker`.
- Zero capture artifacts in the ticket worktree (`.entire/logs`, `.entire/metadata`, `.git/.../entire-sessions` all absent).
- Positive control: web-Host sessions in two other repositories do produce bridge hooks (§4.1, §4.2).

**Impact.** Entire can never see any session hosted by the superagent profile: no sessions, no checkpoints, no trailers, no searchable history, and no future trail/brain contributions from those sessions.

### 5.2 (b) Event-model semantics — **blocking the automations even where the plugin is loaded**

**Cause.** `hookForEvent()` in `plugins/entire/lib/bridge.js` maps `user/message` → `turn-start` only when `data.source.kind` ∈ `{human, user, prompt}`. DSH 0.2.2-alpha.3 uses many other source kinds for machine-originated turns: `schedule` (this is what the repo automation session used), `webhook`, `team-message`, `agent-message`, `dsh-superagent`, plus injected context kinds. Those turns are silently dropped. Since Entire only persists session state on **TurnStart**, dropping `turn-start` means Entire never knows the session exists; later `turn-end` arrives with no state ("session state already removed") and no checkpoint.

**Evidence (strong).**
- Code: `bridge.js` lines ~28/52–68 (`const HUMAN_SOURCE_KINDS = new Set(['human','user','prompt'])`).
- The automation session's decoded DSH event log: 15 `user/message`, **0** with a human-ish source (§3.3); `entire.log` has 5 `session-start` + 5 `turn-end`, **0** `turn-start`.
- Controlled experiment (§6): full hook sequence **with** `turn-start` → session listed (active, then ended) and checkpoint created; sequence **without** `turn-start` → `session list` stays `[]`, no checkpoint refs, same "session state already removed" warning.
- This is the direct root cause of "Automations: Ensure entire-dsh is sending … sessions".

**Scope.** Applies to scheduled/webhook/team/webhook-driven DSH sessions and to superagent worker turns whose first prompt kind is `dsh-superagent`. It also hides the automation's prompts from Entire, so later `blame`/`why`/`search`/trail context would lack the prompt that motivated the work.

### 5.3 (c) Repo/worktree setup gap — **hooks would fail even with the plugin activated**

**Cause.** `.entire/dsh-hooks.json` (the bridge marker) is committed, but the per-repo external-agent enablement is not: the CLI needs `external_agents: true` (or an `entire agent add dsh` run) in that working tree. `entire agent add dsh` writes `.entire/settings.local.json`, which `.entire/.gitignore` ignores, so it exists in the dev clone but **not** in the primary checkout nor in any `git worktree` created from it.

**Evidence (strong).** Throwaway repo containing only the committed `.entire` files (exactly a fresh ticket worktree):

```
$ entire hooks dsh session-start < payload
unknown agent "dsh" (not found as built-in or external plugin)
exit=1
$ entire agent add dsh      # writes .entire/settings.local.json {"external_agents": true}
$ entire hooks dsh session-start < payload   # exit=0
```

Real checkouts: `/home/ngeorger/dsh-plugins` has `.entire/settings.local.json` → capture works; `/home/ngeorger/src/dsh-plugins` and both ticket worktrees lack it → hook calls would exit 1.

**Impact.** If the Lead only installs the plugin into the `superagent` profile, the first hook in a ticket worktree would fail `exit=1`; the bridge logs one warn per repo and suppresses the rest, so this would look like "still nothing captured".

### 5.4 (d) Checkpoint prerequisites — **why even registered sessions yield few checkpoints**

**Cause.** Entire makes a turn checkpoint only when (1) a `turn-start` registered the session, (2) the transcript shows file modifications, and (3) the commit is linked (interactive "Link this commit to session context?" prompt, or `commit_linking: "always"`). In this deployment:

- automation sessions produce no `turn-start` (5.2);
- the counted sessions modify no files (§4.1 "no files modified during session, skipping checkpoint");
- the Lead/Automation commits, not the agent session, and `commit_linking` is not set in the committed `.entire/settings.json`; in a headless automation there is no terminal to answer the prompt.

**Evidence (strong/medium).** Log messages above; `entire checkpoint list` → 0; `git for-each-ref refs/entire` empty in the dev clone; the second repo (human, file-changing, committed work) does produce `checkpoint saved` + `trailer added`. Docs: [Capture Sessions and Their Checkpoints](https://docs.entire.com/guides/checkpoints/capture-checkpoints.md) lists exactly these prerequisites.

### 5.5 (e) Trails — **not automatable through the Agent Integration Protocol; additionally auth-gated**

**How trails are created.** Trails are project-scoped intent objects created explicitly: `entire trail create --title … [--no-branch] [--project …]`, or in the entire.com UI. `--title` is required; from a feature branch it publishes and links the branch, from base it derives a branch. Repository writers can create repository-scoped trails; `--project`-only creation needs project management permission. Docs: [Trails overview](https://docs.entire.com/guides/trails/overview.md), `entire trail create --help`.

**Does DSH/entire-agent-dsh create them automatically?** No.
- `entire-agent-dsh info` capabilities: `hooks`, `transcript_analyzer`, `transcript_preparer`, `token_calculator` — **no trail capability exists in the protocol** ([Commands](https://docs.entire.com/agents/agent-integration-protocol/commands.md)).
- The hook event model is SessionStart/TurnStart/TurnEnd/Compaction/SessionEnd/Subagent* only; there is no trail event ([Lifecycle](https://docs.entire.com/agents/agent-integration-protocol/lifecycle.md)).
- On SessionStart the CLI does write trail *scope* metadata (`.git/entire-sessions/<id>.trail-scope.json` with project/repo/auth key) and spawns a trail refresh (`.git/entire/trail-refresh-spawn`), but that only resolves which existing trail the branch belongs to; it does not create one.
- The DSH plugin exposes `entire_trails` (including `create`), but writes are gated: profile patch leaves `allowWrites:false`, and the plugin converts an approval request to a denial when approval support is absent. So an automation cannot create a trail through the plugin without a config/approval change (a fix, not part of this audit).

**Why there are no trails here.** (i) no explicit `entire trail create` has ever run for this project from this machine; (ii) every trail query needs an authenticated login token and the OS keyring is missing (§5.7), so `entire trail list --project …` cannot even be checked; (iii) `.git/entire/preferences.json` records `trails_enabled: true` plus a failed trail-agent-help refresh (`trails_agent_help_refresh_failed_at`, `trails_agent_help_failure_auth_key`), i.e. the automatic trail-context refresh is failing on auth.

**Evidence (strong for "no auto-create", medium for "none exist").** `entire trail list --project gh/sredevopsorg` → `refresh login token: load core token: read access token: The name org.freedesktop.secrets was not provided by any .service files`; `refs/entire` has no trail refs; no trail files under `.entire`; source code/CLI help above.

### 5.6 (f) Memories — **installed plugins, never enabled; downstream of sessions; not an AIP capability**

**What "memories" means in Entire.** Entire Brain (`entire-brain`) is the memory layer: saved sessions, checkpoints, project memories, docs, and graph context; `entire-brain memories` manages "durable memories" (recall/remember/distill/promote/retract/sync). Entire Graph is its code-map companion. Both are **installable Entire CLI plugins**, not part of capture or the Agent Integration Protocol ([Brain overview](https://docs.entire.com/guides/brain/overview.md), [Graph overview](https://docs.entire.com/guides/graph/overview.md)).

**State here (read-only probes).**

```
$ entire plugin list
  brain   v0.4.0  → …/plugins/pkg/brain/entire-brain
  graph   v0.6.0  → …/plugins/pkg/graph/entire-graph

$ entire brain status
  Brain | gh/sredevopsorg/dsh-plugins
  Memories   | no captured sessions yet
  Daemon     | not installed
  Sources    | missing: sessions, seed, docs, semantic, history
  Manifest   | absent
  Brainstore | disconnected
  ! agents not wired | run `entire brain setup` …
  ! no brain for this repo yet … run `entire brain setup`

$ entire brain memories status
  active=0 total=0 distilled=0 authored=0 superseded=0 retracted=0 proposals=0
  warning: memories retriever has no active memories; …

$ entire graph store
  {"detail":"search store not built for this commit: run `entire graph index --head` …","store_unavailable":true}
```

**Root cause.** The binaries are installed but `entire brain setup` was never run for this repository (no `.entire/agent-guide.md`, no manifest, no daemon). Even if it were, memory extraction/backfill depends on **captured sessions** — which are absent for the reasons in 5.1/5.2 — and hosted memory sync would depend on auth (5.7). The DSH integration cannot emit memories itself: `entire-agent-dsh` declares no memory capability, and the DSH plugin surface has no brain/memory tool at all (only `entire_graph`, which wraps the code graph, not Brain).

### 5.7 (g) Auth / OS keyring — **separate from capture; blocks all server-backed surfaces**

- An active login context exists (`~/.config/entire/contexts.json`, tokens file present; `entire auth contexts` prints the active context), but the access token lives in the OS keyring. This machine has no Secret Service provider, so any token refresh fails:

```
$ entire activity
refresh login token: load core token: read access token: The name org.freedesktop.secrets was not provided by any .service files
$ entire recap
refresh login token: …
$ entire search "…"
search failed: semantic search: resolving repository "gh/sredevopsorg/dsh-plugins": refresh login token: …
$ entire trail list --project gh/sredevopsorg
resolve project: refresh login token: …
```

- This does **not** block local capture: hooks wrote sessions/checkpoints and trailers with no login (proved in §6 and §4.2). `entire status`, `entire session list`, `entire checkpoint list`, `entire doctor`, `entire agent list`, `entire agent-help` all work unauthenticated.
- Therefore `activity`, `recap`, `search`, `trail list/create/…`, and hosted memory sync are **auth-gated failures**, not capture failures. They cannot be fixed by capture changes; they need a keyring (or token-in-env/login-on-a-desktop/session) — deliberately not changed here.

### 5.8 (h) Version/engine skew and release coverage

- `plugins/entire/package.json` declares `"engines": {"dsh": "^0.2.1-rc.2"}`; installed runtime is `0.2.2-alpha.3`. Strict semver: **unsatisfied** (`semver.satisfies('0.2.2-alpha.3','^0.2.1-rc.2') === false`); the repo's validator passes only due to `{includePrerelease:true}` (`scripts/validate-bundles.mjs:449`). `npm view @deepseek-ai/dsh`: `latest = 0.2.1-rc.5`, `alpha = 0.2.2-alpha.3`, `next = 0.2.2-rc.1`.
- CI (`ci.yml`) pins `@deepseek-ai/dsh@0.2.1-rc.2`; the compatibility canary runs `@latest` (currently 0.2.1-rc.5) weekly. **No workflow tests against the alpha channel actually running on this machine.**
- The installed web-profile copy is tag `entire-v0.2.0`; ticket HEAD changed the plugin after the tag without a version bump (`git diff entire-v0.2.0..HEAD -- plugins/entire` = README + config comment only; `bridge.js` byte-identical). So installed == shipped code for capture, but the release/versioning path did not publish the post-tag changes.
- No DSH API used by the bridge changed between those versions (§3.2). **This class is a workflow/coverage gap, not the current blocker.**

### 5.9 (i) Hook-coverage gaps (latent)

- `.entire/dsh-hooks.json` and `entire-agent-dsh info` declare 7 hooks; the bridge emits only 5. **`subagent-start` / `subagent-end` are never emitted** (documented as deferred in `entire-agent-dsh/AGENT.md`), even though DSH records subagent/team activity (`agent/inbox/spliced`, `tool-jobs`, separate worker sessions). Subagent work is neither attributed nor aware.
- **`session-end` fires only on `session/disposed`**, which a long-lived Web Host does not emit for normal sessions (0 `session-end` in the dev clone; 2 in the second repo after a host restart/shutdown). Sessions therefore stay "active" until Entire's stale sweep, and final checkpoints/cleanup are best-effort only.
- The bridge does not flush/await queued hooks on dispose (`bridge.dispose()` clears queues), so a Host shutdown can drop the last `session-end`/`turn-end`.
- `turn-start` is emitted from `session/event`, not from `turn/start`; if a session's first prompt is seeded before observers attach (seed events do not publish), the prompt can be missed even for human sessions.
- Hook calls take ~1.7–2.6 s each in the observed logs while the bridge uses a 10 s timeout and serializes per repo; larger transcripts + CLI work can approach that budget, and a timeout is only warn-once.

### 5.10 (j) Observability gap

- Bridge failures are `ctx.logger.warn` once per repository; there is no metric, no retry, no surfaced status. `~/.dsh/logs` holds only old startup logs (newest 2026-10-26), so even those warns are not readable for the current Hosts.
- The audit therefore had to reconstruct behaviour from Entire's own `.entire/logs/entire.log`, the DSH session files, and controlled probes.

---

## 6. Controlled experiment (throwaway `/tmp` repos; deleted afterwards)

Purpose: separate "bridge mapping" from "Entire CLI behaviour" without touching the real repos.

**A. Sequence with `turn-start`** — repo with committed `.entire` files + `external_agents` enabled; hooks invoked exactly as the bridge does:

| Step | Result |
|---|---|
| `entire hooks dsh session-start` | exit 0, `.git/entire-sessions/<id>.agent` + trail-scope written, `session list` still `[]` |
| `entire hooks dsh turn-start` (user_prompt) | exit 0; session appears in `session list --json` as **active**, `turns: 0`, `last_prompt` set; `.git/entire-sessions/<id>.json` created |
| file change + commit, `turn-end` | exit 0; `checkpoint saved`; checkpoint ref + `last_checkpoint_id`; `checkpoint list` → 1 |
| `session-end` | session becomes `ended`, `turns: 1`; transcript finalized |

**B. Sequence without `turn-start`** (the automation path) — `session-start` + `turn-end` only:

```
session list --json → []
git for-each-ref refs/entire → (none)
WARN "no files modified during session, skipping checkpoint"
WARN "session state already removed; token usage for checkpoint-less turn not recorded"
```

**C. Fresh-worktree setup** — only committed `.entire` files:

```
$ entire hooks dsh session-start < payload
unknown agent "dsh" (not found as built-in or external plugin)   # exit 1
```

same repo after `entire agent add dsh` (writes git-ignored `.entire/settings.local.json` = `{"external_agents": true}`): hooks exit 0 and the session registers.

These reproduce, in isolation, every failure mode observed in the real checkouts and prove that `entire-agent-dsh` 0.1.1 + CLI 0.12.2 hook-name/protocol handling itself is correct.

---

## 7. Auth-gated vs capture failures (decision table)

| Command / surface | Needs OS keyring/login? | Result here |
|---|---|---|
| `entire status`, `session list`, `checkpoint list`, `doctor`, `agent list`, `agent-help` | no | work (local state only) |
| `entire hooks dsh <hook>` (capture write path) | no | works when repo/profile setup is right (§6) |
| `entire activity`, `entire recap` | yes | fail: `org.freedesktop.secrets … not provided by any .service files` |
| `entire search` (semantic) | yes | fail: same |
| `entire trail list/show/…` | yes (project resolution/auth) | fail: same |
| `entire trail create/update/…` | yes | cannot be verified here; would fail login refresh |
| `entire brain sync` (hosted memory) | yes | not attempted; same class |
| `entire brain status`, `brain memories status`, `graph store` | no (local) | work; report "not set up"/"no sessions" |

**Conclusion:** keyring absence does not explain missing sessions/checkpoints; it only hides the read/query surfaces and blocks trails/hosted memories.

---

## 8. "Do not fix here" note

Per the ticket's explicit instruction, this audit **does not** change the bridge, profile bundles, `.entire` files, hooks, environment, or auth. Candidate fixes are intentionally left to the Lead/owners, for example: adding the plugin to the `superagent` profile; committing `external_agents:true` or running `entire agent add dsh` per worktree; widening/redesigning the `turn-start` source mapping to cover automation sources; wiring subagent hooks; extending `captureTimeoutMs`/flush behaviour; setting `commit_linking`; installing/logging keys; and setting up brain/trails. Each of those is a change with its own review/approval; none is applied here.

---

## 9. Needed workflows (requirements only — for the Lead to implement)

> These are workflows/automation scaffolding, not capture fixes. They are ordered by what unblocks the ticket fastest. No implementation is included here.

1. **Capture-contract CI job (blocking on PRs)**
   - Extend `plugins/entire/test/*.test.mjs` (bridge mapping) with cases for `source.kind` = `schedule`, `webhook`, `team-message`, `agent-message`, `dsh-superagent`, plus the existing human ones; a self-contained stub `entire` binary already exists in the test.
   - Add a contract check that the hook list in `plugins/entire/lib/bridge.js`/`.entire/dsh-hooks.json` and `entire-agent-dsh info` (7 names) agree, or deliberately document the subset.
   - Run the suite in `ci.yml` against **both** the pinned `0.2.1-rc.2` and the channel actually deployed here (`0.2.2-alpha.3`), not just `@latest` in a weekly canary.
   - Requirement: failure message must state the unsupported `source.kind` and the expected hook.

2. **Profile-activation check (onboarding/setup workflow)**
   - A check (script or CI job with a fixtures list) that every DSH profile used for agent automation — currently `web` and `superagent` — either bundles `@sredevopsorg/dsh-entire` (and at least `dsh-base` + `web-app`) or is explicitly documented as out of scope.
   - Onboarding must also run `entire agent add dsh` in every checkout/worktree used for automation, or the repo must commit `external_agents: true` in `.entire/settings.json` so fresh worktrees pass. Requirement: detection is by running `entire hooks dsh session-start` (or `entire agent list`) in a representative worktree and failing on `unknown agent "dsh"`.

3. **Scheduled capture-health check (not PR blocking; needs machine-local auth)**
   - Prefer a self-hosted runner / the machine itself, because it needs the real `~/.dsh/sessions`, `entire` on PATH, and login/keyring.
   - Read-only assertions every N hours: `entire status --json`, `entire session list --json`, `entire checkpoint list --json`, `entire doctor`; assert a session created within the last interval by a known automation exists and is not `status: active` forever.
   - Alert on: zero new sessions, "session state already removed", "skipping checkpoint" for automation sessions, hook failures in `.entire/logs/entire.log`, and bridge warns (once DSH logging is enabled).
   - Requirement: read-only (`--json` where available), no writes to repos, no secret output.

4. **Automation capture smoke test (per schedule/automation definition)**
   - Part of any workflow that defines DSH schedule/webhook automations: after the automation's first run, assert `entire session list --json` contains that session id and that `source.kind` handling produced a `turn-start` (or the automation is explicitly excluded from capture).
   - This is the regression test for §5.2; needs the capture bridge mapping to be fixed first.

5. **Commit-linking workflow**
   - Requirement: the repo (or runner-local `.entire/settings.local.json`) sets `commit_linking: "always"` for automation bots, or the automation performs `entire session attach SESSION_ID --agent dsh` after committing, so `Entire-Checkpoint` trailers appear without an interactive prompt.
   - Assert with `entire checkpoint list` and `git log --format=%B` containing `Entire-Checkpoint:`.

6. **Trails workflow (explicit, auth-aware)**
   - Requirement: a human-triggered or scheduled job that, per branch/automation, runs `entire trail create --title … --idempotency-key …` (or links an existing trail) and records the trail id; must run only where login/keyring is available (or with a supported token source), and never from the DSH plugin while `allowWrites:false`.
   - Precondition: decide config for plugin trail writes if they are to be used (`allowWrites`, approval policy); document that AIP hooks cannot create trails.
   - Health: `entire trail list --project gh/sredevopsorg --json` must return the created trail; currently unverifiable due to keyring.

7. **Memories workflow**
   - Requirement: run `entire brain setup` (or `--no-backfill --no-daemon` then a deliberate backfill step) in each automation repo; commit the managed `.entire/agent-guide.md`/AGENTS block if team-wide; install the background watcher where appropriate; then a periodic `entire brain status` / `entire brain memories status` check.
   - Gate on sessions existing; document that memory extraction can send session content to a model provider and may incur tokens.
   - Hosted sync (`entire brain sync`) only where auth/keyring works.

8. **Release/versioning workflows for the plugin**
   - Bump `engines.dsh` to a range that includes the deployed pre-release channel, or pin the deployed DSH and document support; add a CI matrix (rc line + alpha line + `@latest`) for `scripts/validate-bundles.mjs` and `plugins/entire` tests.
   - Enforce a version bump (and tag) whenever `plugins/entire/**` changes; the existing `version-plugins.yml`/`release.yml` already implement the tag→release→index flow — requirement is to make plugin changes fail CI if `package.json` version is unchanged.
   - After release, verify the installed copy in the active profiles matches the tag (hash compare, as done here).

9. **Observability workflow**
   - Enable/persist DSH Host logs (or route the plugin's `ctx.logger.warn` to a durable sink), since `~/.dsh/logs` currently has nothing newer than 2026-10-26. Requirement: bridge hook-failure warnings must be visible to the scheduled health check.

---

## 10. What could NOT be verified (and why)

| Item | Why |
|---|---|
| Current trail inventory / whether a trail exists for this project | `entire trail list --project …` needs login token; OS keyring missing (§5.7). |
| Trail creation success (`entire trail create`) | Auth-gated; creating one would also be a write/change (out of audit scope). |
| `activity`, `recap`, `search` contents | Auth-gated (keyring). |
| Actual memory quality/contents | Brain never set up; 0 memories; extraction needs an agent and captured sessions. |
| Whether a *human-prompted* web-profile session in the ticket repo after hook install captures correctly | No human-source session exists in `/home/ngeorger/dsh-plugins` after 2026-11-02 (all post-install sessions are `schedule`/seed-only); the healthy path was instead verified in the second repo (§4.2) and in the controlled probe (§6). |
| `session-end` behaviour in a long-lived Host | No `session/disposed` occurred here; only observed after host restarts in the second repo. |
| Compaction & subagent hook behaviour end to end | No `compaction/end` in the observed sessions; bridge never emits subagent hooks. |
| `dsh plugin add` on the superagent profile against this DSH version | Would be a write; not performed. Note the strict-semver engine mismatch would likely surface as an install-time compatibility warning/refusal. |
| DSH bridge warnings in logs | No current DSH host logs exist to inspect. |

---

## 11. Recommended next step for the ticket (decision input, not a fix)

The minimal ordering that would let the ticket's automation actually deliver "sessions/checkpoints" is: decide profile activation for `superagent` → make worktrees external-agent enabled → fix the automation `turn-start` mapping → add commit linking → then trails/brain workflows (which additionally need auth). Each step is a change requiring owner approval; this audit intentionally stops at the explanations.

---

## 12. Evidence appendix (commands and short excerpts)

All commands below were read-only with respect to the ticket worktree. Controlled probes wrote only under `/tmp/entire-probe{,2,3}` and were deleted after use. `entire` commands run in `/home/ngeorger/dsh-plugins` may append to that repo's git-ignored `.entire/logs`.

```sh
# Profiles / activation
dsh --version                                        # 0.2.2-alpha.3
dsh plugin --profile web list        # @sredevopsorg/dsh-entire@0.2.0
dsh plugin --profile superagent list # dsh-superagent@link:...
ps -eo pid,args | grep 'dsh --profile'               # web:3080, superagent:3082
tr '\0' '\n' < /proc/56480/environ | grep ^PATH      # includes ~/.local/bin

# Ticket worktree state
git ls-tree -r --name-only HEAD .entire               # marker committed
ls -la .entire                                        # no logs/, no metadata/, no settings.local.json
git status --short --branch                           # agent/forked-plugin-skill-package-…

# Bridge contract / versions
sha256sum plugins/entire/lib/bridge.js                # ecf44421… identical in tag, HEAD, installed copy, ~/.dsh/plugins
node -e "require('<dsh>/node_modules/semver').satisfies('0.2.2-alpha.3','^0.2.1-rc.2')"  # false
npm view @deepseek-ai/dsh version dist-tags --json    # latest 0.2.1-rc.5, alpha 0.2.2-alpha.3
node scripts/validate-bundles.mjs --dsh-root <dsh-root>  # passes network prerelease engine check; unrelated superagent row errors

# Real capture evidence
grep -o '"msg":"[^"]*"' /home/ngeorger/dsh-plugins/.entire/logs/entire.log | sort | uniq -c
# 5 session-start, 5 turn-end, 5 "session state already removed…", 5 "no files modified…", 0 turn-start
entire session list --json        # []   (in /home/ngeorger/dsh-plugins)
entire checkpoint list            # branch main, checkpoints 0
git for-each-ref refs/entire      # empty
grep -o '"event":"[^"]*"' /home/ngeorger/deepseek-kubernetes-sandbox-v2/.entire/logs/entire.log | sort | uniq -c
# SessionStart 11, TurnStart 9, TurnEnd 13, SessionEnd 2; checkpoint saved 2; trailer added 2

# Hook protocol / CLI
entire hooks dsh --help            # internal command, no subcommand list in help
entire-agent-dsh info              # protocol_version 1; hook_names 7; no memory/trail capability
entire doctor                      # git hooks OK, metadata branches OK, no stuck sessions
entire auth contexts               # active context br.auth.entire.io / sredevopsorgagents
entire activity                    # keyring: org.freedesktop.secrets … not provided

# Trails / memories
entire trail list --project gh/sredevopsorg    # keyring failure
entire trail create --help                      # explicit --title/--project workflow
entire plugin list                              # brain v0.4.0, graph v0.6.0
entire brain status                             # no captured sessions; daemon not installed; agents not wired
entire brain memories status                    # active=0 … no active memories
entire graph store                              # store_unavailable: true

# Controlled throwaway probes (deleted)
#   /tmp/entire-probe2: session-start → turn-start → change+commit → turn-end → session-end
#     → session listed (active→ended, turns=1), checkpoint 1, refs/entire/checkpoints/…
#   /tmp/entire-probe3: only committed .entire files → `entire hooks dsh session-start` exit 1
#     "unknown agent \"dsh\""; after `entire agent add dsh` → exit 0, session listed
```

Relevant docs consulted: [Agent Integration Protocol overview](https://docs.entire.com/agents/agent-integration-protocol/overview.md), [Architecture](https://docs.entire.com/agents/agent-integration-protocol/architecture.md), [Lifecycle](https://docs.entire.com/agents/agent-integration-protocol/lifecycle.md), [Commands](https://docs.entire.com/agents/agent-integration-protocol/commands.md), [Sessions: list](https://docs.entire.com/guides/sessions/list-sessions.md), [Capture sessions & checkpoints](https://docs.entire.com/guides/checkpoints/capture-checkpoints.md), [Troubleshooting](https://docs.entire.com/guides/sessions/troubleshooting.md), [Trails](https://docs.entire.com/guides/trails/overview.md), [Entire Brain](https://docs.entire.com/guides/brain/overview.md), [Entire Graph](https://docs.entire.com/guides/graph/overview.md), [Entire-generated files](https://docs.entire.com/guides/configuration/entire-files.md).
