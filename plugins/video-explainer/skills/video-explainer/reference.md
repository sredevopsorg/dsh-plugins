# Video Explainer reference

Set `S` to this skill's `scripts` folder and `P` to the project folder. Run Python scripts through `$S/py`, which uses an isolated venv at `~/.cache/video-explainer/venv` (set `VIDEO_EXPLAINER_VENV` to move it). HyperFrames runs via `npx`, pinned to `0.9.79`.

> **This copy is the DSH plugin port.** `$S/py` never creates the venv and never installs a
> package: when either is missing it exits 1 with the exact command. `$S/setup.sh` is a
> read-only preflight for the same reason — it reports every missing tool, the one-time
> HyperFrames Chrome download, and the optional 3D/voice assets with the command that
> prepares each one, and installs nothing. Pass `--json` for the machine-readable report
> (also available as the `video_explainer_setup` tool). The pinned packages live in
> `requirements.txt` and `requirements-voice.txt` beside this file. Full notes:
> `plugins/video-explainer/docs/UPSTREAM.md`.

```bash
S=/path/to/video-explainer/skills/video-explainer/scripts
P=~/Videos/explainers/how-https-works
mkdir -p "$P/graphics" "$P/media" "$P/captures"
```

## Commands

```bash
# First use: report every missing tool and the exact command for each (installs nothing)
# Ask the user before running any of the printed commands, including the one-time
# `npx -y hyperframes@0.9.79 browser ensure` headless Chrome download (~390 MB).
$S/setup.sh
$S/setup.sh --json

# Also check the local Kokoro TTS + Parakeet alignment stack used by spoken narration
# (~590 MB of models; the packages are pinned in requirements-voice.txt)
$S/setup.sh --voice

# 1. Optional web/local media & captures (recorded in work/media-sources.json)
$S/py $S/media.py image "wikimedia:Jensen Huang" "$P/media/jensen.jpg"
$S/py $S/media.py image "https://example.com/diagram.png" "$P/media/diagram.png" --credit "Example Lab"
$S/py $S/media.py clip "https://example.com/demo.mp4" "$P/media/demo.mp4" --start 2 --duration 6 --credit "Demo"
$S/py $S/capture.py "https://example.com/docs" "$P/captures/docs.png"

# 2. Optional Lyria music bed (needs GEMINI_API_KEY in env or ~/.config/video-explainer/.env)
$S/py $S/generate.py music "$P/music.mp3" --prompt "warm minimal synth pulse, soft marimba, 104 bpm" --seconds 75

# 3. Narrate and align (writes work/narration.wav, work/words.json, work/transcript.md, syncs script.md)
$S/py $S/narrate.py "$P"

# 4. Pre-flight contact sheet (~3s), draft render, QA, and browser review
$S/py $S/render.py "$P" --preview        # writes work/preview/contact.jpg + frame-*.png
$S/py $S/render.py "$P" --draft
$S/py $S/qa.py "$P"
$S/py $S/review.py "$P"                  # keep alive in background; later drafts use --no-open
$S/py $S/review.py --poll "$P/work"      # run in foreground while user reviews
$S/py $S/review.py --ack "$P/work" BATCH_ID

# 5. Final 1080p delivery render and QA (pass --share only when a 720p copy in renders/share/ is wanted)
$S/py $S/render.py "$P"
$S/py $S/qa.py "$P"
```

`media.py image` normalizes direct URLs, `wikimedia:<query>` Commons files (with artist/license credit), or local images to `.jpg` or alpha `.png` (max 1920px). `media.py clip` trims local files, URLs, `wikimedia:<query>` clips, or `yt-dlp` sources to seek-safe 30 fps H.264 MP4 (`-crf 19 -g 15 yuv420p`, silent `-an` unless `--keep-audio`). `build.py` stages `$P/media/` and `$P/captures/` into `hf/assets/media/` (`assets/media/<file>` and `../assets/media/<file>` both resolve).

`qa.py` runs `10/10` checks in `work/qa/report.md`: dimensions, 30 fps, audio stream, A/V sync, `duration_cap` (`<= Max duration + 2.0s`), loudness (`-15 to -13 LUFS`), peak (`<= -1.0 dBFS`), black frames, upper-canvas `motion_liveliness` (`< 4.0s` max frozen stretch, `>= 65%` active intervals on clips `>= 8s`), and `hyperframes check` (lint, runtime, layout, caption-zone, WCAG contrast).

## `script.md` format

```markdown
# script.md: how-https-works

Mode: motion
Aspect: 16:9
Audience: general
Style: blueprint
Voice: kokoro:af_heart
Voice speed: 1.0
Captions: auto
Music: synth:warm
Music level: -19
Sound effects: on

## Narration
- s01: Every time you log in over public Wi-Fi, dozens of routers can read plain text.
- s02: HTTPS fixes this with a three-step handshake before your password leaves the laptop.

## Scenes
| id | start | end | visual | note |
|---|---|---|---|---|
| s01 | auto | auto | graphic: graphics/world.html | plaintext packet stream |
| s02 | auto | auto | graphic: graphics/world.html | whip-pan to 3-step handshake |

## Sound
- @s01+0.20: zoom 0.7
- @s02:handshake: whoosh 0.8 pan=0.3

## Caption fixes
- Wi Fi -> Wi-Fi

## Emphasis
- three-step handshake
```

### Settings

- `Mode`: `motion` (default; aliases `2d`, `kinetic`), `illustrated` (aliases `storybook`, `hand-drawn`), or `3d` (aliases `3d motion`, `3d studio`).
- `Aspect`: `16:9` (`1920x1080`, default), `9:16` (`1080x1920`), or `1:1` (`1080x1080`).
- `Audience`: `general` (default; alias `smart adult`), `eli5`, or `technical` (alias `engineer`).
- `Max duration`: seconds (`120` default).
- `Style`: `default`, `paper`, `blueprint`, or path to a `.json` file.
- `Voice`: `kokoro[:voice_id]` (`af_heart`, `af_nova`, `am_adam`, `bf_emma`, `bm_george`, etc.), `gemini[:VoiceName]` (`Kore`, `Puck`, `Charon`; optional `Voice style:` and `Voice model:`), `<audio_path>`, or `none`.
- `Captions`: `auto` (`on` when voiced, `off` when `Voice: none`), `on`, or `off`.
- `Music`: `synth[:cosmic|warm|minimal]`, `<audio_path>`, or `none`. `Music level`: `-19` default when voiced, `-14` LUFS unvoiced. `Music lift`: `start-end` ranges (`+9 dB`).
- `Sound effects`: `on` / `subtle` / `studio` or `off`. `## Sound` lines use `- <anchor>: <kind> [intensity] [duration_s] [pan=-1..1]` where `<anchor>` is `12.40`, `@s02+0.40`, or `@s05:iron[-0.50]` and `<kind>` is `whoosh`, `zoom`, `impact`, `boom`, `sub_drop`, `riser`, `rumble`, `chime`, `shimmer`, `pop`, `tick`, `pulse`, `tap`, or `air`.
- `Transition`: `motion` (default; consecutive rows pointing to the same `graphic:` file merge into one span) or `cut`.

## Built-in single-beat visuals

Separate fields with `;` (use ` / ` instead of `|` inside table cells):

- `title: Headline ; Subtitle [; Kicker]`
- `card: Title ; row 1 ; row 2` (repeating title + prior rows reveals only new rows)
- `flow: Step 1 -> *Active Step 2* -> Step 3 [; Heading]`
- `compare: Left :: item 1, item 2 ; Right :: item 1, item 2 [; Heading]`
- `number: 99.98% ; Label [; Subtext]`
- `code: auth.ts ; const token = sign(p); ; *return encrypt(token, key);*` (pad ` ; ` with spaces)
- `image: media/photo.jpg [; Caption ; Source credit]`
- `clip: media/demo.mp4 [; Caption ; Source credit]`
- `quote: Quote text ; Author [; Role or Source ; media/avatar.jpg]`
- `page: captures/docs.png [TOP>TOP]`
- `receipt: captures/post.png [mark X,Y,W,H]...`
- `graphic: graphics/world.html`

## Mode 1: `Motion` (`ExplainerStage` + `stage.css`)

Auto-injected into `graphics/*.html`: `stage.css`, `gsap@3.14.2`, `explainer-data.js` (`window.__EXPLAINER_DATA__`), and `stage.js` (`window.ExplainerStage`).

- **CSS kit (`stage.css`):** `.st-stage` (`paper`, `blueprint`), `.st-backdrop`, `.st-parallax`, `.st-cam-shake`, `.st-cam-pivot`, `.st-cam`, `.st-badge` (`gold`, `cyan`, `crimson`, `violet`, `green`, `paper`, `ink`), `.st-kinetic` (`sm`, `lg`, `xl`), `.st-clipping` (`.st-clipping-mast`, `.st-clipping-head`, `.st-clipping-sub`), `.st-highlight`, `.st-stamp`, `.st-media-card`, `.st-quote-card`, `.st-3d-rig`, `.st-3d-layer`, `.st-phone-shell`.
- **Stage API (`stage.js`):**
  - `ExplainerStage.create(compId, { duration, drift })`, `stage.setDrift(cfg)`, `stage.mountBackdrop("#backdrop", { preset: "cosmos" | "paper" | "blueprint", onDraw: (ctx, t, camPose) => ... })` (`onDraw` paints extra layers after the preset).
  - World coordinates: `(0, 0)` inside `#cam` sits at the frame's horizontal center and 46% down, so place art with negative and positive `left`/`top` around it, as in the example below.
  - Camera: `camInit({ x, y, scale, rot })`, `camTo(t, { x, y, scale, rot, dur, ease })`, `whipTo(t, cfg)`, `zoomThrough(t, { x, y, peakScale, dur, toX, toY, toScale })`, `shake(t, dur, amp)`.
  - Choreography: `drawStroke(sel, t, dur, ease)`, `highlightSweep(sel, t, dur)`, `stampSlam(sel, t, cfg)`, `kineticPunch(sel, t, cfg)`, `kenBurns(sel, t0, t1, cfg)`, `popIn(sel, t, cfg)`, `fadeOut(sel, t, dur)`, `implode(sel, t, cfg)`, `counter(sel, from, to, t, dur, fmt)`.
  - Timing & SVG: `scene("s02")`, `cue("s02", "phrase", 0.4)`, `scallopPath(...)`, `coronaFlares(...)`, `onTick((t, camPose) => ...)`, `finalize()`.

```html
<template id="world-tpl">
  <div data-composition-id="world-comp" data-width="1920" data-height="1080" data-duration="24.00">
    <div class="st-stage paper">
      <canvas id="backdrop" class="st-backdrop" data-layout-allow-overflow></canvas>
      <div id="cam-shake" class="st-cam-shake"><div id="cam-pivot" class="st-cam-pivot"><div id="cam" class="st-cam">
        <svg width="2400" height="1400" viewBox="-1200 -700 2400 1400" style="overflow:visible" data-layout-allow-overflow>
          <path id="route-arc" d="M -680 120 Q -120 -360 520 -80" fill="none" stroke="#be123c" stroke-width="6" />
        </svg>
        <div id="press1" class="st-clipping" style="left:-640px;top:-280px;width:580px">
          <div class="st-clipping-mast">Investigative Desk</div>
          <h3 class="st-clipping-head">Route Flagged in <span id="hl-memo" class="st-highlight">Board Memo</span></h3>
          <img id="press-img" src="../assets/media/founder.jpg" alt="" style="height:240px;margin-top:12px">
        </div>
        <div id="stamp1" class="st-stamp" style="left:-140px;top:-330px">PROBE</div>
        <div id="hero-stat" class="st-kinetic crimson" style="left:820px;top:-140px">-$500B</div>
      </div></div></div>
    </div>
    <script>
      const stage = ExplainerStage.create("world-comp");
      stage.camInit({ x: 0, y: 0, scale: 1 }).mountBackdrop("#backdrop", { preset: "paper" });
      stage.drawStroke("#route-arc", 0.15, 1.1).popIn("#press1", 0.35, { fromScale: 0.92, y: 24 });
      stage.kenBurns("#press-img", 0.35, 10.0).highlightSweep("#hl-memo", stage.cue("s01", "memo", 1.2), 0.5);
      stage.stampSlam("#stamp1", stage.cue("s01", "probe", 2.1), { rot: -7 });
      stage.whipTo(stage.scene("s02").start, { x: 860, scale: 1.12 });
      stage.kineticPunch("#hero-stat", stage.cue("s02", "billion", 0.4));
      stage.finalize();
    </script>
  </div>
</template>
```

## Mode 2: `Illustrated` (`StoryBrush` + `IllustratedStage` in `illustrated.js`)

Auto-injected when `Mode: illustrated` or `IllustratedStage` / `StoryBrush` appears in `graphics/*.html`. Bake textured sprites once at startup (`bake` / `bakeBoil`) and composite them in `onDraw` so 30 fps renders stay fast and token-light.

- **`StoryBrush`:**
  - `bake(key, w, h, (ctx, w, h, seed) => ..., seed)` and `bakeBoil(key, 3, w, h, (ctx, w, h, frameIdx, seed) => ..., seed)` + `pickBoil(framesArr, t, 10, phaseSeed)`.
  - `paperGrain(ctx, w, h, baseHex, toothAlpha, seed)` (`#FCFBF7` warm cotton rag or `#0D162B` night indigo).
  - `gouacheFill(ctx, pts, color, { wobble, tooth, poolColor, seed })`.
  - `fillPastel(ctx, pts, color, { angle, density, tooth, wobble, seed })` and `fillStriped(ctx, pts, [colA, colB], { stripeHeight, stripeAngle, tooth, seed })`.
  - `crayonStroke(ctx, pts, color, width, roughness, seed)`, `drawBlush(ctx, cx, cy, rx, ry, color, density, seed)`, `drawDryRibbon(ctx, p0, p1, p2, p3, wStart, wEnd, color, bristles, seed, { dryness })`, `drawHairLock(ctx, p0, p1, p2, p3, wStart, color, { highlightColor, flyaways, seed })`.
  - Deterministic math: `mulberry32(seed)` (`.gauss()`, `.range(lo, hi)`), `noise2`, `fbm2`, `noise01`.
- **`IllustratedStage.mount(compId, "#canvas", opts)`:**
  - `stage.onDraw(({ ctx, W, H, t, scene, speech, palette, brush, safeBottomY }) => ...)` + `stage.finalize()`.
  - `speech`: `{ speaking, word, viseme, openness, mouthWidth, progress }` computed from `words.json`; `stage.blinkAt(t, seed)` returns `0..1` periodic blink.
  - `stage.withCamera(ctx, { x, y, scale, rot, drift, shake, t }, drawFn)`, `stage.pageWipe(ctx, progress, bgHex, seed)`, `stage.drawLabel(ctx, text, x, y, { size, bg, fg, border, rot, alpha })` (clamped above `SAFE_BOTTOM_Y`).

```html
<template id="ill-tpl">
  <div data-composition-id="ill-comp" data-width="1920" data-height="1080" data-duration="12.00">
    <canvas id="ill-canvas" width="1920" height="1080" data-layout-allow-overflow style="position:absolute;inset:0;width:100%;height:100%"></canvas>
    <script>
      const B = StoryBrush;
      const sunBoil = B.bakeBoil("sun", 3, 520, 520, (g, w, h, f, seed) => {
        const pts = Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          return [260 + Math.cos(a) * 190, 260 + Math.sin(a) * 190];
        });
        B.gouacheFill(g, pts, B.palette.sunGold, { wobble: 5, tooth: 0.4, seed });
        B.crayonStroke(g, pts.concat([pts[0]]), B.palette.charcoalInk, 5, 0.55, seed + 9);
      }, 42);
      const stage = IllustratedStage.mount("ill-comp", "#ill-canvas");
      stage.onDraw(({ ctx, W, H, t, scene }) => {
        B.paperGrain(ctx, W, H, scene.index === 0 ? B.palette.paperCream : B.palette.nightIndigo, 0.16, 7);
        stage.withCamera(ctx, { t, scale: 1 + 0.08 * scene.progress }, (g) => {
          g.drawImage(B.pickBoil(sunBoil, t, 10), W * 0.5 - 260, H * 0.46 - 260);
        });
        stage.drawLabel(ctx, "20x MASSIVE STAR", W * 0.5, 130);
      }).finalize();
    </script>
  </div>
</template>
```

## Mode 3: `3D` (`Studio3D` in `studio3d.js` + optional `blender_export.py`)

Auto-injected when `Mode: 3d` or `Studio3D` / `THREE.` appears in `graphics/*.html`: cached `three.min.js` (`r149`) and `studio3d.js`.

- **`Studio3D.create(compId, "#webgl", opts)`:**
  - Configures `WebGLRenderer({ preserveDrawingBuffer: true, antialias: true })`, studio PMREM softbox reflections, lights, and HalfFloat bloom + ACES Filmic composer (`studio.bloom.params`: `threshold = 1.05`, `bloomStrength = 0.42`, `exposure = 1.0`).
  - Materials (`studio.materials`): `titaniumBrushed()`, `titaniumDark()`, `chromeMirror()`, `mattePlaque()`, `sapphireGlass()`, `vaultGold()`, `emeraldCore()`, `emissiveGlow(hex, intensity)`.
  - Camera & lifecycle: `studio.setCameraPath([{ t, pos: [x,y,z], target: [x,y,z], fov, roll }, ...])`, `studio.onTick((t, studio) => ...)`, `studio.finalize()`.
  - Multi-act registry: `Studio3D.registerAct("act1", [t0, t1], (studio) => ({ group, update(t), getCameraPose(t) }))` blends poses seamlessly across `handoffWindow` (`1.1s` default).
  - Readable 3D callouts: `studio.makePlaque("3 MS SAVE", { width, bg, fg, border })` + `studio.faceCamera(mesh)` + `studio.clampAboveCaptions(mesh)` keeps HUD plaques nearly perpendicular to the lens and above the caption zone.
  - Synchronous meshes: `studio.loadAsset("heroMesh")` or `Studio3D.buildGeo(spec)` decodes base64 `Float32Array` / `Uint16Array` / `Uint32Array` specs from `window.STUDIO_ASSETS` (`<script src="../assets/media/studio_assets.js"></script>`).
- **Optional headless Blender exporter (`$S/blender_export.py`):**
  - When `blender` is installed and beveled hardware or Voronoi fracture shards help, write a short generator importing `blender_export` (`clear_scene`, `new_mesh_obj`, `add_rounded_rect_prism`, `apply_bevel`, `fracture_solid`, `pack_object`, `write_studio_assets`) and run `blender -b -P gen_meshes.py` to output `$P/media/studio_assets.js`. Fall back to procedural `THREE` geometries when `blender` is absent.

```html
<template id="three-tpl">
  <div data-composition-id="three-comp" data-width="1920" data-height="1080" data-duration="12.00">
    <canvas id="webgl" width="1920" height="1080" data-layout-allow-overflow style="position:absolute;inset:0;width:100%;height:100%"></canvas>
    <script>
      const studio = Studio3D.create("three-comp", "#webgl");
      const torus = new THREE.Mesh(new THREE.TorusKnotGeometry(1.35, 0.38, 160, 28), studio.materials.titaniumBrushed());
      const plaque = studio.makePlaque("SINGLE-TAKE 3D", { width: 3.1 });
      plaque.position.set(0, 2.25, 0);
      studio.scene.add(torus, plaque);
      studio.setCameraPath([
        { t: 0, pos: [0, 0.9, 6.8], target: [0, 0.3, 0], fov: 42 },
        { t: 12, pos: [2.4, 1.4, 5.4], target: [0, 0.2, 0], fov: 40 }
      ]);
      studio.onTick((t) => {
        torus.rotation.set(t * 0.35, t * 0.55, 0);
        studio.faceCamera(plaque);
        studio.clampAboveCaptions(plaque);
      }).finalize();
    </script>
  </div>
</template>
```

## `style.json` and themes

Built-in presets: `default`, `paper`, and `blueprint`. Lookup order: `--style` -> `<project>/style.json` -> `Style:` in `script.md` -> `~/.config/video-explainer/style.json` -> `styles/default.json`.

```json
{
  "projects_dir": "~/Videos/explainers",
  "caption_y": {"16:9": 965, "9:16": 1480, "1:1": 960},
  "caption": {"font": "../fonts/InterVariable.woff2", "weight": 600, "size": 42, "color": "#FFFFFF",
              "box": "#0B0B0DD9", "border": "#FFFFFF22", "radius": 12, "pad": [24, 12],
              "uppercase": false, "max_words": 6, "max_chars": 38, "emphasis": "#3B82F6"},
  "theme": {"background": "#0B0B0D", "surface": "#15161B", "surface_2": "#1E2028",
            "border": "#FFFFFF1F", "text": "#F8FAFC", "muted": "#94A3B8",
            "accent": "#3B82F6", "accent_2": "#60A5FA", "good": "#10B981", "warn": "#F59E0B", "danger": "#EF4444"},
  "sound_effects": "subtle"
}
```
