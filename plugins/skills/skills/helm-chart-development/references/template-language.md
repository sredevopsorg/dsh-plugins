# Template language

Helm's template language is Go's `text/template` plus Sprig functions plus a few
Helm-specific objects. Everything in this file is how that language actually
behaves when it renders YAML.

## Directive anatomy

```
{{ /* a directive is delimited by {{ and }} */ }}
```

A directive is replaced by its output; everything outside the braces is copied
verbatim. `.` is the current scope — the root object holds the built-ins.

```
{{ .Release.Name }}                  →  myrelease
{{ include "mychart.fullname" . }}   →  myrelease-mychart
```

Only `define` blocks suppress their own body. A plain `.yaml` file in
`templates/` emits its whole rendered text as a manifest.

### The three whitespace forms

| Form | Meaning |
|---|---|
| `{{ … }}` | Replace the directive with its output; leave surrounding whitespace alone |
| `{{- … }}` | Chomp all whitespace **and newlines** immediately to the left |
| `{{ … -}}` | Chomp all whitespace and newlines immediately to the right |
| `{{- … -}}` | Both |

Newlines are whitespace. Without chomping, a multi-line `if` block leaves a blank
line where each directive sat:

```yaml
data:
  {{- if eq .Values.drink "coffee" }}
  mug: "true"
  {{- end }}
```

renders `data:` followed immediately by `mug: "true"`. Drop the left `-` and you
get blank lines; over-chomp with `-}}` on both sides and two keys collapse onto
one line (`food: "PIZZA"mug: "true"`).

There must be a space after the chomp dash. `{{-3 }}` is the number minus three;
`{{- 3 }}` is "trim left, then print 3".

Two ways to fight indentation:

```yaml
{{- range .Values.toppings }}
- {{ . | quote }}
{{- end }}

# or let the engine indent a block for you
{{ indent 4 $block }}
{{ nindent 4 $block }}   # nindent = indent, plus a leading newline
```

## Pipelines

A pipeline chains functions. The piped value becomes the **last** argument:

```yaml
{{ .Values.drink | upper | quote }}     # quote(upper(.Values.drink))
{{ repeat 5 .Values.drink }}            # repeat(5, .Values.drink)
{{ .Values.drink | repeat 5 }}          # same thing
```

Operators are functions too (`eq`, `ne`, `lt`, `le`, `gt`, `ge`, `and`, `or`,
`not`), so they compose in a pipeline. Parentheses group arguments:

```yaml
{{- if and .Values.enabled (gt (.Values.replicas | int) 0) }}
```

## Control structures

### `if` / `else if` / `else`

```yaml
{{ if .Values.ingress.enabled }}
  ...
{{ else if eq .Values.mode "simple" }}
  ...
{{ else }}
  ...
{{ end }}
```

A pipeline is **false** when it is: `false`, `0`, `""`, `nil`/null, or an empty
collection (`[]`, `{}`). Everything else is true.

Consequences worth remembering:

- `if .Values.port` is false for port `0`.
- `if .Values.resources` is false for `resources: {}` — that is what you want.
- `default "x" .Values.flag` returns `"x"` when the flag is `false`, because
  `false` is empty. To switch on a boolean that can legitimately be `false`, test
  the key's existence instead: `{{ if hasKey .Values "flag" }}`, or store
  `null` and test with `if`.

### `with` — rebinding the scope

```yaml
{{- with .Values.resources }}
limits:
  cpu: {{ .limits.cpu | quote }}
{{- end }}
```

Inside the block, `.` is the new object. **The parent scope is unreachable by
`.`** — `.Release.Name` fails inside the block. Two fixes:

```yaml
{{- $rel := .Release.Name -}}     # capture before entering the block
{{- with .Values.resources }}
release: {{ $rel }}
{{- end }}

release: {{ $.Release.Name }}     # or reach for the root
```

`$` always points at the root context, regardless of `with`/`range` nesting.

`with` needs no outer `if` — it already skips when the value is empty.

### `range` — iteration and rebinding

```yaml
{{- range .Values.hosts }}              {{ . }}                          {{/* value only   */}}
{{- range $i, $h := .Values.hosts }}   {{ $i }} {{ $h }}                 {{/* index + value */}}
{{- range $k, $v := .Values.favorite }}                                 {{/* map key/value  */}}
```

Inside the loop `.` is the current element. `range` also accepts a list built
inline: `{{- range tuple "a" "b" "c" }}`.

### Variables

```yaml
{{- $fullname := include "mychart.fullname" . -}}
{{- $port := .Values.service.port | int -}}
```

`$name := value` declares; `$name = value` reassigns. Variables are scoped to
the block that declares them. `$` is the immutable root pointer.

## Named templates

### `define`, `template`, `include`

```yaml
{{- define "mychart.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}
```

- `define` bodies live in a global namespace shared by the chart **and every
  subchart**. Prefix with the chart name; add the major version too when two
  versions of the chart may be loaded together (`mychart.v1.fullname`).
- `define` produces no output until invoked.
- `template "name" .` — the action form. The name must be a string literal, and
  the output is spliced in at column 0 with no indentation control.
- `include "name" .` — the function form. Accepts a computed name and **can be
  piped**, so `| nindent N` works. Prefer it everywhere.
- A `define` receives only the scope you pass. `{{ template "x" }}` with no
  argument passes nothing, so `.Chart.Name` inside resolves to nil and renders as
  an empty value.

```yaml
metadata:
  labels:
    {{- include "mychart.labels" . | nindent 4 }}
```

### `block`

`block` declares a named template with a default body that a later `define` of
the same name replaces. In charts it is a trap: when several charts define the
same block, which one wins is unpredictable. Use `include` plus a plain value
toggle instead.

## Files

`.Files` exposes non-template files bundled in the chart.

```yaml
{{ .Files.Get "config/app.conf" }}
{{ .Files.GetBytes "logo.png" }}
{{ .Files.Glob "config/*.conf" }}      # returns a Files object
{{ .Files.Lines "hosts.txt" }}         # iterate line by line
{{ (.Files.Glob "config/*").AsConfig | nindent 2 }}   # as a ConfigMap data map
{{ (.Files.Glob "secrets/*").AsSecrets | nindent 2 }} # base64-encoded
```

Unavailable through `.Files`: anything in `templates/`, anything matched by
`.helmignore`, and anything outside the chart (a subchart cannot read its parent).
Files are not accessible if absent — `Files.Get` on a missing file returns empty.
Keep the whole chart under ~1 MB because CRDs and other objects are stored in
Kubernetes.

Path helpers from Go's `path` package, lowercased: `base`, `dir`, `ext`, `isAbs`,
`clean`.

## Built-in objects

| Object | Fields |
|---|---|
| `.Release` | `.Name`, `.Namespace`, `.IsUpgrade`, `.IsInstall`, `.Revision`, `.Service` |
| `.Values` | Merged values (chart defaults ← parent ← `-f` file ← `--set`) |
| `.Chart` | Contents of `Chart.yaml`: `.Name`, `.Version`, `.AppVersion`, `.Annotations`, … |
| `.Subcharts` | The parent's view of a subchart's scope |
| `.Files` | `Get`, `GetBytes`, `Glob`, `Lines`, `AsConfig`, `AsSecrets` |
| `.Capabilities` | `.APIVersions.Has "apps/v1"`, `.KubeVersion.{Version,Major,Minor}`, `.HelmVersion.Version` |
| `.Template` | `.Name`, `.BasePath` |

`.Capabilities.APIVersions.Has` guards resources your chart may not be able to
deploy:

```yaml
{{- if .Capabilities.APIVersions.Has "networking.k8s.io/v1/Ingress" }}
apiVersion: networking.k8s.io/v1
{{- end }}
```

### `lookup`

```yaml
{{- $existing := (lookup "v1" "Secret" .Release.Namespace "my-secret") }}
{{- if not $existing }}
{{- fail "secret my-secret must exist before install" }}
{{- end }}
```

Signature: `lookup apiVersion kind namespace name`. `namespace` and `name` may be
`""` (list, or cluster-scoped). Returns a dict for a single object, and the list
under `.items` for many. Returns empty when nothing matches, and an API error
(including an RBAC denial) fails the render.

Always returns empty under `helm template` and `--dry-run=client`. Test it with
`--dry-run=server`.

## NOTES.txt

`templates/NOTES.txt` is templated like everything else, is **not** rendered as a
manifest, and prints at the end of `helm install`/`helm upgrade`. `helm template`
never shows it, so a broken NOTES file only appears on a real install.

```
Your release is named {{ .Release.Name }}.

Forward the service locally:
  $ kubectl --namespace {{ .Release.Namespace }} port-forward svc/{{ include "mychart.fullname" . }} 8080:80
```

## YAML techniques

These decide whether the rendered document parses at all.

### Scalars and types

```yaml
count: 1        # int
count: "1"      # string
port: !!int "80"   # forced int
flag: true      # bool
flag: "true"    # string
nothing: null   # null — the word is `null`, not `nil`
```

Quote strings in `values.yaml`. Unquoted `1.0` becomes a float and `1234e10`
becomes a number.

### Multi-line strings

| Form | Trailing newline |
|---|---|
| `\|` | kept |
| `\|-` | stripped |
| `\|+` | all trailing newlines kept |
| `>` | folded — newlines become spaces |
| `>-` | folded and stripped |

The first line after `|` must be indented consistently with the rest, otherwise
you get `did not find expected key`. Indentation inside a block is preserved.

### Injecting values without breaking structure

| Goal | Use | Avoid |
|---|---|---|
| A scalar | `{{ .Values.name \| quote }}` | bare `{{ .Values.name }}` |
| A string as one scalar | `key: \|` then `{{- .Values.text \| nindent N }}` with `N` > parent indent | `key: {{ .Values.text \| nindent N }}` — `nindent` alone only adds spaces |
| A map or list | `{{- toYaml .Values.extra \| nindent N }}` | hand-rolled `{{ range }}key: {{ . }}{{ end }}` |

`N` must be **greater than the parent indent**, normally parent + 2.

### Multiple documents per file

Prefix each document with `---`. It works in templates but makes debugging
harder; prefer one resource per file. It does **not** work in `values.yaml` —
only the first document is read.

### Anchors

YAML anchors (`&x` / `*x`) are expanded on first read and lost on rewrite, so
they do not survive a round trip through Helm or Kubernetes. Use a library chart
to share snippets instead.