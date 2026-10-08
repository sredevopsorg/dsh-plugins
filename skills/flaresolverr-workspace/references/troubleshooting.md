# Troubleshooting

Work from the outside in: is Docker healthy, is the container healthy, is FlareSolverr answering,
is the target cooperating. Each layer has a distinct symptom, and the plugin's error codes name the
layer rather than the symptom.

## Layer 1 — Docker itself

| Error code | Symptom | Fix |
|---|---|---|
| `docker-missing` | `Docker CLI not found on PATH` | Install Docker Engine. Confirm `docker version` prints a Server section, not just a Client one. |
| `daemon-unreachable` | `the Docker daemon is not reachable` | `sudo systemctl start docker`, or start Docker Desktop. Confirm `docker info` succeeds. |
| `permission-denied` | `permission denied talking to the Docker daemon` | `sudo usermod -aG docker "$USER"`, then **log out and back in** — group membership is read at login, so a new shell in the same session is not enough. |
| `timeout` | The command exceeded its deadline | The pull may still be running. `flaresolverr action=status` before retrying, so you do not start a second container. |

Quick manual check:

```bash
docker version            # client + server?
docker info               # daemon reachable and permissive?
docker ps                 # can you list containers?
```

## Layer 2 — container startup

**The container exits during startup.** The error carries the last log lines, which is where the
real cause is. Common ones:

| Log signature | Cause | Fix |
|---|---|---|
| `stack smashing detected` / Chromium abort | `/dev/shm` too small | Already mitigated (`--shm-size 2g`). If it persists, raise `shmSize` in config. |
| `Chrome / Chromium web browser not installed!` | Corrupt or mismatched image | `docker pull` the image again, or pin a specific tag. |
| Startup probe failure | `TEST_URL` (`https://www.google.com`) is blocked from your network | Start with `env.TEST_URL=https://example.com`, or any URL reachable from this host. |
| `error while loading shared libraries` | Old host `libseccomp2` | Debian: `libseccomp2` must be ≥ 2.5. Update the package and restart Docker. |

**The container never becomes healthy.** The error says the container was left running for
inspection — that is intentional, so you can look:

```bash
docker logs --tail 60 <container-name>
```

Slow hosts (or a cold page cache) need a higher `startupTimeoutMs`. A container that is "Up" but
never answers `/health` is usually still booting Chromium.

**The container disappears mid-run.** Something removed it externally. `action=status` reports
`workspace: null`; `action=start` creates a fresh one, because a dead workspace is reaped before
being replaced.

## Layer 3 — FlareSolverr answers but the challenge does not clear

This is the most common class of "it doesn't work", and it is almost never a plugin bug.

| Message | Diagnosis | Action |
|---|---|---|
| `Error solving the challenge. Timeout after N seconds.` | The challenge did not clear in `maxTimeout`. | Create a session first (`sessions.create`), then retry with `session=<id>` and a higher `maxTimeout`. A warm browser with existing cookies often clears what a cold one cannot. |
| `Cloudflare has blocked this request. Probably your IP is banned…` | The target served an access-denied page. Your IP is known-bad for that site. | Route through a proxy: `env.PROXY_URL` at start, or `proxy` in `sessions.create`. Without a proxy, the target is unreachable from this host. |
| `Captcha detected but no automatic solver is configured.` | An interactive CAPTCHA, not a passive challenge. | **Upstream states no CAPTCHA solver currently works.** Do not spend time on `CAPTCHA_SOLVER`. Solve once manually in a real browser and reuse those cookies, or choose a different target. |
| `Challenge not detected!` and the body is the challenge page | Detection heuristics did not match the page's markup. | Retry with `waitInSeconds=5`; the page may be a JS redirect. Check whether the returned HTML is actually the final content. |
| `status: "error"` about the URL | Malformed or non-`http(s)` URL. | Use an absolute `http://` or `https://` URL. |

### Diagnosis order

1. `flaresolverr action=status` — is the workspace healthy?
2. `request.get` against a **known-good unprotected URL** (`https://example.com`). If this fails,
   the problem is the container, not the target.
3. `request.get` against the target with `disableMedia=true` and `waitInSeconds=5`.
4. If the challenge persists, move to a session and retry.
5. Only then consider a proxy.

### Read the Cloudflare signature

- `Just a moment...` / a `.ray_id` / `#cf-challenge-running` → a real challenge; the solver should
  handle it.
- `Attention Required! | Cloudflare` / `Access denied` → a **block**, not a challenge. No amount of
  retrying helps; you need a different IP.
- A Turnstile widget (`cf-turnstile-response`) → use `tabs_till_verify=N` (GET only) and read
  `solution.turnstile_token`.

## Layer 4 — the cookie does not work downstream

Almost always the **User-Agent trap**: `cf_clearance` is bound to the UA that earned it. See
§3 of `SKILL.md`. Checklist:

- Are you sending `solution.userAgent` **from the same response** that produced the cookies?
- Is your HTTP client overriding the User-Agent (many SDKs set one)?
- Are you sending the cookies for the right domain — `.example.com` covers subdomains, `example.com`
  does not?
- Has the cookie expired? Check `expires` (a Unix timestamp).
- Is the client making a *new* connection that Cloudflare fingerprints differently (TLS/HTTP2)?
  Python `requests` and `httpx` differ here.

## Layer 5 — resource pressure

| Symptom | Cause | Fix |
|---|---|---|
| Host slows, container gets OOM-killed | Several sessions, each a live browser | `sessions.destroy` when done; keep one session per host. |
| Requests queue and time out | Concurrent requests against one workspace | One browser per request without a session; serialize, or raise `memory`/`cpus`. |
| Disk fills | Many image tags accumulated | `docker image prune`. |

FlareSolverr's own README warns about this directly: *"Web browsers consume a lot of memory. If you
are running FlareSolverr on a machine with few RAM, do not make many requests at once."*

## Manual reproduction

When the tool's message is not enough, drop to the CLI — the container is ordinary Docker:

```bash
# Find it
docker ps -a --filter label=dsh.plugin=flaresolverr

# Talk to it directly
PORT=$(docker port <name> 8191/tcp | sed 's/.*://')
curl -s "http://127.0.0.1:$PORT/health"
curl -s -X POST "http://127.0.0.1:$PORT/v1" -H 'Content-Type: application/json' \
  -d '{"cmd":"request.get","url":"https://example.com","maxTimeout":60000}'

# Watch it
docker logs -f <name>

# Remove it
docker rm -f <name> && docker network rm <name>-net
```

Running the container with `LOG_LEVEL=debug` (`env.LOG_LEVEL=debug` at start, or the `logLevel`
config key) prints the full challenge-detection trace, which is the definitive answer to "why did
it not see the challenge".

## Escalation: is it this plugin or the host?

```bash
bash scripts/verify-workspace.sh
```

The script exercises the whole path — Docker, pull, start, health, `request.get`, loopback-only
assertion, teardown, leak assertion — and fails at the exact layer that is broken. If it passes,
the plugin and Docker are fine and the problem is the target or the parameters.
