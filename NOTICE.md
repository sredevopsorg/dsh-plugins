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
| [`skills/github-actions-security-audit`](skills/github-actions-security-audit/SKILL.md) | Guidance grounded in GitHub's Secure use reference — https://docs.github.com/en/actions/reference/security/secure-use (source: https://github.com/github/docs) | CC-BY-4.0 |
| [`skills/kubernetes-kubectl-operations`](skills/kubernetes-kubectl-operations/SKILL.md) | Guidance grounded in the official Kubernetes documentation — https://kubernetes.io/docs/ (source: https://github.com/kubernetes/website) and the Kubernetes MCP Server documentation — https://github.com/containers/kubernetes-mcp-server | CC-BY-4.0 (Kubernetes docs); Apache-2.0 (MCP server docs) |

Each derived `SKILL.md` preserves its upstream `metadata` (author, version,
organization). The Supabase skills carry fields authored by Supabase; they are
reproduced here unmodified apart from repository-local path handling.

## Plugins

| Path | Upstream | License |
|---|---|---|
| [`plugins/entire`](plugins/entire/README.md) | Reads the Entire CLI's data through the `entire` binary and captures DSH sessions through `entire-agent-dsh`. The plugin is original work; the binaries are runtime dependencies and are **not** redistributed here. | MIT |

The `entire` plugin runs the Entire CLI from the `entire` binary on `PATH` or the
`binary` value you configure. Entire is a separate product with its own service,
account, and terms; nothing from Entire is redistributed here.

> Copyright for the upstream material remains with its authors. Nothing in this
> repository's MIT license grants rights to third-party trademarks such as
> "Supabase", "Ghost", "Entire", "Kubernetes", "OpenShift", or "DeepSeek".
