# Third-party notices

This repository is distributed under the MIT license (see [LICENSE](LICENSE)).
Parts of it are derived from third-party work whose licenses and attribution are
reproduced below. Full license texts ship with the upstream projects.

## Skills

| Path | Upstream | License |
|---|---|---|
| [`plugins/skills/skills/supabase`](plugins/skills/skills/supabase/SKILL.md) | Supabase agent skills — https://github.com/supabase/agent-skills | MIT |
| [`plugins/skills/skills/supabase-postgres-best-practices`](plugins/skills/skills/supabase-postgres-best-practices/SKILL.md) | Supabase agent skills (Postgres best practices, v1.1.1) — https://github.com/supabase/agent-skills | MIT |
| [`plugins/skills/skills/ghost-theme-modern-frontend`](plugins/skills/skills/ghost-theme-modern-frontend/SKILL.md) | Guidance grounded in the MIT-licensed community theme https://github.com/christopher-b/vapour and the official docs at https://docs.ghost.org | MIT |
| [`plugins/skills/skills/helm-chart-development`](plugins/skills/skills/helm-chart-development/SKILL.md) | Guidance grounded in the official Helm docs — https://helm.sh/docs/chart_template_guide/ (source: https://github.com/helm/helm-www) | CC-BY-4.0 |
| [`plugins/skills/skills/github-actions-security-audit`](plugins/skills/skills/github-actions-security-audit/SKILL.md) | Guidance grounded in GitHub's Secure use reference — https://docs.github.com/en/actions/reference/security/secure-use (source: https://github.com/github/docs) | CC-BY-4.0 |
| [`plugins/skills/skills/kubernetes-kubectl-operations`](plugins/skills/skills/kubernetes-kubectl-operations/SKILL.md) | Guidance grounded in the official Kubernetes documentation — https://kubernetes.io/docs/ (source: https://github.com/kubernetes/website) and the Kubernetes MCP Server documentation — https://github.com/containers/kubernetes-mcp-server | CC-BY-4.0 (Kubernetes docs); Apache-2.0 (MCP server docs) |

Each derived `SKILL.md` preserves its upstream `metadata` (author, version,
organization). The Supabase skills carry fields authored by Supabase; they are
reproduced here unmodified apart from repository-local path handling. Every
skill now ships inside the installable [`plugins/skills`](plugins/skills/README.md)
plugin package, so the paths above are package-internal.

## Plugins

| Path | Upstream | License |
|---|---|---|
| [`plugins/entire`](plugins/entire/README.md) | Reads the Entire CLI's data through the `entire` binary and captures DSH sessions through `entire-agent-dsh`. The plugin is original work; the binaries are runtime dependencies and are **not** redistributed here. | MIT |
| [`plugins/superagent`](plugins/superagent/README.md) | Fork of the DeepSeek Harness `dsh-superagent` research prototype — https://github.com/deepseek-ai/dsh-superagent-prototype (upstream commit `8c32a9d`). The fork keeps the upstream MIT license, renames the package to `@sredevopsorg/dsh-superagent`, adds repository packaging, and commits the build output so a Git install needs no toolchain. Upstream copyright remains with the DeepSeek Harness Team. | MIT |

The `entire` plugin runs the Entire CLI from the `entire` binary on `PATH` or the
`binary` value you configure. Entire is a separate product with its own service,
account, and terms; nothing from Entire is redistributed here.

The `superagent` plugin is a fork, not a redistribution of the prototype by the
DeepSeek Harness Team; it is provided as research code without warranty, as the
upstream README states. The upstream `LICENSE` is kept in the plugin directory.

> Copyright for the upstream material remains with its authors. Nothing in this
> repository's MIT license grants rights to third-party trademarks such as
> "Supabase", "Ghost", "Entire", "Kubernetes", "OpenShift", or "DeepSeek".
