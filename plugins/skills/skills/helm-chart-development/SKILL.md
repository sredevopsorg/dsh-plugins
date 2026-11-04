---
name: helm-chart-development
description: Create, edit, and improve Helm charts — scaffold with `helm create`, author Go templates, values.yaml and _helpers.tpl, and verify with `helm lint` + `helm template`. Use when adding or reviewing chart templates, values, NOTES.txt, named templates, hooks, CRDs, subcharts, dependencies or values.schema.json, or when a chart fails to render, fails `helm lint`, or fails to install.
whenToUse: Use when creating a new Helm chart, adding or editing anything under templates/, tuning values.yaml, writing named templates in _helpers.tpl, adding hooks, CRDs, subcharts, dependencies or schema validation, or diagnosing a chart that fails `helm lint`, renders broken YAML, or fails to install or upgrade.
---

# Helm chart development

A Helm chart is a versioned bundle of Kubernetes manifests plus the Go templates
that generate them. Helm renders `templates/` with Go's text/template engine, merges
`values.yaml` with whatever the user supplies, and sends the result to Kubernetes.

Two things decide whether the work succeeds: **the rendered output must be valid,
correctly-indented YAML**, and **every value the chart reads must be declared,
documented and overridable**. Everything else is Kubernetes manifest design.

Verified against **Helm 4.3** and the Helm 4 chart template guide.

## 1. Non-negotiables

- **Never test with `helm install`.** `helm template` renders the chart with no
  cluster and no side effects. It is the loop for 100% of template work.
  `helm install --dry-run=client` also works but prints extra noise.
- **`helm create` first, then edit.** It ships correct `_helpers.tpl` (namespaced
  `define` names), `NOTES.txt`, `.helmignore`, and a `values.yaml` skeleton.
  Never hand-roll a chart from a blank directory.
- **Quote every string you interpolate.** `{{ .Values.foo }}` can inject a newline,
  a `:`, or a `-` and reshape the document. Use `| quote` for scalars and
  `toYaml … | nindent N` for maps and lists.
- **Whitespace in templates is YAML structure.** `{{ if }}` / `{{ end }}` lines
  leave their surrounding blank lines behind. Use `{{-` and `-}}` to chomp.
- **Named templates share one global namespace** across the chart *and all its
  subcharts*. Prefix every `define` with the chart name: `{{ define "mychart.fullname" }}`.
- **`include` over `template`.** `template` splices text verbatim with no
  indentation control; `include … | nindent N` can be piped. Use `template` only
  when the name is a literal and the output lands at column 0.
- **Generated names must survive the DNS-1123 63-char limit:**
  always `| trunc 63 | trimSuffix "-"`.
- **Do not set `namespace:` in template `metadata`.** Pass `--namespace` at
  install time. A hardcoded namespace breaks multi-namespace installs and is a
  documented anti-pattern.
- **CRDs go in `crds/`, never `templates/`.** Files in `templates/` are templated
  and re-applied on upgrade, which fights the API server's CRD update rules.
  `crds/` is installed first and skipped on upgrade.
- **Hook resources are not part of the release.** They are tracked in release
  metadata only, never in `helm get manifest`.

## 2. Chart layout

```
mychart/
├── Chart.yaml            required — metadata, version, appVersion, dependencies
├── values.yaml           required — documented defaults for every value
├── values.schema.json    optional but recommended — JSON Schema, validated on lint/template/install
├── .helmignore           required in practice — excludes files from the package
├── README.md             optional — how to install and configure
├── templates/
│   ├── _helpers.tpl      define blocks only; the `_` prefix keeps it out of the output
│   ├── NOTES.txt         post-install instructions (plain text, still templated)
│   ├── deployment.yaml   one resource kind per file, dashed filenames
│   ├── service.yaml
│   ├── ingress.yaml
│   └── tests/
│       └── test-connection.yaml   runs as a hook on install/upgrade
├── crds/                 CRD manifests — installed first, never templated
└── charts/               vendored dependencies (`helm dependency build`)
```

Conventions: `.yaml` for manifests, `.tpl` for define-only files, `_`-prefixed
names for non-manifest files, dashed (never camelCase) filenames, two-space
indent, spaces inside `{{ }}`.

## 3. The verification loop

Run these after **every** change. The first three need no cluster and no network.

```bash
helm lint ./mychart --strict          # schema + conventions; --strict fails on warnings
helm template rel ./mychart           # renders; fails on bad YAML and template errors
helm template rel ./mychart --set key=val -f prod.yaml   # renders a specific config
node scripts/verify-chart.mjs ./mychart                   # the checks helm lint does not do
```

`helm lint --strict` and `helm template` catch syntax, YAML and schema problems.
They do **not** catch: values read from `.Values` that no one declared (a typo
silently renders empty), values declared but never used, unnamespaced `define`
blocks, unquoted interpolations, missing recommended labels, duplicate resources
in the output, or over-long names. `verify-chart.mjs` covers exactly those — it
lives next to this file in the skill's `scripts/` directory and needs only Node
and `helm`:

```bash
node <skill-dir>/scripts/verify-chart.mjs ./mychart
node <skill-dir>/scripts/verify-chart.mjs ./mychart -f prod.yaml --set image.tag=1.2.3
```

Only when the chart is green locally:

```bash
helm template rel ./mychart --dry-run=server   # needs a cluster; validates against the API server
helm install rel ./mychart --dry-run=client     # catches conflicts with existing resources
helm test rel ./mychart                         # runs templates/tests/ hooks against the live release
```

Two important behaviours: `lookup` returns empty under `--dry-run=client` (use
`--dry-run=server`), and `helm template` never prints `NOTES.txt` output, so a
broken NOTES file shows up only on a real install.

## 4. Template language, the parts that bite

Full detail: `references/template-language.md`.

**Scope.** `.` is the current scope. `with` and `range` both rebind it. Inside a
`with`, `.Release.Name` no longer resolves — use `$` for the root:

```yaml
{{- with .Values.resources }}
limits: {{ .limits | quote }}
{{- end }}
release: {{ $.Release.Name }}
```

**Variables** are declared with `:=` and are scoped to their block.
`{{- $rel := .Release.Name -}}` before the `with` is the idiomatic fix.

```yaml
{{- range $i, $name := .Values.hosts }}
- {{ $name }}: {{ $.Values.ports | index $i }}
{{- end }}
```

**Truthiness.** A pipeline is false when it is `false`, `0`, `""`, `nil`, or an
empty collection. Note the trap: `default "x" .Values.flag` returns `"x"` when the
flag is `false`, because `false` counts as empty. Use `hasKey`/`kindIs`, or set
the flag to `null` and test with `if`.

**Pass scope into helpers.** A `define` receives whatever you pass it. Omitting
the argument yields `nil`, which surfaces as
`unknown object type "nil" in ConfigMap.metadata.labels.foo`:

```yaml
{{- define "mychart.labels" -}}
helm.sh/chart: {{ include "mychart.chart" . }}
{{- end }}

metadata:
  labels:
    {{- include "mychart.labels" . | nindent 4 }}
```

**Embedding collections.** `nindent N` must exceed the parent indent:

```yaml
data:
  app.conf: |
    {{- .Values.appConf | nindent 4 }}
  extra.yaml: |
    {{- toYaml .Values.extraConfig | nindent 4 }}
```

## 5. Values design

Full detail: `references/chart-structure.md`.

- Lowercase camelCase keys (`chickenNoodleSoup`). Never hyphens — `.Values.gitlab-runner`
  is parsed as subtraction; use `index .Values "gitlab-runner"` for such keys.
- Quote strings in `values.yaml`; YAML turns `1.0` into a float and `1234e10` into
  a number. Store integers as strings and cast with `{{ int $v }}` when a large
  number matters.
- Document every key with a comment that starts with the key name, so the
  documentation is greppable and doc generators can pair them up.
- Prefer maps over lists of maps so `--set` stays usable:
  `servers.foo.port=80` rather than `servers[0].port=80`.
- Guard genuinely optional trees with `with`, and hard requirements with
  `required "… message" .Values.x`.
- Delete a default rather than merging into it by setting it to `null`:
  `--set livenessProbe.httpGet=null`.
- Add `values.schema.json` for anything user-facing. It is enforced by
  `helm lint`, `helm template`, `install` and `upgrade`, and by every subchart.

## 6. Create a chart

1. **Scaffold:** `helm create mychart`, then `rm` the templates you will not use
   so the chart renders something meaningful from the first commit.
2. **Set identity in `Chart.yaml`:** `name` (DNS-1123: lowercase, dashes, ≤63),
   `version` (SemVer for the chart), `appVersion` (quoted; the app, not the chart),
   `description`, `kubeVersion`, `type: application`.
3. **Design `values.yaml` top-down:** group by the resource that consumes it
   (`image`, `resources`, `serviceAccount`, `ingress`), keep it shallow, document
   each key, and quote strings.
4. **Write `_helpers.tpl`:** `name`, `fullname`, `chart`, `labels`,
   `selectorLabels`, `serviceAccountName` — every `define` namespaced
   `<chart>.` and carries a `{{/* … */}}` doc block.
5. **Write one file per resource,** each gated on an `enabled` flag when optional,
   emitting the `labels` helper and honouring `resources`, `securityContext`,
   `podSecurityContext`, `nodeSelector`, `tolerations`, `affinity`.
6. **Write `NOTES.txt`** with the commands the user needs next: how to reach it,
   how to port-forward, how to get credentials.
7. **Add `values.schema.json`** mirroring `values.yaml`.
8. **Verify** with §3 until green, then `helm package ./mychart` and inspect the
   `.tgz` contents — `.helmignore` mistakes only surface there.

## 7. Edit an existing chart

1. **Read before writing.** A chart has conventions already; match them.
2. **Locate the value's blast radius** — `grep -rn '\.Values\.theKey' templates/`
   — before renaming or removing it. Renaming a value is a breaking change;
   deprecate the old key alongside the new one instead.
3. **Change the default in `values.yaml`,** then adjust the template, then update
   `values.schema.json`. Keeping those three in sync is the most common source of
   chart rot.
4. **Add a helper rather than copy-pasting YAML.** If the same block appears in
   three templates, it belongs in `_helpers.tpl` behind one `define`.
5. **Re-verify with §3** including at least one non-default `--set` combination.

## 8. Improve an existing chart

Run `verify-chart.mjs` first, then audit these. They are ordered by how often they
are actually wrong.

| Check | Why it matters |
|---|---|
| Every `define` is `<chart>.`-prefixed | A bare `fullname` collides with any subchart or dependency that defines one; the last-loaded definition silently wins |
| `include` replaces `template` | `template` output ignores indentation and breaks the moment the block moves |
| Every `.Values.x` interpolation is quoted | Unquoted `:`/newline in a user value corrupts the manifest — this is a security issue, not just cosmetic |
| No `namespace:` in template `metadata` | Blocks multi-namespace and GitOps installs |
| Recommended labels present on every object | `helm.sh/chart`, `app.kubernetes.io/{name,instance,managed-by,version}` — without them `kubectl` cannot find or roll back the release |
| Selector labels are stable | A `matchLabels` containing `version` or a date label makes the Deployment's selector immutable and blocks upgrades |
| Image tags are pinned | `latest`/`canary` make rollbacks non-reproducible; prefer a tag or digest |
| Deprecated `apiVersion`s removed | `extensions/v1beta1`, `networking.k8s.io/v1beta1` Ingress, `policy/v1beta1` PodDisruptionBudget, `autoscaling/v2beta1` HPA, `batch/v1beta1` CronJob are gone from modern clusters |
| `.Values.x` with no entry in `values.yaml` | A typo renders empty and ships a broken default; `verify-chart.mjs` finds these |
| Values in `values.yaml` no template reads | Dead configuration that misleads users |
| ConfigMap/Secret mounted in a workload | Add `checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}` so a change rolls the pods |
| `NOTES.txt` exists and is accurate | It is the only documentation most users ever read |
| `.helmignore` excludes `.git`, `*.tgz`, `.DS_Store`, CI files | Otherwise they ship in the package |
| Probes, `resources`, `securityContext` present | Not required, but their absence is the top support question for app charts |

## 9. Diagnosing a broken chart

| Message | Cause | Fix |
|---|---|---|
| `YAML parse error on <file>: error converting YAML to JSON: yaml: line N: did not find expected key` | A control block left a blank line, or an unquoted value contains `:`/newline | Add `{{-` / `-}}`; pipe the offending value through `\| quote` |
| `nil pointer evaluating interface {}.foo` | `.Values.a.b` where `a` is unset | `default`, `required`, or wrap the block in `with` |
| `unknown object type "nil" in ConfigMap.metadata.labels.x` | A `define` was included without a scope, or an empty value was interpolated unquoted | `include "…" . \| nindent 4`, and quote the label |
| `ValidationError(ConfigMap): unknown field "x"` | An included block was spliced at the wrong nesting level | `include … \| nindent N` with the correct depth |
| `unable to build kubernetes objects from release manifest` | Umbrella error; the real cause is above it | Read the first error in the output, not the last |
| `found in Chart.yaml, but missing in charts/ directory: X` | A dependency was declared but not vendored | `helm dependency build ./mychart` |
| `values don't meet the specifications of the schema(s)` | `values.schema.json` rejects the merged values | Fix the value or the schema; the schema sees the *final* `.Values`, including `--set` |
| `chart requires kubeVersion: … which is incompatible` | Cluster version out of range | Render with `--kube-version`, or widen the constraint |
| `Error: … execution error at (templates/x.yaml:N:M)` | A runtime template error at that line | Open the file at that line and column |
| `lookup` always empty | `helm template` does not contact the cluster | `--dry-run=server`; check RBAC and apiVersion |

When YAML will not parse, comment out the offending directive (`# {{ .Values.x }}`)
and re-render with `--debug` to see the generated text without the parse error
blocking you. Full triage steps: `references/debugging-and-testing.md`.

## 10. Anti-patterns

- `helm install` as a test loop.
- Unnamespaced `define` names.
- `{{ template "x" . }}` where `{{- include "x" . | nindent N }}` is meant.
- Unquoted `{{ .Values.… }}` in a YAML value position.
- `default` used to switch on a boolean — `false` is empty, so the default wins.
- `block` for overridable content — with multiple definitions the winner is
  unpredictable; use `include`.
- Copy-pasted label blocks instead of the `labels` helper.
- CRDs under `templates/`.
- Lists of maps in `values.yaml` that users are expected to override with `--set`.
- Bumping `appVersion` when only the chart templates changed, or forgetting to
  bump `version` at all — Helm refuses to republish an existing version.

## References

- `references/template-language.md` — directives, whitespace chomping, pipelines,
  control structures, scope and variables, named templates, `.Files`, `NOTES.txt`,
  built-in objects, and the YAML techniques that keep rendered output valid.
- `references/chart-structure.md` — `Chart.yaml` fields, `kubeVersion`,
  values design and `values.schema.json`, `.helmignore`, hooks, CRDs, subcharts,
  globals, dependencies, library charts, and the official best practices.
- `references/function-reference.md` — the Helm/Sprig function set that matters,
  grouped and annotated with the argument order and the traps.
- `references/debugging-and-testing.md` — the full verification ladder, offline vs
  cluster, test hooks, CI wiring, and error-by-error triage.
- `scripts/verify-chart.mjs` — lint plus the static and rendered-output checks
  `helm lint` does not perform.

Source: [Helm Chart Template Developer's Guide](https://helm.sh/docs/chart_template_guide/),
[Charts](https://helm.sh/docs/topics/charts/),
[Best Practices](https://helm.sh/docs/chart_best_practices/) and
[Hooks](https://helm.sh/docs/topics/charts_hooks/).