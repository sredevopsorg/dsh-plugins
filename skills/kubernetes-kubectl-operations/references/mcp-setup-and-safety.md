# MCP setup and safety

The Architect Dev bundle ships a profile-level `mcp-kubernetes` row for
[`containers/kubernetes-mcp-server`](https://github.com/containers/kubernetes-mcp-server).
The row is **disabled by default** and is a sibling of the preset, not a preset child,
so `plugin_manager` can toggle it. Enabling it affects every session in the profile.

## Enable and disable

```text
plugin_manager action=list_plugins
  -> find id "mcp-kubernetes" (module @deepseek-ai/dsh-mcp-client), note entryId

plugin_manager action=set_plugin target=<entryId> enabled=true
  -> approval/full access required; HMR applies the change
  -> tools appear as mcp__kubernetes__*
```

Disable with the same call and `enabled=false`. If the tool is unavailable, use the
Web **Plugins** page and the `mcp-kubernetes` row. A non-Web profile can add an override
to the profile patch instead:

```yaml
- id: mcp-kubernetes
  disabled: false
```

## Prerequisites

- `npx` on `PATH` (Node/npm). The row runs
  `npx -y kubernetes-mcp-server@latest`; the first launch downloads the package and
  its platform binary.
- A kubeconfig. The server uses `KUBECONFIG` when set and otherwise
  `~/.kube/config`; the MCP client preserves `KUBECONFIG` through its environment
  scrubbing.
- A Kubernetes cluster reachable with that kubeconfig.

## Read-only is enforced by credentials, not by the bundle

This server is **not** a read-only server. With the default `core` + `config`
toolsets it can:

- create/update resources via server-side apply (`resources_create_or_update`)
- delete resources and pods (`resources_delete`, `pods_delete`)
- execute commands in pods (`pods_exec`)
- run new pods (`pods_run`)
- scale workloads (`resources_scale` with `scale`)
- read Secrets if RBAC allows it

The bundle does not pass a TOML config, and the current server does not expose
`read_only` as an environment variable. Therefore the hard boundary is the kubeconfig
and RBAC.

### Recommended: a dedicated read-only kubeconfig

Follow the upstream production guide:
[Deploying Kubernetes MCP Server in a Kubernetes Cluster](https://github.com/containers/kubernetes-mcp-server/blob/main/docs/getting-started-kubernetes.md).
The short version:

```bash
kubectl create namespace mcp
kubectl create serviceaccount mcp-viewer -n mcp
kubectl create clusterrolebinding mcp-viewer-crb \
  --clusterrole=view --serviceaccount=mcp:mcp-viewer
TOKEN="$(kubectl create token mcp-viewer --duration=2h -n mcp)"
# Build ~/.kube/mcp-viewer.kubeconfig from the current cluster + token, then:
export KUBECONFIG="$HOME/.kube/mcp-viewer.kubeconfig"
```

The built-in `view` ClusterRole is read-only and deliberately excludes Secrets and
RBAC objects. Use a namespace-scoped RoleBinding instead of a ClusterRoleBinding when
the MCP only needs one namespace.

Before enabling the MCP, check the ambient context:

```bash
kubectl config current-context
kubectl auth can-i --list
kubectl auth can-i create pods,deployments,services -A
kubectl auth can-i delete pods -A
```

If writes are allowed, do not enable the MCP for exploratory work; point the MCP at the
read-only context/kubeconfig or use `kubectl`.

### Optional hard read-only TOML

If you control the row, add a TOML file and pass it with `--config` (or set
`MCP_CONFIG_PATH` in the row's `env`). Example:

```toml
read_only = true
disable_destructive = true
toolsets = ["core", "config"]

[[denied_resources]]
group = ""
version = "v1"
kind = "Secret"
```

Then add to the row's `args`:

```yaml
args:
  - '-y'
  - 'kubernetes-mcp-server@latest'
  - '--config'
  - '/absolute/path/to/kubernetes-mcp.toml'
```

A profile override replaces the row's whole `config`, so restate every field:

```yaml
- id: mcp-kubernetes
  config:
    serverName: kubernetes
    transport: stdio
    command: npx
    args: ['-y', 'kubernetes-mcp-server@latest', '--config', '/absolute/path/to/kubernetes-mcp.toml']
    failOnStartupError: false
```

Add `disabled: false` to that override (or enable the row afterward) to activate it.

`read_only` and `denied_resources` are reloadable, but without `--config`/`--config-dir`
the server ignores SIGHUP. Restart the MCP row after changing the file unless you have
wired a config path.

## What the model may call

Use these for inspection:

| Tool | Notes |
|---|---|
| `pods_list` | All namespaces; prefer selectors |
| `pods_list_in_namespace` | Prefer this over `pods_list` |
| `pods_get` | One pod |
| `pods_log` | `tail`, `previous`, `container` |
| `pods_top` | Requires Metrics Server |
| `resources_list` / `resources_get` | Non-Secret kinds; require `apiVersion` and `kind` |
| `events_list` | `fieldSelector` supports `type=Warning`, `involvedObject.name=...` |
| `namespaces_list` | `fieldSelector` |
| `nodes_top` / `nodes_stats_summary` | Node metrics/stats |
| `projects_list` | OpenShift projects |

The current release has no MCP tool for listing contexts or targets. Use
`kubectl config get-contexts` for that, then pass the chosen `context` argument to
the MCP tools.

Do **not** call through MCP:

- `resources_get`/`resources_list` with `kind: Secret` — returns Secret data.
- `configuration_view` — returns kubeconfig YAML, including credentials.
- `nodes_log` — returns host/kubelet logs, which may contain sensitive data.
- `pods_exec` — executes arbitrary commands in a pod.
- `pods_delete`, `pods_run`, `resources_create_or_update`, `resources_delete`,
  `resources_scale` with `scale`.

Use `kubectl` for these, with the confirmation and dry-run rules in
[`apply-and-rollouts.md`](apply-and-rollouts.md).

## Multi-cluster

When the kubeconfig exposes multiple contexts, the server adds a `context` argument to
applicable tools. List contexts with `kubectl config get-contexts`, pass `context`
explicitly, and never rely on the ambient current context when more than one cluster is
configured:

```text
kubectl config get-contexts
mcp__kubernetes__pods_list_in_namespace namespace=default context=staging
```

## Default toolsets

`core` and `config` are enabled by default. `helm`, `kiali`, `kubevirt`, `tekton`,
`kcp`, and the observability toolsets are opt-in through TOML `toolsets`. In
particular, Helm operations are **not** available through this MCP row by default; use
the `helm-chart-development` skill or the `helm` CLI.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No `mcp__kubernetes__*` tools | The row is still disabled. Enable it and wait for HMR/connection. |
| Enabling fails | `plugin_manager` needs full access or approval; check the result's `nextStep`. |
| Server exits at startup | `npx` missing, package download failed, or the npm registry is unreachable. Run `npx -y kubernetes-mcp-server@latest --version` in a shell. |
| Tools return authorization errors | RBAC denies the verb/resource. Fix the kubeconfig/ServiceAccount; do not widen to an admin context casually. |
| Secret reads are blocked | RBAC or `denied_resources` is doing its job. Do not work around it. |
| Tool arguments rejected | `resources_*` requires `apiVersion` + `kind`; `pods_list_in_namespace` requires `namespace`; `pods_get`/`pods_log` require `name`. |
| Wrong cluster | `kubectl config get-contexts`, then pass `context` explicitly. |
