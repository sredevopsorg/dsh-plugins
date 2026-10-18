# Third-party notices

This repository is distributed under the MIT license (see [LICENSE](LICENSE)).
Parts of it are derived from third-party work whose licenses and attribution are
reproduced below. Full license texts ship with the upstream projects.

## Skills

| Path | Upstream | License |
|---|---|---|
| [`skills/supabase`](skills/supabase/SKILL.md) | Supabase agent skills — https://github.com/supabase/agent-skills | MIT |
| [`skills/supabase-postgres-best-practices`](skills/supabase-postgres-best-practices/SKILL.md) | Supabase agent skills (Postgres best practices, v1.1.1) — https://github.com/supabase/agent-skills | MIT |
| [`skills/ghost-theme-modern-frontend`](skills/ghost-theme-modern-frontend/SKILL.md) | Guidance grounded in the MIT-licensed community theme https://github.com/christopher-b/vapour and the official docs at https://docs.ghost.org | MIT |
| [`skills/helm-chart-development`](skills/helm-chart-development/SKILL.md) | Guidance grounded in the official Helm docs — https://helm.sh/docs/chart_template_guide/ (source: https://github.com/helm/helm-www) | CC-BY-4.0 |
| [`skills/flaresolverr-workspace`](skills/flaresolverr-workspace/SKILL.md) | Guidance grounded in the FlareSolverr source and documentation — https://github.com/FlareSolverr/FlareSolverr | MIT |
| [`skills/kubernetes-kubectl-operations`](skills/kubernetes-kubectl-operations/SKILL.md) | Guidance grounded in the official Kubernetes documentation — https://kubernetes.io/docs/ (source: https://github.com/kubernetes/website) and the Kubernetes MCP Server documentation — https://github.com/containers/kubernetes-mcp-server | CC-BY-4.0 (Kubernetes docs); Apache-2.0 (MCP server docs) |

Each derived `SKILL.md` preserves its upstream `metadata` (author, version,
organization). The Supabase skills carry fields authored by Supabase; they are
reproduced here unmodified apart from repository-local path handling.

## Plugins

| Path | Upstream | License |
|---|---|---|
| [`plugins/flaresolverr`](plugins/flaresolverr/README.md) | Runs the FlareSolverr container image (`ghcr.io/flaresolverr/flaresolverr` / `flaresolverr/flaresolverr`). The plugin is original work; the image is a runtime dependency and is **not** redistributed here. | MIT |
| [`plugins/architect-dev-bundle`](plugins/architect-dev-bundle/README.md) | Configures `containers/kubernetes-mcp-server` — https://github.com/containers/kubernetes-mcp-server. The bundle is original work; the server is fetched at runtime with `npx` and is **not** redistributed here. | Apache-2.0 |

The `flaresolverr` plugin pulls its container image at runtime from the registry
you configure. FlareSolverr is an unauthenticated proxy: never publish a
workspace outside the loopback interface, and use it only against targets you are
authorized to access.

The Architect Dev bundle runs the Kubernetes MCP server from the npm registry at
runtime. The server is a full management server, not a read-only one; the bundle
leaves it disabled by default and the skill recommends a read-only kubeconfig or
`view`-only ServiceAccount.

> Copyright for the upstream material remains with its authors. Nothing in this
> repository's MIT license grants rights to third-party trademarks such as
> "Supabase", "Ghost", "FlareSolverr", "Kubernetes", "OpenShift", or "DeepSeek".
