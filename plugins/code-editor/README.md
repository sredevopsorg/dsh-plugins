# Workspace code editor

A DSH Web profile bundle that adds a **Code editor** card to the right-sidebar
guide. The card opens a workspace file browser with a small text editor for
UTF-8 files.

## What it does

- Browses the current Session's workspace directories through the existing
  `workspaceFiles` Remote namespace.
- Opens and edits UTF-8 text files up to 1 MiB / 20,000 lines.
- Saves through one authenticated Host endpoint, using the file version read
  from disk for optimistic conflict detection.
- Saves anywhere inside the Session workspace regardless of the Session's agent
  file policy: the editor's write bypasses the agent sandbox mode, so a
  `read-only` Session, or a file outside the writable root under
  `workspace-write`, still saves. Containment to the Session workspace root is
  enforced by the endpoint itself and cannot be bypassed.
- Keeps unsaved drafts in memory while the plugin stays loaded, keyed by
  Session and path. Drafts survive tab switches and closing/reopening the
  editor tab; a page reload loses them. A restored draft is saved against the
  version it was based on, so newer disk content produces a conflict instead of
  being overwritten.

The editor has no syntax highlighting, language server, diff view, git
integration, file creation, rename, or delete. It is a user surface only: it
registers no agent tool, prompt section, or session event.

## Install

Requires a DSH Web profile with the built-in right Sidebar. From the pinned
release:

```bash
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#code-editor-v0.2.0&path:/plugins/code-editor"
```

Or from a local checkout:

```bash
dsh plugin --profile web add ./plugins/code-editor
```

If an earlier draft was linked as `@local/dsh-code-editor`, remove it first so
both editor tabs do not register:

```bash
dsh plugin --profile web remove @local/dsh-code-editor
```

Restart DSH after installing or removing the bundle.

## Use

1. Install the bundle (see above) and restart DSH if needed.
2. Refresh the Web GUI if the guide card is not visible yet.
3. In the right sidebar, open the guide and pick **Code editor**.
4. Pick a directory row to enter it, or a file row to open it.
5. Edit and press **Ctrl/Cmd+S** or the Save button.

## Host write endpoint

`POST /__dsh-code-editor/write`

```json
{
  "sessionId": "session-123",
  "path": "src/app.ts",
  "content": "full file text",
  "expectedVersion": "opaque version from readBytes",
  "force": false
}
```

The endpoint:

1. applies Connection browser authentication and Host/Origin trust, and accepts
   only the shared browser Peer (API Peers are refused);
2. requires a live Session and a body no larger than 8 MiB;
3. resolves the Session workspace root and refuses any target outside it;
4. refuses a missing path, a non-regular file, or a final symlink;
5. writes with `fs.writeText` and `{ kind: 'replaceIfVersion' }`, unless
   `force` is true, passing `{ mode: 'danger-full-access' }` so the agent's
   sandbox mode does not fence the save. Step 3 is then the only boundary.

Success returns `{ "ok": true, "operation": "create"|"update", "version": "…" }`.
Conflicts return HTTP 409 with a `stale` code and the current version when it can
be re-read. Other failures use `{ "ok": false, "code": "…", "message": "…" }`.

## Development

```sh
npm test        # host route and packaging tests
npm run check   # node --check on both entry points
```

The package is authored in this directory and installed with
`dsh plugin --profile web add ./plugins/code-editor`; the profile patch is never
edited by hand.
