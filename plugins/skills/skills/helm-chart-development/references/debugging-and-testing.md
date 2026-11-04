# Debugging and testing

## The verification ladder

Climb it in order. Each rung is slower and needs more than the one above it, so do
not skip to `helm install` to "see if it works".

### 1. `helm lint` — static checks, no cluster

```bash
helm lint ./mychart                      # errors + warnings
helm lint ./mychart --strict             # warnings become failures
helm lint ./mychart --with-subcharts     # also lint dependencies
helm lint ./mychart -f prod.yaml --set image.tag=1.2.3
helm lint ./mychart --kube-version 1.29.0
```

`helm lint` validates `Chart.yaml`, renders every template with a set of test
values, and checks conventions (chart name, icon, dependency status, values
schema). It does **not** know about your real values or your cluster.

### 2. `helm template` — render, no cluster

```bash
helm template rel ./mychart                                   # defaults
helm template rel ./mychart -f prod.yaml                      # a real config
helm template rel ./mychart --set image.tag=1.2.3              # one override
helm template rel ./mychart --set-json 'ingress.hosts=[{"host":"a.example.com"}]'
helm template rel ./mychart --api-versions autoscaling/v2     # fake capabilities
helm template rel ./mychart --kube-version 1.29.0
helm template rel ./mychart --is-upgrade                       # .Release.IsUpgrade
helm template rel ./mychart --include-crds                     # include crds/
helm template rel ./mychart --output-dir ./out                # one file per resource
helm template rel ./mychart --show-only templates/deploy.yaml # diff one resource
helm template rel ./mychart --debug                            # diagnostics
```

This is where 95% of template work happens. It catches every template error,
every YAML parse error, and every schema violation — with no cluster.

**It does not catch**: a `.Values.x` typo that no `values.yaml` declares (renders
empty, no error), values declared but never used, duplicate resources in the
output, or names over 63 characters.

### 3. `verify-chart.mjs` — the checks Helm omits

```bash
node scripts/verify-chart.mjs ./mychart
node scripts/verify-chart.mjs ./mychart -f prod.yaml --set image.tag=1.2.3
```

### 4. `--dry-run` against a cluster — needs a cluster

```bash
helm install rel ./mychart --dry-run=client   # renders + checks for conflicts
helm install rel ./mychart --dry-run=server   # validates against the live API server
helm upgrade rel ./mychart --dry-run=server
```

`--dry-run=server` is the only way to exercise `lookup` and to validate manifests
against the real API (including CRDs that must exist first).

### 5. Real install and tests

```bash
helm install rel ./mychart -f prod.yaml --atomic
helm test rel ./mychart                      # runs templates/tests/ (test hooks)
helm template rel ./mychart | kubectl apply --dry-run=client -f -
kubectl get all -l app.kubernetes.io/instance=rel
helm upgrade rel ./mychart --install
helm rollback rel 1
helm uninstall rel
```

## Test hooks

`helm test` runs any resource annotated `"helm.sh/hook": test`. The
`templates/tests/` directory is not special to Helm, but it keeps the convention
visible and lets `.helmignore` drop tests from a published package.

```yaml
{{- define "mychart.testConnection" -}}
apiVersion: v1
kind: Pod
metadata:
  name: "{{ include "mychart.fullname" . }}-test-connection"
  annotations:
    "helm.sh/hook": test
spec:
  restartPolicy: Never
  containers:
    - name: wget
      image: busybox:1.36
      command: ['wget']
      args: ["{{ include "mychart.fullname" . }}:{{ .Values.service.port }}"]
{{- end }}
```

## CI wiring

```bash
set -euo pipefail
helm lint ./mychart --strict
helm template rel ./mychart -f ci/values.yaml > /tmp/rendered.yaml
node scripts/verify-chart.mjs ./mychart
helm package ./mychart --destination /tmp
tar -tzf /tmp/mychart-*.tgz            # eyeball what actually ships
```

Render at least two configurations — the defaults and a realistic override —
because a chart that only renders with defaults is only half tested.

## Debugging techniques

### See the generated text when the YAML will not parse

A parse error hides the output that caused it. Comment out the directive: YAML
comments survive rendering, template comments do not.

```yaml
apiVersion: v2
# This may cause problems if the value is over 100Gi
# memory: {{ required "maxMem must be set" .Values.maxMem | quote }}
```

Rendering that shows `memory: "  "`, or omits the line, without a parse error.

The inverse trap: a `#` YAML comment **still evaluates the directives inside it**
when those directives call `required` or `fail`. To truly disable code, wrap it in
a template comment:

```yaml
{{- /*
# memory: {{ required "maxMem must be set" .Values.maxMem | quote }}
*/ -}}
```

### Isolate the resource

```bash
helm template rel ./mychart --show-only templates/service.yaml
helm template rel ./mychart --output-dir ./out   # then inspect ./out/<chart>/templates/*.yaml
```

### Inspect one value's type

```yaml
{{ printf "type=%T kind=%v value=%v" .Values.foo (kindOf .Values.foo) .Values.foo }}
```

Common surprises: `--set` makes strings unless the target looks numeric/bool;
`resources: {}` is empty and therefore falsy; a YAML `1.0` is a float; `1234e10`
is a number.

### Bisect a broken chart

```bash
mv templates/service.yaml /tmp/ && helm template rel ./mychart
```

Remove templates until the error disappears. `helm template --debug` prints the
chart path and computed values, which is often enough on its own.

### Debug `lookup`

`lookup` returning empty is ambiguous. `helm install --debug` logs the reason:

- `lookup: resource not found` — the specific object is absent (single-object form)
- `lookup: resource list not found` — nothing matched (list form)

Then check: does the object exist, does RBAC allow reading it, are you on
`--dry-run=client` (which never reaches the cluster), are apiVersion/kind/
namespace correct.

## Error triage

### Rendering errors

| Message | Cause | Fix |
|---|---|---|
| `YAML parse error on <file>: error converting YAML to JSON: yaml: line N: did not find expected key` | Stray blank line from an unchomped control block, or an unquoted value containing `:`/newline | `{{-` / `-}}`; `\| quote` |
| `YAML parse error … mapping values are not allowed in this context` | Duplicate key, or a value spliced at the wrong indent | Look at the reported line in the *rendered* output |
| `nil pointer evaluating interface {}.foo` | `.Values.a.b` where `a` is absent | `default`, `required`, `with`, or `dig` |
| `can't evaluate field X in type interface {}` | Wrong key name, or a value is a scalar not a map | Check spelling and `values.yaml` |
| `error calling include: …` | A `define` is missing or misspelled | Every `include` needs a matching `define` in the chart or a dependency |
| `template: no such template` | Same | |
| `function "X" not defined` | Sprig function misspelled, or a Helm-3-only function | Check the name in the function reference |
| `error parsing {{ ... }}: unexpected …` | A syntax error in the directive | Watch the `{{- 3 }}` vs `{{-3 }}` dash rule |

### Validation errors

| Message | Cause | Fix |
|---|---|---|
| `unknown object type "nil" in <Kind>.metadata.labels.<key>` | A `define` got no scope, or an empty value was interpolated unquoted | `include "…" . \| nindent N`; quote the label |
| `ValidationError(<Kind>): unknown field "x"` | An included block landed at the wrong nesting level | Correct the `nindent` depth |
| `unable to build kubernetes objects from release manifest` | Umbrella — the specific error is above it | Read the **first** error in the output |

### Packaging and metadata errors

| Message | Cause | Fix |
|---|---|---|
| `found in Chart.yaml, but missing in charts/ directory: X` | Dependency declared but not vendored | `helm dependency build ./mychart` |
| `values don't meet the specifications of the schema(s) in the following chart(s)` | `values.schema.json` rejects the merged values | The schema sees final `.Values` including `--set`; `--skip-schema-validation` to confirm |
| `chart requires kubeVersion: … which is incompatible with Kubernetes vX` | Constraint too narrow | Widen it, or render with `--kube-version` |
| `chart metadata (icon) is missing` | INFO, not an error | Add `icon:` to `Chart.yaml` |
| `cannot overwrite existing file` / duplicate release | Name already in use | `helm upgrade` instead, or `helm uninstall` |
| `helm.sh/hook` resource never deleted | No delete policy | Add `helm.sh/hook-delete-policy` |

## Things that pass locally and fail in a cluster

- `lookup` is empty offline — the value-dependent branch never renders.
- `.Capabilities.APIVersions` is guessed offline; pass `--api-versions` to test
  the other branch, or use `--dry-run=server`.
- CRDs in `crds/` are skipped by `helm template` unless `--include-crds`.
- RBAC rules that reference a ServiceAccount created in the same release work
  only if both objects land in the same apply.
- Namespaces, quotas, network policies and admission webhooks cannot be exercised
  by rendering at all.
- `NOTES.txt` is never shown by `helm template`.
- Server-side apply is the Helm 4 default on **install**; upgrades latch to the
  release's previous apply method. A chart relying on client-side apply
  semantics may behave differently on Helm 4.

## Helm 3 vs Helm 4

Charts written for Helm 3 render unchanged on Helm 4. The differences that touch
chart authors:

- **Server-side apply** is the default for new installs in Helm 4. Releases
  created by Helm 3 keep client-side apply on upgrade; override with
  `--server-side`.
- `helm create` scaffolds an additional `httproute.yaml` (Gateway API).
- `helm template --hide-notes` and `--render-subchart-notes` are deprecated no-ops.
- `--atomic` → `--rollback-on-failure`, `--force` → `--force-replace` (old names
  still work with a warning).
- Post-renderers are plugins; a bare executable path no longer works.
- `helm registry login` takes a domain only, not a full URL.
- Experimental Charts v3 (`HELM_EXPERIMENTAL_CHART_V3=1`,
  `helm create --chart-api-version=v3`) — not for production charts yet.
- Continued `apiVersion: v2` in `Chart.yaml` remains correct.