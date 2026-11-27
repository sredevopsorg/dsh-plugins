# Third-party notices

This repository is distributed under the MIT license (see [LICENSE](LICENSE)).
Parts of it are derived from third-party work whose licenses and attribution are
reproduced below. Full license texts ship with the upstream projects.

## Skills

| Path | Upstream | License |
|---|---|---|
| [`plugins/skills/skills/ghost-theme-modern-frontend`](plugins/skills/skills/ghost-theme-modern-frontend/SKILL.md) | Guidance grounded in the MIT-licensed community theme https://github.com/christopher-b/vapour and the official docs at https://docs.ghost.org | MIT |
| [`plugins/skills/skills/helm-chart-development`](plugins/skills/skills/helm-chart-development/SKILL.md) | Guidance grounded in the official Helm docs — https://helm.sh/docs/chart_template_guide/ (source: https://github.com/helm/helm-www) | CC-BY-4.0 |
| [`plugins/skills/skills/github-actions-security-audit`](plugins/skills/skills/github-actions-security-audit/SKILL.md) | Guidance grounded in GitHub's Secure use reference — https://docs.github.com/en/actions/reference/security/secure-use (source: https://github.com/github/docs) | CC-BY-4.0 |
| [`plugins/skills/skills/kubernetes-kubectl-operations`](plugins/skills/skills/kubernetes-kubectl-operations/SKILL.md) | Guidance grounded in the official Kubernetes documentation — https://kubernetes.io/docs/ (source: https://github.com/kubernetes/website) and the Kubernetes MCP Server documentation — https://github.com/containers/kubernetes-mcp-server | CC-BY-4.0 (Kubernetes docs); Apache-2.0 (MCP server docs) |
| [`plugins/skills/skills/kustomize`](plugins/skills/skills/kustomize/SKILL.md) | Guidance grounded in the Kustomize project documentation — https://kustomize.io/ (source: https://github.com/kubernetes-sigs/kustomize) and the Kubernetes tasks https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/ and https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-kustomize/ (source: https://github.com/kubernetes/website) | Apache-2.0 (Kustomize docs); CC-BY-4.0 (Kubernetes docs) |

Each derived `SKILL.md` preserves its upstream `metadata` (author, version,
organization). They are reproduced here unmodified apart from repository-local
path handling. Every skill now ships inside the installable
[`plugins/skills`](plugins/skills/README.md) plugin package, so the paths above
are package-internal.

## Plugins

| Path | Upstream | License |
|---|---|---|
| [`plugins/video-explainer`](plugins/video-explainer/README.md) | Port of the Video Explainer agent skill — https://github.com/petergyang/video-explainer (upstream commit `be2f729`). The port keeps the upstream MIT license and copyright notice in `plugins/video-explainer/LICENSE`, packages the skill as a DSH bundle, adds the `video_explainer_setup` and `video_explainer_render` tools and the `video-explainer` agent preset, and applies the security fixes listed in `plugins/video-explainer/docs/UPSTREAM.md` (a read-only preflight instead of an auto-installing setup, pinned Python dependencies, a scoped loopback review server). The bundled Inter font ships under the SIL Open Font License (`plugins/video-explainer/skills/video-explainer/fonts/OFL.txt`). | MIT (SIL OFL 1.1 for the Inter font) |
| [`plugins/superagent`](plugins/superagent/README.md) | Fork of the DeepSeek Harness `dsh-superagent` research prototype — https://github.com/deepseek-ai/dsh-superagent-prototype (upstream commit `8c32a9d`). The fork keeps the upstream MIT license, renames the package to `@sredevopsorg/dsh-superagent`, adds repository packaging, and commits the build output so a Git install needs no toolchain. Upstream copyright remains with the DeepSeek Harness Team. | MIT |

The `superagent` plugin is a fork, not a redistribution of the prototype by the
DeepSeek Harness Team; it is provided as research code without warranty, as the
upstream README states. The upstream `LICENSE` is kept in the plugin directory.

> Copyright for the upstream material remains with its authors. Nothing in this
> repository's MIT license grants rights to third-party trademarks such as
> "Ghost", "Kubernetes", "OpenShift", "Video Explainer", or "DeepSeek".
