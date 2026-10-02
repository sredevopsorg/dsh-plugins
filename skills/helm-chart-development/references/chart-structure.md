# Chart structure

Everything outside `templates/`: chart metadata, values design, dependencies,
hooks, CRDs and the official conventions a published chart is expected to follow.

## `Chart.yaml`

```yaml
apiVersion: v2                # v2 for Helm 3+; v1 is legacy
name: mychart                # DNS-1123: [a-z0-9-], starts/ends alphanumeric, ≤63
version: 0.1.0               # SemVer; the CHART version — bump on every change
appVersion: "1.16.0"         # the APP version; quote it
description: One sentence about what this deploys
type: application            # application (default) | library
kubeVersion: ">=1.24.0-0"    # SemVer constraint, enforced at install time
keywords: [postgres, database]
home: https://example.com
sources: [https://github.com/example/mychart]
icon: https://example.com/icon.png
deprecated: false
maintainers:
  - name: Ada
    email: ada@example.com
dependencies:
  - name: redis
    version: "18.0.0"
    repository: "https://charts.bitnami.com/bitnami"   # or oci://…, or "@repo-name"
    condition: redis.enabled
    tags: [cache]
    alias: cache
    import-values:
      - data
annotations:
  artifacthub.io/changes: |
    - kind: added
      description: Initial release
```

Notes:

- `version` and `appVersion` are unrelated. `version` is the chart; `appVersion`
  is the software inside. Bump `version` on every change you publish or Helm
  refuses the upload.
- **Quote `appVersion`.** YAML reads `1.0` as a float and `1234e10` as a number.
- `kubeVersion` supports `>=1.13.0 <1.15.0`, `||`, hyphen ranges (`1.1 - 2.3.4`),
  wildcards (`1.2.x`), tilde (`~1.2.3`) and caret (`^1.2.3`).
- Unknown top-level fields are rejected since Helm 3.3.2 — put custom metadata
  under `annotations`.

## `values.yaml`

### Naming

```yaml
# Good — lowercase camelCase
replicaCount: 3
image:
  repository: nginx
  tag: "1.25.3"

# Bad
ReplicaCount: 3          # uppercase may shadow a built-in
chicken-noodle-soup: true # hyphen is parsed as subtraction
```

A hyphenated key is reachable only via `index`:

```yaml
{{ index .Values "gitlab-runner" "checkInterval" }}
```

### Document every key

The comment starts with the key name so it is greppable and machine-pairable:

```yaml
# replicaCount is the number of application replicas
replicaCount: 1
# service.port is the port the service listens on
service:
  port: 80
```

### Flat over nested, but not always

Nested trees need an existence check at every level:

```yaml
{{- if .Values.server }}{{ default "none" .Values.server.name }}{{- end }}
```

Flat keys need none:

```yaml
{{ default "none" .Values.serverName }}
```

Nest when a group has many related keys and at least one is non-optional.

### Types

Be explicit about strings, implicit about everything else — quote all strings.
Store large integers as strings and cast in the template with `{{ int $v }}`.
`!!str` / `!!int` tags work but are lost after one parse.

### Prefer maps to lists of maps

```yaml
# Hard to override, index-fragile
servers:
  - {name: foo, port: 80}
  - {name: bar, port: 81}

# Easy to override
servers:
  foo: {port: 80}
  bar: {port: 81}
```

`--set servers.foo.port=80` is obvious; `servers[0].port=80` breaks the moment
someone reorders the list.

### `default`, `required`, `null`

```yaml
name: {{ .Values.name | default "app" | quote }}
token: {{ required "auth.token is required" .Values.auth.token | quote }}
```

Put static defaults in `values.yaml`, not in `default` calls — repeating them is
redundant. Use `default` for *computed* values that cannot live in `values.yaml`:

```yaml
drink: {{ .Values.drink | default (printf "%s-tea" (include "mychart.fullname" .)) | quote }}
```

Remember `false` and `0` are "empty" to `default`, so it is the wrong tool for
boolean switches.

To **delete** a default instead of merging into it, set it to `null`:

```sh
helm install drupal ... --set livenessProbe.exec.command=[cat,CHANGELOG] --set livenessProbe.httpGet=null
```

### Overriding from the outside

Precedence, least to most specific:

1. chart `values.yaml`
2. parent chart's `values.yaml` (for subcharts)
3. `-f custom.yaml` / `--set-json` / `--set-file`
4. `--set`

## `values.schema.json`

JSON Schema (draft-07), validated against the **final merged `.Values`** by
`helm lint`, `helm template`, `install` and `upgrade`.

```json
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "title": "mychart values",
  "type": "object",
  "required": ["image", "service"],
  "properties": {
    "replicaCount": { "type": "integer", "minimum": 0, "maximum": 100 },
    "image": {
      "type": "object",
      "required": ["repository"],
      "properties": {
        "repository": { "type": "string", "minLength": 1 },
        "tag": { "type": "string" },
        "pullPolicy": { "type": "string", "enum": ["Always", "IfNotPresent", "Never"] }
      }
    },
    "ingress": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "className": { "type": "string" }
      }
    }
  }
}
```

- Every subchart's schema is checked too, so a parent cannot bypass a child's
  restrictions — and a parent must satisfy the child's `required` fields.
- Bypass for air-gapped setups with remote `$ref`s: `--skip-schema-validation`.

## `.helmignore`

Lives at the chart root next to `Chart.yaml`. Applied by `helm package` **and** by
install/upgrade/template straight from a directory.

```
# comment
.git
.helmignore
.DS_Store
*.tgz
*.tmp
*.bak
ci/
.github/
tests/
```

Differences from `.gitignore`: no `**`; Go's `filepath.Match` globbing (not
fnmatch); trailing spaces always ignored with no escape; no `\!` escape; and the
file does **not** exclude itself by default — list `.helmignore` explicitly.

`.helmignore` also controls `.Files` visibility: an ignored file cannot be read
back by `.Files.Get`.

## Hooks

A hook is a manifest carrying `helm.sh/hook` annotations. Hook resources are
**not** part of the release — they never appear in `helm get manifest`, are not
rolled back with the release, and are not deleted on `helm uninstall` unless you
say so.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: "{{ include "mychart.fullname" . }}-migrate"
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": hook-succeeded,before-hook-creation
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          args: ["/app/migrate"]
```

| Annotation | Effect |
|---|---|
| `helm.sh/hook` | Comma-separated events: `pre-install`, `post-install`, `pre-upgrade`, `post-upgrade`, `pre-delete`, `post-delete`, `post-rollback`, `test` |
| `helm.sh/hook-weight` | Ordering within an event kind, ascending. Must be a **string** |
| `helm.sh/hook-delete-policy` | `before-hook-creation` (default), `hook-succeeded`, `hook-failed` |

A `test` hook runs via `helm test`. Subchart hooks always run — a parent cannot
disable them.

## CRDs

Put CRDs in `crds/`, not `templates/`:

- `crds/*.yaml` is installed before templates, on install only, and never
  templated or upgraded.
- The docs still recommend a copy under `templates/` for Helm 2 compatibility —
  do not do this in a Helm 3+ chart; a templated CRD fights the API server's
  immutable-field rules and rolls can fail.
- `helm template` omits `crds/` unless you pass `--include-crds`.
- Large CRDs can push the chart past the object size limit; keep them lean.

## Subcharts, globals and values scope

A subchart is standalone: it can never read its parent's values, only its own.

```yaml
# parent values.yaml
redis:
  enabled: true          # consumed by the `condition:` dependency
  auth:
    password: secret
global:
  imageRegistry: registry.example.com
```

Inside `charts/redis/templates/…` the values are `.Values.auth.password` — the
parent writes `redis.auth.password`, but the child sees `.Values.auth.password`.

Globals (`Values.global.*`) are the only values shared by name across every chart
in the tree. They must be declared explicitly; you cannot promote an existing
non-global key. A subchart's globals flow **downward** only, never upward, and
the parent's globals win over a child's.

Subcharts are vendored into `charts/` by `helm dependency build`, which reads
`Chart.yaml` `dependencies:` and writes `Chart.lock`. Rendering from a directory
without building first gives:

```
found in Chart.yaml, but missing in charts/ directory: redis
```

Commit `Chart.lock`, and add `charts/*.tgz` to `.gitignore` only if your pipeline
builds dependencies rather than vendoring them.

## Library charts

`type: library`. Not installable, defines only helpers in `_helpers.tpl` for other
charts to consume as a dependency. Use instead of YAML anchors for shared snippets
(anchors do not survive a round trip).

## Conventions

- Chart name: lowercase letters, digits, dashes; start and end alphanumeric; ≤63.
  `helm lint` enforces this.
- Indent YAML with two spaces, never tabs.
- `.yaml` for manifests, `.tpl` for define-only, `_`-prefixed filenames for
  non-manifest templates, one resource kind per file, dashed filenames.
- Template directives get spaces: `{{ .foo }}`, never `{{.foo}}`.
- Never hardcode `namespace:` in `metadata` — pass `--namespace` at install time.
- Store `+` in versions as `_` inside labels: labels forbid `+`
  (`{{ .Chart.Version | replace "+" "_" }}`).

## Labels and annotations

A label is for **querying and identifying**; anything else is an annotation.
Hooks are always annotations.

```yaml
{{- define "mychart.labels" -}}
helm.sh/chart: {{ include "mychart.chart" . }}
{{ include "mychart.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "mychart.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mychart.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

| Label | Status | Value |
|---|---|---|
| `app.kubernetes.io/name` | recommended | the app name |
| `helm.sh/chart` | recommended | `{{ .Chart.Name }}-{{ .Chart.Version \| replace "+" "_" }}` |
| `app.kubernetes.io/managed-by` | recommended | `{{ .Release.Service }}` |
| `app.kubernetes.io/instance` | recommended | `{{ .Release.Name }}` |
| `app.kubernetes.io/version` | optional | `{{ .Chart.AppVersion }}` |
| `app.kubernetes.io/component` | optional | role within the app |
| `app.kubernetes.io/part-of` | optional | higher-level application |

Keep `selectorLabels` **narrower** than `labels`. A `matchLabels` containing a
mutable label (version, a date, a checksum) makes the workload's selector
immutable and blocks every future upgrade.

## Pods and images

- Pin images to a fixed tag or digest; never `latest`, `head`, `canary`.
- Default `imagePullPolicy: IfNotPresent` and let users override it.
- Every PodTemplate should declare an explicit `selector.matchLabels`.
- Provide `resources`, `podSecurityContext` and `securityContext` keys, defaulted
  to `{}`, so users can set them without `--set` gymnastics.
- When a pod mounts a ConfigMap or Secret, force a rollout on change:

```yaml
annotations:
  checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
```