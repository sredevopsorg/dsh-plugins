# OpenCode agent preset (`@sredevopsorg/dsh-agent-opencode`)

An agent preset whose only route to work is delegation: every task is handed to
the [OpenCode](https://opencode.ai) CLI through the `subagent_opencode` tool.

The point is the **absence** of tools. This preset mounts no file, shell,
search, or job tools, so the agent cannot read the workspace or edit it itself.
It can only describe work and delegate it. That makes it a genuine test of the
OpenCode subagent — a delegation that silently did nothing cannot be papered
over by the orchestrator doing the work directly.

This package is the **opinionated consumer**. The capability it consumes is
[`subagent-opencode`](../subagent-opencode/README.md), installed as its own
package. The two are deliberately independent: this bundle inserts **no**
host-level provider row and binds the provider name `opencode-preset`, so it
never collides with `subagent-opencode`'s own `opencode` row even when both are
installed in one profile.

- [What the agent can do](#what-the-agent-can-do)
- [Install](#install)
- [Prerequisites](#prerequisites)
- [Which provider backs the preset](#which-provider-backs-the-preset)
- [Choosing the preset](#choosing-the-preset)
- [Configuration](#configuration)
- [Automatic continuation on output limit](#automatic-continuation-on-output-limit)
- [How it differs from a normal coding agent](#how-it-differs-from-a-normal-coding-agent)

## What the agent can do

| Capability | Row | Why |
|---|---|---|
| `subagent_opencode` | `@deepseek-ai/dsh-tool-subagent` | The only way to touch the workspace |
| Interrupt / observe the child | `dsh-tool-subagent-control` | Orchestration without a shell |
| Plan before acting | `dsh-plan-mode` | A wrong delegation is expensive |
| Ask, track, set a goal | `dsh-tool-ask-user`, `dsh-tool-todo`, `dsh-tool-goal` | Reasoning aids, no side effects |
| Compaction | `dsh-compaction-basic`, `dsh-command-compact` | Long sessions |
| Resume a cut-off reply | `@sredevopsorg/dsh-agent-opencode/auto-continue` | The orchestrator's own answer can exceed the model's output cap |

Everything absent on purpose: `dsh-tool-fs`, `dsh-tool-fs-search`,
`dsh-tool-bash`, `dsh-tool-pwsh`, `dsh-tool-bash-persistent`, `dsh-tool-jobs`,
`dsh-tool-skill`, `skill-filesystem`, `dsh-workflow-ptc`.

## Install

```bash
dsh plugin --profile web add ./plugins/agent-opencode
```

Or from a pinned release tag:

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#agent-opencode-v0.4.0&path:/plugins/agent-opencode"
```

Restart DSH afterwards. Installing declares the preset; it does not change any
existing agent.

## Prerequisites

The preset needs three things beyond a working DSH:

1. **A provider named `opencode-preset`.** This bundle cannot register one: a
   DSH preset cannot mount a host service. Install
   [`subagent-opencode`](../subagent-opencode/README.md) and add its provider
   row to the profile (see [Which provider backs the preset](#which-provider-backs-the-preset)).
2. **The OpenCode CLI on that provider's `PATH`**, or the provider's own
   `requirements.install: true`.
3. **A login** for each provider you intend to delegate to:

   ```bash
   opencode auth login
   ```

What this preset does *not* need is for `subagent-opencode` to be enabled in the
same profile with its own host-level rows. The two are independent packages; see
[Which provider backs the preset](#which-provider-backs-the-preset).

## Which provider backs the preset

The preset binds the provider name `opencode-preset`. Two configurations supply
it, and they are not exclusive:

**A. One profile drives, one profile provides.** Put `subagent-opencode` in a
profile that has OpenCode configured, and add the patch this bundle ships for
that profile (`profiles/preset.cordis.patch.yml`):

```yaml
# In the providing profile's cordis.patch.yml
- id: subagent-opencode-preset
  name: '@sredevopsorg/dsh-subagent-opencode'
  config:
    providerName: opencode-preset
    permission: session
    requirements:
      require: []
```

The preset itself can then live in a different profile, or in the same one. The
provider resolves OpenCode's home and credentials from its own environment, so
the two profiles can differ.

**B. The standard `subagent-opencode` bundle is already enabled.** That bundle
registers `opencode`, not `opencode-preset`, so the preset would still have no
provider. Add only the profile-side row above; the preset finds it. Neither
package's host rows are duplicated.

**Why `opencode-preset` and not `opencode`.** A provider name registers once
per profile, and DSH rejects a second registration with `DUPLICATE_PROVIDER`.
Binding a distinct name is what lets the preset and the standard subagent bundle
be installed together, each with its own OpenCode home, model, and permission
policy. It also means an upgrade of one never forces an upgrade of the other.

**When the provider is missing.** The tool simply is not there: DSH mounts a
`dsh-tool-subagent` row only while its provider exists. That is why this bundle
ships the optional `conformance` row, which reports it after composition:

```yaml
- id: subagent-opencode-conformance
  name: '@sredevopsorg/dsh-subagent-opencode/conformance'
  config:
    providers: ['opencode-preset', 'opencode']
```

## Choosing the preset

Select **OpenCode** in the agent preset picker. Presets are per session, so the
rest of your setup is untouched.

`order: 30` places it after the shipped presets (standard 1, minimal 3,
sredevops-writer 20) in the roster.

## Configuration

This bundle configures nothing about the provider: that lives in the
`subagent-opencode` row the profile supplies. Its own row is the preset, and the
only knob with a cross-package meaning is below.

| Setting | Default | Meaning |
|---|---|---|
| `auto-continue-opencode.requireChildPrompt` | `true` | Continue only a cut-off of the orchestrator's own reply, not a delegated child's stop reason |

Override any setting from the profile patch by row id:

```yaml
- id: auto-continue-opencode
  name: '@sredevopsorg/dsh-agent-opencode/auto-continue'
  config:
    maxAttempts: 10
    windowMs: 600000
    requireChildPrompt: false
```

### Settings in the Web GUI

The bundle ships its own settings page, shown under **Plugins → OpenCode** and
also reachable from the `auto-continue-opencode` row's **Configure** control.
It edits the watcher without touching YAML:

| Field | Default | Meaning |
|---|---|---|
| Prompt text | `continue` | The message queued to resume a cut-off reply |
| Maximum continuations | `5` | Automatic continuations allowed in one rolling window |
| Rolling window (ms) | `180000` | The guard window; the default is three minutes |
| Only continue the agent's own reply | `true` | Skip a cut-off that belongs to a delegated child |
| Preset id (Advanced) | `opencode` | Sessions running this preset are served by the watcher |

**Save** writes through DSH's configuration editor to the active profile's
`cordis.patch.yml`; **Reset to defaults** removes the profile override and
restores the bundle values. Unrelated rows, comments, and `!!js` expressions are
preserved. If the profile or the row is not active, the page says so instead of
writing a partial config.

The page needs the Web GUI and a profile with a live configuration editor. It
is not an agent tool: changing the continuation policy remains a user action.

### Permission policy

The preset holds no file or shell tools, so the only authority in play is the
child's. The child's policy lives in the profile-side provider row, and the
shipped `profiles/preset.cordis.patch.yml` sets `permission: session`.

With `session`, the child follows the **delegating session's** approval policy:

- in a session with approval prompts disabled (`never`), the child cannot ask
  anyone, so a task that needs a write or a command reports that it could not
  proceed. The persona tells the orchestrator to say so rather than retry;
- in every other session, the profile's answer applies.

That is what makes the preset honest in unattended and CI-shaped sessions. If
you need the child to write regardless of the session, set `permission: allow`
on that provider row deliberately:

```yaml
- id: subagent-opencode-preset
  name: '@sredevopsorg/dsh-subagent-opencode'
  config:
    providerName: opencode-preset
    permission: allow
    requirements:
      require: ['install']
      install: true
```

See [`subagent-opencode`](../subagent-opencode/README.md#permission-policy) for
the full resolution order and the pinned `reject` / `allow` semantics.

## Automatic continuation on output limit

When a reply reaches the model's output token cap, the Web chat ends the turn
with an "Output token limit reached" notice that suggests sending `continue`.
This bundle answers that cutoff for the **OpenCode preset** on its own:

1. A turn that ends because of the output cap (`turn/end` with
   `reason.kind === 'max-tokens'`) marks the session.
2. Once the agent is idle again, the host row queues `continue` as an ordinary
   user message — the same prompt a human would type, recorded in the session
   log like any other.
3. The next turn either finishes normally (the loop stops) or hits the cap again
   (the loop continues, guarded).

The trigger is the turn's end **reason**, not the rendered notice text, so the
behavior is identical in every UI language and in headless surfaces.

A delegated child can also end its own turn with `max-tokens`. That stop reason
reaches the orchestrator in the completion notice, so `requireChildPrompt`
(default `true`) skips it: the watcher continues only a cut-off whose turn ended
on the orchestrator's own reply, not on a `tool`-role result. Queueing
`continue` for a child cutoff would pay for a second, redundant delegation.

The guard stops a model that only ever emits cutoff-length replies: more than
five automatic continuations inside a rolling three-minute window pause the
loop. Attempts age out individually, so continuations resume as the window
drains. A prompt the human queues during the cut-off turn takes precedence; the
watcher then leaves the session alone.

| Setting | Default | Meaning |
|---|---|---|
| `presetId` | `opencode` | Preset whose sessions are served |
| `text` | `continue` | Exact text queued as the continuing user message |
| `maxAttempts` | `5` | Continuations allowed inside one rolling window |
| `windowMs` | `180000` | Window length in milliseconds |
| `requireChildPrompt` | `true` | Continue only the orchestrator's own cut-off, not a child's stop reason |

Override any of them from the profile patch by row id:

```yaml
- id: auto-continue-opencode
  name: '@sredevopsorg/dsh-agent-opencode/auto-continue'
  config:
    maxAttempts: 10
    windowMs: 600000
```

Disable the watcher without removing the preset by setting `disabled: true` on
that row.

## How it differs from a normal coding agent

A normal preset gives the agent the tools and lets it work. This one gives the
agent a **budget of delegations** and nothing else.

The child does not see the conversation, so the orchestrator has to restate
context with every delegation. That is a constraint worth having: it exposes
whether a task can be stated well enough for another agent to complete alone,
which is the same property you need for a queue, a schedule, or a handoff.

## Relationship to `subagent-opencode`

| | `agent-opencode` (this) | [`subagent-opencode`](../subagent-opencode/README.md) |
|---|---|---|
| Role | opinionated consumer: an agent preset | capability: the provider and tool |
| Host rows | the preset, the auto-continue watcher | the provider (`opencode`), the tool |
| Binds | provider `opencode-preset` | provider name is its own config (`opencode`) |
| Installs alone | yes, with the profile patch | yes, fully self-contained |
| Installs next to the other | yes — no row, tool, or provider name repeats |

Each is versioned and released separately. An upgrade of one never requires the
other: the only contract between them is the provider name `opencode-preset` and
the `subagent_opencode` tool a preset child binds.

## Release notes

### 0.4.0

- **Web settings page.** The bundle's page under **Plugins → OpenCode** (and the
  `auto-continue-opencode` row's **Configure** page) edits the prompt, attempt
  limit, rolling window, child-prompt guard, and preset id. Saves go through the
  profile configuration editor; Reset restores the bundle defaults. No YAML
  format changed.
- **One new host row.** `agent-opencode` mounts the package itself so the client
  module system can attach the browser half; it registers no agent, tool, or
  provider behavior and can be switched off without affecting the preset.

### 0.3.0

- **No host-level provider row.** The preset no longer inserts
  `@sredevopsorg/dsh-subagent-opencode` itself. The provider is supplied by the
  profile (`profiles/preset.cordis.patch.yml`) under the distinct name
  `opencode-preset`, so this bundle and the standard subagent bundle can be
  installed together without duplicate rows or tools. **This is a breaking
  change for an existing install**: add the profile patch, or the preset's
  `subagent_opencode` tool disappears.
- **Persona states the session policy.** The orchestrator is told the child
  follows the session's approval policy and that it must report a refusal
  instead of retrying.
- **`auto-continue.requireChildPrompt`** (default `true`) stops continuing a
  delegated child's `max-tokens` stop reason.
- Tests cover the cross-package contract, including the profile patch, and the
  repository's `validate-plugin-pair.mjs` now fails CI if any two bundles insert
  the same host row id, subagent tool name, or host provider name.
