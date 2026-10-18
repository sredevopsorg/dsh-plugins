---
name: kubernetes-kubectl-operations
description: >-
  Safe Kubernetes operations with kubectl and the optional Kubernetes MCP tools: resolve
  context and namespace, discover APIs, inspect pods, workloads, nodes, events, and logs,
  triage Pending/CrashLoopBackOff/ImagePullBackOff, and review apply, diff, rollout, scale,
  and delete steps before changing a cluster.
whenToUse: >-
  Use when asked to run kubectl, inspect or troubleshoot a Kubernetes workload, read pod
  logs or events, plan or review a manifest change, or when mcp__kubernetes__* tools are
  available and the task needs cluster access.
metadata:
  author: sredevopsorg
  version: "1.0.0"
---

# Kubernetes kubectl operations

Kubernetes work has two paths: **`kubectl`**, which is always available when installed
and configured, and the optional **Kubernetes MCP server**, which exposes structured
Kubernetes tools through `mcp__kubernetes__*`.

Default to `kubectl`. The MCP server is installed by the Architect Dev bundle but is
**disabled by default** and is a full management server when enabled — it is not a
read-only bridge. Treat MCP use as inspection-only unless the user explicitly asks
otherwise, and send mutations through `kubectl` where a diff and confirmation are
possible.

## 0. MCP is opt-in

No Kubernetes MCP process starts at DSH launch. Enable it only when the user asks for
the MCP tools or when their structured output materially helps the task:

1. **Point the MCP at the right kubeconfig.** The Architect Dev row passes
   `KUBERNETES_MCP_KUBECONFIG` (absolute path) to the server as its `KUBECONFIG`
   when set; otherwise the server uses the ambient `KUBECONFIG` or
   `~/.kube/config`. The variable is read when the row activates, so set it in the
   environment that starts DSH. Do not export it in a shell after DSH is already
   running.
2. **Verify the target is read-only.** The server can create, update, delete, exec,
   and run pods if the kubeconfig permits it. Run the preflight against the exact
   file:
   ```bash
   bash scripts/verify-kube-access.sh \
     --kubeconfig "${KUBERNETES_MCP_KUBECONFIG:?set KUBERNETES_MCP_KUBECONFIG first}" \
     --require-read-only
   ```
   If `KUBERNETES_MCP_KUBECONFIG` is unset, check the ambient context instead:
   ```bash
   kubectl config current-context
   kubectl auth can-i --list
   kubectl auth can-i create pods,deployments,services -A
   kubectl auth can-i delete pods -A
   ```
   If writes are allowed, do **not** enable the MCP for exploratory inspection; use
   `kubectl` against the read-only context instead, or ask the user for a read-only
   kubeconfig.
3. **Find the row.** Call `plugin_manager` with `action: list_plugins` and locate the
   row whose id is `mcp-kubernetes` (module `@deepseek-ai/dsh-mcp-client`); note its
   `entryId`.
4. **Enable it.** Call `plugin_manager` with `action: set_plugin`, that `entryId`, and
   `enabled: true`. The call needs full access or approval; the change affects every
   session in the profile.
5. **Use it.** After connection, tools appear as `mcp__kubernetes__*`.
6. **Disable it when done** with `set_plugin` and `enabled: false`, unless the user
   wants it left on.

If `plugin_manager` is unavailable, ask the user to enable the `mcp-kubernetes` row in
the Web **Plugins** page. If the row is unavailable, the MCP feature is not part of the
installed bundle.

`references/mcp-setup-and-safety.md` has the full activation, read-only kubeconfig, and
hard read-only TOML guidance.

## 1. Choose the path

| Need | Use |
|---|---|
| List/get pods, workloads, resources, events, namespaces, node metrics | MCP (when enabled) or `kubectl get` |
| Pod logs, previous-container logs | MCP `pods_log` or `kubectl logs` |
| `describe`, JSONPath/custom columns, YAML inspection | `kubectl` |
| Exec, port-forward, `kubectl debug` | `kubectl` only |
| Apply, diff, patch, scale, rollout, delete, drain | `kubectl` (and `helm` for releases) |
| Helm releases | `helm-chart-development` skill |

The MCP server's default toolsets are `core` and `config`. Helm tools are **not**
enabled by default; use `helm` for releases.

## 2. Non-negotiables

- **Know the target first.** Establish context, cluster, user, and namespace before the
  first command. Prefer `--context` and `-n` on each command over globally switching
  context.
- **Read-only by default.** MCP use is inspection-only. Mutate only when the user asked
  for the change, and use `kubectl` with `--dry-run=server` and `kubectl diff` first.
- **No broad destructive commands.** Never delete a namespace, PVC, PV, CRD, or
  cluster-scoped resource, and never use `--all`/`-A` with a mutation, without naming
  the exact target and getting explicit confirmation.
- **Secrets stay secret.** Never print Secret `data`/`stringData`, kubeconfig contents,
  or node system logs. The new MCP server does not redact Secrets; RBAC must.
- **No casual exec.** `kubectl exec` and MCP `pods_exec` run arbitrary commands and can
  mutate state. Use only on explicit request.
- **Bound the output.** Use `--tail`, `--since`, selectors, `-o wide`, and JSONPath
  instead of dumping whole manifests or multi-thousand-line logs.
- **Do not force stuck resources** with `--force --grace-period=0` unless the user asks
  and the cause is understood.

## 3. The loop

```
1. Verify:   context, namespace, user, API reachability, read/write permission
2. Discover: api-resources, explain, selectors
3. Inspect:  get / describe / logs / events (MCP read tools when enabled)
4. Diagnose: compare desired vs observed state and correlate events
5. Change:   diff -> dry-run -> apply/rollout/scale with confirmation -> verify
6. Report:   context, evidence, conclusion, change, rollback
```

## 4. Command map

```bash
# Context and namespace
kubectl config current-context
kubectl config get-contexts
kubectl config view --minify
kubectl get namespaces
kubectl config view --minify -o jsonpath='{..namespace}'

# Discovery
kubectl api-resources
kubectl api-resources --namespaced
kubectl explain deployment.spec.strategy
kubectl get all -n <namespace>

# Inspection
kubectl get pods -n <namespace> -o wide
kubectl get pods -A --field-selector=status.phase!=Running
kubectl describe pod <pod> -n <namespace>
kubectl get pod <pod> -n <namespace> -o yaml
kubectl get deploy,rs,pods -n <namespace> -o wide
kubectl logs <pod> -n <namespace> --tail=200
kubectl logs <pod> -n <namespace> --previous
kubectl logs -f deploy/<deploy> -n <namespace> --all-containers
kubectl get events -n <namespace> --sort-by=.lastTimestamp
kubectl get events -A --field-selector type=Warning

# Interactive
kubectl exec -it <pod> -n <namespace> -- sh
kubectl port-forward svc/<service> 8080:80 -n <namespace>
kubectl debug pod/<pod> -n <namespace> -it --image=busybox
kubectl debug node/<node> -it --image=busybox

# Changes (confirm first)
kubectl diff -f manifest.yaml
kubectl apply -f manifest.yaml --dry-run=server
kubectl apply -f manifest.yaml
kubectl rollout status deploy/<deploy> -n <namespace>
kubectl rollout history deploy/<deploy> -n <namespace>
kubectl rollout undo deploy/<deploy> -n <namespace>
kubectl scale deploy/<deploy> --replicas=3 -n <namespace>
kubectl delete -f manifest.yaml --dry-run=server
```

## 5. MCP tool map

Names assume `serverName: kubernetes`; a re-enabled row with another name changes the
prefix. When multiple contexts exist, the server adds a `context` argument — list
contexts with `kubectl config get-contexts` and pass it explicitly.

| MCP tool | Use | Key arguments |
|---|---|---|
| `pods_list` | Pods across namespaces | `labelSelector`, `fieldSelector` |
| `pods_list_in_namespace` | Pods in one namespace | `namespace`, selectors |
| `pods_get` | One pod | `namespace`, `name` |
| `pods_log` | Pod logs | `namespace`, `name`, `container`, `tail`, `previous` |
| `pods_top` | Pod metrics | `all_namespaces`, `namespace`, `name`, `label_selector` |
| `resources_list` | Any listable kind | `apiVersion`, `kind`, `namespace`, selectors |
| `resources_get` | One resource | `apiVersion`, `kind`, `namespace`, `name` |
| `events_list` | Events | `namespace`, `fieldSelector` |
| `namespaces_list` | Namespaces | `fieldSelector` |
| `nodes_top` | Node metrics | `name`, `label_selector` |
| `nodes_stats_summary` | Node kubelet stats | `name` |
| `projects_list` | OpenShift projects | — |

Examples: `apps/v1` + `Deployment`, `networking.k8s.io/v1` + `Ingress`, `v1` +
`Service`/`ConfigMap`/`Node`.

**Never call via MCP:** `resources_get`/`resources_list` with `kind: Secret`,
`configuration_view` (returns kubeconfig credentials), `nodes_log` (host logs),
`pods_exec` (arbitrary commands), `pods_delete`, `pods_run`,
`resources_create_or_update`, `resources_delete`, or `resources_scale` with a `scale`
value. Use `kubectl` for those with explicit confirmation.

## 6. Triage matrix

| Symptom | First evidence | Likely cause |
|---|---|---|
| `Pending` | `kubectl describe pod`, scheduler events | Unschedulable: requests/limits, taints, affinity, PVC unbound |
| `ImagePullBackOff` / `ErrImagePull` | `kubectl describe pod` events | Wrong image/tag, private registry, missing `imagePullSecrets` |
| `CrashLoopBackOff` | `kubectl logs --previous`, `describe` | App startup failure, bad config/secret, failed probe |
| `OOMKilled` | `lastState.terminated.reason`, `kubectl top pod` | Memory limit too low or leak |
| `Evicted` | `kubectl get pods --field-selector=status.phase=Failed` | Node disk/memory pressure |
| `FailedMount` | `kubectl describe pod` events | Missing ConfigMap/Secret, PVC, CSI driver |
| Service has no endpoints | `kubectl get endpoints`, `get pods --show-labels` | Selector mismatch or pods not ready |
| Ingress 404/502 | `kubectl describe ingress`, controller logs | Host/path/backend mismatch, TLS, controller |
| DNS failures | `kubectl exec -- nslookup`, CoreDNS logs | Service/network policy/CoreDNS |
| PVC `Pending` | `kubectl describe pvc`, StorageClass | No provisioner, access mode, zone/volume binding |
| Rollout stuck | `rollout status`, `describe deploy`, ReplicaSet events | Image pull, quota, readiness, immutable field |
| `Forbidden` | `kubectl auth can-i ...` | RBAC; do not retry with broader credentials |
| Node `NotReady` | `describe node`, node conditions | Kubelet/runtime/network/disk pressure |

Details and per-symptom command sequences are in
[`references/inspect-and-debug.md`](references/inspect-and-debug.md).

## 7. Reporting

State the context and namespace used, the observed evidence (bounded), the conclusion,
the exact change applied, and how to roll it back. If the MCP was enabled only for the
task, disable it before finishing.

## References

- [`references/mcp-setup-and-safety.md`](references/mcp-setup-and-safety.md) — MCP
  activation, read-only kubeconfig, hard read-only TOML, sensitive tools.
- [`references/cluster-and-context-safety.md`](references/cluster-and-context-safety.md)
  — contexts, RBAC, dry-run semantics, destructive-operation checklist.
- [`references/inspect-and-debug.md`](references/inspect-and-debug.md) — discovery,
  bounded output, logs/events, symptom playbooks.
- [`references/apply-and-rollouts.md`](references/apply-and-rollouts.md) — apply/diff,
  rollouts, scale, delete, jobs, node maintenance, rollback.
- [`scripts/verify-kube-access.sh`](scripts/verify-kube-access.sh) — read-only access
  preflight and write-permission warning.
