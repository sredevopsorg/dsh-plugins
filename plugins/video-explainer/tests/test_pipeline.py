"""Unit and end-to-end integration tests for /video-explainer."""
import json, os, subprocess, sys, tempfile, unittest
from unittest import mock

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(REPO_ROOT, "skills", "video-explainer", "scripts")
sys.path.insert(0, SCRIPTS_DIR)

import common
import media
import qa
import review
import sfx


SAMPLE_GRAPHIC = """<template id="s03-tpl">
  <div data-composition-id="s03-box" data-width="1920" data-height="1080" data-duration="2.00">
    <style>
      .wrap { position: absolute; inset: 0; padding: 80px 120px var(--safe-bottom, 190px); box-sizing: border-box;
              display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 32px; }
      .hdr { font: 800 52px/1.1 Ftitle, sans-serif; color: var(--text); margin: 0; }
      .box { fill: var(--surface); stroke: var(--accent); stroke-width: 3; rx: 24; }
      .lbl { font: 700 30px Fbody, sans-serif; fill: var(--text); text-anchor: middle; dominant-baseline: central; }
    </style>
    <div class="wrap">
      <h2 class="hdr">Encrypted Tunnel</h2>
      <svg width="960" height="240" viewBox="0 0 960 240">
        <g id="nodeA"><rect class="box" x="40" y="40" width="280" height="160" /><text class="lbl" x="180" y="120">Client</text></g>
        <path id="wire" d="M 340 120 H 620" stroke="var(--accent)" stroke-width="6" fill="none" />
        <g id="nodeB"><rect class="box" x="640" y="40" width="280" height="160" /><text class="lbl" x="780" y="120">Server</text></g>
      </svg>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.from("#nodeA", { autoAlpha: 0, y: 20, duration: 0.35 }, 0.1)
        .from("#nodeB", { autoAlpha: 0, y: 20, duration: 0.35 }, 0.45)
        .from("#wire", { autoAlpha: 0, duration: 0.3 }, 0.8);
      window.__timelines["s03-box"] = tl;
    </script>
  </div>
</template>
"""


def write_text(path, content):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


def read_text(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def make_test_image(path, w=640, h=360, color="0x2563EB", alpha=False):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    fmt = "rgba" if alpha else "rgb24"
    src_color = f"{color}@0.6" if alpha else color
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={src_color}:s={w}x{h}:d=0.1",
         "-frames:v", "1", "-pix_fmt", fmt, path],
        check=True,
    )


def make_test_video(path, w=640, h=360, dur=2.5, fps=24):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size={w}x{h}:rate={fps}:duration={dur}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", path],
        check=True,
    )


class ScriptParserTests(unittest.TestCase):
    def test_parse_all_twelve_visual_types_and_styles(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_text(os.path.join(tmp, "g.html"), '<div data-composition-id="g"></div>')
            for name in ("site.png", "post.png", "media/photo.jpg", "media/avatar.png", "media/demo.mp4"):
                full = os.path.join(tmp, name)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "wb") as fh:
                    fh.write(b"stub")
            md = os.path.join(tmp, "script.md")
            write_text(md, """# script.md: demo
Aspect: 16:9
Style: paper
Voice: none
Captions: off

## Narration
- s01: Hello world.

## Scenes
| id | start | end | visual | note |
|---|---|---|---|---|
| s01 | 0.00 | 2.00 | title: Headline ; Subtitle ; Kicker | intro |
| s02 | 2.00 | 4.00 | card: Steps ; One ; Two | list |
| s03 | 4.00 | 6.00 | flow: Input -> *Process* -> Output ; Flow | pipeline |
| s04 | 6.00 | 8.00 | compare: Before :: Slow, Manual ; After :: Fast, Auto ; Contrast | cmp |
| s05 | 8.00 | 10.00 | number: 99.5% ; Accuracy ; Measured on test set | stat |
| s06 | 10.00 | 12.00 | code: app.ts ; const a = 1; ; *return a * 2;* | snippet |
| s07 | 12.00 | 14.00 | page: site.png 100>400 | docs |
| s08 | 14.00 | 16.00 | receipt: post.png mark .1,.2,.7,.1 | proof |
| s09 | 16.00 | 18.00 | image: media/photo.jpg ; GPU wafer ; Wikimedia Commons | img |
| s10 | 18.00 | 20.00 | clip: media/demo.mp4 ; Live rollout ; Demo Lab | clip |
| s11 | 20.00 | 22.00 | quote: Software is eating the world. ; Marc Andreessen ; WSJ 2011 ; media/avatar.png | quote |
| s12 | 22.00 | 24.00 | graphic: g.html | custom |

## Caption fixes
- Wi Fi -> Wi-Fi

## Emphasis
- Accuracy
""")
            parsed = common.parse_script(md)
            self.assertEqual(len(parsed["scenes"]), 12)
            self.assertEqual(
                [s["visual"]["type"] for s in parsed["scenes"]],
                ["title", "card", "flow", "compare", "number", "code", "page", "receipt", "image", "clip", "quote", "graphic"],
            )
            validated = common.validate_scenes(parsed, tmp)
            self.assertEqual(validated[8]["visual"]["credit"], "Wikimedia Commons")
            self.assertEqual(validated[9]["visual"]["caption"], "Live rollout")
            self.assertEqual(validated[10]["visual"]["author"], "Marc Andreessen")
            self.assertTrue(os.path.isfile(validated[10]["visual"]["avatar_abs"]))
            self.assertIn("GPU wafer", review.describe(validated[8]["visual"]))
            self.assertIn("Live rollout", review.describe(validated[9]["visual"]))
            self.assertIn("Marc Andreessen", review.describe(validated[10]["visual"]))
            self.assertTrue(parsed["scenes"][2]["visual"]["nodes"][1]["active"])
            self.assertTrue(parsed["scenes"][5]["visual"]["lines"][1]["highlight"])
            self.assertFalse(common.captions_enabled(parsed, tmp))
            self.assertEqual(common.resolve_aspect(parsed), ("16:9", (1920, 1080)))
            self.assertEqual(parsed["audience"], "general")
            self.assertEqual(parsed["max_duration"], 120.0)
            for preset in ("default", "paper", "blueprint"):
                st = common.load_style(tmp, style_arg=preset)
                self.assertIn("accent", st["theme"])
                self.assertTrue(os.path.isfile(st["caption"]["font"]))

    def test_audience_and_max_duration_headers_and_duration_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            md = os.path.join(tmp, "script.md")
            cases = [
                ("", "general", 120.0),
                ("Audience: general\n", "general", 120.0),
                ("Audience: smart adult\n", "general", 120.0),
                ("Audience: Smart Adult\n", "general", 120.0),
                ("Audience: eli5\nMax duration: 60\n", "eli5", 60.0),
                ("Audience: technical\nMax duration: 150.5\n", "technical", 150.5),
                ("Audience: engineer\nMax duration: 180s\n", "technical", 180.0),
            ]
            for hdr, exp_aud, exp_max in cases:
                write_text(md, f"{hdr}## Scenes\n| id | start | end | visual |\n|---|---|---|---|\n| s01 | 0 | 2 | title: Hi ; Sub |\n")
                parsed = common.parse_script(md)
                self.assertEqual(parsed["audience"], exp_aud)
                self.assertEqual(common.resolve_audience(parsed), exp_aud)
                self.assertAlmostEqual(parsed["max_duration"], exp_max)
                self.assertAlmostEqual(common.resolve_max_duration(parsed), exp_max)

            write_text(md, "Audience: martian\n## Scenes\n| id | start | end | visual |\n|---|---|---|---|\n| s01 | 0 | 2 | title: Hi ; Sub |\n")
            with self.assertRaises(SystemExit) as cm_aud:
                common.parse_script(md)
            self.assertIn("line 1", str(cm_aud.exception))

            write_text(md, "Max duration: -10\n## Scenes\n| id | start | end | visual |\n|---|---|---|---|\n| s01 | 0 | 2 | title: Hi ; Sub |\n")
            with self.assertRaises(SystemExit) as cm_dur:
                common.parse_script(md)
            self.assertIn("line 1", str(cm_dur.exception))

            mode_cases = [
                ("", "motion"),
                ("Mode: motion\n", "motion"),
                ("Mode: Illustrated\n", "illustrated"),
                ("Mode: storybook\n", "illustrated"),
                ("Mode: 3d\n", "3d"),
                ("Mode: 3D Motion\n", "3d"),
                ("Mode: 3D Studio\n", "3d"),
            ]
            for hdr, exp_mode in mode_cases:
                write_text(md, f"{hdr}## Scenes\n| id | start | end | visual |\n|---|---|---|---|\n| s01 | 0 | 2 | title: Hi ; Sub |\n")
                parsed = common.parse_script(md)
                self.assertEqual(parsed["mode"], exp_mode)
                self.assertEqual(common.resolve_mode(parsed), exp_mode)

            write_text(md, "Mode: hologram\n## Scenes\n| id | start | end | visual |\n|---|---|---|---|\n| s01 | 0 | 2 | title: Hi ; Sub |\n")
            with self.assertRaises(SystemExit) as cm_mode:
                common.parse_script(md)
            self.assertIn("line 1", str(cm_mode.exception))

        # Default 120s cap allows up to 122.0s (+2.0s trailing grace)
        self.assertTrue(qa.duration_cap_check(68.0, 120.0)[1])
        self.assertTrue(qa.duration_cap_check(122.0, 120.0)[1])
        bad_name, bad_ok, bad_detail = qa.duration_cap_check(122.1, 120.0)
        self.assertEqual(bad_name, "Duration cap (duration_cap)")
        self.assertFalse(bad_ok)
        self.assertIn("FAIL", bad_detail)
        self.assertTrue(qa.duration_cap_check(148.0, 150.0)[1])

    def test_malformed_visual_exits_with_line_number(self):
        with tempfile.TemporaryDirectory() as tmp:
            md = os.path.join(tmp, "script.md")
            write_text(md, """## Scenes
| id | start | end | visual |
|---|---|---|---|
| s01 | 0 | 2 | bogus: nothing |
""")
            with self.assertRaises(SystemExit) as cm:
                common.parse_script(md)
            self.assertIn("line 4", str(cm.exception))

    def test_parse_json_output_ignores_leading_brackets(self):
        raw = '[hyperframes] browserGpuMode probe -> hardware\n{\n  "ok": true,\n  "lint": {"errorCount": 0}\n}\n'
        obj = common.parse_json_output(raw, "check")
        self.assertTrue(obj["ok"])
        self.assertEqual(obj["lint"]["errorCount"], 0)

    def test_media_cli_normalizes_images_clips_and_wikimedia_credit(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = os.path.join(tmp, "media-proj")
            os.makedirs(os.path.join(proj, "media"), exist_ok=True)
            big_png = os.path.join(tmp, "big_alpha.png")
            raw_vid = os.path.join(tmp, "raw24.mp4")
            make_test_image(big_png, w=2400, h=1200, color="0x16A34A", alpha=True)
            make_test_video(raw_vid, w=1280, h=720, dur=3.0, fps=24)

            py_runner = os.path.join(SCRIPTS_DIR, "py")
            out_png = os.path.join(proj, "media", "logo.png")
            out_clip = os.path.join(proj, "media", "broll.mp4")
            subprocess.run([py_runner, os.path.join(SCRIPTS_DIR, "media.py"), "image", big_png, out_png, "--credit", "Local Repo"], check=True)
            subprocess.run([py_runner, os.path.join(SCRIPTS_DIR, "media.py"), "clip", raw_vid, out_clip, "--start", "0.4", "--duration", "1.8", "--credit", "Demo Clip"], check=True)

            iw, ih, _ = common.probe(out_png)
            self.assertEqual((iw, ih), (1920, 960))
            self.assertTrue(media._has_alpha(out_png))

            cw, ch, cdur = common.probe(out_clip)
            self.assertEqual((cw, ch), (1280, 720))
            self.assertAlmostEqual(cdur, 1.8, delta=0.15)

            manifest = json.loads(read_text(os.path.join(proj, "work", "media-sources.json")))
            self.assertEqual(len(manifest), 2)
            self.assertEqual({m["out"] for m in manifest}, {"media/logo.png", "media/broll.mp4"})

            fake_api = {
                "query": {
                    "pages": {
                        "10": {
                            "index": 1,
                            "title": "File:Chip wafer.jpg",
                            "imageinfo": [{
                                "mime": "image/jpeg",
                                "thumburl": "https://upload.wikimedia.org/fake.jpg",
                                "descriptionurl": "https://commons.wikimedia.org/wiki/File:Chip_wafer.jpg",
                                "extmetadata": {
                                    "Artist": {"value": '<a href="https://example.org">Jane Doe</a>'},
                                    "LicenseShortName": {"value": "CC BY-SA 4.0"},
                                },
                            }],
                        }
                    }
                }
            }
            fake_resp = mock.MagicMock()
            fake_resp.read.return_value = json.dumps(fake_api).encode("utf-8")
            fake_resp.__enter__.return_value = fake_resp
            with mock.patch("urllib.request.urlopen", return_value=fake_resp):
                img_url, credit, page_url = media.search_wikimedia("chip wafer")
            self.assertEqual(img_url, "https://upload.wikimedia.org/fake.jpg")
            self.assertEqual(credit, "Jane Doe / CC BY-SA 4.0 / Wikimedia Commons")
            self.assertIn("File:Chip_wafer.jpg", page_url)

    def test_sfx_synthesis_and_word_cue_resolution(self):
        scenes = [{"id": "s01", "start": 0.0, "end": 4.0}, {"id": "s02", "start": 4.0, "end": 9.0}]
        words = [
            {"text": "Silicon", "start": 4.25, "end": 4.70},
            {"text": "fuses", "start": 4.72, "end": 5.08},
            {"text": "into", "start": 5.10, "end": 5.30},
            {"text": "iron.", "start": 5.35, "end": 5.82},
        ]
        self.assertAlmostEqual(sfx.resolve_cue_time("@s02:iron", scenes, words, 9.0), 5.35, places=2)
        self.assertAlmostEqual(sfx.resolve_cue_time("@s02:iron-0.50", scenes, words, 9.0), 4.85, places=2)
        self.assertAlmostEqual(sfx.resolve_cue_time("@s01+0.40", scenes, words, 9.0), 0.40, places=2)
        parsed = sfx.parse_sound_line("- @s02:iron: sub_drop 0.9 1.1s pan=-0.3", 12)
        self.assertEqual(parsed["kind"], "sub_drop")
        self.assertAlmostEqual(parsed["intensity"], 0.9)
        self.assertAlmostEqual(parsed["duration"], 1.1)
        self.assertAlmostEqual(parsed["pan"], -0.3)
        for kind in ("whoosh", "zoom", "impact", "boom", "sub_drop", "riser", "rumble", "chime", "shimmer", "pop", "tick", "pulse"):
            buf = sfx.synth_cue(kind)
            self.assertEqual(buf.shape[1], 2)
            self.assertLessEqual(float(abs(buf).max()), 1.0)
        bed = sfx.synth_ambient_score(3.0, mood="cosmic")
        self.assertEqual(bed.shape, (3 * sfx.SR, 2))

    def test_stage_js_exports_drift_and_stage_css_classes(self):
        stage_js_path = os.path.join(REPO_ROOT, "skills", "video-explainer", "assets", "stage.js")
        stage_css = read_text(os.path.join(REPO_ROOT, "skills", "video-explainer", "assets", "stage.css"))
        for cls in (".st-kinetic", ".st-clipping", ".st-highlight", ".st-stamp", ".st-3d-rig", ".st-3d-layer", ".st-phone-shell"):
            self.assertIn(cls, stage_css, f"Missing {cls} in stage.css")

        node_check = f"""
const fs = require("fs");
const vm = require("vm");
const code = fs.readFileSync({json.dumps(stage_js_path)}, "utf8");
const elements = {{
  "#cam-shake": {{ style: {{ transform: "" }} }},
  "#cam-pivot": {{ style: {{ transform: "" }} }},
  "#cam": {{ style: {{ transform: "" }} }},
  "#arc": {{ tagName: "path", getTotalLength: () => 480, style: {{}} }},
  "#hl": {{
    classList: {{ contains: () => false, add: function() {{ this.added = true; }} }},
    querySelector: () => null,
    firstChild: null,
    ownerDocument: {{ createElement: () => ({{ className: "", setAttribute: () => {{}} }}) }},
    insertBefore: function(node) {{ this.inserted = node; return node; }}
  }},
  "#stamp": {{ style: {{}} }},
  "#punch": {{ style: {{}} }},
  "#photo": {{ tagName: "IMG", style: {{}} }},
}};
const gsapCalls = [];
const tl = {{
  _t: 0,
  to: function(t, v, pos) {{ gsapCalls.push(["to", v, pos]); return tl; }},
  fromTo: function(t, fv, tv, pos) {{ gsapCalls.push(["fromTo", fv, tv, pos]); return tl; }},
  set: function(t, v, pos) {{ gsapCalls.push(["set", v, pos]); return tl; }},
  seek: function(t) {{ this._t = t; return tl; }},
  time: function() {{ return this._t; }},
  eventCallback: function() {{ return tl; }},
}};
const sandbox = {{
  window: null,
  document: {{
    querySelector: (s) => elements[s] || null,
    querySelectorAll: () => [],
  }},
}};
sandbox.window = sandbox;
sandbox.window.addEventListener = () => {{}};
sandbox.window.gsap = {{
  timeline: () => tl,
  set: (el, v) => gsapCalls.push(["gsap.set", v]),
  getProperty: () => 0,
  utils: {{ toArray: (s) => (typeof s === "string" ? (elements[s] ? [elements[s]] : []) : [s]) }},
}};
vm.runInNewContext(code, sandbox);
const stage = sandbox.window.ExplainerStage.create("unit-comp", {{ duration: 12 }});
sandbox.window.ExplainerStage.create("drift-comp", {{ duration: 12, drift: {{ swayX: 4 }} }});  // drift config must not crash create()
const required = [
  "setDrift", "whipTo", "zoomThrough", "drawStroke",
  "highlightSweep", "stampSlam", "kineticPunch", "kenBurns", "seek"
];
for (const fn of required) {{
  if (typeof stage[fn] !== "function") throw new Error("Missing stage." + fn);
}}
stage.camInit({{ x: 0, y: 0, scale: 1 }});
stage.whipTo(1.0, {{ x: 600, scale: 1.1 }});
stage.zoomThrough(2.5, {{ x: 600, y: -40, peakScale: 4.8, dur: 0.9 }});
stage.drawStroke("#arc", 0.5, 0.8);
stage.highlightSweep("#hl", 1.2, 0.45);
stage.stampSlam("#stamp", 2.0, {{ rot: -8 }});
stage.kineticPunch("#punch", 3.0, {{ hold: 1.2 }});
stage.kenBurns("#photo", 0.0, 5.0, {{ toScale: 1.14, dx: -20, dy: -10 }});
stage.finalize();
stage.seek(0.0);
const tr0 = elements["#cam-shake"].style.transform;
stage.seek(1.7);
const tr1 = elements["#cam-shake"].style.transform;
if (tr0 === tr1) throw new Error("Expected continuous camera drift between t=0 and t=1.7");
stage.setDrift(false).seek(1.7);
const trOff = elements["#cam-shake"].style.transform;
if (trOff !== "translate3d(0,0,0)") throw new Error("Expected drift disabled, got " + trOff);
if (!gsapCalls.some((c) => c[0] === "to" && c[1].backgroundSize === "100% 100%" && c[2] === 1.2))
  throw new Error("Expected highlightSweep to sweep the marker's background-size at t=1.2");
console.log("OK");
"""
        r = subprocess.run(["node", "-e", node_check], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, f"stage.js check failed:\n{r.stdout}\n{r.stderr}")
        self.assertEqual(r.stdout.strip(), "OK")

    def test_motion_liveliness_thresholds_and_caption_band_exclusion(self):
        # Active >= 8s video passes
        good_diffs = [1.8] * 14 + [0.05, 0.05] + [2.4] * 4
        self.assertTrue(qa.evaluate_motion_liveliness(good_diffs, 10.5)[1])

        # 8+ consecutive frozen 0.5s intervals (4.0s frozen slide stretch) fails
        frozen_stretch = [2.5] * 10 + [0.10] * 8 + [2.5] * 6
        _, ok_f, det_f = qa.evaluate_motion_liveliness(frozen_stretch, 12.5)
        self.assertFalse(ok_f)
        self.assertIn("frozen stretch 4.0s >= 4.0s", det_f)

        # Low overall active ratio (< 0.65) on >= 8s video fails even without an 8-interval streak
        choppy = [0.05, 0.05, 1.2] * 6  # 6/18 = 33% active
        _, ok_c, det_c = qa.evaluate_motion_liveliness(choppy, 9.5)
        self.assertFalse(ok_c)
        self.assertIn("active ratio", det_c)

        # Short unit-test clip (< 8s) passes as long as no >= 4.0s frozen stretch exists
        short_diffs = [1.5, 0.05, 0.05, 0.05, 1.8, 0.05, 0.05, 0.05, 1.4]
        self.assertTrue(qa.evaluate_motion_liveliness(short_diffs, 5.5)[1])

        # Real video where ONLY the bottom caption band (y > 35 on 80x45, i.e. y >= 864 on 1080p) animates
        # while the upper 80% visual canvas stays completely static for 5.0s -> must FAIL!
        with tempfile.TemporaryDirectory() as tmp:
            fake_vid = os.path.join(tmp, "caption_only_motion.mp4")
            subprocess.run(
                [
                    "ffmpeg", "-v", "error", "-y", "-f", "lavfi",
                    "-i", "color=c=0x101828:s=1920x1080:r=30:d=5.5",
                    "-vf", "drawbox=x='mod(t*500,1400)':y=900:w=420:h=120:color=white:t=fill",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", fake_vid,
                ],
                check=True,
            )
            _, ok_cap, det_cap = qa.motion_liveliness(fake_vid, 5.5)
            self.assertFalse(ok_cap, f"Caption-only motion should not fool motion_liveliness: {det_cap}")
            self.assertIn("FAIL", det_cap)


class EndToEndPipelineTests(unittest.TestCase):
    def _run_py(self, script_name, *args):
        py_runner = os.path.join(SCRIPTS_DIR, "py")
        cmd = [py_runner, os.path.join(SCRIPTS_DIR, script_name), *args]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            self.fail(f"{script_name} failed ({r.returncode}):\nSTDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}")
        return r.stdout

    def test_unvoiced_end_to_end_render_and_qa(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = os.path.join(tmp, "unvoiced-demo")
            write_text(os.path.join(proj, "graphics", "s03.html"), SAMPLE_GRAPHIC)
            write_text(os.path.join(proj, "script.md"), """# script.md: unvoiced-demo
Aspect: 16:9
Style: paper
Voice: none
Sound effects: subtle

## Scenes
| id | start | end | visual | note |
|---|---|---|---|---|
| s01 | 0.00 | 1.80 | title: Zero-Key Motion ; Pure HTML and GSAP at 1080p ; Silent Demo | hook |
| s02 | 1.80 | 3.80 | flow: Script -> *Motion* -> MP4 ; Three Steps | flow |
| s03 | 3.80 | 5.80 | graphic: graphics/s03.html | custom svg |
""")
            self._run_py("narrate.py", proj)
            self.assertTrue(os.path.isfile(os.path.join(proj, "work", "transcript.md")))
            self._run_py("render.py", proj, "--draft")
            self.assertFalse(os.path.exists(os.path.join(proj, "renders", "share")))
            self._run_py("qa.py", proj)
            qa_report = read_text(os.path.join(proj, "work", "qa", "report.md"))
            self.assertIn("(10/10 checks)", qa_report)
            self.assertEqual(qa_report.count("- [x] "), 10)
            self.assertIn("- [x] Duration cap (duration_cap):", qa_report)
            self.assertIn("- [x] Motion liveliness (motion_liveliness):", qa_report)

            # Verify qa.py enforces Max duration cap (5.8s video > 2.0s cap + 2.0s grace = 4.0s limit)
            script_path = os.path.join(proj, "script.md")
            orig_script = read_text(script_path)
            write_text(script_path, orig_script.replace("Aspect: 16:9\n", "Aspect: 16:9\nAudience: smart adult\nMax duration: 2.0\n"))
            py_runner = os.path.join(SCRIPTS_DIR, "py")
            fail_run = subprocess.run([py_runner, os.path.join(SCRIPTS_DIR, "qa.py"), proj], capture_output=True, text=True)
            self.assertNotEqual(fail_run.returncode, 0)
            fail_report = read_text(os.path.join(proj, "work", "qa", "report.md"))
            self.assertIn("(9/10 checks)", fail_report)
            self.assertIn("- [ ] Duration cap (duration_cap): FAIL", fail_report)
            write_text(script_path, orig_script)
            self._run_py("qa.py", proj)

            master = os.path.join(proj, "renders", "unvoiced-demo-v1.mp4")
            share_dir = os.path.join(proj, "renders", "share")
            self.assertTrue(os.path.isfile(master))
            self.assertFalse(os.path.exists(share_dir))
            self.assertTrue(os.path.isfile(os.path.join(proj, "work", "qa", "contact.jpg")))
            self.assertTrue(os.path.isfile(os.path.join(proj, "work", "qa", "opening.jpg")))
            review.build_review_page(common.project_paths(proj), master, os.path.join(proj, "work", "review", "index.html"))
            self.assertTrue(os.path.isfile(os.path.join(proj, "work", "review", "index.html")))

    def test_media_primitives_and_multi_theme_backdrops_end_to_end(self):
        paper_world = """<template id="paper-tpl">
  <div data-composition-id="paper-comp" data-width="1920" data-height="1080" data-duration="2.00">
    <div class="st-stage paper">
      <canvas id="bg-paper" class="st-backdrop" data-layout-allow-overflow></canvas>
      <div id="cam-shake" class="st-cam-shake">
        <div id="cam-pivot" class="st-cam-pivot">
          <div id="cam" class="st-cam">
            <svg width="2000" height="1000" viewBox="-1000 -500 2000 1000" style="overflow:visible" data-layout-allow-overflow>
              <path id="p-arc" d="M -620 120 Q -120 -340 480 -60" fill="none" stroke="#be123c" stroke-width="6" />
            </svg>
            <div id="mcard" class="st-clipping" style="left:-620px;top:-260px;width:460px">
              <div class="st-clipping-mast">Investigative Desk</div>
              <h3 class="st-clipping-head">Route in <span id="hl1" class="st-highlight">Classified Memo</span></h3>
              <img id="mcard-img" src="../assets/media/photo.jpg" alt="" style="height:180px">
            </div>
            <div id="qcard" class="st-quote-card" style="left:40px;top:-220px;width:540px">
              <blockquote class="st-quote-text">"Predict in representation space, not every pixel."</blockquote>
              <div class="st-quote-meta">
                <img class="st-quote-avatar" src="assets/media/avatar.png" alt="">
                <span class="st-quote-author">Yann LeCun</span>
                <span class="st-quote-source">JEPA Architecture</span>
              </div>
            </div>
            <div id="b1" class="st-stamp" style="left:-360px;top:-350px">PROBE OPENED</div>
            <div id="b2" class="st-kinetic sm crimson" style="left:120px;top:70px">-$500B</div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const stage = ExplainerStage.create("paper-comp", { duration: 2.0 });
      stage.camInit({ x: 0, y: 0, scale: 1 });
      stage.mountBackdrop("#bg-paper", { preset: "paper" });
      stage.drawStroke("#p-arc", 0.05, 0.7);
      stage.popIn("#mcard", 0.08, { fromScale: 0.92, y: 18 });
      stage.kenBurns("#mcard-img", 0.08, 1.95, { toScale: 1.12, dx: -14, dy: -8 });
      stage.highlightSweep("#hl1", 0.25, 0.45);
      stage.popIn("#qcard", 0.22, { fromScale: 0.92, y: 18 });
      stage.stampSlam("#b1", 0.18, { rot: -5 });
      stage.kineticPunch("#b2", 0.32, { fromScale: 1.45 });
      stage.whipTo(0.85, { x: 60, scale: 1.06 });
      stage.finalize();
    </script>
  </div>
</template>
"""
        blueprint_world = """<template id="bp-tpl">
  <div data-composition-id="bp-comp" data-width="1920" data-height="1080" data-duration="1.80">
    <div class="st-stage blueprint">
      <canvas id="bg-bp" class="st-backdrop" data-layout-allow-overflow></canvas>
      <div id="cam-shake" class="st-cam-shake">
        <div id="cam-pivot" class="st-cam-pivot">
          <div id="cam" class="st-cam">
            <div class="st-3d-rig" style="left:-580px;top:-340px;width:360px;height:680px">
              <div id="phone3d" class="st-3d-layer" style="inset:0">
                <div class="st-phone-shell" style="width:320px;height:620px">
                  <img src="../assets/media/photo.jpg" alt="">
                </div>
              </div>
            </div>
            <div id="bp-tag" class="st-badge cyan" style="left:160px;top:-220px">MCP TOOL BUS</div>
            <div id="bp-q" class="st-quote-card" style="left:-100px;top:-120px;width:560px">
              <p class="st-quote-text">Expo client syncs sets straight to <span id="bp-hl" class="st-highlight cyan">typed MCP handlers</span>.</p>
              <div class="st-quote-meta">
                <span class="st-quote-author">Architecture Spec</span>
                <span class="st-quote-source">README.mcp.md</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const stage = ExplainerStage.create("bp-comp", { duration: 1.8 });
      stage.camInit({ x: 0, y: 0, scale: 1 });
      stage.mountBackdrop("#bg-bp", { preset: "blueprint" });
      stage.popIn("#phone3d", 0.06, { fromScale: 0.92, y: 20 });
      stage.popIn("#bp-tag", 0.1);
      stage.popIn("#bp-q", 0.2, { fromScale: 0.94, y: 16 });
      stage.highlightSweep("#bp-hl", 0.35, 0.45);
      stage.zoomThrough(0.95, { x: 40, y: -10, peakScale: 1.25, dur: 0.75 });
      stage.finalize();
    </script>
  </div>
</template>
"""
        with tempfile.TemporaryDirectory() as tmp:
            proj = os.path.join(tmp, "media-world-demo")
            make_test_image(os.path.join(proj, "media", "photo.jpg"), w=1280, h=720, color="0x1D4ED8")
            make_test_image(os.path.join(proj, "media", "avatar.png"), w=240, h=240, color="0x059669")
            make_test_video(os.path.join(proj, "media", "demo.mp4"), w=960, h=540, dur=2.2, fps=30)
            write_text(os.path.join(proj, "graphics", "paper_world.html"), paper_world)
            write_text(os.path.join(proj, "graphics", "bp_world.html"), blueprint_world)
            write_text(os.path.join(proj, "script.md"), """# script.md: media-world-demo
Aspect: 16:9
Style: paper
Voice: none
Music: synth:warm
Sound effects: on

## Scenes
| id | start | end | visual | note |
|---|---|---|---|---|
| s01 | 0.00 | 1.60 | image: media/photo.jpg ; Silicon Wafer Inspection ; Commons CC BY 4.0 | image card |
| s02 | 1.60 | 3.20 | clip: media/demo.mp4 ; Real-time Telemetry Capture ; Lab Feed | broll clip |
| s03 | 3.20 | 4.80 | quote: Accelerated computing reinvented the stack. ; Jensen Huang ; Keynote 2024 ; media/avatar.png | quote card |
| s04 | 4.80 | 6.80 | graphic: graphics/paper_world.html | paper world |
| s05 | 6.80 | 8.60 | graphic: graphics/bp_world.html | blueprint world |
""")
            self._run_py("narrate.py", proj)
            self._run_py("render.py", proj, "--draft")
            self.assertFalse(os.path.exists(os.path.join(proj, "renders", "share")))
            self.assertTrue(os.path.isfile(os.path.join(proj, "hf", "assets", "media", "photo.jpg")))
            self.assertTrue(os.path.isfile(os.path.join(proj, "hf", "assets", "media", "demo.mp4")))
            self._run_py("qa.py", proj)
            report = read_text(os.path.join(proj, "work", "qa", "report.md"))
            self.assertIn("(10/10 checks)", report)
            self.assertIn("- [x] Motion liveliness (motion_liveliness):", report)
            self.assertIn("- [x] HyperFrames check (lint/runtime/layout/contrast)", report)
            self.assertIn("errors=0", report)

    def test_voiced_kokoro_end_to_end_render_and_qa(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = os.path.join(tmp, "voiced-demo")
            write_text(os.path.join(proj, "script.md"), """# script.md: voiced-demo
Aspect: 16:9
Style: blueprint
Voice: kokoro:af_heart
Sound effects: subtle

## Narration
- s01: Compare static slides against timed motion graphics.
- s02: One command renders clean video with synced captions.

## Scenes
| id | start | end | visual | note |
|---|---|---|---|---|
| s01 | auto | auto | compare: Slides :: Dense bullets, Static text ; Motion :: Timed steps, Clear focus ; Why Motion Wins | compare |
| s02 | auto | auto | code: build.sh ; npx hyperframes lint ; *npx hyperframes render -o out.mp4* | code |

## Emphasis
- synced captions
""")
            self._run_py("narrate.py", proj)
            synced = common.parse_script(os.path.join(proj, "script.md"))
            self.assertIsNotNone(synced["scenes"][0]["start"])
            self.assertIsNotNone(synced["scenes"][1]["end"])
            transcript = read_text(os.path.join(proj, "work", "transcript.md"))
            self.assertIn("Cues (scene-local s):", transcript)

            self._run_py("render.py", proj, "--draft")
            self.assertFalse(os.path.exists(os.path.join(proj, "renders", "share")))
            self._run_py("qa.py", proj)
            report = read_text(os.path.join(proj, "work", "qa", "report.md"))
            self.assertIn("(10/10 checks)", report)
            self.assertEqual(report.count("- [x] "), 10)
            self.assertIn("- [x] Duration cap (duration_cap):", report)
            self.assertIn("- [x] Motion liveliness (motion_liveliness):", report)
            self.assertIn("- [x] Size is 1920x1080", report)
            self.assertIn("- [x] Loudness is -15 to -13 LUFS", report)
            self.assertIn("- [x] HyperFrames check (lint/runtime/layout/contrast)", report)

    def test_continuous_world_graphic_merges_consecutive_scenes(self):
        stage_world = """<template id="world-tpl">
  <div data-composition-id="world-comp" data-width="1920" data-height="1080" data-duration="4.00">
    <div class="st-stage">
      <canvas id="cosmos" class="st-backdrop" data-layout-allow-overflow></canvas>
      <div class="st-parallax" data-parallax="0.3" data-layout-allow-overflow>
        <svg width="2000" height="1200" viewBox="-1000 -600 2000 1200"><circle cx="0" cy="0" r="180" fill="rgba(56,189,248,0.08)"/></svg>
      </div>
      <div id="cam-shake" class="st-cam-shake">
        <div id="cam-pivot" class="st-cam-pivot">
          <div id="cam" class="st-cam">
            <svg width="2400" height="1400" viewBox="-600 -500 2400 1400" style="overflow:visible" data-layout-allow-overflow>
              <path id="orb" fill="#38bdf8" />
            </svg>
            <div id="tag1" class="st-badge cyan" style="left:0px;top:-190px">BEAT ONE</div>
            <div id="tag2" class="st-badge gold" style="left:640px;top:-190px">BEAT TWO</div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const stage = ExplainerStage.create("world-comp", { duration: 4.0 });
      stage.camInit({ x: 0, y: 0, scale: 1 });
      stage.mountCosmos("#cosmos");
      stage.popIn("#tag1", 0.15);
      stage.camTo(stage.scene("s02").start, { x: 640, scale: 1.15, dur: 0.9 });
      stage.popIn("#tag2", stage.cue("s02", "two", 0.3));
      const orb = document.getElementById("orb");
      stage.onTick((t) => { orb.setAttribute("d", stage.scallopPath(0, 0, 110, 14, 6, t * 2)); });
      stage.finalize();
    </script>
  </div>
</template>
"""
        with tempfile.TemporaryDirectory() as tmp:
            proj = os.path.join(tmp, "world-demo")
            write_text(os.path.join(proj, "graphics", "world.html"), stage_world)
            write_text(os.path.join(proj, "script.md"), """# script.md: world-demo
Aspect: 16:9
Voice: none
Music: synth:cosmic
Sound effects: on

## Scenes
| id | start | end | visual | note |
|---|---|---|---|---|
| s01 | 0.00 | 2.00 | graphic: graphics/world.html | beat 1 |
| s02 | 2.00 | 4.00 | graphic: graphics/world.html | beat 2 |

## Sound
- @s01+0.15: pop 0.8
- @s02: whoosh 0.9 pan=0.4
- @s02+0.40: chime 0.8
""")
            self._run_py("narrate.py", proj)
            self._run_py("render.py", proj, "--preview")
            self.assertTrue(os.path.isdir(os.path.join(proj, "work", "preview")))
            self.assertTrue(os.path.isfile(os.path.join(proj, "work", "preview", "contact.jpg")))
            self._run_py("render.py", proj, "--draft", "--share")
            self.assertTrue(os.path.isfile(os.path.join(proj, "renders", "world-demo-v1.mp4")))
            self.assertTrue(os.path.isfile(os.path.join(proj, "renders", "share", "world-demo-v1.mp4")))
            index_html = read_text(os.path.join(proj, "hf", "index.html"))
            self.assertEqual(index_html.count('data-composition-src="graphics/s01.html"'), 1)
            self.assertNotIn('graphics/s02.html', index_html)
            self.assertTrue(os.path.isfile(os.path.join(proj, "hf", "assets", "stage.js")))
            self.assertTrue(os.path.isfile(os.path.join(proj, "hf", "assets", "explainer-data.js")))
            self._run_py("qa.py", proj)
            report = read_text(os.path.join(proj, "work", "qa", "report.md"))
            self.assertIn("- [x] Loudness is -15 to -13 LUFS", report)
            self.assertIn("errors=0", report)
            scenes, _ = review.build_review_page(common.project_paths(proj),
                                                 os.path.join(proj, "renders", "world-demo-v1.mp4"),
                                                 os.path.join(proj, "work", "review", "index.html"))
            self.assertEqual(len(scenes), 2)


    def test_illustrated_and_3d_modes_end_to_end(self):
        ill_world = """<template id="ill-tpl">
  <div data-composition-id="ill-comp" data-width="1920" data-height="1080" data-duration="3.60">
    <canvas id="ill-cv" width="1920" height="1080" data-layout-allow-overflow style="position:absolute;inset:0;width:100%;height:100%"></canvas>
    <script>
      const B = StoryBrush;
      const sunBoil = B.bakeBoil("sun", 3, 520, 520, (g, w, h, f, seed) => {
        const pts = Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          return [260 + Math.cos(a) * 185, 260 + Math.sin(a) * 185];
        });
        B.gouacheFill(g, pts, B.palette.sunGold, { wobble: 5, tooth: 0.35, seed });
        B.crayonStroke(g, pts.concat([pts[0]]), B.palette.charcoalInk, 5, 0.5, seed + 7);
        B.drawBlush(g, 220, 250, 44, 28, B.palette.blushRose, 0.4, seed + 13);
      }, 42);
      const stage = IllustratedStage.mount("ill-comp", "#ill-cv");
      stage.onDraw(({ ctx, W, H, t, scene }) => {
        B.paperGrain(ctx, W, H, scene.index === 0 ? B.palette.paperCream : B.palette.nightIndigo, 0.16, 11);
        stage.withCamera(ctx, { t, x: (t - 1.8) * 90, scale: 1 + 0.14 * (t / 3.6) }, (g) => {
          g.drawImage(B.pickBoil(sunBoil, t, 10), W * 0.5 - 260, H * 0.46 - 260);
        });
        stage.drawLabel(ctx, scene.index === 0 ? "STORYBRUSH SUN" : "NIGHT COLLAPSE", W * 0.5, 130);
      }).finalize();
    </script>
  </div>
</template>
"""
        three_world = """<template id="three-tpl">
  <div data-composition-id="three-comp" data-width="1920" data-height="1080" data-duration="3.60">
    <canvas id="webgl" width="1920" height="1080" data-layout-allow-overflow style="position:absolute;inset:0;width:100%;height:100%"></canvas>
    <script>
      const studio = Studio3D.create("three-comp", "#webgl");
      const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.35, 0.38, 128, 24), studio.materials.titaniumBrushed());
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.65, 2), studio.materials.emissiveGlow(0x38bdf8, 1.8));
      const plaque = studio.makePlaque("SINGLE-TAKE 3D", { width: 3.1 });
      plaque.position.set(0, 2.2, 0);
      studio.scene.add(knot, core, plaque);
      studio.setCameraPath([
        { t: 0, pos: [-2.2, 1.1, 6.4], target: [0, 0.2, 0], fov: 42 },
        { t: 3.6, pos: [2.4, 1.5, 5.2], target: [0, 0.2, 0], fov: 40 }
      ]);
      studio.onTick((t) => {
        knot.rotation.set(t * 0.8, t * 1.1, 0);
        core.rotation.y = -t * 1.3;
        studio.faceCamera(plaque);
        studio.clampAboveCaptions(plaque);
      }).finalize();
    </script>
  </div>
</template>
"""
        with tempfile.TemporaryDirectory() as tmp:
            # 1. Illustrated mode E2E
            ill_proj = os.path.join(tmp, "ill-demo")
            write_text(os.path.join(ill_proj, "graphics", "world.html"), ill_world)
            write_text(os.path.join(ill_proj, "script.md"), """# script.md: ill-demo
Mode: illustrated
Aspect: 16:9
Voice: none
Music: synth:warm
Sound effects: subtle

## Scenes
| id | start | end | visual | note |
|---|---|---|---|---|
| s01 | 0.00 | 1.80 | graphic: graphics/world.html | daylight sun |
| s02 | 1.80 | 3.60 | graphic: graphics/world.html | night shift |
""")
            self._run_py("narrate.py", ill_proj)
            self._run_py("render.py", ill_proj, "--preview")
            self.assertTrue(os.path.isfile(os.path.join(ill_proj, "work", "preview", "contact.jpg")))
            self._run_py("render.py", ill_proj, "--draft")
            self.assertTrue(os.path.isfile(os.path.join(ill_proj, "hf", "assets", "illustrated.js")))
            ill_html = read_text(os.path.join(ill_proj, "hf", "graphics", "s01.html"))
            self.assertIn("../assets/illustrated.js", ill_html)
            self._run_py("qa.py", ill_proj)
            self.assertIn("(10/10 checks)", read_text(os.path.join(ill_proj, "work", "qa", "report.md")))

            # 2. 3D mode E2E
            three_proj = os.path.join(tmp, "three-demo")
            write_text(os.path.join(three_proj, "graphics", "world.html"), three_world)
            write_text(os.path.join(three_proj, "script.md"), """# script.md: three-demo
Mode: 3d
Aspect: 16:9
Voice: none
Music: synth:cosmic
Sound effects: subtle

## Scenes
| id | start | end | visual | note |
|---|---|---|---|---|
| s01 | 0.00 | 1.80 | graphic: graphics/world.html | orbit start |
| s02 | 1.80 | 3.60 | graphic: graphics/world.html | orbit end |
""")
            self._run_py("narrate.py", three_proj)
            self._run_py("render.py", three_proj, "--draft")
            self.assertTrue(os.path.isfile(os.path.join(three_proj, "hf", "assets", "three.min.js")))
            self.assertTrue(os.path.isfile(os.path.join(three_proj, "hf", "assets", "studio3d.js")))
            three_html = read_text(os.path.join(three_proj, "hf", "graphics", "s01.html"))
            self.assertIn("../assets/three.min.js", three_html)
            self.assertIn("../assets/studio3d.js", three_html)
            self._run_py("qa.py", three_proj)
            self.assertIn("(10/10 checks)", read_text(os.path.join(three_proj, "work", "qa", "report.md")))

    def test_docs_have_zero_em_dashes(self):
        for rel in (
            "README.md",
            "agents/openai.yaml",
            "skills/video-explainer/agents/openai.yaml",
            "skills/video-explainer/SKILL.md",
            "skills/video-explainer/reference.md",
            "skills/video-explainer/eval.md",
        ):
            content = read_text(os.path.join(REPO_ROOT, rel))
            self.assertNotIn("\u2014", content, f"Found em dash in {rel}")
        self.assertEqual(
            read_text(os.path.join(REPO_ROOT, "agents", "openai.yaml")),
            read_text(os.path.join(REPO_ROOT, "skills", "video-explainer", "agents", "openai.yaml")),
        )


if __name__ == "__main__":
    unittest.main()
