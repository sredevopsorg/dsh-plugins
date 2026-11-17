# OpenCode agent preset (`@sredevopsorg/dsh-agent-opencode`)

An agent preset whose only route to work is delegation: every task is handed to
the [OpenCode](https://opencode.ai) CLI through the `subagent_opencode` tool.

The point is the **absence** of tools. This preset mounts no file, shell,
search, or job tools, so the agent cannot read the workspace or edit it itself.
It can only describe work and delegate it. That makes it a genuine test of the
OpenCode subagent — a delegation that silently did nothing cannot be papered
over by the orchestrator doing the work directly.

- [What the agent can do](#what-the-agent-can-do)
- [Install](#install)
- [Prerequisites](#prerequisites)
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
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#agent-opencode-v0.2.0&path:/plugins/agent-opencode"
```

Restart DSH afterwards. Installing declares the preset; it does not change any
existing agent.

## Prerequisites

The bundle also enables the `@sredevopsorg/dsh-subagent-opencode` provider, so
it needs the same things that provider needs: the OpenCode CLI, and a login for
each provider you intend to delegate to.

```bash
opencode auth login
```

If `opencode` is not on the DSH process's `PATH`, either point `command` at it
or set `requirements.install: true` (see below) to have the plugin install it on
first use.

## Choosing the preset

Select **OpenCode** in the agent preset picker. Presets are per session, so the
rest of your setup is untouched.

`order: 30` places it after the shipped presets (standard 1, minimal 3,
sredevops-writer 20) in the roster.

## Configuration

The patch enables the provider with these defaults:

| Setting | Default | Meaning |
|---|---|---|
| `permission` | `reject` | The child refuses to edit without a human. Raise to `allow` for preset-driven work that should change files |
| `requirements.install` | `false` | Install OpenCode on first delegation when `command` does not resolve |
| `requirements.require` | `[]` | No mandatory gates |

Override them from the profile patch by row id:

```yaml
- id: subagent-opencode-provider
  name: '@sredevopsorg/dsh-subagent-opencode'
  config:
    providerName: opencode
    permission: allow
    requirements:
      require: ['install']
      install: true
```

`permission: reject` is the honest default: an orchestrator that delegates
everything will otherwise produce children that quietly cannot edit. Set it to
`allow` deliberately, once you have decided this preset should change files.

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
