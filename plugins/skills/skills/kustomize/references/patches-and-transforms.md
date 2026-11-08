# Patches and transforms

Everything in this file was rendered with Kustomize **v5.5.0**. When a behavior here
drives a decision, reproduce it with `kustomize build` on a three-line overlay before
committing to it.

## 1. The `patches` field

One field, two patch languages, three shapes of entry:

```yaml
patches:
  - path: patches/replicas.yaml                      # strategic merge, matched by name
  - path: patches/json-patch.yaml                    # JSON 6902 (a bare list), needs target
    target:
      group: apps
      version: v1
      kind: Deployment
      name: myapp
  - target:
      kind: Deployment
      name: myapp
    patch: |-
      - op: replace
        path: /spec/replicas
        value: 4
```

- A patch whose document has `apiVersion`/`kind`/`metadata.name` is a **strategic merge
  patch**: a partial object merged into the target, with lists merged by merge key
  (`containers` by `name`, `ports` by `containerPort`, `env` by `name`, `volumes` by
  `name`).
- A patch that is a YAML/JSON **list** is a **JSON 6902 patch**. It has no identity of its
  own, so a `target` is mandatory; omitting it fails with
  `must specify a target for JSON patch [path: "…"]`.
- `patch: |‑` inlines either shape.

`patches` replaced three older fields. All of these still parse in v5.5.0 and print a
deprecation warning; `kustomize edit fix` rewrites them:

| Deprecated | Replacement |
|---|---|
| `patchesStrategicMerge: [file]` | `patches: [{ path: file }]` |
| `patchesJson6902: [{ target, path }]` | `patches: [{ target, path }]` |
| `vars: [{ name, objref, fieldrefs }]` | `replacements: [{ source, targets }]` |
| `commonLabels` | `labels: [{ pairs, includeSelectors: true }]` |
| `bases:` | `resources:` |

A `$(VAR)` left in rendered output is a `vars` reference that never resolved — the
symptom that shows up as a literal `$(SERVICE_NAME)` inside a pod.

## 2. Targeting

`target` fields: `group`, `version`, `kind`, `name`, `namespace`, `labelSelector`,
`annotationSelector`. Unset fields are wildcards.

Verified behaviors worth knowing:

| Situation | Result |
|---|---|
| `target: { kind: Deployment }` only | Patches **every** Deployment in the build |
| `target: { kind: Deployment, name: myapp }` | Exact name match; `'^myapp$'` (a regex) also matches |
| `labelSelector: app=myapp` with the label set in the same file via `labels` or `commonLabels` | **Does not match** — label transforms in the same file are not visible to its own `labelSelector` |
| `annotationSelector` with the annotation added by `commonAnnotations` in the same file | Matches (annotation transforms run before target selection) |
| `labelSelector` matching a label that came from a deeper `resources:` base | Matches |
| Strategic-merge patch with a `target`, body `metadata.name` different from the target | **Still applies** to the target; the body name is ignored |
| Strategic-merge patch with no `target`, body name not in the build | Fails: `no matches for Id …` |
| JSON patch with no `target` | Fails: `must specify a target for JSON patch` |
| Two resources match a non-JSON target | Patch applies to all of them; use `name`/selectors to disambiguate |

Consequence: prefer `kind` + `name` targets in overlays. If you need a `labelSelector`,
add the label in a *base* (or an intermediate kustomization) and select from the overlay
above it — never rely on `labels`/`commonLabels` in the same file as the selector. This
trap costs an afternoon precisely because the build succeeds and the patch silently does
nothing.

## 3. Strategic merge: what it can and cannot do

It merges fields and replaces scalars; it does not "insert" into a keyed list unless you
name the element. Deleting a field is a lock-key protected operation and is not reliably
available everywhere — do not build a workflow on "delete a field with a strategic merge
patch"; use a JSON patch `remove` instead.

Useful idioms:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        - name: myapp                 # merge key: matches the existing container
          resources:
            limits:
              memory: 512Mi
```

To add a whole container, a JSON patch appending to the list is the least surprising
option:

```yaml
- op: add
  path: /spec/template/spec/containers/-
  value:
    name: metrics
    image: registry.example.com/mirror/prometheus:v2.55.1
```

CRDs do not have built-in merge keys. For sophisticated strategic merges against custom
resources, supply the schema:

```yaml
openapi:
  path: schemas/crds.json     # OpenAPI v3 document, e.g. generated from a CRD
```

Without it, lists in a CRD merge as plain "replace" and member patches of CRD fields
behave differently than you expect.

## 4. JSON 6902 quick reference

```yaml
- op: replace
  path: /spec/replicas
  value: 5
- op: add
  path: /spec/template/spec/containers/0/readinessProbe
  value:
    httpGet:
      path: /healthz
      port: 8080
    periodSeconds: 10
- op: add
  path: /metadata/annotations/example.com~1deprecated   # "/" in a key is ~1, "~" is ~0
  value: "true"
```

Paths are evaluated against the serialized object; indices shift after a `remove`, so
order matters. A `replace` on a missing path fails the build — that failure is a feature
when the patch is a guard.

## 5. `replacements`

```yaml
replacements:
  - source:
      kind: Service
      name: myapp
      fieldPath: metadata.name
    targets:
      - select:
          kind: Deployment
          name: myapp
        fieldPaths:
          - spec.template.spec.containers.[name=myapp].env.[name=SERVICE_HOST].value
        options:
          create: true        # create the env entry if it does not exist
```

- `source`: `kind` + `name` (or selectors), `fieldPath`. `name` matches the object's name
  *after* this kustomization's name transforms, so with `namePrefix: prod-` you select
  `name: prod-myapp` — the same ordering rule as strategic-merge patches. When the source
  is a hash-suffixed generated object, `name: app-config` matches
  `app-config-4f64tg9ch6`.
- `targets[].select`: same shape as a patch `target` (`kind`, `name`, `namespace`,
  `labelSelector`, `annotationSelector`, `group`/`version`).
- `fieldPaths`: dot path, `[name=x]` list selectors, numeric indices.
- An unmatched target field fails the build with
  `unable to find field "…" in replacement target`.
- A field can be replaced from multiple sources only if the pattern never matches twice.

`replacements` is the sanctioned way to wire "Service name → env var" or "ConfigMap key
→ another object". It is not a template engine: no concatenation, no conditionals.

## 6. Label, namespace and name transforms

### `labels` vs `commonLabels`

```yaml
labels:
  - pairs:
      app.kubernetes.io/part-of: myapp
    includeSelectors: false     # default
```

- `labels[].pairs` add labels to `metadata.labels` of every resource.
- `includeSelectors: true` also writes them to `spec.selector.matchLabels` and
  `spec.template.metadata.labels` for workloads (and Service `.spec.selector`).
- `commonLabels` is the legacy equivalent of `includeSelectors: true`.

**Immutable-selector trap:** adding a selector key to an existing Deployment fails on
`kubectl apply` with `spec.selector: Invalid value: … field is immutable`. Adding a
selector label is safe only for a workload you are creating. Version, date, or
environment labels must stay out of `includeSelectors`.

`labels[]` entries take exactly three fields in v5.5.0 — `pairs`, `includeSelectors`,
`includeTemplates`:

```yaml
labels:
  - pairs:
      app.kubernetes.io/version: "2.4.1"
    includeSelectors: false
    includeTemplates: true     # label the pod template only
```

- `includeSelectors: true` writes the pairs into `metadata.labels` **and** the workload
  selectors/template plus Service `.spec.selector`.
- `includeTemplates: true` writes them to the pod template labels only — pair it with
  `includeSelectors: false` when a label should reach pods but not the selector.
- There is no per-entry `delete` or `options`: both are rejected with
  `invalid Kustomization: json: unknown field "…"`. To drop a label, patch the object.
- A `pairs` value of `null` renders `label: ""`; it does **not** delete the key.

### `namespace`

- Writes `metadata.namespace` on namespaced resources; cluster-scoped resources
  (`Namespace`, `ClusterRole`, `ClusterRoleBinding`, `PersistentVolume`, CRDs) do not get
  one.
- Rewrites references it knows (subjects of RBAC bindings pointing at in-build objects,
  etc.). It cannot rewrite arbitrary CRD fields that embed a namespace — patch those
  explicitly.
- A `metadata.namespace` already present in a resource is overwritten.

### `namePrefix` / `nameSuffix`

Rewrites `metadata.name` and the references Kustomize knows: `ConfigMap`/`Secret`
volume/`envFrom`/`env.valueFrom`, `serviceAccountName`, `RoleBinding`/`ClusterRoleBinding`
`subjects[].name`, Service names in Ingress backends and CRD `serviceName` fields, and
similar built-in references.

Not rewritten — verified on v5.5.0 unless you add a `replacements` entry:

- `roleRef.name` in a `RoleBinding`/`ClusterRoleBinding` (a `roleRef` pointing at an
  in-build Role keeps the unprefixed name and the binding silently grants nothing);
- names inside free-form strings: annotation values, script text, `command:`/`args:`
  entries, plain env values.

Do not rename resources by patching `metadata.name` in a strategic merge patch — the
reference rewriting does not follow, and the old object is left behind.
