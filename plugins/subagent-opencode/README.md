# OpenCode subagent (`@sredevopsorg/dsh-subagent-opencode`)

Delegate a one-shot task from a DeepSeek Harness agent to the
[OpenCode](https://opencode.ai) CLI, over the Agent Client Protocol.

The bundle registers a subagent provider named `opencode` and exposes it as the
`subagent_opencode` tool, mirroring how the official `subagent-codex` bundle
wraps Codex. The child runs in its own process, with its own session, model,
tools, and credentials; only its final text comes back to the parent.

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Required configurations](#required-configurations)
- [Configuration](#configuration)
- [What the model sees](#what-the-model-sees)
- [Differences from `subagent-codex`](#differences-from-subagent-codex)
- [Troubleshooting](#troubleshooting)

## Prerequisites

OpenCode must be installed and logged in. The global install needs pnpm's
build-script approval because the package's postinstall links the platform
binary:

```bash
pnpm add -g --allow-build=@opencode/cli @opencode/cli
```

Then authenticate each provider you intend to delegate to:

```bash
opencode auth login
```

> A global pnpm install writes `opencode` to pnpm's global bin directory, which
> a GUI-launched DSH often does **not** have on `PATH`. If the plugin reports
> that the executable is missing, set `command` to the absolute path
> `pnpm bin -g` prints, or put that directory on `PATH`.

No specific OpenCode version is required: the plugin drives the stable ACP v1
surface, which `opencode acp` implements.

## Install

```bash
dsh plugin --profile web add ./plugins/subagent-opencode
```

Or from a pinned release tag:

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#subagent-opencode-v0.1.0&path:/plugins/subagent-opencode"
```

Restart DSH afterwards; the provider and tool are composed at startup.

## Required configurations

OpenCode keeps its provider credentials in its own store and reads some of them
from its **environment** — but the DSH subprocess seam scrubs credential-shaped
variables from every child. Delegation therefore needs an explicit statement of
what OpenCode requires and which variables to relay. That is the
`requirements` block.

It has three duties:

| Duty | What it does |
|---|---|
| **Declare** | `require: [auth, credentials, model]` states which configuration is mandatory |
| **Enforce** | A missing item fails the **plugin load**, so a broken profile fails at startup instead of on first delegation |
| **Relay** | `credentials` and `home` are forwarded to the child after the seam's scrub |

### Local, logged-in setup

Nothing required: an `opencode auth login` store is found automatically.

```yaml
- id: subagent-opencode
  name: '@sredevopsorg/dsh-subagent-opencode'
  config:
    requirements:
      require: ['auth']
```

### Headless / CI setup

No login store, so declare the key names and the model explicitly. The values
are read from the DSH process's own environment and never appear in a message,
a log line, or a diagnostic.

```yaml
- id: subagent-opencode
  name: '@sredevopsorg/dsh-subagent-opencode'
  config:
    requirements:
      require: ['credentials', 'model']
      credentials: ['OPENAI_API_KEY']   # names only
      model: openai/gpt-5-codex
      mode: build
```

### Fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `require` | array | `[]` | Mandatory gates: `auth`, `credentials`, `model`. Empty disables enforcement |
| `credentials` | string[] | `[]` | Env var **names** relayed to the child; each required one must be set |
| `model` | string | — | `provider/model` applied to every session |
| `mode` | string | — | OpenCode agent id applied to every session |
| `effort` | string | — | Model variant applied to every session |
| `home` | string | — | OpenCode home, exported as `OPENCODE_HOME`; also where `auth` looks |
| `env` | object | `{}` | Literal child environment values |
| `verifiedVersion` | string | — | Reserved for pinning; not enforced by this release |

What each gate checks:

- **`credentials`** — every name in `credentials` is set and non-empty in the
  parent environment. The message names the variables, never their values.
- **`auth`** — when `home` is configured, the plugin checks for
  `auth.json` (or `data/auth.json`) inside it. Without a `home` the check
  defers to OpenCode itself, which reports `auth_required` on the first run.
- **`model`** — `requirements.model` is set and looks like `provider/model`.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `opencode` | Registry name on `ctx.subagents` |
| `command` | `opencode` | Executable: a bare name on `PATH`, or an absolute path |
| `args` | `['acp']` | Arguments after the executable; `acp` is added when absent |
| `permission` | `reject` | Auto-answer permission prompts: `reject` or `allow` |
| `passEnv` | `['OPENCODE_*', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'HOME']` | Ambient names re-forwarded after the credential scrub |
| `env` | `{}` | Explicit child environment, merged last |
| `disposeGraceMs` | `3000` | Window before the child is terminated after its stdin closes |

### Permission policy

The child never asks a human: every `session/request_permission` is answered by
policy.

- `reject` (default) picks `reject_once`, so a task that needs to write files or
  run commands will report that it could not proceed. This is the safe default
  for an unattended child.
- `allow` picks `allow_once` for every prompt.

Choose `allow` when the delegation is expected to modify the workspace, and rely
on the DSH session's own approval settings for the authority to do so.

### Changing the tool name

The bundled patch names the tool `subagent_opencode` so it sits beside the
built-in `subagent` and `subagent_fork` tools. Override it in the profile patch:

```yaml
- id: tool-subagent-opencode
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: opencode
    toolName: opencode
    maxDepth: provider-managed
```

`maxDepth` must stay `provider-managed` (or be removed): the child is
out-of-process, so DSH cannot enforce a numeric depth cap inside it.

## What the model sees

The parent receives the child's name immediately and a completion notice with
the child's final text. Intermediate messages and tool traffic never enter the
parent conversation. The delegation tool's description says the child **does not
see this conversation**, because every run starts a fresh OpenCode session with
only the task text.

Stop reasons map onto the shared vocabulary:

| ACP | DSH |
|---|---|
| `end_turn` | `completed` |
| `max_tokens` | `max-tokens` |
| `refusal` | `refusal` |
| `cancelled` | `aborted` |
| anything else | `error` |

A failed run keeps any text the child already produced and adds one fixed
diagnostic line naming the stage and category — never stderr, task content,
paths, or environment values.

## Differences from `subagent-codex`

| | `subagent-codex` | this bundle |
|---|---|---|
| Protocol | Codex `app-server --stdio` | `opencode acp` (Agent Client Protocol) |
| Server | none | a **private** OpenCode server per child; no port, no shared service |
| Teardown | signal ladder over the managed range | close stdin (ACP's documented exit), then terminate |
| Auth | Codex's own settings | OpenCode's store, plus declared env relay |
| Required configuration | `model`, `permissionMode` | `requirements` block (declare, enforce, relay) |
| Session options | `thread/start` fields | `session/set_config_option` (`model`, `effort`, `mode`) |

Both are one-shot: the child cannot receive follow-up messages.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `stage: install` | `opencode` is not on the DSH process's `PATH` | Set `command` to the absolute path, or fix `PATH` |
| `stage: session-new; category: auth-required` | No login for a configured provider | `opencode auth login`, or declare `credentials` |
| `required configuration is missing: X is not set` | `require: [credentials]` and `X` is unset | Export `X` for the DSH process, or drop the gate |
| `stage: configure` | OpenCode rejected `model`, `effort`, or `mode` | Check `opencode models` / `opencode agent list` |
| The child reports it could not write files | `permission: reject` | Set `permission: allow` |

## Development

```bash
cd plugins/subagent-opencode
npm test    # 32 tests: requirement gates, env relay, and the ACP lifecycle
npm run check
```

The runner tests spawn `test/fixtures/fake-opencode-agent.mjs`, a scripted ACP
agent, so they need neither OpenCode nor network access.

## License

MIT
