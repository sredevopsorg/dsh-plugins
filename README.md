# DSH Plugins

Custom DSH plugins for [DeepSeek Harness (DSH)](https://github.com/sredevopsorg), maintained by [sredevopsorg](https://github.com/sredevopsorg).

Each directory under [`plugins/`](plugins/) is a self-contained Cordis plugin package installable into a DSH profile. The repository also publishes [`index.json`](index.json), a format-1 plugin market index browsable from the Web **Plugins → Discover** tab via **Custom plugin indexes**.

## Plugins

| Plugin | Kind | Use it for |
|---|---|---|
| [`agent-opencode`](plugins/agent-opencode/README.md) | bundle + agent preset | Delegates every task to the OpenCode CLI |
| [`code-editor`](plugins/code-editor/README.md) | bundle + web editor | Right-sidebar workspace file browser and editor |
| [`peak-rate-footer`](plugins/peak-rate-footer/README.md) | bundle + web footer | Peak/off-peak API billing footer with local clock |
| [`skills`](plugins/skills/README.md) | bundle + 10 skills | Packaged skill provider serving 10 agent skills |
| [`sredevops-writer`](plugins/sredevops-writer/README.md) | bundle + agent preset | Editorial agent preset for sredevops.org |
| [`subagent-opencode`](plugins/subagent-opencode/README.md) | bundle + subagent provider | Delegates one-shot tasks to OpenCode over ACP |
| [`superagent`](plugins/superagent/README.md) | bundle + web panel | Proactive agent that runs GitHub tickets in DSH sessions |

## Install via Custom plugin indexes (recommended)

1. Open **Plugins** in the Web sidebar and switch on **Custom plugin indexes** under **Experimental plugins**.
2. Select **Discover → Add index source** and enter:

   ```
   https://raw.githubusercontent.com/sredevopsorg/dsh-plugins/main/index.json
   ```

3. Pick a plugin and version and confirm the install. Each entry pins its exact Git commit.

## Install from a pinned GitHub release tag

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#<plugin>-v<version>&path:/plugins/<plugin>"
```

Quote the spec so the shell does not interpret `&`. Replace `web` with your profile. Examples:

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#agent-opencode-v0.2.0&path:/plugins/agent-opencode"
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#code-editor-v0.1.0&path:/plugins/code-editor"
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#peak-rate-footer-v0.1.0&path:/plugins/peak-rate-footer"
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#skills-v0.2.0&path:/plugins/skills"
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#sredevops-writer-v0.1.1&path:/plugins/sredevops-writer"
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#subagent-opencode-v0.2.1&path:/plugins/subagent-opencode"
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#superagent-v0.1.2&path:/plugins/superagent"
```

For local development, install a checkout instead:

```bash
dsh plugin --profile web add ./plugins/code-editor
```

`dsh --profile web list` shows installed packages; `dsh --profile web --dump-config` composes the tree without booting.

## Repository layout

```
plugins/
├── agent-opencode/
├── code-editor/
├── peak-rate-footer/
├── skills/
├── sredevops-writer/
├── subagent-opencode/
└── superagent/
```

Each plugin ships its own `package.json`, `cordis.patch.yml`, entry point, tests, locale, and `README.md`. Full per-plugin docs live under each `plugins/<name>/` directory.

## Verifying

```bash
node scripts/validate-bundles.mjs
node scripts/validate-github-install.mjs --strict
node scripts/build-market-index.mjs --check
node scripts/validate-market-index.mjs
```

CI runs these validators plus the plugin unit tests on every push and pull request.

## Releasing a plugin

A release is one annotated tag named `<plugin-directory>-v<version>`. Bump `version` in `plugins/<dir>/package.json`, run the validators, commit on `main`, and push. The `version-plugins.yml` workflow tags the release and opens a pull request that republishes `index.json`.

Or tag by hand:

```bash
node scripts/release-tag.mjs --plugin code-editor --push
```

---

Released under the [MIT License](LICENSE). Third-party attribution is listed in [NOTICE.md](NOTICE.md).
