# Generators and overlays

Rendered with Kustomize **v5.5.0**. Generator output is where rollout behavior and secret
hygiene are decided — get it wrong and everything either restarts for no reason or never
restarts at all.

## 1. Generator inputs

```yaml
configMapGenerator:
  - name: app-config
    literals:
      - LOG_LEVEL=info
    files:
      - config/app.properties        # key: app.properties — the whole file as one value
      - app.conf=config/other.conf   # key: app.conf
    envs:
      - config.env                   # each KEY=VALUE becomes its own key
```

`files:` vs `envs:` with the same file:

| Input | Rendered data |
|---|---|
| `files: [config.env]` | `config.env: \|` + the whole file text |
| `envs: [config.env]` | one key per line: `LOG_LEVEL: info`, … |

That distinction is the most common generator bug: a `KEY=VALUE` file listed under
`files:` becomes a single opaque key the application can never read.

`name` must be a valid resource name. The generated object's `data` keys keep their case;
`envs` values are strings (`A=1` renders `A: "1"`).

### secretGenerator

```yaml
secretGenerator:
  - name: app-tls
    type: kubernetes.io/tls
    files:
      - tls.crt=certs/tls.crt
      - tls.key=certs/tls.key
```

Same inputs as `configMapGenerator` plus `type:`. Valid types include `Opaque`,
`kubernetes.io/tls`, `kubernetes.io/dockerconfigjson`, `kubernetes.io/ssh-auth`,
`kubernetes.io/basic-auth`.

`secretGenerator` base64-encodes values into `data` (which is what any Kustomize-rendered
Secret must look like). It is **not** encryption:

- `git log` needs `git diff` to leak the plaintext. Do not commit credential files.
- The rendered stream is what a GitOps controller stores — plaintext-equivalent Secret in
  the cluster and often in the controller's cache.
- Preferred patterns: keep literal Secrets out of the Kustomization and let SOPS /
  Sealed Secrets / External Secrets / Vault CSI fill the gap; or generate from files that
  are `.gitignore`d and injected by CI into a throwaway overlay.

## 2. The hash suffix is the rollout mechanism

By default Kustomize appends a content hash to each generated name:
`app-config` → `app-config-4f64tg9ch6` (10 lowercase characters). It then rewrites every
reference it knows to point at the hashed name — volumes, `envFrom`, `env.valueFrom`,
`configMapRef`, args in the well-known fields. Change the data, the name changes, the
Deployment's pod template changes, the pods roll. That is how a config edit restarts a
workload in a template-free tool.

Consequences:

- **Never hardcode the hashed name.** Reference `app-config`; let the transform hash it.
- Do not include the ConfigMap key in mutable state you cannot re-render (e.g. a manual
  Helm release values file) — the name changes on every data edit.
- `options.disableNameSuffixHash: true` keeps `app-config` stable and therefore removes
  the automatic rollout. Restart manually (`kubectl rollout restart deploy/myapp`) or
  accept stale config. Choose deliberately.
- `options.immutable: true` emits `immutable: true` on the object. With the hash suffix on
  this is safe (each data change is a new object). With the hash disabled it means the
  first update after a data change is rejected by the API server — never pair
  `immutable` with `disableNameSuffixHash`.

## 3. `generatorOptions`

Defaults for every generator in one kustomization file:

```yaml
generatorOptions:
  labels:
    app.kubernetes.io/part-of: myapp
  annotations:
    owner: platform
  disableNameSuffixHash: false
  immutable: false
```

`generatorOptions` applies only within its own file — it does not cascade into bases or
overlays. Set it in the base when the base generates, and again in an overlay that adds
its own generators.

## 4. `behavior:` in overlays

An overlay that lists a base under `resources` **and** generates a name the base already
generated must say what it means:

```yaml
# fails: ConfigMap app-config exists; behavior must be merge or replace
configMapGenerator:
  - name: app-config
    literals:
      - LOG_LEVEL=info
```

| `behavior` | Meaning |
|---|---|
| `create` (default) | This layer owns the object; a name collision with a lower layer is an error |
| `merge` | Merge data into the inherited object; duplicated keys take the overlay's value |
| `replace` | Replace the inherited object's input entirely (new data, new hash, new name) |

```yaml
configMapGenerator:
  - name: app-config
    behavior: merge
    literals:
      - LOG_LEVEL=info      # other keys from the base survive
```

Use `merge` for "environment overrides a few keys", `replace` for "the base data must not
reach this environment", and `create` only in the layer that defines the object.

## 5. Overlay patterns

**Base + per-environment overlay.** The default. Base holds the Deployment and Service;
each overlay adds namespace, prefix, images, and patches.

**Common intermediate layer.** Two overlays that share most of their difference should
share a "staging-like" intermediate:

```
overlays/staging/      → overlays/_common/staging → base
overlays/prod/         → overlays/_common/prod    → base
```

Name shared intermediates with a leading `_` or a `common/` directory so CI does not treat
them as deployable roots.

**Platform vs application.** A platform base (monitoring, policy, controllers) and an
application base are separate roots with separate overlays; different teams own them and
different lifecycles apply.

**One overlay, one deployable unit.** If two overlays must always be applied together,
they are one overlay. If an overlay only changes one manifest for one tenant, use a
component.

## 6. Components

```yaml
# components/observability/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component

labels:
  - pairs:
      app.kubernetes.io/part-of: platform

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
# overlays/prod/kustomization.yaml
components:
  - ../../components/observability
```

- `kind: Component`, `apiVersion: kustomize.config.k8s.io/v1alpha1`.
- Meaningful only when a parent imports it through `components:`. Built directly, a
  patches/labels-only component renders nothing and exits 0; one that also has
  `resources:` renders just those resources. An empty or truncated stream is the symptom
  of building the component directory instead of its owner.
- Applied after the importing overlay's own transforms, which is why a component can
  extend whatever the overlay produced.
- Components may define `resources`, `patches`, generators, labels — anything except
  another component's identity. Keep them small and single-purpose (sidecar, policy
  bundle, labels pack); a "does everything" component is an overlay in disguise.
- No cycles: a component may not import the overlay that imports it.

## 7. `helmCharts`

The Helm chart inflator lets a kustomization consume a chart as a resource:

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

Toolchain requirements — check before designing around this:

- Standalone binary: `kustomize build overlays/prod --enable-helm`, with `helm` on `PATH`
  (the inflator shells out to it). `--helm-command` overrides the binary path.
- Both the standalone binary and `kubectl kustomize` expose `--enable-helm` (kubectl
  1.32 / kustomize v5.5.0 ships the same inflator); whichever you use, the `helm`
  executable must be on `PATH`, and without the flag the build fails with
  `must specify --enable-helm`.
- The embedded build in a GitOps controller is the controller's own binary: check which
  one it runs before assuming the field works there.
- The inflator has no network policy of its own: `repo:` fetches over the network at
  build time, which conflicts with hermetic GitOps pipelines.

Rules if you use it: pin `version`; vendor the chart (or mirror the repo) for hermetic
builds; keep values files in git beside the kustomization; render and diff the output like
any other manifests. When Helm is the primary packaging format and users need
`helm install`/rollback semantics, prefer the `helm-chart-development` skill instead.
