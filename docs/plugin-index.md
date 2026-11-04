# Publishing the plugin index

[`index.json`](../index.json) at the repository root is a **format-1 plugin market
index**. It is the document that
[`@deepseek-ai/dsh-experimental-plugin-market-bundle`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/experimental/plugin-market-bundle)
reads when a user adds this repository as an index source, and it powers the Web
**Plugins → Discover** tab for these plugins.

The format and its rules are defined by DSH:

- [Plugin indexes user guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md)
- [Plugin market index format (format 1)](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md)
- [Reference generator](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/plugin-market-generator/README.md) — this repository uses its own generator because its packages are Git-only and versioned by release tags

## Use the index in Discover

1. Open **Plugins** in the Web sidebar and switch on **Custom plugin indexes** under
   **Experimental plugins**. The Plugins page then shows **Installed** and **Discover**
   tabs.
2. Select **Discover → Add index source** and enter:

   ```
   https://raw.githubusercontent.com/sredevopsorg/dsh-plugins/main/index.json
   ```

3. The tab lists every plugin version with its title, icon, description, and
   compatibility. **Install** shows the exact source — this repository, the release-tag
   commit, and `plugins/<directory>` — and only installs after confirmation.

The source belongs to the current DSH profile. The index is unsigned third-party
content: check the source in the install confirmation, as you would for any Git address.

## What the index lists

The index is **generated**, never hand-edited:

- **One plugin entry per package under `plugins/`** that declares `dsh.bundle.patch`.
  The package `name` is the index `name`; the plugin must have at least one release tag.
- **One version per release tag** named `<plugin-directory>-v<version>`. The version is
  the tag suffix, `publishTimestamp` is the tag commit's committer time, and the source is

  ```json
  {
    "type": "git",
    "url": "https://github.com/sredevopsorg/dsh-plugins",
    "commit": "<40-hex commit of the tag>",
    "path": "plugins/<plugin-directory>"
  }
  ```

  DSH installs it as a commit-pinned pnpm Git spec, so the tag's contents are immutable.
- **`engines.dsh`** copied from the package manifest at that tag, so Discover shows the
  same compatibility the installer enforces.
- **Display metadata**: `title` and `description` from `plugins/<directory>/locale/en.json`,
  `icon` as a relative `plugins/<directory>/icon.svg` reference (resolved against the index
  URL), and `author`, `homepage`, `repository`, and keywords from the package manifest.

`index.json` is published from the `main` branch, so relative icon references resolve
against `.../main/plugins/<directory>/icon.svg`. The raw GitHub URL must stay the public
index address; if the repository or branch changes, update `INDEX_URL` in
`scripts/build-market-index.mjs` and the documentation together.

## Build, check, and validate

```bash
# Regenerate index.json from the current release tags and manifests.
node scripts/build-market-index.mjs

# Fail when index.json is not what the generator would write.
node scripts/build-market-index.mjs --check

# Validate the format, every tag pin, metadata, and freshness.
node scripts/validate-market-index.mjs
node scripts/validate-market-index.mjs --strict   # unlisted release tags become errors
```

The validator resolves `@deepseek-ai/dsh-plugin-market-index` from a DSH installation.
Pass `--dsh-root <path-to-node_modules/@deepseek-ai>`, set `DSH_INSTALL`, or have `dsh` on
`PATH`. It reads release tags and the commits they pin, so the checkout needs full history
and tags: `git fetch --tags` locally, and `fetch-depth: 0` in CI (already configured).

The index is stale when a release tag exists but is not listed yet. That is normal between
a tag push and the merge of the index update pull request described below; the validator
reports it as a warning, and `--strict` fails. Any other difference between `index.json`
and the generator output fails validation.

## Version on merge, publish in the index

A merged plugin change that bumps `plugins/<directory>/package.json` is versioned
automatically. [`version-plugins.yml`](../.github/workflows/version-plugins.yml) runs on
every push to `main`, creates the annotated tag `<plugin-directory>-v<version>` for every
market bundle whose tag does not exist yet, and dispatches
[`release.yml`](../.github/workflows/release.yml) for each new tag. The dispatch is
required because a tag pushed with `GITHUB_TOKEN` does not start another workflow run.
The workflow is idempotent: existing tags are skipped, so re-running it tags nothing twice.

`release.yml` then:

1. validates the tag against the package version,
2. creates the GitHub release, and
3. rebuilds `index.json` and opens a pull request from a `market/publish-<tag>` branch.

Releases are serialized by a `plugin-release` concurrency group. When one merge introduces
several versions, the first release run opens the index pull request and the queued runs
find a branch that already publishes the same `index.json`, so they skip instead of opening
duplicates.

The workflow validates the rebuilt index before it opens the pull request, so the branch
is known-good. GitHub does not start CI for a pull request opened with the repository
token, so to get the full CI run either dispatch the `ci` workflow on that branch
(`gh workflow run ci.yml --ref market/publish-<tag>`) or run the validators locally.

Merge that pull request to make the new version appear in Discover. Until it merges,
Discover shows the previous versions; nothing needs to be installed from it.

The manual path still works when the versioning workflow is unavailable: bump and commit
the version on `main`, then run

```bash
node scripts/release-tag.mjs --plugin <directory> --push
```

which creates and pushes the same annotated tag, so `release.yml` runs directly. Never move
a published tag; release a new version instead.

If the repository does not allow GitHub Actions to create pull requests, the release
workflow stops before opening the update; build the index locally and open the pull
request by hand. To repair or refresh the index by hand:

```bash
node scripts/build-market-index.mjs
node scripts/validate-market-index.mjs
git add index.json
git commit -m "chore(market): republish the plugin index"
```

Never hand-edit `index.json`: a listed version must be a real tag pinned to its commit, and
the validator fails when the file drifts from the generator.

## Known limits

- **Git-only sources** — these packages are not published to npm, so every version is a
  commit-pinned Git source. `publishTimestamp` is the tag commit time, not an npm publish
  time.
- **Tags are the release unit** — a version appears in Discover only after it is tagged and
  the index update pull request merges. There are no prerelease channels beyond SemVer
  prerelease tags.
- **No upgrade flow** — Discover reports an installed bundle's status; upgrading is
  uninstall followed by install, as with any DSH bundle.
- **Unsigned** — titles, descriptions, and sources are this repository's claims. DSH checks
  the format and the source's manifest before installing; it does not endorse the content.
