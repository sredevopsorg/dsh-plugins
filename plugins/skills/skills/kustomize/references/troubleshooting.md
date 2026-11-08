# Troubleshooting Kustomize

Read the *first* error, not the last: Kustomize wraps accumulation errors. The usual
sequence is: does it build → does the rendered output contain what I meant → does the
cluster accept it.

## 1. Error message → cause → fix

| Message | Cause | Fix |
|---|---|---|
| `must specify a target for JSON patch [path: "x.json"]` | A JSON 6902 patch (a bare list) with no `target` | Add `target:` (group/version/kind/name), or rewrite the patch as strategic merge |
| `no resource matches strategic merge patch "Deployment.v1.apps/foo.[noNs]": no matches for Id …` | Strategic-merge patch without a `target`, and no built object has that kind/name | Fix `metadata.name`/`kind`; or add a `target` and let it select |
| `merging from generator …: id … Name:"app-config" … exists; behavior must be merge or replace` | An overlay generates a name the base already generated | Add `behavior: merge` (override keys) or `behavior: replace` (drop base data) |
| `security; file '…' is not in or below '…'` | `--load-restrictor LoadRestrictionsRootOnly` (default) and a path escapes the root | Keep the file under the root, or build with `--load-restrictor LoadRestrictionsNone` |
| `unable to find field "…" in replacement target` | A `replacements[].fieldPaths` entry no longer exists on the selected object | Fix the path, add `options.create: true`, or drop the target |
| `error converting YAML to JSON: yaml: line N: did not find expected key` | Malformed YAML in a resource or patch file | Open the file at line N; check indentation and quoting |
| `unable to find one of 'kustomization.yaml', 'kustomization.yml' or 'Kustomization' in directory '…'` | Build directory is wrong, or the file is nested one level too deep | `kustomize build <dir-with-kustomization>` |
| `accumulating resources: … resource 'x.yaml' is not a valid resource` | `resources:` lists a file that is not a K8s object, or a directory with no kustomization | Fix the path or add a kustomization |
| `must build at directory: not a valid directory: evalsymlink failure …` | Path does not exist relative to the current directory (often a `../` mistake) | Check the path against the kustomization's own directory |
| `failed to get the patch file from path(…): evalsymlink failure …` | Same, for `patches[].path` | Fix the relative path |
| `error loading auth plugin` / git fetch errors on a remote base | Unreachable host, private repo without credentials, or rate limiting | Pin to a SHA, add credentials, or vendor the base |
| `invalid Kustomization: json: unknown field "…"` | Field not supported by this Kustomize version (often `helmCharts` or a newer field on an older embedded build) | Upgrade the binary or use the field's older equivalent |
| `Error: must specify a namespace` / unexpected namespace on objects | `namespace:` applied to resources that must live elsewhere | Move that resource to another kustomization or patch the namespace explicitly |
| Warning `'patchesStrategicMerge' is deprecated` | Legacy field still parsed | `kustomize edit fix` rewrites to `patches` |
| `kustomize build` succeeds, `kubectl apply` fails with `field is immutable` | A label transform changed `spec.selector` on an existing Deployment | Remove the label from `includeSelectors`; recreate the workload if it is already live |

## 2. "The patch did nothing"

In this order:

1. **Render and grep.** `kustomize build overlays/prod | grep -A3 replicas`. No change means
   the patch never applied.
2. **Check identity.** For strategic merge without `target`, `kind` and `metadata.name`
   must match the built object exactly, including any `namePrefix` from *this* overlay —
   the patch is applied after prefixes, so `name: myapp` does not match `prod-myapp`.
3. **Check the target.** A `target` with no `name`/selector matches every object of that
   kind, which may be a different object than you meant. Conversely, adding `group`/
   `version`/`namespace` that the object does not have matches nothing.
4. **Check the patch language.** A bare list is JSON 6902, not strategic merge. A document
   without `apiVersion`/`kind` may still parse as JSON and then fail for "no target".
5. **Check ordering.** Another layer may overwrite the value afterwards.

## 3. "The rendered output is wrong, not the patch"

- Names: `namePrefix`/`nameSuffix` are cumulative down the chain (`base` `myapp` →
  overlay prefix `prod-` → `prod-myapp`). The hash suffix adds 10 more characters; watch
  the 63-character DNS-1123 and 253-character service-name limits.
- Selectors: a `labels` entry with `includeSelectors: true` (or `commonLabels`) rewrites
  `spec.selector.matchLabels` and template labels — which is correct for a new workload
  and an apply error for an existing one.
- ConfigMaps/Secrets: the hash suffix is expected. A stable name means someone set
  `disableNameSuffixHash: true`.
- Duplicates: two layers creating the same object is an error at apply time
  (`AlreadyExists`) or a silent overwrite in the stream — `verify-kustomize.mjs` flags
  duplicate kinds/names.

## 4. "kubectl and kustomize disagree"

```bash
kubectl version --client      # embedded "Kustomize Version"
kustomize version             # standalone
```

Build the same directory with both and diff:

```bash
kustomize build overlays/prod > /tmp/a.yaml
kubectl kustomize overlays/prod > /tmp/b.yaml
diff -u /tmp/a.yaml /tmp/b.yaml | head -40
```

A standalone binary reporting `(devel)` is an untagged build — pin a release. Do **not**
assume `kubectl kustomize` is flag-poorer: on kubectl 1.32.3 it accepts
`-o/--output`, `--load-restrictor`, `--enable-helm`, `--enable-alpha-plugins`,
`--helm-command`, `--helm-debug`, and `--mount`. If `kubectl kustomize` rejects a flag,
run `kubectl kustomize --help` and compare against the `Kustomize Version` inside
`kubectl version`: the flag set tracks the embedded Kustomize, so an older embedded
release can lack a newer flag.

## 5. "It builds but the cluster rejects it"

The composition is fine and the manifest is wrong for the cluster:

```bash
kubectl apply --dry-run=client -f /tmp/rendered.yaml   # offline: types, required fields
kubectl apply --dry-run=server -f /tmp/rendered.yaml   # API server: admission, defaults
kubectl diff -k overlays/prod                          # what would actually change
```

`--dry-run=client` validates locally and is safe on a laptop without a cluster; it does
not catch admission, immutability, or CRD schema errors. Those need `--dry-run=server` or
`diff`, plus a cluster you are allowed to read.

## 6. A checklist before you assume it is Kustomize's fault

- Are you building the directory you think (`kustomize build` with an explicit path)?
- Is there more than one kustomization file in the directory?
- Does `git status` show the patch file as untracked — i.e. it exists locally and not in
  CI?
- Is the failure in the kustomization or in a helm inflator / remote base it pulls?
- Does the same directory render on a clean machine with the pinned binary?
