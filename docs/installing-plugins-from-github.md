# Installing plugins from GitHub

This repository is a monorepo: each plugin under [`plugins/`](../plugins/) is a
self-contained DSH bundle with no dependencies and no build step. The packages
are not published to npm, so they install straight from this GitHub repository
with pnpm's Git **subdirectory** support.

`dsh plugin` forwards its arguments to pnpm, so the install address is a normal
pnpm Git spec:

```
github:sredevopsorg/dsh-plugins#<plugin-directory>-v<version>&path:/plugins/<plugin-directory>
```

- `github:` selects the GitHub shorthand.
- `<plugin-directory>-v<version>` is the release tag, e.g. `flaresolverr-v1.0.2`.
- `&path:/plugins/<plugin-directory>` tells pnpm to pack only that package from
  the monorepo (supported since pnpm 9).
- Quote the whole spec: the shell must not interpret `&`.

## Requirements

- **DSH `^0.2.1-rc.2`** — the `engines.dsh` gate in every package, and the
  version checked by CI.
- **Git** on `PATH` and network access to GitHub. DSH checks a GitHub address
  with `git ls-remote` before pnpm starts.
- **pnpm 9 or newer**, which DSH invokes for `dsh plugin` operations. No build
  script runs, so no `allowBuilds` approval is needed.

## Pinned installs (recommended)

| Plugin | Tag | Command |
|---|---|---|
| `architect-dev-bundle` | `architect-dev-bundle-v1.3.1` | `dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#architect-dev-bundle-v1.3.1&path:/plugins/architect-dev-bundle"` |
| `flaresolverr` | `flaresolverr-v1.0.2` | `dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#flaresolverr-v1.0.2&path:/plugins/flaresolverr"` |
| `suggest-resources` | `suggest-resources-v1.0.2` | `dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#suggest-resources-v1.0.2&path:/plugins/suggest-resources"` |

Replace `web` with the profile you use. The tag is immutable: a new release gets
a new tag and a new version, so an install command always reproduces the same
package contents.

### Equivalent full-URL form

If your environment does not accept the `github:` shorthand, spell out the Git
URL — pnpm treats both forms as the same dependency:

```bash
dsh plugin --profile web add "git+https://github.com/sredevopsorg/dsh-plugins.git#flaresolverr-v1.0.2&path:/plugins/flaresolverr"
```

### Other refs

| Ref | Example fragment | Use |
|---|---|---|
| Release tag | `#flaresolverr-v1.0.2&path:/plugins/flaresolverr` | Reproducible install (recommended) |
| Commit | `#<40-hex-commit>&path:/plugins/flaresolverr` | Reproducible install before a tag exists |
| Branch | `#main&path:/plugins/flaresolverr` | Latest unreleased code; may change without notice |

## Install through `plugin_manager` or the Web UI

The same spec works anywhere DSH accepts a bundle target.

In a Web session, `plugin_manager` with `install_bundle`:

```json
{
  "action": "install_bundle",
  "target": "github:sredevopsorg/dsh-plugins#suggest-resources-v1.0.2&path:/plugins/suggest-resources"
}
```

Every call needs full access or approval. The Plugins page's install dialog
accepts the same string in its spec field. Installing enables the bundle by
default; on a profile without HMR, restart DSH before the new rows load.

## Verify

```bash
dsh plugin --profile web list
dsh --profile web --dump-config | grep -E 'architect-dev|flaresolverr|suggest-resources'
```

Then in a new session, load the plugin's tool or select the preset:

- `suggest_resources` appears in the tool list.
- `flaresolverr` appears in the tool list.
- **Architect Dev** appears in the preset selector.

See each plugin README for its full verification checklist.

## Update

Install the newer tag over the existing package:

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#flaresolverr-v1.0.3&path:/plugins/flaresolverr"
```

If the bundle is running and cannot be replaced in place, DSH reports
`restart-required`; restart DSH. If you prefer a clean replacement, remove first
and then install the new tag.

## Uninstall

```bash
dsh plugin --profile web remove @sredevopsorg/dsh-flaresolverr
```

Use the package name, not the Git address. Then restart DSH if it reports
`restart-required`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ERR_PNPM_...` or "package.json not found" | The `&path:/plugins/<dir>` segment is missing, unquoted, or points at the wrong directory. Use the exact command from the table. |
| `fatal: could not read from remote repository` | Git is missing, the network is blocked, or the repository is private and credentials are not configured. DSH's preflight reports a network failure before pnpm starts. |
| `ERR_PNPM_UNSUPPORTED_PROTOCOL` or the `path:` parameter is ignored | The pnpm behind DSH is older than 9. Upgrade pnpm. |
| "no version compatible with the running DSH" | The package's `engines.dsh` rejects the running DSH. Use a matching DSH release; a version exemption is a deliberate, risky override. |
| Tag not found | Release tags are created after the version bump merges. Use the commit-pinned or `#main` form until the tag is published, or check the tag list on GitHub. |
| `Cannot find module '@sredevopsorg/...'` after install | The bundle is installed but not selected, or DSH needs a restart (no HMR). Check `dsh --profile <p> --dump-config`, then restart. |

## Release tags

Maintainers tag one plugin at a time:

```
<plugin-directory>-v<package-version>
```

Examples: `flaresolverr-v1.0.2`, `architect-dev-bundle-v1.3.1`,
`suggest-resources-v1.0.2`.

The procedure is:

1. Bump `version` in `plugins/<dir>/package.json` and update the install tables
   in this repository.
2. Run `node scripts/validate-github-install.mjs --strict`.
3. Commit the change on `main`.
4. Create and push the tag:

   ```bash
   node scripts/release-tag.mjs --plugin flaresolverr --push
   ```

The tag push starts [`.github/workflows/release.yml`](../.github/workflows/release.yml),
which revalidates the tag against the package version and creates the GitHub
release. Never move a published tag; release a new version instead.
