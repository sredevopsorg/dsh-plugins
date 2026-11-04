# Function reference

Helm's function set is Go's `text/template` builtins plus Sprig plus a handful of
Helm-specific additions. ~180 functions is more than anyone memorises; this file
covers the ones that appear in real charts, plus the argument-order and type traps
that cause bugs.

Unless noted, argument order is as written: `func ARG1 ARG2`, and in a pipeline
the piped value arrives as the **last** argument.

## Logic and flow control

| Function | Notes |
|---|---|
| `default DEFAULT GIVEN` | Returns `GIVEN` unless it is *empty*. Empty means `0`, `""`, `[]`, `{}`, `false`, or nil. **Never use it on a boolean switch** — a `false` flag returns the default |
| `required MSG VALUE` | Fails rendering with `MSG` when `VALUE` is empty. The message is what the user sees; write it as an instruction |
| `coalesce a b c` | First non-empty. `coalesce .Values.name .Values.legacyName "default"` |
| `empty V` / `all …` / `any …` / `not V` | `if V` already covers emptiness; `all`/`any` are variadic |
| `fail MSG` | Abort rendering with `MSG` once a condition proves the chart cannot render |
| `ternary TRUEVAL FALSEVAL TEST` | `{{ .Values.x \| ternary "yes" "no" }}` — the piped value is the test |
| `eq ne lt le gt ge` | Also `and` / `or` / `not`. Parenthesise when composing |

Type comparisons fail loudly: `gt .Values.replicas 1` errors if `replicas` is the
string `"3"`. Cast first with `| int`.

## Strings

| Function | Example |
|---|---|
| `quote` / `squote` | `{{ .Values.name \| quote }}` — **apply to every string scalar** |
| `upper` / `lower` / `title` / `untitle` / `swapcase` | `.Values.env \| upper` |
| `trim` `trimAll CUTSET` `trimPrefix P` `trimSuffix S` | `trunc 63 \| trimSuffix "-"` is the standard name-truncation pair |
| `trunc N` / `trunc -N` | Truncates to N chars; a **negative** N keeps the last N |
| `repeat N S` | Pipelined: `.Values.x \| repeat 5` |
| `substr START END S` | Both indices required; `substr 0 5 "hello world"` → `hello` |
| `replace OLD NEW S` | Pipelined: `"a b" \| replace " " "-"` |
| `contains SUBSTR S` | Arg order is the trap — it reads backwards |
| `hasPrefix` / `hasSuffix` | Same arg order trap |
| `cat …` / `print …` / `println …` | `cat` joins with spaces; `print` inserts spaces between non-string neighbours |
| `printf FMT …` | `printf "%s:%s" .Values.host .Values.port` |
| `indent N S` / `nindent N S` | `indent` adds N spaces to every line; `nindent` also prepends a newline |
| `snakecase` `camelcase` `kebabcase` | `kebabcase "FirstName"` → `first-name` |
| `plural ONE MANY LEN` | `len .Values.hosts \| plural "one host" "many hosts"` |
| `abbrev N S` / `abbrevboth L R S` | Ellipsis counts toward the length |
| `nospace` / `initials` / `swapcase` / `wrap N S` / `wrapWith DELIM N S` | Rare in manifests |
| `shuffle S` | Randomises output — **do not use**, it breaks idempotent upgrades |

`shuffle` and `rand*` produce different output on every render, which makes
`helm upgrade` churn the manifest on every run.

## Type conversion

| Function | Notes |
|---|---|
| `toYaml V` | Encodes a collection as indented YAML. The workhorse for embedding maps/lists |
| `toYamlPretty V` | Same but indents list items too |
| `fromYaml S` / `fromYamlArray S` / `fromJson S` / `fromJsonArray S` | Parse bundled files into objects |
| `toJson V` / `toPrettyJson V` / `toRawJson V` | `toRawJson` leaves `<`, `>`, `&` unescaped — **the right one for embedded JSON** |
| `mustToJson` / `mustToYaml` / `mustMerge` … | Same as above but return an error instead of an empty string. Prefer these in charts |
| `atoi S` | String to int; errors on non-numeric input |
| `int` / `int64` / `float64` / `toString` / `toStrings` | Lenient conversions across types |
| `toDecimal OCT` | `"0777"` → `511`, for file modes |

`toYaml` emits lists at the parent's indentation. `toYaml | nindent N` where
`N <= parent indent` produces invalid YAML — `N` must be strictly greater.

## Lists

| Function | Notes |
|---|---|
| `list …` / `tuple …` | Build an inline list. `tuple` is fixed-arity; `range tuple "a" "b"` is the common idiom |
| `first` / `last` / `rest` / `initial` / `reverse` / `uniq` / `compact` | `must*` variants error on empty input |
| `append LIST ITEM` / `prepend LIST ITEM` / `concat LISTS…` | Pipeline puts the list last: `.Values.x \| append "z"` |
| `without LIST ITEM…` | |
| `has ITEM LIST` | `has "prod" .Values.envs` — note the arg order |
| `index COLLECTION KEY…` | The only way to read hyphenated keys: `index .Values "gitlab-runner" "checkInterval"` |
| `slice LIST START END` | |
| `until N` / `untilStep START STOP STEP` / `seq …` | Build number ranges for `range` |
| `chunk SIZE LIST` | |

## Dictionaries

| Function | Notes |
|---|---|
| `dict k v …` | Build a map. Use `dict` to pass structured args to `tpl` |
| `get DICT KEY` / `set DICT KEY VALUE` / `unset DICT KEY` | `set`/`unset` return a **new** dict; rebind the variable |
| `hasKey DICT KEY` | The correct way to distinguish "false" from "absent" |
| `dig KEY1 KEY2 … DEFAULT DICT` | Traverse nested dicts with a fallback — removes guard clauses entirely |
| `merge DEST SRC…` | Merges src into dest, dest wins. `mergeOverwrite` is the reverse: src wins |
| `keys DICT` / `values DICT` | Sorted keys — `range (keys .Values.a)` iterates deterministically |
| `pick DICT k…` / `omit DICT k…` / `pluck KEY DICTS…` | Shape a map before `toYaml` |
| `deepCopy V` | Prevents a subchart from mutating a parent's shared map |

```yaml
{{- $limits := .Values.resources.limits | default dict -}}
cpu: {{ dig "cpu" "500m" $limits | quote }}
```

Sprig's `dict` implementation returns a map with no ordering guarantee; rely on
`keys` when output order matters (it sorts).

## Encoding

`b64enc` / `b64dec` / `b64enc` for Secret `data`, `urlquery` / `urlParse` /
`urlJoin` for URLs.

Kubernetes `Secret.data` must be base64. Use `stringData` if you want to write
plaintext, or `b64enc` for `data`.

## Dates

`now`, `date "2006-01-02" TIME`, `dateInZone`, `htmlDate`, `dateModify`,
`duration`, `durationSeconds`, `toDate`, `unixEpoch`, `ago`.

**`now` makes output non-deterministic** — every render produces a different
manifest. Fine in `NOTES.txt`; never in a manifest (and never as a label).

Go reference layouts: `2006-01-02`, `15:04:05`, `2006-01-02T15:04:05Z07:00`.

## Crypto and security

`sha1sum`, `sha256sum`, `sha512sum`, `adler32sum`, `randAlphaNum n`, `randNumeric n`,
`randAscii n`, `randAlpha n`, `htpasswd`, `derivePassword`, `genPrivateKey`,
`genCA`, `genSelfSignedCert`, `genSignedCert`, `buildCustomCert`, `encryptAES`,
`decryptAES`.

`sha256sum` is the standard use — rolling a Deployment when a mounted Secret
changes:

```yaml
annotations:
  checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
```

`randAlphaNum`/`randNumeric` produce a **different value on every render**, which
makes every upgrade rewrite the Secret. Generate the password once at install time
with `lookup`+`randAlphaNum` and reuse it, or generate it outside the chart.

## Semver

`semverCompare CONSTRAINT VERSION`, and `semver` (a parsed struct with `.Major`,
`.Minor`, `.Patch`, `.Prerelease`).

```yaml
{{- if semverCompare ">=1.21-0" .Capabilities.KubeVersion.Version }}
apiVersion: policy/v1
{{- else }}
apiVersion: policy/v1beta1
{{- end }}
```

Supports `||`, hyphen ranges, wildcards (`1.2.x`), tilde (`~1.2.3`) and caret
(`^1.2.3`).

## Reflection

`typeOf V`, `kindOf V`, `typeIs TYPE V`, `kindIs KIND V`, `typeIsLike TYPE V`,
`deepEqual A B`.

```yaml
{{ printf "%T" .Values.foo }}     # the fastest way to debug a type problem
{{ if kindIs "map" .Values.foo }}…{{ end }}
```

## Regular expressions

`regexMatch`, `regexFindAll`, `regexFind`, `regexReplaceAll`,
`regexReplaceAllLiteral`, `regexSplit`, each with a `must*` variant that errors
instead of returning empty.

Note the arg order is `regexReplaceAll PATTERN REPL STRING`.

## Math

`add`, `add1`, `sub`, `div`, `mod`, `mul`, `max`, `min`, `len`, `randInt`.
Float variants: `addf`, `add1f`, `subf`, `divf`, `mulf`, `maxf`, `minf`, `floor`,
`ceil`, `round`.

`div` on integers truncates — `div 5 2` is `2`, not `2.5`. Use `divf` for floats.

## Paths, URLs, network, UUID

`base`, `dir`, `ext`, `isAbs`, `clean`; `urlParse`, `urlJoin`, `urlquery`;
`uuidv4`; and `getHostByName` (requires `--enable-dns`, so avoid it — it makes
rendering depend on the network).

## Helm and Kubernetes specific

| Item | Notes |
|---|---|
| `include NAME CONTEXT` | Renders a `define` and returns a **string**, so it composes in a pipeline |
| `template NAME CONTEXT` | The action form; not pipeable, name must be literal |
| `tpl TEMPLATE_STRING CONTEXT` | Renders a string as a template. The backbone of generic helpers |
| `required` | See logic above |
| `lookup apiVersion kind namespace name` | Cluster read; empty under `helm template` |
| `.Files.*` | `Get`, `GetBytes`, `Glob`, `Lines`, `AsConfig`, `AsSecrets` |
| `.Capabilities.APIVersions.Has "apps/v1"` | Feature detection |
| `printf "%T"` / `typeOf` | Type introspection |

### The `tpl` pattern

```yaml
{{- define "mychart.tplvalues.render" -}}
{{- $value := index . 0 -}}
{{- $context := index . 1 -}}
{{- if $value }}
{{- tpl (toYaml $value) $context }}
{{- end }}
{{- end }}
```

Used with `tplvalues.render` to let users supply their own template snippet:

```yaml
{{- define "mychart.tplvalues.render" -}}
{{- printf "{{ include \"custom.header\" . }}" }}
{{- end }}
```

This is how charts offer "bring your own template" values. Pass arguments as a
`list` and read them with `index`.

## Cheat sheet for manifests

```yaml
# a scalar
name: {{ .Values.name | default "app" | quote }}
# a bounded name
name: {{ printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}
# a map or list
resources: {{- toYaml .Values.resources | nindent 8 }}
# a multi-line string
config: |
  {{- .Values.configText | nindent 4 }}
# conditional block
{{- if .Values.ingress.enabled }}
# ...
{{- end }}
# optional subtree
{{- with .Values.tls }}
{{- toYaml . | nindent 4 }}
{{- end }}
# a required value
password: {{ required "auth.password must be set" .Values.auth.password | quote }}
# iterate
{{- range $i, $h := .Values.hosts }}
- name: host-{{ $i }}
  value: {{ $h | quote }}
{{- end }}
# secret data
data:
  token: {{ .Values.token | b64enc | quote }}
```