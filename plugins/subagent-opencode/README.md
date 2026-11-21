# OpenCode subagent (`@sredevopsorg/dsh-subagent-opencode`)

Delegate a one-shot task from a DeepSeek Harness agent to the
[OpenCode](https://opencode.ai) CLI, over the Agent Client Protocol.

The bundle registers a subagent provider named `opencode` and exposes it as the
`subagent_opencode` tool, mirroring how the official `subagent-codex` bundle
wraps Codex. The child runs in its own process, with its own session, model,
tools, and credentials; only its final text comes back to the parent.

This package is a **capability**: it has no agent preset, no persona, and no
opinion about how you delegate. It stands alone and it is safe next to
[`agent-opencode`](../agent-opencode/README.md), which is the **opinionated
consumer** — an agent preset that delegates every task here. The two never
share a row id, a tool name, or a provider name (see
[Relationship to the OpenCode preset](#relationship-to-the-opencode-preset)).

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Relationship to the OpenCode preset](#relationship-to-the-opencode-preset)
- [Required configurations](#required-configurations)
- [Configuration](#configuration)
- [What the model sees](#what-the-model-sees)
- [Differences from `subagent-codex`](#differences-from-subagent-codex)
- [Troubleshooting](#troubleshooting)
- [Release notes](#release-notes)

## Prerequisites

OpenCode must be available to the plugin, and it must be logged in. There are
two ways to provide it; the second needs no manual step.

**1. Install it yourself.** The npm launcher `@opencode/cli` is a stub whose
`postinstall` links the real binary, so a global install needs pnpm's
build-script approval:

```bash
pnpm add -g --allow-build=@opencode/cli @opencode/cli
```

**2. Let the plugin install it.** Set `requirements.install: true` and the
provider installs the platform package (`@opencode/cli-linux-x64`,
`@opencode/cli-darwin-arm64`, and so on) into `installDir` the first time a
delegation finds no `opencode` on `PATH`. That package has **no install
scripts**, so the install needs no build approval.

```yaml
requirements:
  install: true
  require: ['install']   # fail the run with a clear message when it cannot
```

Authentication is the same either way:

```bash
opencode auth login
```

> A global pnpm install writes `opencode` to pnpm's global bin directory, which
> a GUI-launched DSH often does **not** have on `PATH`. If the plugin reports
> that the executable is missing, set `command` to the absolute path
> `pnpm bin -g` prints, or put that directory on `PATH` — or use
> `requirements.install`, which needs neither.

No specific OpenCode version is required: the plugin drives the stable ACP v1
surface, which `opencode acp` implements.

## Install

```bash
dsh plugin --profile web add ./plugins/subagent-opencode
```

Or from a pinned release tag:

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#subagent-opencode-v0.3.0&path:/plugins/subagent-opencode"
```

Restart DSH afterwards; the provider and tool are composed at startup.

## Relationship to the OpenCode preset

[`agent-opencode`](../agent-opencode/README.md) is an agent preset whose only
route to work is this provider. It is a separate package, installed separately,
versioned separately, and **not a dependency of this one**. The two are built to
be independent:

| | this bundle | `agent-opencode` |
|---|---|---|
| Purpose | provide the capability | compose an agent that only delegates |
| Host rows it inserts | provider `subagent-opencode`, tool `subagent_opencode` | the `opencode` preset, the auto-continue watcher |
| Provider name | `opencode` | binds `opencode-preset` (supplied by a profile) |
| Tool name in the model | `subagent_opencode` | `subagent_opencode` (a preset child, local to the preset) |
| Needs the other to work | no | yes, to have something to delegate to |

The names are deliberately disjoint. The preset binds `opencode-preset`, so it
can point at *this* bundle's `opencode` provider in a profile that supplies one,
or at its own provider row, while both packages stay installed. Install either
alone and it is self-contained; install both and no row, tool, or provider name
is inserted twice.

`subagent-opencode/conformance` is the optional row that turns a missing
provider into a named diagnostic instead of a silently absent tool:

```yaml
- id: subagent-opencode-conformance
  name: '@sredevopsorg/dsh-subagent-opencode/conformance'
  config:
    providers: ['opencode-preset', 'opencode']
```

It runs after the host has composed every row, waits for `ready`, reports with
one fixed line per unbacked provider, and never blocks the profile. An explicit
empty `providers` list turns it off.

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
| **Provide** | `install: true` installs OpenCode where `command` does not resolve |

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
| `require` | array | `[]` | Mandatory gates: `auth`, `credentials`, `model`, `install`. Empty disables enforcement |
| `credentials` | string[] | `[]` | Env var **names** relayed to the child; each required one must be set |
| `model` | string | — | `provider/model` applied to every session |
| `mode` | string | — | OpenCode agent id applied to every session |
| `effort` | string | — | Model variant applied to every session |
| `home` | string | — | OpenCode home, exported as `OPENCODE_HOME`; also where `auth` looks |
| `env` | object | `{}` | Literal child environment values |
| `install` | boolean | `false` | Install OpenCode when `command` does not resolve |
| `installManager` | string | `pnpm` | Package manager for that install: `pnpm`, `npm`, or `none` |
| `installDir` | string | `<profile>/opencode` | Directory the install writes to and is reused from |
| `installArgs` | string[] | `[]` | Extra package-manager arguments, before the packages |
| `installTimeoutMs` | number | `300000` | Bound on one install run |

What each gate checks:

- **`credentials`** — every name in `credentials` is set and non-empty in the
  parent environment. The message names the variables, never their values.
- **`auth`** — when `home` is configured, the plugin checks for
  `auth.json` (or `data/auth.json`) inside it. Without a `home` the check
  defers to OpenCode itself, which reports `auth_required` on the first run.
- **`model`** — `requirements.model` is set and looks like `provider/model`.
- **`install`** — the configured `command` resolves, or the plugin installed it.
  It is the only gate decided at delegation time rather than at load, because it
  reports a fact about the host rather than about the profile.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `opencode` | Registry name on `ctx.subagents` |
| `command` | `opencode` | Executable: a bare name on `PATH`, or an absolute path |
| `args` | `['acp']` | Arguments after the executable; `acp` is added when absent |
| `permission` | `session` | Auto-answer permission prompts: `session`, `reject`, or `allow` |
| `passEnv` | `['OPENCODE_*', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'HOME']` | Ambient names re-forwarded after the credential scrub |
| `env` | `{}` | Explicit child environment, merged last |
| `disposeGraceMs` | `3000` | Window before the child is terminated after its stdin closes |

### Installing OpenCode

`requirements.install` is off by default: a delegation never downloads a program
unless the profile asked for it. When it is on, the first delegation whose
`command` does not resolve:

1. looks in `installDir` for an earlier install, and reuses it;
2. otherwise runs the package manager once — `pnpm add`, or the npm CLI bundled
   with the running Node — with its working directory set to `installDir`, the
   launcher packages denied their install scripts, and npm additionally run
   under Node's permission model (writes only inside `installDir`, the npm
   cache, and the temporary directory);
3. delegates to the installed executable, with its directory first on the
   child's `PATH`.

Only `opencode` is ever installed this way. A `command` that names another
program is left exactly as configured, because an install could not make it
resolve.

Every failure is one fixed message naming the manager, its arguments, and the
directory — never the manager's output, which can carry proxy credentials. If
the git or npm install of a *plugin* is what failed, DSH reports the pending
build as usual; this plugin only ever runs the install itself.

### Permission policy

The child never asks a human: every `session/request_permission` is answered by
policy. That is the only authority the child has, because a subagent provider
never holds an agent handle and therefore cannot ask the approval seam itself.

- `session` (the default) follows the approval policy of the **session that is
  delegating**:
  - a session whose policy is `never` answers every prompt with `reject_once`,
    so a task that needs to write files or run commands reports that it could
    not proceed. That is the honest reading of "never ask the user": there is no
    human, so a request that needs one cannot be granted;
  - every other session keeps the profile's answer. The profile's configured
    policy decides the rest, and a session this provider cannot inspect is
    treated as untrusted, so the child never gains authority the parent could
    not verify.
- `reject` pins `reject_once` for every prompt, whatever the session says.
- `allow` pins `allow_once` for every prompt.

The projection is one-way: a `never` session makes the child stricter than the
profile allowed, and never more permissive. Read order is the session's recorded
`approval/policy` override, then the approval service's configured default, then
the documented `ask` default. The two private DSH facts (`overrideOf` and
`config.policy`) are read through guarded helpers, so a future DSH that reshapes
the service degrades to `ask` instead of failing a delegation.

A permission failure names the resolved policy and its source in one fixed line,
so a child that stopped because it could not act is distinguishable from an
OpenCode error. Raise `permission` to `allow` only when you have decided that
every session may write, `never` or `ask`.

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
| Required configuration | `model`, `permissionMode` | `requirements` block (declare, enforce, relay, provide) |
| Session options | `thread/start` fields | `session/set_config_option` (`model`, `effort`, `mode`) |

Both are one-shot: the child cannot receive follow-up messages.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `stage: install` | `opencode` is not on the DSH process's `PATH` | Set `command` to the absolute path, fix `PATH`, or set `requirements.install: true` |
| `subagent-opencode: <manager> failed in …` | The explicit install could not run | Read the exit code, then fix network or registry settings; `installManager: none` turns installing off |
| `… installed no executable for …` | The manager succeeded without the platform package | Check the registry and `installArgs`; arm64 and x64 Linux and macOS are published |
| `<provider> is not registered` from `conformance` | nothing supplied the provider a preset binds | Install this bundle, or add its provider row to the profile |
| `stage: session-new; category: auth-required` | No login for a configured provider | `opencode auth login`, or declare `credentials` |
| `required configuration is missing: X is not set` | `require: [credentials]` and `X` is unset | Export `X` for the DSH process, or drop the gate |
| `stage: configure` | OpenCode rejected `model`, `effort`, or `mode` | Check `opencode models` / `opencode agent list` |
| The child reports it could not write files | `permission: session` and the session has approval prompts disabled, or `permission: reject` | Switch the session to `ask`, or set `permission: allow` deliberately |

## Release notes

### 0.3.0

Follows the delegating session's approval policy by default and makes
coexistence with `agent-opencode` structural.

- **`permission: session` is the new default.** A session whose approval policy
  is `never` now gets a child that also refuses permission prompts, instead of a
  child that asked for a human who was not there. `reject` and `allow` still pin
  the answer for every session. The policy is resolved per run from the
  session's `approval/policy` override, then the approval service's configured
  default, then `ask`, and is reported in one fixed line on a permission
  failure. A profile that relied on the old `reject` default and delegates to a
  child that must write should set `permission: allow` explicitly.
- **Guarded session seam.** The two private DSH facts used for that read
  (`overrideOf(session)` and `config.policy`) are accessed through try/catch
  helpers. A DSH release that reshapes them degrades to `ask`; no delegation
  fails.
- **Client capability.** The ACP `initialize` handshake now advertises
  `fs.sessionPermissionRequests`, matching the contract this client already
  honors.
- **Coexistence guard.** A child whose working directory is inside the profile
  that mounts this provider is refused with a fixed diagnostic: the child would
  configure a second profile and register the provider and tool twice. This is
  the failure a same-profile preset install would otherwise hit as
  `DUPLICATE_PROVIDER`.
- **`subagent-opencode/conformance`.** New optional row that reports a preset's
  provider when nothing supplies it, after the host composition settles.
- **No coupling to `agent-opencode`.** The subagent, install, requirements, and
  approval-policy modules do not import anything from the preset package, and
  the resources the ACP SDK needs are resolved from the DSH installation itself
  (`sdk.js`), which every profile has.

### 0.2.1

Drop-in patch over 0.2.0. Fixes the first delegation failing with
`Error: The "path" argument must be of type string. Received undefined` whenever
`opencode` is absent from the DSH process's `PATH` and no `installDir` was
configured. The resolved default install directory now reaches the executable
probe, an unusable directory reports no previous install instead of throwing a
raw `TypeError`, and any unexpected probe failure uses the plugin's own fixed
diagnostic. No configuration changes are needed; install 0.2.1 over 0.2.0.

## Development

```bash
cd plugins/subagent-opencode
npm test    # 112 tests: requirement gates, env relay, the ACP lifecycle,
            # session policy, conformance, and the coexistence guard
npm run check
```

The runner tests spawn `test/fixtures/fake-opencode-agent.mjs`, a scripted ACP
agent, so they need neither OpenCode nor network access.

## License

MIT
