# Remote bases, versions, and CI/GitOps rendering

## 1. Remote resources

```yaml
resources:
  - https://github.com/org/manifests//deploy/base?ref=v1.4.2
  - github.com/org/manifests//deploy/base?ref=3f2a9c1
```

- `//` separates the repository from the in-repo directory. Without `//` the path is
  ambiguous.
- `ref` accepts a branch, a tag, or a commit SHA. **Pin a tag or a SHA.** A branch means
  the rendered output changes without a commit in your repo, which silently defeats
  review and rollback.
- Fetching uses `git` and needs network access at build time. Rate limits, private repos,
  and proxy policy all become build failures.
- For hermetic builds, vendor the dependency (`kustomize build` the remote ref once and
  commit the output, or copy the directory in) and point `resources` at the vendored copy.

Treat a remote base as a supply-chain input: review the upstream diff when you move the
pin, record the pin in the changelog, and diff the rendered output in CI.

## 2. `--load-restrictor`

Default: `LoadRestrictionsRootOnly`. A kustomization may read files only at or below its
own directory. Reaching outside fails:

```
security; file '/repo/shared/patch.json' is not in or below '/repo/overlays/prod'
```

Options:

1. Move the shared file under a shared base and reference the base, not the file.
2. Duplicate the small patch (often the honest answer for a five-line patch).
3. Pass `--load-restrictor LoadRestrictionsNone`.

`LoadRestrictionsNone` makes the kustomization non-relocatable and removes a security
boundary that matters when manifests come from pull requests. Set it only in CI where the
tree is trusted, and never as a default in a wrapper script.

## 3. kubectl-embedded vs standalone Kustomize

```
kubectl version --client       # prints "Kustomize Version: v5.x.y"
kustomize version              # e.g. v5.5.0, or "(devel)" for an untagged build
```

`kubectl apply -k` and `kubectl kustomize` use the **embedded** build, which is whatever
the kubectl release shipped with — not necessarily the binary on your PATH, and not
necessarily what Argo CD or Flux use. Known drift areas:

| Area | Why it differs |
|---|---|
| Newer fields (`labels` replacing `commonLabels`, `replacements`) | Older embedded builds do not know them |
| `helmCharts` | Both binaries expose `--enable-helm`, but the inflator shells out to the `helm` binary, which must be on `PATH` |
| `-o`/`--output`, `--load-restrictor`, `--enable-helm` | Present in **both** on kubectl 1.32.3 (`kubectl kustomize --help` lists them all); the risk is an older/newer embedded release exposing a different set |
| Deprecation timing | A newer standalone binary deprecates fields whose removal the embedded build has not made yet, and an older embedded build can reject fields the newer binary added |

When output disagrees, reproduce with both binaries, record both versions in the issue,
and pin one version for the whole pipeline. `kustomize version` reporting `(devel)` (an
untagged build) is itself a warning that the binary is not a pinned release.

## 4. CI and GitOps rendering

The invariant: **the cluster must only ever see output some pipeline rendered, validated,
and diffed.**

```bash
# Render
kustomize build overlays/prod > /tmp/rendered.yaml
# Validate offline
kubectl apply --dry-run=client -f /tmp/rendered.yaml
# Validate against a schema-aware server when available
kubectl apply --dry-run=server -f /tmp/rendered.yaml
# Show what would actually change
kubectl diff -k overlays/prod
```

**Argo CD.** Set `spec.source.path` to the overlay and `spec.source.kustomize` for options
(`images`, `namePrefix`, `commonLabels`, `patches`); set the controller's Kustomize binary
version with `kustomize.version` in `argocd-cm` and options with
`kustomize.buildOptions`. Options set in the Application layer the render on top of the
repo's kustomization, so a `namePrefix` there composes with the one in the overlay. Do not
point two Applications at the same overlay unless you intend to compete for the same
objects.

**Flux.** Use a `Kustomization` CR with `spec.path` to the overlay; `spec.postBuild`
substitutes CI-injected variables after rendering (this is where `${IMAGE_TAG}` style
injection belongs), and `spec.kustomize`/controller flags pin the binary and options.

**CI checks worth the minute they cost:**

```bash
# every overlay must render
for d in overlays/*/; do kustomize build "$d" > /dev/null || exit 1; done
# the repo helper adds empty-render, duplicate-object and placeholder checks
node scripts/verify-kustomize.mjs overlays --strict
# nothing rendered may still reference an unsubstituted $(VAR) or ${VAR}
grep -rnE '\$\([A-Z_]+\)|\$\{[A-Z_]+\}' /tmp/rendered.yaml
```

Also diff the rendered output between the pull request branch and the merge base, and fail
on unexpected changes — that catches a base change leaking into an overlay nobody
reviewed.

**Do not** render on the cluster side by patching in place, and do not let a CI job apply
a different overlay than the one the GitOps controller renders.

## 5. Secret hygiene in GitOps

- Keep `secretGenerator` out of the synced path when the data is real. A synced
  `secretGenerator` means a plaintext-equivalent Secret in git history and in the
  controller cache.
- SOPS: encrypt the value files, decrypt in CI (or let the controller's SOPS plugin
  decrypt) and feed `secretGenerator.files`. The rendered Secret is still plaintext at
  runtime — that is expected; the goal is to keep it out of git.
- External Secrets Operator / Secrets Store CSI Driver: keep a `Secret` reference out of
  the Kustomization entirely and let the operator populate it. Then pods must tolerate the
  Secret appearing after the workload (init container, retry).
- Sealed Secrets: the SealedSecret is cluster-bound; commit it, not the Secret.
- Never `kubectl get secret -o yaml` into a file and commit it; that is the same mistake
  with extra steps.
