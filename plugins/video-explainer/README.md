# Video Explainer for DeepSeek Harness

One DSH plugin that installs the [Video Explainer](https://github.com/petergyang/video-explainer)
skill: it turns a topic, an article, a codebase, or a URL into a **~1-minute explainer video**
(Motion, Illustrated, or 3D), with sourced web media, optional voiceover, synchronized
captions, 10 automated QA checks, and a frame-pinned browser review page.

The plugin packages the skill, its Python pipeline, and its three render engines, and adds
two tools and an opt-in agent preset. Nothing is downloaded or installed by the plugin
itself: the first render tells you exactly what the machine is missing.

## Install

From this repository, pinned to the release tag (the tag is immutable, so the command
reproduces the same package contents):

```sh
dsh plugin --profile web add "github:sredevopsorg/dsh-plugins#video-explainer-v0.1.0&path:/plugins/video-explainer"
```

Quote the spec so the shell does not interpret `&`. Replace `web` with your profile. Restart
DSH afterwards: the skill catalog is rebuilt at startup.

Install from the repository plugin index instead by adding
`https://raw.githubusercontent.com/sredevopsorg/dsh-plugins/main/index.json` under
**Plugins → Discover → Add index source**; see [`docs/plugin-index.md`](../../docs/plugin-index.md).

Or install the local checkout while developing:

```sh
dsh plugin --profile web add ./plugins/video-explainer
```

## What it provides

| Surface | Name | What it does |
|---|---|---|
| Skill | `video-explainer` | The whole workflow: mode selection, research, `script.md`, graphics, narration, render, QA, review loop |
| Tool | `video_explainer_setup` | **Read-only** preflight: lists every missing tool with the exact command for it. Installs nothing |
| Tool | `video_explainer_render` | Runs **one** pipeline step inside a project folder in the session workspace |
| Agent preset | `video-explainer` | An opt-in agent with shell, background jobs, web, files, and the skill catalog |

The skill is model- and user-invocable, so it shows up in the session catalog and under `/`
in the composer. Three visual modes ship with it:

1. **Motion** (default) — full-frame 2D kinetic graphics, live SVG routes and charts.
2. **Illustrated** — hand-drawn picture-book animation with paper grain and 10 fps line boil.
3. **3D** — single-take Three.js camera flythroughs with studio lighting and bloom.

## Prerequisites

The pipeline shells out to local tools. `video_explainer_setup` (or
`skills/video-explainer/scripts/setup.sh --json`) reports which are present and prints the
command for each missing one.

| Requirement | Why | Install |
|---|---|---|
| **ffmpeg** + ffprobe | Mix audio, encode and probe video | `sudo apt install ffmpeg` / `brew install ffmpeg` |
| **Python 3.10+** | Runs the pipeline scripts | `sudo apt install python3 python3-venv` |
| **Node 22+** | HyperFrames, the renderer | <https://nodejs.org> |
| Pipeline venv | `numpy`, pinned in `requirements.txt` | `uv venv -p 3.12 ~/.cache/video-explainer/venv && uv pip install -r requirements.txt -p ~/.cache/video-explainer/venv/bin/python` |
| HyperFrames Chrome | Rendering (~390 MB, once) | `npx -y hyperframes@0.9.79 browser ensure` |
| yt-dlp *(optional)* | Pull web video clips | `pipx install yt-dlp` |
| Blender *(optional)* | Sculpt or fracture 3D meshes | <https://www.blender.org> |
| Kokoro + Parakeet *(optional)* | Local voiceover and word alignment | `requirements-voice.txt` + `npx -y hyperframes@0.9.79 models install parakeet` |
| `GEMINI_API_KEY` *(optional)* | Gemini TTS voiceover and Lyria music | Put it in `~/.config/video-explainer/.env`, never in chat |

Plan on roughly 400 MB of downloads for silent videos, or ~1.4 GB with local voiceover.

## Tools

### `video_explainer_setup`

```jsonc
// input
{ "voice": false }          // true also checks the local Kokoro + Parakeet stack

// output
{
  "ok": false,              // every required tool present?
  "installed": false,       // always false: this tool never installs
  "missing":  [{ "name": "ffmpeg", "command": "sudo apt install ffmpeg", "why": "mix audio and encode video" }],
  "optional": [{ "name": "yt-dlp", "command": "pipx install yt-dlp", "why": "pull web video clips" }],
  "bootstrap":[{ "command": "npx -y hyperframes@0.9.79 browser ensure", "why": "…~390 MB…" }],
  "notes": ["hyperframes: npx -y hyperframes@0.9.79 (pinned)"],
  "message": "Missing 2 required item(s). Ask the user before running any of these commands…"
}
```

The tool is deliberately incapable of installing anything: setup.sh only inspects and prints.

### `video_explainer_render`

```jsonc
{
  "project": "/home/me/work/how-https-works",   // absolute, must be inside the session workspace
  "step": "draft",                              // see below
  "voice": false, "share": false,               // preflight: --voice; final: --share
  "batchId": "1764…-a1b2c3d4",                  // review-ack only, from review-poll
  "port": 8791                                  // review only
}
```

| Step | Runs | Produces |
|---|---|---|
| `preflight` | `setup.sh --json` | the environment report |
| `narrate` | `narrate.py` | `work/transcript.md`, `work/words.json`, synced `script.md` |
| `preview` | `render.py --preview` | `work/preview/contact.jpg` |
| `draft` | `render.py --draft` | `renders/<slug>-vN.mp4` |
| `final` | `render.py` | the delivery render (plus `renders/share/` with `share`) |
| `qa` | `qa.py` | `work/qa/report.md`, contact and opening sheets |
| `review` | `review.py --no-open` | a review URL on `127.0.0.1` |
| `review-poll` | `review.py --poll` | `work/feedback.md` |
| `review-ack` | `review.py --ack` | acknowledgement of one feedback batch |

Every step refuses a project outside the session workspace, both sides canonicalized with
`realpath`, so neither `..` nor a symlink escapes. The command is spawned with an argument
list and `shell: false`; no user value is ever parsed by a shell.

## The agent preset

Installing the bundle changes no existing agent. To use the preset, pick **Video Explainer**
in the agent preset picker and start a session with it. It carries `tool-bash` (sandboxed,
so it follows the session's file policy), `tool-jobs` (renders run in the background),
`tool-fs`/`tool-fs-search`, `tool-web`, `tool-skill`, `tool-ask-user`, and `tool-todo`.

It declares no subagent row on purpose: a preset must not depend on a provider your profile
does not supply. Sessions that already have subagents can use them for the "fresh eyes"
review step the skill asks for; without them the preset reviews the frames itself.

## Security notes

Read these before the first render.

- **Nothing is installed for you.** Upstream bootstrapped on first run; this port never does.
  `setup.sh` and `video_explainer_setup` only report what is missing, and every download
  (HyperFrames Chrome, voice models, `numpy`) happens only when you approve it. The venv is
  never created or populated by `scripts/py`; the pinned dependencies live in
  `requirements.txt` and `requirements-voice.txt`.
- **Network egress.** The pipeline contacts: `cdn.jsdelivr.net` (GSAP and three.js, loaded by
  the generated render page; three.js is also cached under `~/.cache/video-explainer/vendor/`),
  Wikimedia Commons and whatever media URL the skill fetches, `yt-dlp`'s targets when you use
  `clip:` scenes, and `generativelanguage.googleapis.com` when you set `GEMINI_API_KEY`.
  HyperFrames itself runs through `npx`, pinned to `0.9.79`.
- **The API key** is read from the environment or `~/.config/video-explainer/.env`, sent only
  to Google's Gemini endpoint, and redacted from error messages. It is never logged by this
  plugin and never part of a tool argument.
- **The review page is loopback-only and scoped.** It binds `127.0.0.1`, answers only to
  `127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>` Host headers (so a
  DNS-rebinding page cannot use it), caps a submission at 1 MiB, and serves **only** the
  page, its poster, and the video from a dedicated `work/review/serve/` root rather than the
  whole project folder.
- **Review notes and fetched media are untrusted data.** A note can say anything; the agent
  must treat it as a comment about the video, never as an instruction. The skill says so
  explicitly.
- **Supply chain.** The renderer is pinned (`hyperframes@0.9.79`), the GSAP and three.js
  versions are pinned in `build.py`, and the Python dependencies are pinned in the two
  requirements files. `scripts/py` will not upgrade anything on its own.
- **Existing user data.** The pipeline keeps its state under `~/.cache/video-explainer/`
  (venv, vendored three.js) and `~/.config/video-explainer/` (`.env`, `style.json`), exactly
  as upstream documents.

## Verification

```sh
node scripts/validate-bundles.mjs                 # patch rows, Config schema, engines.dsh
node scripts/validate-github-install.mjs --strict # manifest, tarball contents, pinned spec
node scripts/validate-plugin-pair.mjs             # no row/provider/tool collisions
node scripts/validate-skills.mjs                  # packaged-skill contract
cd plugins/video-explainer && npm test            # provider, packaging, and security tests
```

The upstream end-to-end test suite ships as [`tests/test_pipeline.py`](tests/test_pipeline.py).
It needs ffmpeg:

```sh
python3 -m pip install numpy
python3 plugins/video-explainer/tests/test_pipeline.py
```

## Attribution

Ported from [`petergyang/video-explainer`](https://github.com/petergyang/video-explainer) at
commit `be2f729` under the MIT license; see [NOTICE.md](../../NOTICE.md) and
[`docs/UPSTREAM.md`](docs/UPSTREAM.md) for the file-by-file adaptation list. The bundled
`InterVariable.woff2` font ships under the SIL Open Font License
([`skills/video-explainer/fonts/OFL.txt`](skills/video-explainer/fonts/OFL.txt)).

"Video Explainer" is the upstream project's name; nothing here grants rights to its
trademarks.
