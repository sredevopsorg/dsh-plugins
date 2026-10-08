# flaresolverr

A DSH Host plugin that registers one model-facing tool, **`flaresolverr`**, which gives the
session a **disposable FlareSolverr workspace**: a short-lived, loopback-only Docker container
that solves Cloudflare and DDoS-Guard challenges and returns the page together with the cookies
needed to bypass them.

The tool exposes four actions — `start`, `status`, `request`, `stop`. The workspace is owned by
the calling session, so it is removed when the session ends; there is no durable daemon to
forget about.

## Why a workspace rather than an endpoint

FlareSolverr is an **unauthenticated open proxy**. Anyone who can reach port 8191 can make your
machine fetch arbitrary URLs with your IP and your cookies. Upstream says plainly: *do not expose
FlareSolverr to the internet*.

This plugin therefore treats exposure as a design constraint rather than a caveat:

- The container is published with `-p 127.0.0.1::8191` — bound to the loopback interface, on a
  kernel-assigned ephemeral host port. It is never reachable from the network, and it can never
  collide with another workspace's port.
- Each workspace gets its own Docker bridge network, so it never joins a network shared with other
  containers.
- The container runs with `--security-opt no-new-privileges` and explicit memory and CPU caps.
- Lifecycle is enforced through `ctx.jobs`, so a killed session cannot leak a running container.

## Actions

| Action | Key inputs | Behavior |
|---|---|---|
| `start` | `image`, `env`, `memory`, `cpus` | Creates the network and container, waits for `GET /health`, returns the endpoint and the solver's User-Agent. Idempotent: an already-running workspace for this session is returned as-is. |
| `status` | `all` | Reports this session's workspace (state, URL, health). `all: true` also lists containers whose owning session is gone. |
| `request` | `cmd`, `url`, `session`, `maxTimeout`, `cookies`, `postData`, `returnOnlyCookies`, `returnScreenshot`, `disableMedia`, `waitInSeconds`, `session_ttl_minutes`, `tabs_till_verify`, `full` | Runs one FlareSolverr v1 command, starting a workspace first if none is live. Returns a bounded summary by default. |
| `stop` | `all` | Stops and removes the container and its network. `all: true` also reaps orphans. |

`request` accepts the five v1 commands: `sessions.create`, `sessions.list`, `sessions.destroy`,
`request.get`, `request.post`.

### Output shape

`request` returns a summary rather than the raw envelope, because `solution.response` is a full
page of untrusted HTML:

```json
{
  "action": "request",
  "cmd": "request.get",
  "status": "ok",
  "message": "Challenge solved!",
  "solution": {
    "url": "https://protected.example/",
    "status": 200,
    "userAgent": "Mozilla/5.0 (X11; Linux x86_64) …",
    "cookieCount": 2,
    "cookies": [{ "name": "cf_clearance", "value": "…", "domain": ".example", "httpOnly": true }],
    "bodyBytes": 61587,
    "responseOmitted": true,
    "responseHint": "Rerun with full=true to include the HTML body."
  }
}
```

Pass `full: true` to include the HTML body and headers. The output stays bounded either way.

> **The User-Agent trap.** A Cloudflare clearance cookie only works for the exact User-Agent that
> solved the challenge. Reuse `solution.userAgent` verbatim in the downstream HTTP client, or the
> challenge reappears. `start` and `request` both surface it for this reason.

## Configuration

Set these under the row's `config` in `cordis.patch.yml`. Every key is optional; a wrong-typed or
out-of-range value falls back to its default instead of failing activation. The plugin declares
**no `Config` schema**, so `cordis_inspect_query Config.listConfigs` reports status `absent` for
this row — that is expected, not an error.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `image` | string | `ghcr.io/flaresolverr/flaresolverr:latest` | Container image. Pin a digest or tag for reproducible runs. |
| `defaultMaxTimeoutMs` | integer | `60000` | Default solve budget when the call omits `maxTimeout`. |
| `startupTimeoutMs` | integer | `60000` | How long `start` waits for `/health` to answer before giving up. |
| `healthIntervalMs` | integer | `1000` | Readiness probe interval. |
| `pullTimeoutMs` | integer | `600000` | Budget for the initial image pull, which dominates a cold start. |
| `shmSize` | string | `2g` | `/dev/shm` size. Headless Chromium deadlocks on the 64 MB default. |
| `memory` | string | `1g` | Container memory limit. |
| `cpus` | string | `2` | Container CPU limit. |
| `requestTimeoutSlackMs` | integer | `15000` | Transport slack added on top of `maxTimeout`, so the tool never aborts a solve in flight. |
| `maxOutputChars` | integer | `12000` | Cap on one tool result. |
| `stopGraceSeconds` | integer | `10` | Grace period before `docker stop` escalates. |
| `logTailLines` | integer | `40` | Log lines attached to a startup failure. |
| `logLevel` | string | `info` | Container `LOG_LEVEL`. Use `debug` when diagnosing. |
| `promptSection` | boolean | `true` | Register the one-sentence system-prompt section. |

### Example

```yaml
- id: flaresolverr
  name: '@sredevopsorg/dsh-flaresolverr'
  config:
    image: 'ghcr.io/flaresolverr/flaresolverr:3.4.3'
    memory: '2g'
    startupTimeoutMs: 120000
```

## Requirements

- **Docker Engine** with a reachable daemon and permission to create containers, networks, and
  published ports. Missing CLI, a stopped daemon, and a socket permission error are each detected
  up front and reported with the specific fix.
- **Network access to the registry** on first use. FlareSolverr's image is roughly 1 GB
  uncompressed; the pull dominates a cold `start`. For air-gapped hosts, pre-pull the image and
  set `image` to the local tag.

## Design notes

- **No shell, ever.** Every Docker invocation is `execFile('docker', argv)` with an explicit
  argument vector — no `bash -c`, no interpolation. The injection class is removed rather than
  escaped around, and `env` names are constrained to POSIX identifiers on top of that.
- **Labels are the source of truth.** Ownership and workspace identity live on the container
  (`dsh.plugin`, `dsh.workspace`, `dsh.owner`, `dsh.network`), so a plugin reload or a crashed
  harness process leaves a *findable* container rather than an invisible leak.
  `status { all: true }` lists orphans; `stop { all: true }` reaps them.
- **No dependencies, no build step.** The plugin ships plain ESM with `node:` imports only. A
  workspace-linked plugin cannot resolve bare `@deepseek-ai/*` specifiers unless its manifest
  declares them as `peerDependencies`, so this package registers a raw tool definition instead of
  using `defineTool`. That keeps `dsh plugin add` free of both a toolchain and install-script
  approval.
- **Ports and adapters.** `index.js` holds policy; `docker.js` knows Docker's argv and its error
  taxonomy; `flare.js` knows the wire protocol. Only `docker.js` executes anything.
- **Readiness is probed, not scraped.** The API's own `/health` is the only signal that means
  "ready", and a container that exits during startup is detected immediately — the failing log
  lines are attached to the error.
- **Failures are classified.** Docker's stderr is mapped to a closed set — `docker-missing`,
  `daemon-unreachable`, `permission-denied`, `not-found`, `timeout`, `conflict`, `failed` — each
  with an imperative remediation sentence. The model never sees a stack trace.

## Privacy note

`env` values can carry proxy credentials (`PROXY_URL`, `PROXY_USERNAME`, `PROXY_PASSWORD`). They
are passed as Docker argv entries, so they are visible to any local user who can run
`docker inspect` — that is inherent to the Docker CLI, not specific to this plugin. Tool results
echo environment **names** only, never values. Do not put a long-lived secret in workspace config.

## Verifying

```bash
dsh plugin --profile <name> add /path/to/plugins/flaresolverr
dsh --profile <name> --dump-config        # the flaresolverr row is present
```

Then in a session, confirm `flaresolverr` appears in the tool list and run:

```
flaresolverr action=start
flaresolverr action=request cmd=request.get url=https://example.com
flaresolverr action=stop
docker ps --filter label=dsh.plugin=flaresolverr    # must be empty
```

Disabling the bundle removes the tool, confirming the registration is owned by the plugin context.

The companion skill [`flaresolverr-workspace`](../../skills/flaresolverr-workspace/SKILL.md)
carries the API contract, the lifecycle invariant, and the failure playbook, and ships
`scripts/verify-workspace.sh` — an end-to-end proof that also asserts nothing is left behind.
