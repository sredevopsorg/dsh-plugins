"""Shared helpers: aspect presets, ffmpeg/ffprobe wrappers, style loading, and the script.md parser."""
import glob, json, os, re, subprocess, sys, wave

import numpy as np
from sfx import parse_sound_line

FPS = 30
HF_VERSION = "0.9.79"
HF = f"hyperframes@{HF_VERSION}"   # pinned so renders and alignments stay identical across machines
_HF_BIN = None


def hf_cmd(*args):
    """Use the local cached hyperframes@0.9.79 binary directly (~10x faster than npx -y), falling back to npx."""
    global _HF_BIN
    if _HF_BIN is None:
        _HF_BIN = ""
        for pkg in glob.glob(os.path.expanduser("~/.npm/_npx/*/node_modules/hyperframes/package.json")):
            try:
                if json.load(open(pkg, encoding="utf-8")).get("version") == HF_VERSION:
                    cand = os.path.join(os.path.dirname(os.path.dirname(pkg)), ".bin", "hyperframes")
                    if os.path.isfile(cand) and os.access(cand, os.X_OK):
                        _HF_BIN = cand
                        break
            except Exception:
                continue
    return ([_HF_BIN, *args] if _HF_BIN else ["npx", "-y", HF, *args])


def hf_env(extra=None):
    env = dict(os.environ, NO_UPDATE_NOTIFIER="1", npm_config_update_notifier="false")
    if extra:
        env.update(extra)
    return env
ASPECTS = {
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
}
MODES = ("motion", "illustrated", "3d")
MODE_ALIASES = {
    "motion": "motion",
    "default": "motion",
    "2d": "motion",
    "2d motion": "motion",
    "kinetic": "motion",
    "illustrated": "illustrated",
    "storybook": "illustrated",
    "storyboard": "illustrated",
    "hand drawn": "illustrated",
    "picture book": "illustrated",
    "3d": "3d",
    "3d motion": "3d",
    "3d studio": "3d",
    "studio 3d": "3d",
    "threejs": "3d",
}
AUDIENCES = ("general", "eli5", "technical")
AUDIENCE_ALIASES = {
    "general": "general",
    "smart adult": "general",
    "curious non engineer": "general",
    "non engineer": "general",
    "default": "general",
    "eli5": "eli5",
    "technical": "technical",
    "engineer": "technical",
    "engineers": "technical",
    "engineering": "technical",
}
DEFAULT_MAX_DURATION = 120.0
PRESET_STYLES = ("default", "paper", "blueprint")
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_ENV = os.path.expanduser("~/.config/video-explainer/.env")


def settings_key():
    """Read Gemini API key from env or ~/.config/video-explainer/.env so it never enters chat."""
    for var in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        if os.environ.get(var):
            return os.environ[var].strip()
    if os.path.isfile(SETTINGS_ENV):
        for line in open(SETTINGS_ENV, encoding="utf-8"):
            k, _, v = line.strip().partition("=")
            if k.strip() in ("GEMINI_API_KEY", "GOOGLE_API_KEY") and v.strip():
                return v.strip().strip("'\"")
    return None


def die(msg):
    sys.exit(f"error: {msg}")


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode:
        die(f"{cmd[0]} failed:\n{(r.stderr or r.stdout)[-1500:]}")
    return r


def parse_json_output(text, label="command"):
    """Extract the last complete JSON object or array from CLI stdout (tolerates leading [hyperframes] logs)."""
    src = text or ""
    decoder = json.JSONDecoder()
    starts = [m.start(1) for m in re.finditer(r"(?m)^\s*([\{\[])", src)]
    for pos in reversed(starts):
        try:
            obj, end = decoder.raw_decode(src, pos)
            if isinstance(obj, (dict, list)) and not src[end:].strip():
                return obj
        except json.JSONDecodeError:
            continue
    for pos in reversed(starts):
        try:
            obj, _ = decoder.raw_decode(src, pos)
            if isinstance(obj, (dict, list)):
                return obj
        except json.JSONDecodeError:
            continue
    die(f"{label} returned invalid JSON:\n{src[-800:]}")


def probe(path):
    """Return width, height, duration (seconds) of a media file."""
    out = run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration",
               "-of", "json", path]).stdout
    info = json.loads(out)
    vid = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
    return vid.get("width"), vid.get("height"), float(info.get("format", {}).get("duration") or 0)


def frames(t):
    return int(round(t * FPS))


def project_paths(project):
    p = os.path.abspath(project)
    return {
        "root": p,
        "script": os.path.join(p, "script.md"),
        "work": os.path.join(p, "work"),
        "renders": os.path.join(p, "renders"),
        "narration": os.path.join(p, "work", "narration.wav"),
        "words": os.path.join(p, "work", "words.json"),
        "transcript": os.path.join(p, "work", "transcript.md"),
    }


# ---------- audio energy ----------

def read_wav_mono(path):
    with wave.open(path, "rb") as wf:
        sr, ch = wf.getframerate(), wf.getnchannels()
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        pcm = pcm.reshape(-1, ch).mean(axis=1)
    return pcm, sr


def energy_db(pcm, sr, hop_s=0.01):
    hop = max(1, int(sr * hop_s))
    n = len(pcm) // hop
    if n == 0:
        return np.array([-90.0])
    rms = np.sqrt(np.mean(pcm[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms + 1e-9)


def silence_threshold(db):
    """Adaptive threshold between the noise floor and typical speech level."""
    live = db[db > -85] if np.any(db > -85) else db
    floor, speech = np.percentile(live, 10), np.percentile(live, 90)
    return max(floor + 0.3 * (speech - floor), -55.0)


# ---------- style ----------

def _resolve_style_ref(ref, project_root=None):
    """Resolve a preset name ('paper') or file path into an existing JSON file path."""
    if not ref:
        return None
    low = ref.strip().lower()
    if low in PRESET_STYLES:
        return os.path.join(SKILL_DIR, "styles", f"{low}.json")
    exp = os.path.expanduser(ref.strip())
    if os.path.isabs(exp):
        return exp if os.path.isfile(exp) else die(f"style file not found: {ref}")
    if project_root:
        cand = os.path.join(project_root, exp)
        if os.path.isfile(cand):
            return cand
    if os.path.isfile(exp):
        return os.path.abspath(exp)
    die(f"style not found: {ref} (presets: {', '.join(PRESET_STYLES)})")


def _load_style_layer(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    base = os.path.dirname(os.path.abspath(os.path.expanduser(path)))
    for section in ("caption", "theme"):
        for k, v in data.get(section, {}).items():
            if k.endswith("font") and v:
                data[section][k] = os.path.normpath(os.path.join(base, os.path.expanduser(v)))
    return data


def load_style(project, style_arg=None, script_style=None):
    """Merge style layers: default.json <- ~/.config/video-explainer/style.json <- Style: <- <project>/style.json <- --style."""
    default_path = os.path.join(SKILL_DIR, "styles", "default.json")
    layers = [default_path]
    user_global = os.path.expanduser("~/.config/video-explainer/style.json")
    if os.path.isfile(user_global):
        layers.append(user_global)
    if script_style:
        layers.append(_resolve_style_ref(script_style, project))
    proj_style = os.path.join(project, "style.json")
    if os.path.isfile(proj_style):
        layers.append(proj_style)
    if style_arg:
        layers.append(_resolve_style_ref(style_arg, project))

    style = _load_style_layer(layers[0])
    for layer_path in layers[1:]:
        custom = _load_style_layer(layer_path)
        for section in ("caption", "theme", "caption_y"):
            if section in custom:
                style.setdefault(section, {}).update(custom[section])
        for k, v in custom.items():
            if k not in ("caption", "theme", "caption_y"):
                style[k] = v

    for section in ("caption", "theme"):
        for k, v in style.get(section, {}).items():
            if k.endswith("font") and not os.path.isfile(v):
                die(f"style font not found: {v}")
    style["_path"] = layers[-1]
    return style


# ---------- script.md ----------

def _num_or_auto(s, line_no, what):
    t = s.strip().lower()
    if t in ("auto", "-", ""):
        return None
    try:
        return float(s)
    except ValueError:
        die(f"script.md line {line_no}: {what} '{s}' must be a number or 'auto'")


def _strip_emphasis_marker(s):
    s = s.strip()
    if len(s) > 2 and s.startswith("*") and s.endswith("*"):
        return s[1:-1].strip(), True
    return s, False


def parse_visual(v, line_no):
    """Parse one visual cell from script.md ## Scenes."""
    v = v.strip()
    if not v:
        die(f"script.md line {line_no}: visual cell cannot be empty")
    low = v.lower()

    if low.startswith("graphic:"):
        src = v[8:].strip()
        if not src:
            die(f"script.md line {line_no}: graphic needs a file path like 'graphic: graphics/s01.html'")
        return {"type": "graphic", "src": src}

    if low.startswith("title:"):
        parts = [p.strip() for p in v[6:].split(";")]
        if not parts[0]:
            die(f"script.md line {line_no}: title needs at least a headline: 'title: Headline ; Subtitle [; Kicker]'")
        return {
            "type": "title",
            "headline": parts[0],
            "subtitle": parts[1] if len(parts) > 1 else "",
            "kicker": parts[2] if len(parts) > 2 else "",
        }

    if low.startswith("card:"):
        parts = [p.strip() for p in v[5:].split(";")]
        if not parts[0]:
            die(f"script.md line {line_no}: card needs a title: 'card: Title ; row 1 ; row 2'")
        return {"type": "card", "title": parts[0], "rows": [p for p in parts[1:] if p]}

    if low.startswith("flow:"):
        parts = [p.strip() for p in v[5:].split(";")]
        raw_nodes = [n.strip() for n in parts[0].split("->") if n.strip()]
        if len(raw_nodes) < 2:
            die(f"script.md line {line_no}: flow needs at least 2 nodes joined by '->': 'flow: Step 1 -> *Step 2* [; Heading]'")
        nodes = []
        for raw in raw_nodes:
            label, active = _strip_emphasis_marker(raw)
            nodes.append({"label": label, "active": active})
        return {"type": "flow", "nodes": nodes, "title": parts[1] if len(parts) > 1 else ""}

    if low.startswith("compare:"):
        parts = [p.strip() for p in v[8:].split(";")]
        if len(parts) < 2 or "::" not in parts[0] or "::" not in parts[1]:
            die(f"script.md line {line_no}: compare must be 'compare: Left :: a, b ; Right :: c, d [; Title]'")
        sides = []
        for idx in (0, 1):
            heading, _, body = parts[idx].partition("::")
            items = [it.strip() for it in re.split(r"\s*,\s*|\s+/\s+", body.strip()) if it.strip()]
            sides.append({"heading": heading.strip(), "items": items})
        return {
            "type": "compare",
            "left": sides[0],
            "right": sides[1],
            "title": parts[2] if len(parts) > 2 else "",
        }

    if low.startswith("number:"):
        parts = [p.strip() for p in v[7:].split(";")]
        if not parts[0] or not re.search(r"\d", parts[0]):
            die(f"script.md line {line_no}: number needs a value with digits, like 'number: 89.5% ; Label [; Subtext]'")
        return {
            "type": "number",
            "value": parts[0],
            "label": parts[1] if len(parts) > 1 else "",
            "subtext": parts[2] if len(parts) > 2 else "",
        }

    if low.startswith("code:"):
        # Split on whitespace-padded " ; " (or ";;") so trailing semicolons in JS/TS/C lines stay intact.
        parts = [p.strip() for p in re.split(r"\s+;\s+|;;", v[5:].strip()) if p.strip()]
        if len(parts) < 2 or not parts[0]:
            die(f"script.md line {line_no}: code needs a title/filename and at least one line: 'code: app.ts ; line 1 ; *line 2*'")
        lines = []
        for raw in parts[1:]:
            text, hl = _strip_emphasis_marker(raw)
            lines.append({"text": text, "highlight": hl})
        return {"type": "code", "title": parts[0], "lines": lines}

    if low.startswith("page:"):
        tokens = v[5:].split()
        if not tokens:
            die(f"script.md line {line_no}: page needs an image path: 'page: captures/site.png [0>300]'")
        drift = (0.0, 220.0)
        if len(tokens) > 1:
            m = re.fullmatch(r"(\d+(?:\.\d+)?)(?:>(\d+(?:\.\d+)?))?", tokens[1])
            if not m:
                die(f"script.md line {line_no}: page drift must be 'TOP>TOP' in pixels, like 120>520")
            y0 = float(m.group(1))
            drift = (y0, float(m.group(2)) if m.group(2) else y0 + 220.0)
        return {"type": "page", "src": tokens[0], "drift": drift}

    if low.startswith("receipt:"):
        tokens = v[8:].split()
        if not tokens:
            die(f"script.md line {line_no}: receipt needs an image path: 'receipt: captures/post.png [mark X,Y,W,H]...'")
        rec = {"type": "receipt", "src": tokens[0], "marks": []}
        it = iter(tokens[1:])
        for t in it:
            try:
                assert t == "mark"
                box = tuple(float(x) for x in next(it, "").split(","))
                assert len(box) == 4 and all(0 <= x <= 1 for x in box)
            except (ValueError, AssertionError):
                die(f"script.md line {line_no}: receipt is 'receipt: path [mark X,Y,W,H]...', fractions 0..1")
            rec["marks"].append(box)
        return rec

    if low.startswith("image:"):
        parts = [p.strip() for p in v[6:].split(";")]
        if not parts[0]:
            die(f"script.md line {line_no}: image needs a file path: 'image: media/photo.jpg [; Caption ; Source credit]'")
        return {
            "type": "image",
            "src": parts[0],
            "caption": parts[1] if len(parts) > 1 else "",
            "credit": parts[2] if len(parts) > 2 else "",
        }

    if low.startswith("clip:"):
        parts = [p.strip() for p in v[5:].split(";")]
        if not parts[0]:
            die(f"script.md line {line_no}: clip needs a video path: 'clip: media/demo.mp4 [; Caption ; Source credit]'")
        return {
            "type": "clip",
            "src": parts[0],
            "caption": parts[1] if len(parts) > 1 else "",
            "credit": parts[2] if len(parts) > 2 else "",
        }

    if low.startswith("quote:"):
        parts = [p.strip() for p in v[6:].split(";")]
        if len(parts) < 2 or not parts[0] or not parts[1]:
            die(f"script.md line {line_no}: quote needs text and author: 'quote: Quote text ; Author [; Role or Source ; media/avatar.jpg]'")
        text_val = parts[0].strip().strip('"“”')
        if not text_val:
            die(f"script.md line {line_no}: quote text cannot be empty")
        return {
            "type": "quote",
            "text": text_val,
            "author": parts[1],
            "source": parts[2] if len(parts) > 2 else "",
            "avatar": parts[3] if len(parts) > 3 else "",
        }

    die(
        f"script.md line {line_no}: unknown visual '{v}'. "
        "Expected graphic:, title:, card:, flow:, compare:, number:, code:, page:, receipt:, image:, clip:, or quote:"
    )


def parse_script(path):
    """Parse script.md into {settings, narration, scenes, fixes, emphasis, sounds}. Fails loudly with line numbers."""
    if not os.path.isfile(path):
        die(f"{path} not found")
    settings, narration, scenes, fixes, emphasis, sounds = {}, {}, [], [], [], []
    section, header = None, None
    with open(path, encoding="utf-8") as fh:
        for i, raw in enumerate(fh, 1):
            s = raw.strip()
            if s.startswith("## "):
                section = s[3:].strip().lower()
                header = None
                continue
            if not s or s.startswith("# ") or s.startswith("<!--"):
                continue
            if section is None:
                m = re.match(r"([A-Za-z][A-Za-z _-]*):\s*(.*)$", s)
                if m:
                    key = re.sub(r"[\s_-]+", " ", m.group(1).strip().lower())
                    settings[key] = (m.group(2).strip(), i)
                continue
            if section.startswith("narration"):
                m = re.match(r"(?:-\s*)?([A-Za-z0-9_-]+)\s*:\s*(.*)$", s)
                if not m:
                    die(f"script.md line {i}: narration line must look like '- s01: Spoken line...', got '{s}'")
                sid, text = m.group(1).strip(), m.group(2).strip()
                if sid in narration:
                    die(f"script.md line {i}: duplicate narration for scene '{sid}'")
                narration[sid] = text
            elif section.startswith("scenes"):
                if not s.startswith("|"):
                    continue
                cells = [c.strip() for c in s.strip("|").split("|")]
                if header is None:
                    header = [c.lower() for c in cells]
                    for need in ("id", "start", "end", "visual"):
                        if need not in header:
                            die(f"script.md line {i}: scenes table needs a '{need}' column")
                    continue
                if all(re.fullmatch(r":?-+:?", c) for c in cells if c):
                    continue
                if len(cells) != len(header):
                    die(f"script.md line {i}: expected {len(header)} cells, got {len(cells)}. Use ' / ' instead of '|' inside cells.")
                row = dict(zip(header, cells))
                sid = row["id"].strip()
                if not sid:
                    die(f"script.md line {i}: scene id cannot be empty")
                scenes.append({
                    "id": sid,
                    "start": _num_or_auto(row["start"], i, "start"),
                    "end": _num_or_auto(row["end"], i, "end"),
                    "visual": parse_visual(row["visual"], i),
                    "note": row.get("note", ""),
                    "line": i,
                })
            elif section.startswith("caption"):
                m = re.match(r"-\s*(.+?)\s*->\s*(.+)$", s)
                if m:
                    fixes.append((m.group(1), m.group(2)))
            elif section.startswith("emphasis"):
                m = re.match(r"-\s*(.+)$", s)
                if m:
                    emphasis.append(m.group(1).strip())
            elif section.startswith("sound"):
                if s.startswith("-"):
                    try:
                        sounds.append(parse_sound_line(s, i))
                    except ValueError as err:
                        die(str(err))
    parsed = {
        "settings": settings,
        "narration": narration,
        "scenes": scenes,
        "fixes": fixes,
        "emphasis": emphasis,
        "sounds": sounds,
    }
    parsed["mode"] = resolve_mode(parsed)
    parsed["audience"] = resolve_audience(parsed)
    parsed["max_duration"] = resolve_max_duration(parsed)
    return parsed


def setting(script_data, key, default=None):
    v = script_data["settings"].get(key)
    return v[0] if v else default


def resolve_mode(script_data):
    """Return canonical visual mode ('motion' | 'illustrated' | '3d') from Mode: header (default 'motion')."""
    entry = script_data["settings"].get("mode")
    if not entry or not entry[0].strip():
        return "motion"
    raw, line_no = entry
    norm = re.sub(r"[\s_-]+", " ", raw.strip().lower())
    if norm in MODE_ALIASES:
        return MODE_ALIASES[norm]
    die(f"script.md line {line_no}: Mode must be one of {', '.join(MODES)}, got '{raw}'")


def resolve_audience(script_data):
    """Return canonical audience ('general' | 'eli5' | 'technical') from Audience: header (default 'general')."""
    entry = script_data["settings"].get("audience")
    if not entry or not entry[0].strip():
        return "general"
    raw, line_no = entry
    norm = re.sub(r"[\s_-]+", " ", raw.strip().lower())
    if norm in AUDIENCE_ALIASES:
        return AUDIENCE_ALIASES[norm]
    die(
        f"script.md line {line_no}: Audience must be one of {', '.join(AUDIENCES)} "
        f"(or alias 'smart adult', 'engineer'), got '{raw}'"
    )


def resolve_max_duration(script_data):
    """Return float seconds from Max duration: header (default 120.0)."""
    entry = script_data["settings"].get("max duration")
    if not entry or not entry[0].strip():
        return DEFAULT_MAX_DURATION
    raw, line_no = entry
    txt = raw.strip()
    if txt.lower().endswith("s"):
        txt = txt[:-1].strip()
    try:
        val = float(txt)
    except ValueError:
        die(f"script.md line {line_no}: Max duration must be a number of seconds, got '{raw}'")
    if val <= 0 or not np.isfinite(val):
        die(f"script.md line {line_no}: Max duration must be greater than 0, got '{raw}'")
    return val


def resolve_aspect(script_data):
    raw = (setting(script_data, "aspect", "16:9") or "16:9").strip()
    if raw not in ASPECTS:
        die(f"script.md: Aspect must be one of {', '.join(ASPECTS)}, got '{raw}'")
    return raw, ASPECTS[raw]


def resolve_voice(script_data, project_root=None):
    """Return ('none'|'kokoro'|'gemini'|'file', value) from Voice: setting."""
    raw = setting(script_data, "voice")
    if raw is None:
        return ("kokoro", "af_heart") if script_data["narration"] else ("none", None)
    val = raw.strip()
    low = val.lower()
    if low in ("none", "off", "silent"):
        return ("none", None)
    if low == "kokoro":
        return ("kokoro", "af_heart")
    if low.startswith("kokoro:"):
        return ("kokoro", val.split(":", 1)[1].strip() or "af_heart")
    if low == "gemini":
        return ("gemini", "Kore")
    if low.startswith("gemini:"):
        return ("gemini", val.split(":", 1)[1].strip() or "Kore")
    path = os.path.expanduser(val)
    if project_root and not os.path.isabs(path):
        path = os.path.join(project_root, path)
    return ("file", path)


def captions_enabled(script_data, project_root=None):
    raw = (setting(script_data, "captions", "auto") or "auto").strip().lower()
    if raw in ("off", "false", "no", "none"):
        return False
    if raw in ("on", "true", "yes"):
        return True
    mode, _ = resolve_voice(script_data, project_root)
    return mode != "none"


def validate_scenes(script_data, project, duration=None):
    scenes = script_data["scenes"]
    if not scenes:
        die("script.md has no rows under '## Scenes'")
    seen_ids = set()
    for sc in scenes:
        if sc["id"] in seen_ids:
            die(f"script.md line {sc['line']}: duplicate scene id '{sc['id']}'")
        seen_ids.add(sc["id"])
        if sc["start"] is None or sc["end"] is None:
            die(f"script.md line {sc['line']}: scene '{sc['id']}' has 'auto' timing; run narrate.py first (or enter numbers for Voice: none)")
        if sc["end"] <= sc["start"]:
            die(f"script.md line {sc['line']}: scene end ({sc['end']}) must be after start ({sc['start']})")
    if abs(scenes[0]["start"]) > 0.05:
        die(f"script.md line {scenes[0]['line']}: first scene must start at 0")
    for a, b in zip(scenes, scenes[1:]):
        if abs(a["end"] - b["start"]) > 1.5 / FPS:
            die(f"script.md line {b['line']}: scene starts at {b['start']} but previous scene ends at {a['end']}")
    for sc in scenes:
        vis = sc["visual"]
        if vis["type"] in ("graphic", "page", "receipt", "image", "clip"):
            vis["abs"] = vis["src"] if os.path.isabs(vis["src"]) else os.path.join(project, vis["src"])
            if not os.path.isfile(vis["abs"]):
                die(f"script.md line {sc['line']}: {vis['type']} not found: {vis['src']}")
        elif vis["type"] == "quote" and vis.get("avatar"):
            vis["avatar_abs"] = vis["avatar"] if os.path.isabs(vis["avatar"]) else os.path.join(project, vis["avatar"])
            if not os.path.isfile(vis["avatar_abs"]):
                die(f"script.md line {sc['line']}: quote avatar not found: {vis['avatar']}")
    if duration is not None:
        last = scenes[-1]
        if abs(last["end"] - duration) > 0.6:
            die(f"script.md line {last['line']}: last scene ends at {last['end']} but narration is {duration:.2f}s")
        last["end"] = duration
    return scenes
