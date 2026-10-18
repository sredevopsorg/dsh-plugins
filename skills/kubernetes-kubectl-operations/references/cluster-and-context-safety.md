# Cluster and context safety

Most Kubernetes incidents caused by an agent are target mistakes, not command mistakes:
the right command against the wrong cluster, namespace, or credential. Resolve the
target before anything else.

## 1. Resolve the target

```bash
kubectl config current-context
kubectl config get-contexts
kubectl config view --minify
kubectl config view --minify -o jsonpath='{..namespace}'
kubectl cluster-info
```

Record four values in the working notes: **context name, cluster server, user, namespace**.
If the user did not name a namespace and the context has no default, ask or use an
explicit `-n`; do not assume `default`.

Prefer per-command targeting:

```bash
kubectl --context staging -n payments get pods
```

Avoid `kubectl config use-context` unless the user asked to switch; it mutates global
state for every subsequent command and every other terminal.

## 2. Kubeconfig and `KUBECONFIG`

- `--kubeconfig` wins for one command; `KUBECONFIG` selects one or more files; otherwise
  client-go uses `~/.kube/config`.
- `KUBECONFIG` with multiple paths merges them. Duplicate names are resolved by the
  merge rules, which can silently select a different cluster/user than expected. Check
  `kubectl config view` with the same environment before trusting it.
- The MCP server inherits `KUBECONFIG` through the MCP client environment. Set it in the
  environment that starts DSH, not in an unrelated shell.
- Do not commit kubeconfigs, tokens, or client certificates. Do not paste their contents
  into chat.

## 3. Namespaces

```bash
kubectl get namespaces
kubectl get pods -n <namespace>
kubectl get all -n <namespace>
kubectl get pods -A --field-selector=status.phase!=Running
```

Reads across namespaces (`-A`) are fine. Mutations across namespaces are not: name the
namespace and the object explicitly.

## 4. RBAC and identity

```bash
kubectl auth whoami                       # newer clusters
kubectl auth can-i --list
kubectl auth can-i get pods -n <namespace>
kubectl auth can-i list pods -A
kubectl auth can-i create pods,deployments,services -A
kubectl auth can-i delete pods -A
kubectl auth can-i '*' '*' -n <namespace>
```

- `can-i` answers yes/no; exit status is non-zero for "no", so guard it in scripts.
- `--as` / `--as-group` impersonate another identity only if the current user has
  `impersonate` permission. Use it for diagnosis, not to bypass a denial.
- A `Forbidden` response is information. Do not retry with a broader kubeconfig without
  the user's explicit approval.

## 5. Dry-run semantics

| Form | Contacts the API server? | Validates admission/webhooks? | Use |
|---|---|---|---|
| `--dry-run=client` | No | No | Render/validate locally |
| `--dry-run=server` | Yes | Yes | Validate against the live cluster |
| `kubectl diff -f` | Yes, server-side dry-run | Yes | Show what would change |

Always prefer `kubectl diff -f <manifest>` and `--dry-run=server` before `apply`.
`--dry-run=client` is not a substitute for cluster validation.

`kubectl diff` exits `1` when differences exist and `0` when there are none; don't treat
exit `1` as a failure.

## 6. Secret hygiene

- Never run `kubectl get secret -o yaml`, `-o json`, or a JSONPath that decodes `data`.
- `kubectl describe secret` prints only metadata, but treat the name and annotations as
  sensitive too.
- The Kubernetes MCP server does **not** redact Secret contents. Do not call
  `resources_get`/`resources_list` with `kind: Secret`, and do not call
  `configuration_view` (it returns kubeconfig credentials).
- If a task needs a Secret value, ask the user to retrieve it through their own
  secret-management path. Do not copy it into the transcript.
- `kubectl exec` can read mounted secrets; treat exec as a sensitive operation.

## 7. Destructive-operation checklist

Before any delete, drain, scale-to-zero, or namespace operation:

1. State the exact context, namespace, kind, and name.
2. Show the observed object (`kubectl get ... -o yaml` or `describe`).
3. Check dependencies: owner references, finalizers, PVCs, Services, PDBs, HPA.
4. Preview with `--dry-run=server` where supported.
5. Get explicit user confirmation for that exact object.
6. Prefer `kubectl delete <kind>/<name>` over `delete -f directory/` or label selectors.
7. Verify after the operation and report what disappeared.

Never use `--all`, `-A`, `--force --grace-period=0`, or `kubectl delete namespace` as a
shortcut. A namespace deletion cascades to every namespaced resource in it.

## 8. Node maintenance

```bash
kubectl get nodes -o wide
kubectl describe node <node>
kubectl cordon <node>
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
kubectl uncordon <node>
```

Drain evicts pods and can disrupt workloads. Confirm with the user, check PDBs, and
verify workloads reschedule before uncordoning. `--delete-emptydir-data` destroys
emptyDir data.

## 9. Version skew

```bash
kubectl version
kubectl version --output=json
```

kubectl supports a skew of one minor version from the API server. If the client is
farther off, report it; a newer client may reject old APIs or a newer server may reject
old manifests. The MCP server talks to the API directly, so it is not bound by the
kubectl version.

## 10. MCP context selection

When more than one context is configured, the Kubernetes MCP tools accept a `context`
argument. List contexts with `kubectl config get-contexts`, then pass the intended
context to every call. The server's default context is whatever the kubeconfig marks as
current; never rely on that for multi-cluster work.

If the MCP is enabled, verify its target independently:

```text
mcp__kubernetes__namespaces_list
```

Then compare with `kubectl config current-context`. A mismatch means stop and fix the
kubeconfig before changing anything.
