# Lifecycle, ownership, and teardown

"Disposable" is the whole point of this plugin. Getting the resource model right is what makes that
true rather than aspirational — a FlareSolverr container left running holds a browser image on
disk, a published port, and a Docker bridge network indefinitely.

## Three tiers, three lifetimes

Confusing these is the most common way to waste memory or leak state.

| Tier | What it is | Lifetime | Cost |
|---|---|---|---|
| **Browser session** | A live Chrome inside the container, with its cookies | From `sessions.create` to `sessions.destroy` (or container exit) | Hundreds of MB, grows with each session |
| **Container** | The FlareSolverr workspace itself | From `action=start` to `action=stop` (or session end) | A browser image + published port + network |
| **Image** | The ~1 GB image on the host | Until untagged/pruned | Disk only; shared between workspaces |

A one-shot `request.get` with no `session` spawns a *temporary* browser and destroys it when the
call returns — so it does not accumulate sessions, but it pays the launch cost every time.

## Ownership model

A workspace is created for the session that asked for it, and it is removed when that session ends.
There are three paths to removal, all of which reach the same teardown:

1. **`flaresolverr action=stop`** — the model decides it is done.
2. **Session end** — the harness archives the session, which cancels the ownership job, which stops
   and removes the container and its network.
3. **Plugin unload / process exit** — the plugin's disposal hook tears down every tracked workspace.

Because all three converge, a forgotten workspace is bounded by the session's own lifetime. There
is no daemon that outlives the conversation.

### The ownership job

`action=start` registers the workspace with the harness job registry, owned by the calling session.
That job *is* the ownership record: it stays in the running state for the workspace's whole life
and settles only when teardown begins. It follows that:

- Killing the job (or letting the session end) removes the workspace.
- `job_list` shows the workspace as a running job, which is why a long-lived entry is expected and
  not a stuck job.
- `job_output` on that id shows startup narration.

## Labels are the durable source of truth

In-memory state is a cache. The container carries its own identity as Docker labels:

| Label | Value |
|---|---|
| `dsh.plugin` | `flaresolverr` — makes every workspace findable |
| `dsh.workspace` | The container name |
| `dsh.owner` | The owning session id |
| `dsh.network` | The dedicated network, so it can be removed with the container |

Consequences worth relying on:

```bash
# Every workspace on this host, running or not
docker ps -a --filter label=dsh.plugin=flaresolverr

# Every stray network
docker network ls --filter label=dsh.plugin=flaresolverr
```

If the harness process crashes, the container survives — but it is *findable*, because the labels
are on the container rather than only in the harness's memory. `flaresolverr action=status all=true`
lists containers whose owning session is gone; `flaresolverr action=stop all=true` reaps them.

## Networking and exposure

Each workspace gets:

- Its **own Docker bridge network**, so it never shares a network with unrelated containers.
- A **loopback-only published port**: `-p 127.0.0.1::8191`. The kernel assigns an ephemeral host
  port and binds it to `127.0.0.1`.

This is deliberate on both counts. FlareSolverr has **no authentication** — anyone who can reach
the port can make this host fetch arbitrary URLs with its IP and cookies. Binding to loopback and
letting the kernel choose the port means:

- The service is unreachable from the network — no host firewall rule required.
- Two workspaces can never collide on a port.
- Nothing needs to be reserved or cleaned up in a port registry.

Never republish a workspace on `0.0.0.0`. Never put it behind a public reverse proxy.

## Resource limits

`action=start` applies:

- `--shm-size 2g` — headless Chromium deadlocks on the 64 MB `/dev/shm` default. This is the
  single most common cause of a container that starts and never answers.
- `--memory 1g` and `--cpus 2` (configurable) — FlareSolverr's own documentation warns that
  browsers are memory-hungry and that each request launches one. Cap it so a runaway crawl cannot
  take the host down.
- `--security-opt no-new-privileges` — the image already runs as the unprivileged `flaresolverr`
  user; this prevents re-escalation.
- `--restart no` — a disposable container must not resurrect itself after teardown.

## Cost model

| Situation | Cost |
|---|---|
| First `start` on a host | Pulls ~1 GB; dominates the wall time |
| Subsequent `start` | Image cached; seconds to healthy |
| `request.get`, no session | Browser launch + solve — seconds to tens of seconds |
| `request.get`, with session | Navigation only — much faster after the first call |
| Idle container | One idle Chromium's memory, held until teardown |

Rule of thumb: **one session per host you are crawling, destroyed as soon as that host is done.**
Do not leave a session open across unrelated tasks.

## Teardown checklist

Before reporting a scraping task complete:

```bash
flaresolverr action=stop
docker ps --filter label=dsh.plugin=flaresolverr     # must be empty
docker network ls --filter label=dsh.plugin=flaresolverr   # must be empty
```

`scripts/verify-workspace.sh` performs exactly these assertions automatically, including after a
kill-path teardown, which is the failure that silently leaks in most implementations.
