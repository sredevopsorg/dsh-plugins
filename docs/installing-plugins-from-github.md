# Installing plugins from GitHub

This repository is a monorepo: each plugin under [`plugins/`](../plugins/) is a
self-contained DSH bundle. No package runs a build or install lifecycle script when
pnpm fetches it: runtime dependencies (if any) are declared in `package.json` and any
build output is committed. In particular, the forked `plugins/superagent` keeps its
TypeScript toolchain for development, but a Git install uses the committed `lib/`.
The packages are not published to npm, so they install straight from this GitHub
repository with pnpm's Git **subdirectory** support.

There are two ways to install them:

- **Discover** — add the repository's [plugin market index](../docs/plugin-index.md)
  under **Plugins → Discover → Add index source** and install a listed version.
  The index pins every version to its release-tag commit, so this is the same
  package with the same pinning and less typing.
- **A pnpm Git spec** — install a pinned release tag directly, as documented
  below.

`dsh plugin` forwards its arguments to pnpm, so the install address is a normal
pnpm Git spec:

```
github:sredevopsorg/dsh-plugins#<plugin-directory>-v<version>&path:/plugins/<plugin-directory>
```

- `github:` selects the GitHub shorthand.
- `<plugin-directory>-v<version>` is the release tag, e.g. `entire-v0.2.0`.
- `&path:/plugins/<plugin-directory>` tells pnpm to pack only that package from
  the monorepo (supported since pnpm 9).
- Quote the whole spec: the shell must not interpret `&`.

## Requirements

- **DSH `^0.2.1-rc.2`** — the `engines.dsh` gate in every package. CI, release,
  and versioning install and verify `@deepseek-ai/dsh@0.2.2-rc.1`; DSH's gate is
  prerelease-inclusive, so the pinned release satisfies the range. The Discover
  flow additionally needs the experimental **Custom plugin indexes** bundle
  enabled in the Web profile.
- **Git** on `PATH` and network access to GitHub. DSH checks a GitHub address
  with `git ls-remote` before pnpm starts.
- **pnpm 9 or newer**, which DSH invokes for `dsh plugin` operations. No build
  script runs, so no `allowBuilds` approval is needed. `plugins/superagent`
  also fetches its two runtime dependencies (`zod`, `proper-lockfile`) from the
  npm registry.
- **Node.js 22.19+ or 24+ and a Web profile** — only for `superagent`, whose
  management panel and client bundle load in the Web UI; `code-editor` also
  needs a Web profile with the built-in right Sidebar.

## Pinned installs (recommended)

| Plugin | Tag | Command |
|---|---|---|
| `code-editor` | `code-editor-v0.1.0` | `dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#code-editor-v0.1.0&path:/plugins/code-editor"` |
| `entire` | `entire-v0.2.0` | `dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#entire-v0.2.0&path:/plugins/entire"` |
| `skills` | `skills-v0.2.0` | `dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#skills-v0.2.0&path:/plugins/skills"` |
| `superagent` | `superagent-v0.1.2` | `dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#superagent-v0.1.2&path:/plugins/superagent"` |

Replace `web` with the profile you use. The tag is immutable: a new release gets
a new tag and a new version, so an install command always reproduces the same
package contents.

### Equivalent full-URL form

If your environment does not accept the `github:` shorthand, spell out the Git
URL — pnpm treats both forms as the same dependency:

```bash
dsh plugin --profile web add "git+https://github.com/sredevopsorg/dsh-plugins.git#entire-v0.2.0&path:/plugins/entire"
```

### Other refs

| Ref | Example fragment | Use |
|---|---|---|
| Release tag | `#entire-v0.2.0&path:/plugins/entire` | Reproducible install (recommended) |
| Commit | `#<40-hex-commit>&path:/plugins/entire` | Reproducible install before a tag exists |
| Branch | `#main&path:/plugins/entire` | Latest unreleased code; may change without notice |

## Install through `plugin_manager` or the Web UI

The same spec works anywhere DSH accepts a bundle target.

In a Web session, `plugin_manager` with `install_bundle`:

```json
{
  "action": "install_bundle",
  "target": "github:sredevopsorg/dsh-plugins#entire-v0.2.0&path:/plugins/entire"
}
```

Every call needs full access or approval. The Plugins page's install dialog
accepts the same string in its spec field. Installing enables the bundle by
default; on a profile without HMR, restart DSH before the new rows load.

## Verify

```bash
dsh plugin --profile web list
dsh --profile web --dump-config | grep -E 'code-editor|entire|skills|superagent'
```

Then in a new session, confirm the plugin's surface appears:

- `code-editor` — the right Sidebar guide lists **Code editor** and opens a workspace file.
- `entire` — the Entire tools appear in the tool list.
- `skills` — every repository skill appears in the skill catalog (`/` lists them).
- `superagent` — the **Superagent** sidebar entry opens its management panel.

See the plugin README for its full verification checklist.

## Update

Install the newer tag over the existing package:

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#entire-v0.2.1&path:/plugins/entire"
```

If the bundle is running and cannot be replaced in place, DSH reports
`restart-required`; restart DSH. If you prefer a clean replacement, remove first
and then install the new tag.

## Uninstall

```bash
dsh plugin --profile web remove @sredevopsorg/dsh-entire
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
| Tag not found | Release tags are created by the `version-plugins` workflow after the version bump merges. If the tag is missing, that workflow failed or was skipped; use the commit-pinned or `#main` form until it runs, or check the tag list on GitHub. |
| Discover shows an older version | Merge the index update pull request that the release workflow opens after a tag push; see [Publishing the plugin index](plugin-index.md). |
| `Cannot find module '@sredevopsorg/...'` after install | The bundle is installed but not selected, or DSH needs a restart (no HMR). Check `dsh --profile <p> --dump-config`, then restart. |

## Release tags

Release tags are created automatically when a version bump merges to `main`:

```
<plugin-directory>-v<package-version>
```

Examples: `code-editor-v0.1.0`, `entire-v0.2.0`, `skills-v0.2.0`, `superagent-v0.1.2`.

[`.github/workflows/version-plugins.yml`](../.github/workflows/version-plugins.yml)
runs on every push to `main`, tags each plugin whose `<dir>-v<version>` tag does
not exist yet, and dispatches [`.github/workflows/release.yml`](../.github/workflows/release.yml)
for each new tag. The release workflow revalidates the tag against the package
version, creates the GitHub release, and opens a pull request that republishes
[`index.json`](../index.json) with the new version. Merge that pull request to
publish the version in Discover. Never move a published tag; release a new version
instead.

The procedure for a maintainer is therefore only:

1. Bump `version` in `plugins/<dir>/package.json` and update the install tables
   in this repository.
2. Run `node scripts/validate-github-install.mjs --strict`.
3. Commit the change on `main`.

When the versioning workflow is unavailable, tag by hand after the bump merges:

```bash
node scripts/release-tag.mjs --plugin <directory> --push
```

That creates and pushes the same annotated tag, and the tag push starts the release
workflow directly. See [Publishing the plugin index](plugin-index.md).
