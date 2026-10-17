# architect-dev-bundle

A DSH **agent-preset bundle**. It adds the **Architect Dev** preset to a profile:
a senior software architect and fullstack developer assistant for
container-based Python and Node.js work, minimalistic architectures, and
tool/skill/plugin/MCP discovery.

The package declares no code entry point. Its whole effect is the Cordis patch
in [`cordis.patch.yml`](cordis.patch.yml), which inserts one
`@deepseek-ai/dsh-agent-preset` declaration (`id: architect-dev`).

## Compatibility

- **DSH `^0.2.1-rc.2`** — declared in `package.json` `engines.dsh`. A DSH
  release outside that range refuses to install or activate this bundle; use an
  explicit version exemption only if you accept the risk.
- Validated on `@deepseek-ai/dsh` **0.2.1-rc.2**.
- The preset is a copy of the shipped `standard` preset plus a persona, a
  profile-gated `plugin_manager` tool, and the MCP rows. `scripts/validate-bundles.mjs`
  at the repository root compares the copy with the installed DSH and fails when
  the shipped preset adds or changes a row this bundle has not mirrored.

## What it composes

Preset id `architect-dev`, display name **Architect Dev**, roster order `10`.
Relative to the shipped `standard` preset, it changes:

| Delta | Effect |
|---|---|
| `persona` prefix + suffix | Architect/fullstack identity, skill-first discovery, delegation guidance |
| `tool-plugin-manager` | Enabled when the profile supplies `profileContext` (Web); every call still requires full access or approval |
| `mcp-supabase` | Supabase MCP tools, disabled unless `SUPABASE_ACCESS_TOKEN` is set; read-only by default |
| `mcp-github` | Disabled example using the current hosted GitHub MCP server; enabled only with `GITHUB_TOKEN` |

Everything else mirrors `standard`, including plan mode, compaction,
delegation/workflow tools, web access, goals, and presentation.

## Prerequisites

1. **A DSH profile** (Web is the tested target). The bundle uses profile-scoped
   features such as `profileContext` and subagent model selection.
2. **Skills** — the persona points at `software-architecture`,
   `fullstack-development`, `supabase`, and
   `supabase-postgres-best-practices`. From the repository root run:

   ```bash
   ./install.sh                 # links skills/ into ~/.dsh/skills
   ./install.sh --dry-run       # show what would be linked
   ```

   Without this step the preset still works, but its named skills are not in the
   catalog.
3. **Supabase MCP (optional)** — set `SUPABASE_ACCESS_TOKEN` before starting
   DSH. Create a personal access token at
   <https://supabase.com/dashboard/account/tokens>.
4. **GitHub MCP (optional)** — set `GITHUB_TOKEN` with a personal access token
   that can read the repositories you want to expose.

## Install

From the repository root, into a profile:

```bash
dsh plugin --profile web add ./plugins/architect-dev-bundle
dsh plugin --profile web list
```

The same directory also installs through the `plugin_manager` tool or the Web
**Plugins** page (`install_bundle` with the absolute package directory). The
bundle is linked, so with HMR (the Web default) later edits to this directory
apply on the next reload without reinstalling; otherwise restart DSH.

## Select the preset

Installing the bundle puts the preset on the profile roster; it does **not**
change the profile's default preset. Choose **Architect Dev** in the Web preset
selector, or make it the default in the profile patch:

```yaml
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: standard
    selectedDefault: architect-dev
```

## Verify

Start a **new** session (existing sessions keep the preset revision they began
with) and check:

- the prompt names the assistant as a senior software architect;
- the current time context is present;
- `schedule_list` / `schedule_create` exist (the preset mirrors `standard`'s
  schedule tools);
- `plugin_manager` is present in a Web profile and absent elsewhere;
- `mcp__supabase__*` tools are absent without `SUPABASE_ACCESS_TOKEN`, and
  appear after the token is set and DSH reloads;
- plan mode says it stays active "until the user approves your plan through
  `exit_plan_mode`".

Also run the static checks from the repository root:

```bash
node scripts/validate-skills.mjs
node scripts/validate-bundles.mjs
# if `dsh` is not the installation on PATH:
node scripts/validate-bundles.mjs --dsh-root "$(npm root -g)/@deepseek-ai"
```

## MCP configuration

| Row | Transport | Environment | Default |
|---|---|---|---|
| `mcp-supabase` | Streamable HTTP, `https://mcp.supabase.com/mcp?read_only=true&features=docs,database,debugging,development,functions,storage` | `SUPABASE_ACCESS_TOKEN` | Enabled when the token is set; read-only |
| `mcp-github` | Streamable HTTP, `https://api.githubcopilot.com/mcp/` | `GITHUB_TOKEN` | Disabled unless the token is also set |

Both rows set `failOnStartupError: false`, so a reachable-but-failing or
unreachable server logs an error and leaves the preset usable instead of failing
activation. An unset token disables the row before any connection is attempted.

### Scope Supabase to one project

Append `&project_ref=<project-ref>` to the Supabase URL to restrict the server
to one project. This is recommended for day-to-day work because it keeps the
server scoped to the project the task concerns and prevents an accidental
cross-project query.

### Allow writes

`read_only=true` is deliberate. To allow migrations, SQL writes, or Edge
Function deploys, remove it **and** add a project scope, and only against a
project whose data you can afford to change. Treat the Supabase token as a
credential with the same reach as the MCP server.

## Security notes

- MCP servers execute outside the DSH filesystem sandbox and use their own
  credentials; enable only servers you trust.
- Supabase defaults to read-only; the GitHub example stays disabled unless a
  token is present.
- `plugin_manager` can install, remove, and select profile bundles. Every call
  requires full access or an approved escalation. Disable the row in
  `cordis.patch.yml` if you do not want the capability in Architect Dev.
- Never commit tokens or session data. Set the environment variables in the
  shell or launch environment that starts DSH.

## Maintenance

When DSH ships a new `standard` preset:

1. Diff `@deepseek-ai/dsh-web-app/presets/standard.patch.yml` against this
   bundle's plugin list.
2. Mirror the new rows/config, except the persona, the gated `plugin_manager`,
   and the `mcp-*` rows.
3. Re-run `node scripts/validate-bundles.mjs`.
4. If the compatible DSH range changed intentionally, update `engines.dsh` and
   the version, then note it here.

Persona templates may only use prompt variables registered by the installed DSH
(`{{model}}` and `{{provider}}` in 0.2.1-rc.2). The validator rejects any other
`{{name}}`; the runtime context already carries the working directory, so do not
add a `{{cwd}}` placeholder.

CI runs the skills validator and the bundle validator; the weekly compatibility
canary checks the newest published DSH so upstream preset drift is visible
early.

## Uninstall

```bash
dsh plugin --profile web remove @sredevopsorg/dsh-architect-dev-bundle
```

Removing the bundle deletes the preset from the roster. Existing sessions keep
their started revision until they restart; recovery after a restart needs the
preset definition, so reinstall before resuming an Architect Dev session if you
want it to keep its preset.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No Architect Dev on the roster | Bundle not selected: check `dsh plugin --profile web list` and the profile's `dsh.profile.bundles` |
| Install refused with `incompatible-version` | `engines.dsh` does not include your DSH version; upgrade DSH or grant an explicit exemption |
| No Supabase tools | `SUPABASE_ACCESS_TOKEN` unset (row disabled), server unreachable, or DSH not reloaded |
| GitHub row never loads | Set `GITHUB_TOKEN`; the row is token-gated and disabled otherwise |
| Named skills missing | Run `./install.sh` and confirm the skill catalog lists `software-architecture` |
