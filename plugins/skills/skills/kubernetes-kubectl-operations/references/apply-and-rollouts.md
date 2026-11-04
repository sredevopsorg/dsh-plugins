# Apply and rollouts

A change is a reviewed diff, a validated manifest, a controlled rollout, and a known
rollback. Skipping any of those turns a small mistake into an outage.

## 1. Before any mutation

1. Confirm context, namespace, and object.
2. Show the live object and the intended manifest.
3. Run `kubectl diff -f <manifest>` and read it.
4. Run `kubectl apply -f <manifest> --dry-run=server` when admission/webhooks matter.
5. Get explicit confirmation for the exact change.
6. Apply and watch the rollout status.
7. Verify the user-visible behavior and report the rollback command.

Never apply a manifest you have not diffed. Never apply a directory of mixed
environments (`kubectl apply -f ./k8s/`) without checking which files it contains.

## 2. Client-side vs server-side apply

```bash
kubectl apply -f manifest.yaml                    # client-side apply
kubectl apply --server-side -f manifest.yaml      # server-side apply
kubectl apply --server-side --field-manager=<name> -f manifest.yaml
kubectl diff -f manifest.yaml
kubectl diff -f manifest.yaml --server-side
```

- **Client-side apply** stores the last applied manifest in the
  `kubectl.kubernetes.io/last-applied-configuration` annotation and uses a strategic
  merge patch. It can fight controllers and other writers.
- **Server-side apply** tracks field ownership by manager. It is the better default for
  new work, especially with CRDs and multiple controllers.
- When switching apply modes, expect field-manager conflicts. Read the conflict, do not
  blanket-force it. `--force-conflicts` takes ownership from another manager and can
  overwrite controller-set fields.
- `kubectl diff` requires server-side dry-run and can be slow on large objects.

## 3. Pruning

`kubectl apply --prune` deletes objects that were previously managed but are absent from
the current input. This is a common way to delete production resources accidentally.

- Prefer GitOps (Argo CD/Flux) or Helm for lifecycle management.
- If you must prune, scope it with an explicit label selector and review the dry-run:
  ```bash
  kubectl apply -f manifest.yaml --prune -l app=<app> --dry-run=server
  ```
- Never prune a namespace or a directory containing unrelated resources.

## 4. Rollouts

```bash
kubectl rollout status deploy/<deploy> -n <namespace>
kubectl rollout status deploy/<deploy> -n <namespace> --timeout=5m
kubectl rollout history deploy/<deploy> -n <namespace>
kubectl rollout history deploy/<deploy> -n <namespace> --revision=<n>
kubectl rollout undo deploy/<deploy> -n <namespace>
kubectl rollout undo deploy/<deploy> -n <namespace> --to-revision=<n>
kubectl rollout pause deploy/<deploy> -n <namespace>
kubectl rollout resume deploy/<deploy> -n <namespace>
kubectl rollout restart deploy/<deploy> -n <namespace>
```

- `rollout status` blocks until the new ReplicaSet is complete or the timeout expires.
- `rollout undo` uses the previous ReplicaSet template; it does not revert ConfigMap,
  Secret, or external state changes.
- `rollout restart` adds a `restartedAt` annotation and triggers a new ReplicaSet. It is
  a mutation; confirm it.
- For StatefulSets and DaemonSets, check the strategy and partition settings before
  assuming a rollout is safe.

## 5. Scaling and autoscaling

```bash
kubectl scale deploy/<deploy> --replicas=3 -n <namespace>
kubectl scale statefulset/<name> --replicas=3 -n <namespace>
kubectl get hpa -n <namespace>
kubectl describe hpa <hpa> -n <namespace>
```

- Scaling to zero stops the workload; confirm with the user.
- If an HPA owns `spec.replicas`, a manual scale may be overwritten. Disable/pause the
  HPA only with explicit approval.
- Check PodDisruptionBudgets before scaling down or draining.

## 6. Patching

```bash
kubectl patch deploy <deploy> -n <namespace> --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"app","image":"repo/app:1.2.3"}]}}}}'
kubectl patch deploy <deploy> -n <namespace> --type=merge -p '{"spec":{"replicas":3}}'
kubectl patch deploy <deploy> -n <namespace> --type=json -p '[{"op":"replace","path":"/spec/replicas","value":3}]'
kubectl set image deploy/<deploy> <container>=<image> -n <namespace>
kubectl annotate ... --overwrite
kubectl label ... --overwrite
```

- Strategic merge is Kubernetes-aware (lists merge by key); JSON merge replaces lists
  and can drop entries; JSON patch is positional and brittle.
- `kubectl set image` and `annotate` trigger a rollout. Confirm before using them.
- Prefer editing the source manifest and applying it over ad-hoc patches, so the desired
  state stays recorded.

## 7. Deletes

```bash
kubectl delete pod <pod> -n <namespace>
kubectl delete deploy <deploy> -n <namespace>
kubectl delete -f manifest.yaml --dry-run=server
kubectl delete -f manifest.yaml
```

- Deleting a Pod owned by a Deployment/StatefulSet/DaemonSet causes recreation. If the
  goal is to stop the workload, scale/delete the owner instead.
- Deleting a Deployment deletes its ReplicaSets and Pods by cascading. Confirm.
- Finalizers can leave an object `Terminating`. Diagnose the finalizer before removing
  it.
- `--force --grace-period=0` is for a truly stuck object and risks inconsistency. Only
  with explicit user approval.
- Never delete a namespace, PVC, PV, CRD, or cluster-scoped resource as a shortcut.

## 8. Jobs and CronJobs

```bash
kubectl get jobs -n <namespace>
kubectl get cronjobs -n <namespace>
kubectl create job --from=cronjob/<cronjob> <manual-name> -n <namespace>
kubectl logs job/<job> -n <namespace>
kubectl delete job <job> -n <namespace>
kubectl patch cronjob <cronjob> -n <namespace> -p '{"spec":{"suspend":true}}'
```

- A manual Job from a CronJob is a new object; clean it up.
- Suspending a CronJob stops future runs but does not stop running Jobs.
- Delete completed Jobs only after confirming their logs are no longer needed.

## 9. Node maintenance

```bash
kubectl cordon <node>
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
kubectl uncordon <node>
```

Drain evicts workloads. Check PDBs, local storage, and whether the remaining nodes can
schedule the evicted Pods. `--delete-emptydir-data` destroys emptyDir contents.

## 10. Helm boundary

The Kubernetes MCP row does not enable the Helm toolset. Use Helm for releases:

```bash
helm list -n <namespace>
helm status <release> -n <namespace>
helm diff upgrade <release> <chart> -n <namespace>   # requires the diff plugin
helm upgrade --install <release> <chart> -n <namespace> --dry-run=server
```

Do not `kubectl apply` rendered Helm templates over a release; Helm's release metadata
and ownership annotations will diverge. See the `helm-chart-development` skill.

## 11. MCP mutation caveat

The Kubernetes MCP server's default `core` toolset includes
`resources_create_or_update` (server-side apply), `resources_delete`, `pods_delete`,
`pods_run`, `resources_scale`, and `pods_exec`. The skill treats these as off-limits:
use `kubectl` so the diff, dry-run, and confirmation are explicit. If the MCP is
enabled against a read-only kubeconfig, these tools fail with RBAC errors, which is the
intended hard boundary.

## 12. Rollback checklist

Before applying, know:

- the previous image/tag or ReplicaSet revision (`kubectl rollout history`);
- the previous manifest (Git, Helm revision, or saved YAML);
- whether the change is reversible (schema changes, PVC deletion, CRD removal are not);
- the expected user-visible behavior and how to verify it;
- who to notify if the rollout fails.

After applying:

```bash
kubectl rollout status deploy/<deploy> -n <namespace>
kubectl get pods -n <namespace> -l app=<app> -o wide
kubectl logs deploy/<deploy> -n <namespace> --tail=100
kubectl get events -n <namespace> --sort-by=.lastTimestamp
```

If it fails, roll back first and diagnose second — unless the failure is data-destructive
and rolling back would make it worse. State the trade-off.
