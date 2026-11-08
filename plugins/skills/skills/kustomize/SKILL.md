---
name: kustomize
description: Customize and compose Kubernetes manifests with Kustomize: kustomization.yaml layout, base/overlay trees, strategic-merge and JSON patches with targets, configMapGenerator/secretGenerator, images, replacements, labels and namespace transforms, components, and pinned remote bases. Use when authoring or debugging kustomization.yaml, `kubectl kustomize`, `kubectl apply -k`, `kubectl diff -k`, dev/staging/prod overlays, helmCharts, or Argo CD/Flux rendering.
whenToUse: Use when creating or editing a kustomization.yaml, splitting manifests into a base plus environment overlays, patching upstream or third-party YAML without forking it, generating ConfigMaps or Secrets from literals/files/env files, rewriting image tags per environment, adding components or replacements, pinning remote bases, or diagnosing a build that renders wrong, renders nothing, or differs between kubectl and the standalone kustomize binary.
metadata:
  author: sredevopsorg
  version: "1.0.0"
---

# Kustomize

Kustomize customizes *plain, untemplated* Kubernetes YAML by reading a directory tree.
Each `kustomization.yaml` names resources, and each transform in it — label, namespace,
prefix, patch, generator, image, replacement — is applied by building the siblings up
into one combined manifest stream. There is no template language and no variables in the
manifests, so the output of `kustomize build` is the reviewable artifact.

Everything that goes wrong goes wrong in one of two ways: a transform silently does
nothing (a patch target that matches nothing, a `behavior` that drops base data), or a transform does too much
(selectors rewritten, resources renamed, secrets hashed into a new name). Prefer plain
YAML, small patches, and explicit composition over copying whole files per environment.

Verified against Kustomize **v5.5.0** (the version embedded in kubectl **1.32.3**) and
the standalone `kustomize` binary.

## 1. Non-negotiables

- **Never test with `kubectl apply`.** `kustomize build` / `kubectl kustomize` renders
  with no cluster. Read the rendered stream; it is the review artifact.
- **Bases are environment-agnostic.** No namespace, no prefixes, no environment
  literals, no environment image tags in `base/`. Environment differences belong in
  overlays — a base that is already customized cannot be reused.
- **Bases must never reference overlays.** The dependency arrow points one way:
  `overlay → base`. Components are the only shared fragments overlays may also import.
- **Pin remote resources with `ref=`** to a tag or commit SHA. Never `?ref=main`, never a
  bare branch.
- **Do not commit real secrets.** `secretGenerator` literals are base64 in git, which is
  not encryption. Use SOPS, an external secrets operator, or CI-injected files.
- **Understand what the generated hash suffixes do** before disabling them
  (`disableNameSuffixHash: true`). They are the rollout mechanism for config changes.
- **Know which kustomize runs.** `kubectl` embeds its own Kustomize build, which lags or
  leads the standalone binary. Record `kubectl version` and `kustomize version` when
  output disagrees with a pipeline.
- **One overlay = one deployable variant** (cluster, environment, or tenant slice). If
  two overlays are always applied together, they are one overlay.
- **Diff before merge.** Re-render every overlay in CI and diff the output against the
  previous commit, so an unintended transform is visible in review rather than at sync
  time.

## 2. Layout

```
myapp/
├── base/                     # or bases/<name>/ — one kustomization root
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   └── service.yaml
├── components/
│   └── monitoring/           # kind: Component (apiVersion kustomize.config.k8s.io/v1alpha1)
│       └── kustomization.yaml
└── overlays/
    ├── dev/
    │   └── kustomization.yaml
    ├── staging/
    │   └── kustomization.yaml
    └── prod/
        ├── kustomization.yaml
        ├── config/app.properties
        └── patches/
            ├── replicas.yaml
            └── healthcheck.yaml
```

`kustomization.yaml` can also be named `kustomization.yml` or `Kustomization`; exactly
one per directory. A `resources:` entry may point at a file (`.yaml`), a directory that
holds a kustomization, or a remote URL. One file may hold several documents separated by
`---`; Kustomize splits them and transforms each independently.

## 3. Minimal kustomization

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml
```

Use `apiVersion: kustomize.config.k8s.io/v1beta1` for every normal root and base. The
exception is a component, which is `kustomize.config.k8s.io/v1alpha1` and
`kind: Component`.

```bash
kustomize build overlays/prod            # from the worktree root or anywhere
kubectl kustomize overlays/prod          # the kustomize embedded in kubectl
kustomize build overlays/prod -o out.yaml  # write to a file; -o works for both binaries
```

`kustomize build DIR` with no `DIR` builds `.`. The output is a `---`-separated stream on
stdout. `kubectl kustomize DIR` renders the same way with the Kustomize embedded in
kubectl: it accepts `-o`/`--output`, `--load-restrictor`, and the plugin and helm flags
(`--enable-helm`, `--enable-alpha-plugins`, `--helm-command`, …). No flag difference is
guaranteed across releases, though: a flag accepted by one binary and rejected by the
other on your installs means the two Kustomize versions differ — see §10.

## 4. Bases and overlays

The overlay lists the base under `resources` and adds transforms and patches. Fields in
the overlay apply *after* everything the base did — so with `namePrefix: prod-` below, a
patch or replacement in this file addresses `prod-myapp`, not `myapp`.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base

namespace: myapp-prod
namePrefix: prod-

patches:
  - path: patches/replicas.yaml
```

Rules of thumb:

- Relative paths in `resources`, `patches`, `configMapGenerator.files` and friends are
  resolved against the directory holding that `kustomization.yaml`, not against your
  shell's working directory.
- A transform in an overlay applies to the whole accumulated result, including whatever
  the base produced; a transform in the base is already applied when an overlay renders
  it.
- Prefer several small patches over one large patch file; each patch names the change
  it makes.
- With `--load-restrictor LoadRestrictionsRootOnly` (the default) a kustomization may
  only load files at or below its own directory. Reaching `../` outside the root fails;
  see §10.

## 5. Cross-cutting transforms

| Field | Effect |
| :--- | :--- |
| `namespace` | Set `metadata.namespace` on every namespaced resource |
| `namePrefix` / `nameSuffix` | Prefix/suffix `metadata.name`, and rewrite known references to the old name |
| `labels` | List of `{ pairs, includeSelectors }` entries; adds labels, optionally to selectors |
| `commonLabels` | Older form: adds labels **and** selectors — superseded by `labels` |
| `commonAnnotations` | Add annotations to all resources |
| `images` | Rewrite image names and tags/digests (§7) |
| `replacements` | Copy a field value from one object into another (§8) |

- `labels` with `includeSelectors: true` adds the pairs to `spec.selector.matchLabels` and
  the pod template labels. `includeSelectors: false` (the default) only touches
  `metadata.labels`. Common error: a selector label that carries a version, so the next
  image bump cannot be applied.
- `namePrefix` rewrites references Kustomize knows about: `ConfigMap`/`Secret` volume and
  `envFrom`/`env.valueFrom` references, Service names used as `serviceName`,
  `ServiceAccount` names, and references in the well-known fields. It does **not** rewrite
  the inside of arbitrary strings such as a URL in an annotation or a shell script. A
  Service name that reaches a container through a plain env value is not rewritten —
  either use `replacements` (§8) or let the pod read it from the injected env.
- `namespace` sets `metadata.namespace` on namespaced resources and rewrites references
  it understands into that namespace (e.g. `serviceAccountName` in a RoleBinding subject
  when the account is in the build). It does not know about fields an arbitrary CRD
  defines, and it does not change a `ClusterRoleBinding` subject that points elsewhere.
- Align with the [Kubernetes recommended
  labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/)
  where practical (`app.kubernetes.io/name`, `app.kubernetes.io/instance`,
  `app.kubernetes.io/version`, `app.kubernetes.io/component`, `app.kubernetes.io/part-of`,
  `app.kubernetes.io/managed-by`) — but only the instance/name pair belongs in
  `includeSelectors`.

> **Warning.** `commonLabels` and `labels` with `includeSelectors: true` rewrite label
> selectors on workloads. Adding a selector key to an existing Deployment changes an
> immutable field, so `kubectl apply` is rejected: `field is immutable`. Add selector
> labels before the workload exists, or recreate it. For metadata-only labels on modern
> Kustomize use the `labels` list form with `includeSelectors: false` instead of
> expanding `commonLabels`.

```yaml
labels:
  - pairs:
      app.kubernetes.io/part-of: myapp
    includeSelectors: false

commonAnnotations:
  owner: platform
```

## 6. Patches

`patches` is the single patch field. Each entry has either `patch` (inline string) or
`path` (file), and optionally a `target` that says which objects the patch applies to.

```yaml
patches:
  - path: patches/replicas.yaml          # strategic merge (a full YAML object)
  - path: patches/healthcheck.yaml       # JSON 6902 by default when it is a bare list
    target:
      group: apps
      version: v1
      kind: Deployment
      name: myapp
  - target:
      kind: Deployment
      labelSelector: app=myapp
    patch: |-
      - op: replace
        path: /spec/replicas
        value: 4
```

**Strategic merge** — a partial object whose `apiVersion`/`kind`/`metadata.name` name the
target; lists merge by merge key (containers and env by `name`, ports by
`containerPort`, …), so one container can be amended without restating the others.

```yaml
# patches/replicas.yaml — patches Deployment myapp
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
```

**JSON patch (RFC 6902)** — a YAML list of `op`/`path`/`value`. Use it for precise edits
that strategic merge cannot express (replace an element, delete a key, touch a list with
no merge key). It **requires a `target`** — with no `target` Kustomize fails with
`must specify a target for JSON patch`. The discriminator is the shape of the patch
document: a top-level list is always JSON patch, while a mapping with
`apiVersion`/`kind`/`metadata.name` is strategic merge.

**Patch targets.** Narrow with `group`, `version`, `kind`, `name`, `namespace`,
`labelSelector`, `annotationSelector`. A missing field is a wildcard, so a target of only
`kind: Deployment` patches *every* Deployment in the build. Selector visibility is
asymmetric and worth memorizing: a label added by `labels`/`commonLabels` in the **same
file** is not visible to that file's `labelSelector` — the patch silently does nothing.
`commonAnnotations` *is* visible to `annotationSelector`, and a label that arrived from a
deeper `resources:` base is visible everywhere above it (verified on v5.5.0). The robust
pattern is `kind` + `name`, or a label planted in the base and selected from the overlay.
Always read the rendered output (§12).

**Deprecated fields.** v5 still reads `patchesStrategicMerge`, `patchesJson6902`,
`commonLabels`, `bases` and `vars`, printing a deprecation warning; `kustomize edit fix`
rewrites them to `patches`/`labels`/`resources`/`replacements`. They are removed in
kustomize v6, so do not use them in new work. A `$(NAME)` left in the rendered stream is a
`vars` reference that never resolved.

**A patch that does nothing is silent.** With a `target`, a strategic-merge patch whose
body names a different `metadata.name` still applies to the target — the body name is
unused. Without a `target`, a strategic-merge patch for a name that does not exist fails
with `no matches for Id …`; with a mismatched body name it can merge into the target
regardless. Check the rendered output, not the exit code.

Full detail: [`references/patches-and-transforms.md`](references/patches-and-transforms.md).

## 7. Generators and images

```yaml
configMapGenerator:
  - name: app-config
    literals:
      - LOG_LEVEL=info
    files:
      - config/app.properties          # key = file base name, value = whole file
      - app.conf=config/other.conf     # key = app.conf
    envs:
      - config.env                     # key = each variable in the file
```

- `files:` embeds each file as one string value; `envs:` splits a `KEY=VALUE` file into
  separate keys. The same file listed under `files:` becomes one multi-line value.
- The three inputs are a single key space: a key repeated across `literals:`, `files:`
  and `envs:` in one entry fails the build with `configmap app-config illegally repeats
  the key 'LOG_LEVEL'`. Split the setting so each key is defined once, or drop it from
  the env file.
- `secretGenerator:` uses the same inputs plus `type:` (e.g. `kubernetes.io/tls`,
  `kubernetes.io/dockerconfigjson`, `Opaque`).
- By default the generated name gets a **content hash suffix**
  (`app-config-4f64tg9ch6`), and Kustomize rewrites every known reference to the base name
  so a data change rolls the pods. This is the rollout mechanism. Do not reference the
  hashed name yourself: reference the base name and let the transform hash it.
- `options.disableNameSuffixHash: true` on an entry keeps a stable name but **removes
  that rollout**: pods keep the old config until something else restarts them.
- `options.immutable: true` emits `immutable: true`. With the default hash suffix that is
  safe (a data change is a new object). With the hash disabled, the first data change is
  rejected by the API server — never pair the two.

```yaml
secretGenerator:
  - name: app-tls
    type: kubernetes.io/tls
    files:
      - tls.crt=certs/tls.crt
      - tls.key=certs/tls.key
```

> **Caution.** `secretGenerator` output is base64, not encryption, and it lands in git as
> plaintext-equivalent `data`. Keep credential files out of the repo (`.gitignore`), or
> leave the Secret as a gap that SOPS, External Secrets, Sealed Secrets or the GitOps
> controller fills. Treat `literals:` in a tracked `secretGenerator` as non-production or
> bootstrap-only.

`generatorOptions` sets defaults for every generator in the same kustomization file —
`labels`, `annotations`, `disableNameSuffixHash`, `immutable`:

```yaml
generatorOptions:
  labels:
    app.kubernetes.io/part-of: myapp
  annotations:
    owner: platform
  disableNameSuffixHash: false
```

**Overlay generators** need `behavior:`. Without it, an overlay that generates a name the
base already generated fails with `… exists; behavior must be merge or replace`.

```yaml
# overlays/prod/kustomization.yaml
configMapGenerator:
  - name: app-config
    behavior: merge        # merge into the base's data, override listed keys
    literals:
      - LOG_LEVEL=info
```

- `create` (the default) means "this layer owns the object". Use it only in the layer
  that generates it.
- `merge` combines with the same-named object inherited from `resources`. Overridden keys
  win; other keys survive.
- `replace` swaps the object's whole input for this one (a new hash and hence a new name
  when the hash is enabled); use it when the base data must not leak through.

**Images.** `images[].name` matches the image string *before* transforms; only the name
part is matched, so `myapp` also matches `myapp:latest`. `newName` replaces the
repository (and can carry a registry), `newTag` replaces the tag, `digest` replaces the
tag with `@sha256:…`. Use `digest` for immutable pinning; setting both produces
`repo:tag@sha256:…`, which is legal but redundant and easy to read as "tag wins".

```yaml
images:
  - name: myapp
    newName: registry.example.com/myorg/myapp
    newTag: "1.2.3"
```

## 8. Replacements

Copy a field value from one object into one or more fields of another — the supported
successor to `vars`, for example injecting the post-`namePrefix` Service name:

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
```

- `source.name` is matched against the object's name **after** this file's name
  transforms: with `namePrefix: prod-` you select `name: prod-myapp` and the copied value
  is `prod-myapp`. A hash-suffixed generated object is matched by its base name
  (`name: app-config`) and its hashed name is what gets copied.
- `fieldPaths` use Kustomize's path syntax: dot-separated fields, `[name=foo]` list
  selectors, and numeric indices.
- `options.create: true` on a target creates the list entry if it is missing.
- An unmatched target field fails the build (`unable to find field … in replacement
  target`), so a replacement is a check that the field still exists.
- Prefer `replacements` over sed-style edits in scripts and docs.

## 9. Components

Components are reusable fragments an overlay *imports*; unlike bases they are never
deployed alone and they are applied after the overlay's own transforms.

```yaml
# components/monitoring/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component

patches:
  - target:
      kind: Deployment
    patch: |-
      - op: add
        path: /spec/template/spec/containers/-
        value:
          name: metrics
          image: registry.example.com/mirror/prometheus:v2.55.1
```

```yaml
# an overlay that enables it
components:
  - ../../components/monitoring
```

Keep components focused (a sidecar, a network-policy bundle, a set of labels), give
them their own `patches`/`resources`, and avoid cycles between components and overlays.
A component is meaningful only when a parent imports it via `components:`. Building a
component directory directly exits 0 while rendering nothing (a patches-only component)
or only its own `resources:` — a silently empty or truncated stream is the symptom of
building the wrong directory.

## 10. Remote bases, directories, and lookup order

```yaml
resources:
  - https://github.com/org/manifests//deploy/base?ref=v1.4.2
  - github.com/org/manifests//deploy/base?ref=3f2a9c1
```

- The `//` separates the repository URL from the in-repo path. Always pin `ref` to a tag
  or commit SHA. Treat remote bases like supply-chain inputs: review upgrades, vendor or
  mirror when policy requires, and record the pin in the changelog.
- Remote bases are fetched with `git`; the host must be reachable at build time. Avoid
  non-hermetic fetches in production GitOps paths unless policy allows them and they are
  pinned.
- A local kustomization may only load files at or below its own root: with the default
  `--load-restrictor LoadRestrictionsRootOnly`, a `patches`/`resources`/generator path
  that escapes the directory fails with `security; file … is not in or below …`. Keep
  shared files in a shared base, or pass `--load-restrictor LoadRestrictionsNone` —
  accepting that the kustomization is then no longer relocatable.
- One repo directory can serve many overlays; do not duplicate the base per environment.

> **Important.** Embedded Kustomize in `kubectl` can lag or lead the standalone
> `kustomize` binary. `kubectl version` prints the embedded `Kustomize Version`; compare
> it with `kustomize version`. If output differs, reproduce with both before editing
> YAML, and pin one release line for CI and the GitOps controller.

## 11. helmCharts (optional, toolchain-dependent)

Some Kustomize builds can render Helm charts from a `kustomization.yaml`. Rendering is
done by the **Helm chart inflator**, which needs two things at build time: `--enable-helm`
passed to the build (both the standalone binary and `kubectl kustomize` expose it, and
`--helm-command` points at a non-default binary), and a working `helm` on `PATH`. Without
the flag the build fails with `must specify --enable-helm`; without `helm` it fails to run
`helm version`. Check your toolchain before designing around it.

```yaml
helmCharts:
  - name: ingress-nginx
    repo: https://kubernetes.github.io/ingress-nginx
    version: 4.11.3
    releaseName: ingress
    namespace: ingress-nginx
    valuesFile: values-ingress.yaml
    includeCRDs: true
```

If you use it: pin `version`, keep values files in git next to the kustomization, and
validate the rendered stream. A remote `repo:` needs network access at build time — if
GitOps policy forbids that, vendor the chart. When Helm is the primary packaging format,
prefer the `helm-chart-development` skill and plain Helm.

## 12. Validation workflow

Run before every apply or merge:

```bash
kustomize build overlays/prod > /tmp/rendered.yaml   # or: kubectl kustomize overlays/prod
kubectl apply --dry-run=client -f /tmp/rendered.yaml # offline schema/type check
kubectl apply --dry-run=server -f /tmp/rendered.yaml # needs a cluster; truly validates
kubectl diff -k overlays/prod                        # needs a cluster; diff against live
```

- `kubectl apply -k DIR` renders and applies in one step; `kubectl diff -k DIR` and
  `kubectl apply --dry-run=client -k DIR` render and check without mutating anything.
  Use the diff as the review step before `apply -k`.
- The repo ships `scripts/verify-kustomize.mjs`: it builds each kustomization root, falls
  back to `kubectl kustomize`, and adds the checks `kustomize build` does not do — empty
  renders, duplicate objects, unresolved `$(VAR)`/`${VAR}` placeholders, tab
  indentation, and missing document separators. Run it in CI:

  ```bash
  node <skill-dir>/scripts/verify-kustomize.mjs overlays/prod
  node <skill-dir>/scripts/verify-kustomize.mjs overlays --strict
  ```

- In GitOps, run the same `kustomize build` (or controller-equivalent) in CI so the
  cluster never sees composition that was not rendered and reviewed.
- Keep the rendered stream in a committed artifact or a CI artifact when manifests must be
  audited; do not rely on the cluster to tell you what the overlay produced.

## 13. GitOps alignment

- Argo CD and Flux both consume Kustomize. Keep the kustomization root explicit in the
  Argo CD `Application` (`spec.source.path` plus `kustomize:` options) or the Flux
  `Kustomization` CR (`spec.path`, `spec.postBuild`); do not rely on directory scanning
  defaults.
- Pin the Kustomize binary version where the controller lets you (Flux `spec.kustomize`
  / controller flags, Argo CD `kustomize.buildOptions` and `kustomize.version`), so the
  cluster renders what CI rendered.
- Avoid non-hermetic fetches in production paths: no unpinned remote bases, no
  `helmCharts.repo` pointing at the internet unless mirrored.
- Split "platform" and "application" bases when different teams own their lifecycles, and
  keep generated Secrets out of the synced path — point the controller at a Secret store
  or a SOPS-decrypting path instead.
- CI check worth keeping: rebuild every overlay on each PR, diff the rendered output
  against the previous commit, and fail on unexpected changes.

## 14. Common failure modes

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| Patch did nothing | Wrong `metadata.name`/`kind`, a `target` that matches nothing, or a `labelSelector` on a label set in the same file | Verify the rendered stream; target by `kind`+`name`; §6 |
| `must specify a target for JSON patch` | A JSON patch with no `target` | Add `target:` or convert the patch to strategic merge |
| `… exists; behavior must be merge or replace` | Overlay generates a name the base already generates | Add `behavior: merge` (or `replace`) |
| Pods did not restart on config change | `disableNameSuffixHash: true`, or the reference does not go through a known name transform | Remove the option; read the ConfigMap via volume/envFrom |
| `field is immutable` on Deployment apply | A label transform added a selector key | Keep the key out of `includeSelectors` and out of the template labels |
| `security; file … is not in or below …` | Path escapes the kustomization root | Put the file under the root, or `--load-restrictor LoadRestrictionsNone` |
| `no matches for Id …` | Strategic-merge patch for a name that does not exist in the build | Fix the name, or add a `target` |
| Remote build flaky or slow | Unpinned `ref`, network policy, git-host rate limits | Pin to a SHA, vendor the base, or mirror |
| Output differs between CI and `kubectl apply -k` | Different embedded Kustomize versions | Align versions; debug with both binaries |
| `must specify --enable-helm` / `unable to run: 'helm version'` | `helmCharts` build without `--enable-helm`, or without `helm` on `PATH` | Pass `--enable-helm` and install Helm |
| Empty or zero-document render | `resources:` points at a file that holds only comments, or no kustomization found | Check `resources`; `verify-kustomize.mjs` fails on empty renders |

## 15. Anti-patterns

- Environment literals, namespaces or image tags inside `base/`.
- `commonLabels`/`includeSelectors: true` on a workload that already exists.
- `kubectl apply` as the test loop.
- Patching `metadata.name` to rename a resource instead of `namePrefix`.
- Generating a Secret from committed plaintext files and calling it secret.
- Copy-pasting a base per environment because the overlays became unreadable.
- Editing the rendered output by hand and committing it.

## References

- [`references/patches-and-transforms.md`](references/patches-and-transforms.md) —
  strategic merge vs JSON 6902 semantics, target selection, replacements syntax, label /
  namespace / name transforms and what they rewrite.
- [`references/generators-and-overlays.md`](references/generators-and-overlays.md) —
  generator inputs, hash suffixes, `behavior`, `generatorOptions`, overlays, components
  and `helmCharts`.
- [`references/remote-bases-and-cicd.md`](references/remote-bases-and-cicd.md) — remote
  references and pinning, load restrictor, kustomize-vs-kubectl drift, CI and GitOps
  rendering, secret hygiene.
- [`references/troubleshooting.md`](references/troubleshooting.md) — error-message → cause
  → fix table and debugging sequences.
- [`scripts/verify-kustomize.mjs`](scripts/verify-kustomize.mjs) — cluster-free render
  validation: empty output, duplicate objects, placeholders, tabs, separators.

Source: [kustomize.io](https://kustomize.io/),
[Kubernetes: Declarative management of Kubernetes objects using
Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/),
[Managing Secrets using
Kustomize](https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-kustomize/),
and [Kubernetes common
labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/).
