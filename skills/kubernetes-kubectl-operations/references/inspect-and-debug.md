# Inspect and debug

Work from the outside in: does the object exist, is it scheduled, is the container
running, is it ready, is it reachable, and is it correct? Stop at the first "no"; later
symptoms are usually consequences.

## 1. Discovery

```bash
kubectl api-resources
kubectl api-resources --namespaced
kubectl api-versions
kubectl explain deployment
kubectl explain deployment.spec.strategy
kubectl explain pod.spec.containers --recursive | head -80
```

`api-resources` is the source of truth for kind, group, version, and whether a resource
is namespaced. For CRDs, use it before guessing an `apiVersion`/`kind` pair.

## 2. Bounded inspection

```bash
kubectl get pods -n <namespace> -o wide
kubectl get pods -n <namespace> -w
kubectl get pods -n <namespace> --show-labels
kubectl get pods -n <namespace> --sort-by=.status.startTime
kubectl get pods -n <namespace> -o custom-columns=\
NAME:.metadata.name,PHASE:.status.phase,RESTARTS:.status.containerStatuses[0].restartCount,NODE:.spec.nodeName
kubectl get pods -n <namespace> -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}'
kubectl get pod <pod> -n <namespace> -o yaml
kubectl describe pod <pod> -n <namespace>
```

Rules of thumb:

- `get -o wide` first; `describe` for events and conditions; `-o yaml` only when the
  exact fields matter.
- Filter with `--field-selector` and `-l`/`--selector` before increasing output.
- Never dump a whole namespace's YAML. Select the object and the field.

## 3. Logs

```bash
kubectl logs <pod> -n <namespace> --tail=200
kubectl logs <pod> -n <namespace> --since=15m
kubectl logs <pod> -n <namespace> --timestamps --tail=100
kubectl logs <pod> -n <namespace> --previous
kubectl logs <pod> -n <namespace> -c <container>
kubectl logs <pod> -n <namespace> --all-containers=true --tail=100
kubectl logs -f deploy/<deploy> -n <namespace> --all-containers
kubectl logs -l app=<app> -n <namespace> --max-log-requests=10 --tail=100
```

- `--previous` is the first thing to read for a CrashLoopBackOff; the current container
  may have produced no logs yet.
- `--since` and `--tail` keep output bounded. Avoid `kubectl logs` with no limit on a
  long-running pod.
- Init-container logs use `-c <init-container>`. Sidecars are separate containers.
- Logs end at container restart; use the previous container and events to cover the gap.

## 4. Events

```bash
kubectl get events -n <namespace> --sort-by=.lastTimestamp
kubectl get events -n <namespace> --field-selector type=Warning --sort-by=.lastTimestamp
kubectl get events -A --field-selector involvedObject.name=<pod>
kubectl describe pod <pod> -n <namespace>   # includes the same events
```

Events are short-lived and may be aggregated (`count`). Read the newest `Warning`
events first; they usually name the failing component (scheduler, kubelet, image pull,
probe, volume).

## 5. Describe vs get

| Need | Command |
|---|---|
| Conditions, events, container states, mounted volumes | `kubectl describe` |
| Exact spec/status fields, owner refs, annotations | `kubectl get -o yaml` |
| Tabular overview | `kubectl get -o wide` |
| One field | `kubectl get -o jsonpath` |

`describe` omits fields; `get -o yaml` omits events. Use both when the cause is unclear.

## 6. Workloads

```bash
kubectl get deploy,rs,pods -n <namespace> -o wide
kubectl rollout status deploy/<deploy> -n <namespace>
kubectl rollout history deploy/<deploy> -n <namespace>
kubectl describe deploy <deploy> -n <namespace>
kubectl describe rs <replicaset> -n <namespace>
kubectl get statefulset <name> -n <namespace> -o wide
kubectl get daemonset <name> -n <namespace> -o wide
kubectl get jobs -n <namespace>
kubectl get cronjobs -n <namespace>
kubectl describe job <job> -n <namespace>
```

A Deployment owns ReplicaSets, which own Pods. If Pods are missing, inspect the
ReplicaSet events; if the ReplicaSet is missing, inspect the Deployment status and
conditions. For StatefulSets, check `podManagementPolicy`, PVCs, and ordinal Pods.
For DaemonSets, check node selectors/taints and the desired/ready counts.

## 7. Networking

```bash
kubectl get svc,endpoints,endpointslices -n <namespace>
kubectl describe svc <service> -n <namespace>
kubectl get pods -n <namespace> --show-labels
kubectl get ingress -n <namespace>
kubectl describe ingress <ingress> -n <namespace>
kubectl get networkpolicy -n <namespace>
kubectl exec -it <pod> -n <namespace> -- nslookup <service>
kubectl exec -it <pod> -n <namespace> -- wget -qO- http://<service>:<port>/
```

- A Service with no endpoints usually means the selector does not match or the Pods are
  not Ready. Compare `spec.selector` with Pod labels and readiness.
- `Endpoints`/`EndpointSlice` reflect readiness, not just existence.
- Ingress problems split into controller (events/logs), TLS, host/path rules, and
  backend Service/port. Check the controller's logs in its namespace.
- NetworkPolicy denials look like timeouts, not connection refused. Test from a Pod in
  the same namespace and from the client namespace.

## 8. Storage

```bash
kubectl get pvc,pv -n <namespace>
kubectl describe pvc <pvc> -n <namespace>
kubectl get storageclass
kubectl get events -n <namespace> --field-selector reason=ProvisioningFailed
```

PVC `Pending` usually means no provisioner, an unsupported access mode, a
volume-binding mode/zone mismatch, or a missing StorageClass. Read the PVC events before
changing anything.

## 9. Nodes and capacity

```bash
kubectl get nodes -o wide
kubectl describe node <node>
kubectl top nodes
kubectl top pods -n <namespace>
kubectl get pods -A --field-selector spec.nodeName=<node>
```

`kubectl top` needs Metrics Server. Node `MemoryPressure`/`DiskPressure`/`PIDPressure`
conditions explain evictions and scheduling failures. Check taints and allocatable
resources.

## 10. Exec, port-forward, and debug

```bash
kubectl exec -it <pod> -n <namespace> -- sh
kubectl exec <pod> -n <namespace> -- <command>
kubectl port-forward svc/<service> 8080:80 -n <namespace>
kubectl debug pod/<pod> -n <namespace> -it --image=busybox --target=<container>
kubectl debug node/<node> -it --image=busybox
kubectl debug -it <pod> --image=busybox --copy-to=<debug-pod>
```

- Treat `exec` as a mutation: it can change files, kill processes, or read secrets.
- `port-forward` is local-only and dies with the command; it is safe for inspection but
  can bypass network policy from your machine.
- `kubectl debug` with `--copy-to` creates a new Pod; clean it up.
- Without `kubectl debug`, use an ephemeral container on newer clusters or a
  `kubectl run` toolbox Pod with an explicit cleanup step.

## 11. Symptom playbooks

### Pending

```bash
kubectl describe pod <pod> -n <namespace>
kubectl get events -n <namespace> --field-selector involvedObject.name=<pod>
kubectl describe node <candidate-node>
```

Look for `FailedScheduling` messages: insufficient CPU/memory, taints, affinity,
topology spread, PVC unbound, or no nodes matching the selector.

### ImagePullBackOff / ErrImagePull

```bash
kubectl describe pod <pod> -n <namespace>
kubectl get secret -n <namespace>   # names only; do not print data
```

Check the exact image reference and tag, registry credentials (`imagePullSecrets`),
network policy to the registry, and whether the image exists for the node architecture.

### CrashLoopBackOff

```bash
kubectl logs <pod> -n <namespace> --previous --tail=200
kubectl describe pod <pod> -n <namespace>
kubectl get pod <pod> -n <namespace> -o jsonpath='{.status.containerStatuses[*].lastState}'
```

Common causes: missing env/config/secret, failed command, permission errors, failed
startup/liveness probes, or an application crash. A probe failure with a running process
often means the probe path/port/timeout is wrong.

### OOMKilled

```bash
kubectl get pod <pod> -n <namespace> -o jsonpath='{.status.containerStatuses[*].lastState.terminated.reason}'
kubectl top pod <pod> -n <namespace> --containers
kubectl describe pod <pod> -n <namespace>
```

The container exceeded its memory limit. Check requests/limits, heap settings, and
sidecar usage before raising the limit.

### Evicted

```bash
kubectl get pods -A --field-selector=status.phase=Failed
kubectl describe pod <pod> -n <namespace>
kubectl describe node <node>
```

Node pressure or ephemeral-storage exhaustion. Fix the node condition, then clean up
Failed pods after confirming they are not needed.

### FailedMount / FailedAttachVolume

```bash
kubectl describe pod <pod> -n <namespace>
kubectl get events -n <namespace> --field-selector involvedObject.name=<pod>
kubectl get pvc -n <namespace>
```

Missing ConfigMap/Secret, unbound PVC, multi-attach, CSI driver failure, or a zone
mismatch. Check the volume and the node.

### Service has no endpoints

```bash
kubectl get svc <service> -n <namespace> -o yaml
kubectl get pods -n <namespace> --show-labels
kubectl get endpoints <service> -n <namespace>
kubectl get endpointslices -n <namespace> -l kubernetes.io/service-name=<service>
```

Selector mismatch, no Ready Pods, or the wrong target port. Readiness probes are the
usual reason a running Pod is not an endpoint.

### Ingress 404/502/503

```bash
kubectl describe ingress <ingress> -n <namespace>
kubectl get svc <backend> -n <namespace>
kubectl get pods -n <ingress-controller-namespace>
kubectl logs -n <ingress-controller-namespace> <controller-pod> --tail=200
```

Check host/path rules, TLS secret, backend service/port, and controller logs. A 502
usually means the controller reached the Service but the upstream failed; a 404 often
means no matching host/path.

### DNS failures

```bash
kubectl exec -it <pod> -n <namespace> -- cat /etc/resolv.conf
kubectl exec -it <pod> -n <namespace> -- nslookup <service>.<namespace>.svc.cluster.local
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=100
```

Check the CoreDNS Service/endpoints, NetworkPolicy, and the Pod's `dnsPolicy`/
`dnsConfig`.

### Rollout stuck

```bash
kubectl rollout status deploy/<deploy> -n <namespace>
kubectl describe deploy <deploy> -n <namespace>
kubectl get rs -n <namespace> -l app=<app>
kubectl describe rs <new-replicaset> -n <namespace>
```

Image pull, quota, readiness, PodDisruptionBudget, or an immutable field. Do not
`rollout undo` until you know whether the new ReplicaSet is failing or just slow.

### Forbidden

```bash
kubectl auth can-i <verb> <resource> -n <namespace>
kubectl auth can-i --list -n <namespace>
```

Report the exact verb/resource/namespace. Do not switch to an admin kubeconfig to "make
it work" without the user's explicit approval.

## 12. Evidence checklist

Before proposing a fix, collect:

- context, namespace, object kind/name, and owning workload;
- Pod phase, container states, restart counts, and last termination reason;
- the newest Warning events;
- relevant logs (bounded, previous if restarted);
- resource requests/limits and current usage;
- Service selector/endpoints and Ingress backend if networking is involved;
- PVC/StorageClass state if storage is involved.

## 13. MCP equivalents

When the Kubernetes MCP is enabled and pointed at a read-only kubeconfig:

| Need | MCP tool |
|---|---|
| Namespaces | `namespaces_list` |
| Pods | `pods_list`, `pods_list_in_namespace`, `pods_get` |
| Logs | `pods_log` |
| Metrics | `pods_top`, `nodes_top`, `nodes_stats_summary` |
| Any resource | `resources_list`, `resources_get` |
| Events | `events_list` |

Contexts are not an MCP tool in the current release; use `kubectl config get-contexts`
and pass the `context` argument to MCP calls.

The MCP has no `describe`. Use `kubectl describe` for conditions, events, and volume
mounts, or combine `pods_get`/`resources_get` with `events_list`.
