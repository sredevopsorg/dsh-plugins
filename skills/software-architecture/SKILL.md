---
name: software-architecture
description: Modern minimalistic software architecture — how to choose the simplest design that works, which patterns to apply or skip, engineering good practices, and how to discover and select skills, plugins, MCP servers, and other tools for a goal.
whenToUse: Use when designing or reviewing a system, choosing an architectural style or pattern, making a build-vs-buy or tooling decision, or when a request mixes architecture, practices, and tool selection.
---

# Software Architecture (minimalistic by default)

Use this skill when designing a system, choosing an architectural style or pattern, setting engineering practices, or deciding which tool/skill/plugin/MCP to reach for.

## 1. Minimalism first

The default posture is the simplest design that satisfies the requirements. Complexity is a cost paid on every future change, so it must be earned.

- **YAGNI** — do not build for a scale, a tenant model, or a failure mode nobody has asked for. Design for the next order of magnitude, not the next decade.
- **Boring technology** — prefer the proven, well-documented option over the novel one unless the novel one solves a problem you actually have.
- **Modular monolith before microservices** — one deployable with clear internal module boundaries is almost always the right start. Boundaries can become services later; distributed systems are very hard to un-distribute.
- **Prefer deleting over abstracting** — the best refactor is often removing code. Abstract only at the second or third real duplication, not the first.
- **Managed over self-hosted** — a managed database/queue/object store removes operational surface. Self-host only for cost, compliance, or control reasons you can name.
- **Make it work, make it right, make it fast** — in that order, with tests pinning each step.
- **Every dependency is a liability** — a library that saves 50 lines but adds an upgrade treadmill, a security surface, and a transitive tree may be a net loss.

Signals you are over-engineering: an abstraction with one implementation, an interface with one caller, an event bus with one publisher and one subscriber, a service that shares a database with its only peer, a config flag nobody sets.

## 2. Architecture workflow

1. **Requirements and constraints** — functional needs, plus the hard constraints: team size, deadline, budget, latency, compliance, existing systems.
2. **Quality attributes** — rank the few "-ilities" that actually matter (scalability, reliability, security, observability, maintainability, cost). They, not fashion, drive the design. State them as measurable targets where possible.
3. **Simplest sufficient design** — start from the most boring thing that meets those targets, then justify each addition.
4. **C4 sketch** — Context → Container → Component, at the altitude the audience needs. A whiteboard-level diagram in the repo beats a perfect one nobody reads.
5. **ADR** — for each meaningful decision record context, decision, consequences, and rejected alternatives. A short `docs/adr/NNNN-title.md` with `Status: Accepted|Superseded` is enough.
6. **Vertical slices** — implement one thin end-to-end path first (API → logic → storage → UI), tested, then widen. Defer cross-cutting machinery until a second consumer exists.

## 3. Choosing a style

| Situation | Start with |
|---|---|
| New product, small team | Modular monolith, one database, one deployable |
| Clear bounded contexts, independent team ownership | Modules with explicit interfaces; split to services only when deployment or scaling diverges |
| Read/write asymmetry, heavy audit needs | CQRS, and only then consider event sourcing |
| Genuine asynchronous workflows, integration across systems | Message queue / event-driven, with idempotent consumers |
| Simple CRUD with reporting | Plain layered CRUD; do not reach for DDD |

Keep a bounded context owning its data: other contexts read through its API or its events, never its tables. Distributed transactions are a design smell — prefer a transactional outbox, saga, or an accepting eventual consistency with a stated reconciliation story.

## 4. Patterns: apply or skip

**Worth it when the problem exists**
- **Hexagonal / ports-and-adapters** — isolate domain logic from frameworks and I/O behind interfaces. Makes the core testable without a database and swappable without a rewrite.
- **Repository** — only around a real persistence boundary; do not wrap an ORM that is already an abstraction.
- **Dependency injection** — for wiring and test seams; a container is optional, constructor arguments often suffice.
- **Strangler fig** — the safe way to replace a legacy system incrementally.
- **Outbox / idempotency keys** — the moment you combine a database write with a message publish.
- **Circuit breaker / retry with jitter** — for every remote call you do not control.

**Usually overkill**
- **Event sourcing** — unless audit, temporal queries, or replay are first-class requirements.
- **Microservices** — before you have independent scaling or independent team ownership.
- **Generic repository/service layers over CRUD** — they add indirection without behaviour.
- **Home-grown frameworks, ORMs, or DI containers** — use the ecosystem's.
- **Speculative multi-tenancy, plugin systems, or rule engines** — build the specific thing.

Domain-driven design is worth it where the business rules are genuinely complex: use aggregates, entities, value objects, domain events, and ubiquitous language there; leave the CRUD parts anemic and boring.

## 5. Quality attributes and trade-offs

- **Scalability** — stateless services scale horizontally; push state to backing services. Measure before optimizing; cache only with an invalidation story.
- **Reliability** — timeouts, retries with backoff and jitter, idempotency, graceful degradation, health/readiness probes, and a stated consistency model.
- **Observability** — structured logs, metrics, and traces from day one; instrument the boundaries (inbound requests, outbound calls, DB). Alert on SLOs (latency, error rate, saturation), not on raw CPU.
- **Security** — validate at the boundary, least privilege, secrets in a secret store (never in the image or the repo), dependency scanning, and review for injection, SSRF, IDOR, and unsafe deserialization.
- **Maintainability** — one obvious way to do each thing, consistent layout, small modules with explicit dependencies, and tests that document intent.
- **Cost** — right-size instances, set resource requests/limits, and prefer managed services where the operational saving exceeds the bill.

State trade-offs explicitly: "we chose X over Y because Z, accepting the cost of W."

## 6. Engineering good practices

- **12-factor** — config in env, stateless processes, backing services as attached resources, disposable processes, dev/prod parity, logs as event streams.
- **Testing pyramid** — many fast unit tests on domain logic, fewer integration tests across real boundaries, a thin e2e layer on critical journeys. Mock at the boundary, not the internals.
- **CI/CD** — lint → typecheck → test → build image → scan → deploy, gated on a green main; small, reversible, frequent releases; a documented rollback path.
- **Trunk-based development** — short-lived branches, small PRs, review by a peer, no long-running divergence.
- **Migrations** — forward-only, versioned, reviewed, and safe to run while the old code is still live (expand → migrate → contract).
- **Documentation** — a README that gets a new developer running, plus ADRs for decisions. Prefer executable documentation (tests, schemas) over prose that drifts.
- **Git hygiene** — focused commits with clear messages, no secrets committed, no commented-out code blocks left behind.

## 7. Discovering and using skills, plugins, MCP servers, and tools

Choose in this order, and stop at the first rung that solves the problem:

1. **An existing skill** — the session's skill catalog lists every available skill with its description. If one matches the task, load it with the `skill` tool before improvising; it carries task-specific instructions you would otherwise have to rediscover.
2. **A built-in tool** — shell (`bash`), filesystem read/write/search, web search and fetch, `todo_write`, `ask_user_question`, subagents, `workflow`, and goals. These need no setup.
3. **Delegation for scale** — `subagent` / `subagent_fork` for focused independent work, `workflow` for fan-out across many items, so the main context stays clean.
4. **An MCP server** — for capabilities the harness does not ship (a specific SaaS, database, or API). One server per `@deepseek-ai/dsh-mcp-client` row; tools surface as `mcp__<serverName>__<tool>`.
5. **A plugin or preset change** — a durable capability of the harness itself.

### Skills: where they are discovered

The filesystem skill provider scans these roots in rank order (a directory bundle `<name>/SKILL.md` or a flat `<name>.md`; nested `**/SKILL.md` is not discovered):

| Rank | Source | Path |
|---|---|---|
| 100 | project-dsh | `<projectRoot>/.dsh/skills` |
| 200 | project-agents | `<projectRoot>/.agents/skills` |
| 300 | custom | `customSkillDirs` configured on the preset |
| 400 | user-dsh | `<dshHome>/skills` (harness-wide: the architecture, fullstack, and Supabase skills live here) |
| 500 | user-agents | `<agentsHome>/skills` |

Frontmatter requires `name` and `description`; optional `whenToUse`, `metadata`, `disable-model-invocation`, and `user-invocable`. The catalog is re-read, so a new or edited skill is picked up without a restart. To add a repeatable procedure for this agent, author a skill under one of those roots rather than repeating it in every prompt.

### MCP servers: the row shape and prerequisites

```yaml
- id: mcp-supabase
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: supabase
    transport: streamable-http
    url: https://mcp.supabase.com/mcp?read_only=true&features=docs,account,database,debugging,development,functions
    headers:
      Authorization: !!js '`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`'
```

`transport` is `stdio` (with `command`/`args`/`env`) or `streamable-http` (with `url`/`headers`). `@deepseek-ai/dsh-mcp-client` is installed in this profile, so a row activates as soon as its own upstream is reachable; each row still needs that upstream (a URL, or a command that exists) and its credentials. DSH starts a stdio server but never runs a package manager, so the executable must already be installed. A connection failure does not fail the mount (`failOnStartupError` defaults to false) — the error is logged and the client retries with backoff. See `docs/user/guide/mcp-memory.md` for the canonical opt-in pattern.

**Supabase is already wired.** The `mcp-supabase` row in this preset's composition attaches the hosted Supabase MCP server, and the `supabase` and `supabase-postgres-best-practices` skills are bundled beside this one. Use those skills for how to work with Supabase; use the MCP tools (prefixed `mcp__supabase__`) for live project access. The row is read-only by default and needs `SUPABASE_ACCESS_TOKEN` set before dsh starts; dropping `read_only=true` from its URL enables writes, and appending `&project_ref=<ref>` scopes it to one project.

### Plugins

`dsh plugin --profile <name> add|remove|why <package>` forwards to pnpm inside the profile directory; a dependency that declares a `dsh.bundle` patch joins the profile's layer stack, so adding one extends the harness itself. Plugin state is also visible in the Web GUI's plugin-inventory settings page. Changes take effect on the next profile start.

### Suggesting something you are not sure exists

Search the web (`web_search`/`web_fetch`) before naming a specific MCP server, plugin, CLI, or library, and cite the source. Never invent a package or server name. State the install and credential prerequisites explicitly, and prefer maintained, pinned options with a recent release.
