# Superagent for DeepSeek Harness

A proactive coding agent for one GitHub repository, packaged as a DSH bundle: it listens to GitHub and, optionally, Feishu, evaluates requests under a Policy, turns authorized ones into Tickets, and executes each in its own DSH Session. A web panel shows what needs a person.

This is a **fork** of the DeepSeek Harness research prototype [`deepseek-ai/dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype) (MIT), vendored from upstream commit [`8c32a9d`](https://github.com/deepseek-ai/dsh-superagent-prototype/commit/8c32a9dc5d72c033816c6a8110b37f40cf94fba4) and republished here as `@sredevopsorg/dsh-superagent` so it can be installed and versioned like the other bundles in this repository. The upstream project calls itself a research prototype for reference only; that caveat applies to this fork too. See [Fork provenance](#fork-provenance) and [NOTICE.md](NOTICE.md).

> This code grew out of the DeepSeek Harness team's day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.

The upstream prototype was adapted for publication and is not identical to the internal version or the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are future directions and are not implemented here.

It is also a way of working with an agent: **take as little human attention as possible, and give as much value as possible.** An agent that can act for a whole team can also waste a whole team's attention, so it acts only when asked or when a rule the team wrote allows it, and speaks only when someone must act or can use a result. [docs/000-philosophy.md](docs/000-philosophy.md) explains the principle and what it asks of the operator.

## Install

Install from this repository, pinned to the release tag (the tag is immutable, so the command reproduces the same package contents):

```sh
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#superagent-v0.1.0&path:/plugins/superagent"
```

The package ships its built `lib/` directory, so **no build step runs at install time** and the Git dependency needs no toolchain beyond Node and pnpm. The same spec works with the `plugin_manager` tool's `install_bundle` and from the repository's plugin index (Discover).

pnpm may report unmet `@deepseek-ai/*` peer dependencies after the install. That is expected: those packages are supplied by the running DSH installation through its own module resolution, not by the profile; the peer ranges document the DSH versions the code was built and tested against.

Or install a local checkout:

```sh
dsh plugin --profile superagent add "link:$PWD"
```

The bundle then activates automatically in the profile (`dsh plugin add` reconciles `dsh.profile.bundles`).

### Requirements

- DSH satisfying this package's `engines.dsh` (`^0.2.1-rc.2`); the fork was smoke-tested against DSH `0.2.2-alpha.3`.
- Node.js `^22.19.0 || >=24.0.0` and pnpm 9 or newer (for installation; the plugin itself runs under DSH).
- Git 2.32+, GitHub CLI 2.48+, tmux, and Python 3.8+ for the managed-service script and for the agent's work.
- A DSH model provider configured for the profile.
- The plugin **refuses to start without a `stateDir`** in its configuration (see [Configuration](#configuration)).

### Configuration

The bundle inserts the `dsh-superagent` row, the `dsh-superagent-github` Source, a disabled `dsh-superagent-feishu` Source, and the worker/router agent presets. Provide the state directory in the profile's `cordis.patch.yml`, using the row id from the bundle patch (ids are unchanged from upstream):

```yaml
- id: dsh-superagent
  config:
    stateDir: /absolute/path/to/state/superagent
# Feishu is optional; enable its Source after configuring the bot's lark-cli.
- id: dsh-superagent-feishu
  disabled: false
```

See [examples/profile.cordis.patch.yml](examples/profile.cordis.patch.yml) and [docs/006-deployment.md](docs/006-deployment.md) for every configuration key, account setup, upgrades, and troubleshooting.

## Setup

Setup has many steps, so an agent does it with you. Ask your coding agent:

> Read SETUP.md in this repository and set up dsh-superagent with me.

It asks one short question at a time, shows the full plan once, and then configures everything. [SETUP.md](SETUP.md) is what it follows.

## Documentation

The upstream numbered documents are vendored unchanged and still describe the plugin; read them in order.

- [000 Philosophy](docs/000-philosophy.md)
- [001 Domain model](docs/001-domain.md)
- [002 Authorization](docs/002-authorization.md)
- [003 Execution](docs/003-execution.md)
- [004 Prompts](docs/004-prompts.md)
- [005 Panel](docs/005-panel.md)
- [006 Deployment](docs/006-deployment.md): manual setup, configuration, upgrades and troubleshooting
- [007 Architecture](docs/007-architecture.md)
- [008 Cookbook](docs/008-cookbook.md): adding a Source

## Fork provenance

- Upstream: <https://github.com/deepseek-ai/dsh-superagent-prototype> at commit `8c32a9dc5d72c033816c6a8110b37f40cf94fba4` ("feat: add the dsh-superagent research prototype"), package version `0.1.0`.
- License: MIT. Upstream copyright (c) 2026 DeepSeek Harness Team is retained in [LICENSE](LICENSE); see [NOTICE.md](NOTICE.md).
- Every source file, test, prompt, skill, locale file, script, build config and `pnpm-lock.yaml` is vendored; `docs/` and `SETUP.md` are the upstream documents.

Changes this fork makes on top of the upstream tree, all required to publish it as a scoped package that installs from Git:

| Change | Why |
|---|---|
| Package name is `@sredevopsorg/dsh-superagent`; `private` removed; `repository`, `homepage`, `bugs` and `keywords` point at this repository. | The repository's GitHub-install and release validators require the `@sredevopsorg/dsh-superagent` name for `plugins/superagent`, and a Git dependency must not be private. |
| Built `lib/` is committed (upstream `.gitignore` no longer ignores it) and listed in `files`. | pnpm does not run a build (`prepare`) for a Git dependency; committing the build makes a pinned tag installable with no toolchain. |
| Bundle-patch rows use the scoped package specifiers (`@sredevopsorg/dsh-superagent`, `@sredevopsorg/dsh-superagent/github-watch`, `@sredevopsorg/dsh-superagent/feishu-watch`); row ids are unchanged. | Rows resolve the package name from the profile, which is the scoped name after installation. Row ids stay stable so profile overrides by `id` keep working. |
| `src/infra/paths.ts` recognizes the scoped package name (and still the upstream name) when locating packaged `prompts/` and `skills/`. | The runtime locates its packaged assets by reading its own `package.json` name. |
| `tsdown.config.ts` registers the browser bundle under the scoped module id. | The client module system keys the built `client.js` by the package specifier the DSH client loader imports. |
| `engines.dsh` is `^0.2.1-rc.2` (upstream: `^0.2.1-alpha.2`), and `@deepseek-ai/dsh-*` peer ranges are `^0.2.1-rc.2`. | Match the DSH release this repository targets (`^0.2.1-rc.2`); this range also accepts newer `0.2.x` releases under DSH's prerelease-inclusive check. Development lockfile pins stay at upstream `0.2.1-alpha.2` so the vendored build is reproducible. |
| `NOTICE.md` records the fork attribution. | MIT requires keeping the copyright and permission notice; the fork documents its provenance. |
| `tests/sources.spec.ts` waits for the malformed-line health report instead of sampling it once. | The fake bot CLI writes `[event] ready` on stderr and the event lines on stdout; the two pipes are observed in either order, so the upstream single-sample assertion fails deterministically on this Node version (also on the unmodified upstream checkout). The behavior under test is unchanged: a malformed line is still reported and the consumer keeps processing later events. |

To resynchronize with upstream, vendor the new upstream commit over `src/`, `tests/`, `prompts/`, `skills/`, `docs/`, `locale/`, `scripts/`, `SETUP.md`, `tsconfig.json`, `vitest.config.ts`, `pnpm-lock.yaml` and `LICENSE`, then reapply the table above, run the verification below, commit the rebuilt `lib/`, and bump `version` (and the release tag) if the change is user-visible.

## Development and verification

The fork is a normal pnpm TypeScript project. `pnpm check` runs the typecheck, the tests and the build.

```sh
pnpm install --frozen-lockfile   # dev dependencies (DSH 0.2.1-alpha.2 packages, vitest, tsdown)
pnpm typecheck                   # tsc --noEmit
pnpm test                        # vitest run
pnpm build                       # tsdown: writes the committed lib/
git status --short lib           # must be clean: the committed lib/ is reproduced by the build
```

Verify that the published package is complete and installable before tagging:

```sh
npm pack --dry-run --json        # tarball must contain lib/, cordis.patch.yml, locale/, prompts/, skills/, README.md
node --check lib/index.js && node -e "import('./lib/index.js').then(m => console.log(m.name, typeof m.apply))"
```

Optional end-to-end install check into a scratch DSH profile, from the packed tarball:

```sh
npm pack --pack-destination /tmp
DSH_HOME=/tmp/dsh-scratch dsh plugin --profile scratch add /tmp/sredevopsorg-dsh-superagent-0.1.0.tgz
DSH_HOME=/tmp/dsh-scratch dsh --profile scratch --dump-config
```

The install path is covered by hand: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, a rebuild-vs-committed-`lib/` diff, `npm pack --dry-run`, and a scratch-profile install from the packed tarball — `dsh plugin add`, `dsh --profile scratch --dump-config`, then booting a Web profile where the plugin serves its management API (`/orchestrator/api/state`) and reports the expected setup problem. The unit suite has one upstream test that is timing-sensitive under load and fails the same way in an unmodified checkout of the upstream tree; it is unrelated to the fork.

## Limitations

- Upstream describes this as a research prototype, not production software; the fork does not change that.
- The vendored code was written against DSH `0.2.1-alpha.2` and this fork declares `^0.2.1-rc.2`. It was smoke-tested on DSH `0.2.2-alpha.3`: installed from the packed tarball into a fresh Web profile, booted, and its management API answered with the expected `repositoryUnset` setup problem. A full end-to-end run of the agent needs GitHub/Feishu accounts, a model provider and a repository, so it is the operator's setup step. DSH `0.2.2-alpha.3` also cannot dump a JSON Schema for preset rows that are custom Loader carriers (`unrecognized Loader tree carrier`); that diagnostic appears for the shipped presets too and does not affect booting.
- The management panel is Web-only. Feishu support is optional and inert until its Source is enabled and a bot `lark-cli` is configured.
- Ticket execution shells out to `git`, `gh`, `tmux`, `python3` and `lark-cli` as configured; DSH's sandbox/permission settings for the profile still apply.
- Committed `lib/` means the fork must rebuild and commit it on every source change; CI should assert the build reproduces it.

## License

[MIT](LICENSE). This fork retains the upstream copyright; see [NOTICE.md](NOTICE.md) for the attribution text.
