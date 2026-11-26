"""Build script.md into the HyperFrames project (PROJECT/hf) that render.py renders.
Supports 16:9 (default), 9:16, and 1:1, visual modes (motion, illustrated, 3d), optional voiceover,
optional music/SFX, captions, built-in primitives, webpage/receipt captures, and bespoke graphics."""
import hashlib, html, json, os, re, shutil, subprocess, urllib.request

import numpy as np
from common import (FPS, SKILL_DIR, captions_enabled, die, frames, load_style, parse_script, probe,
                    project_paths, resolve_aspect, resolve_voice, run, setting, validate_scenes)
from sfx import resolve_cue_time, synth_ambient_score, synth_cue

SR = 48000
THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"
THREE_CACHE = os.path.expanduser("~/.cache/video-explainer/vendor/three.min.js")
EASE = "(3*pow(min(t/{d},1),2)-2*pow(min(t/{d},1),3))"   # smoothstep for page drift


def esc(s):
    return html.escape(str(s))


def css_color(hex_color):
    h = str(hex_color).lstrip("#")
    if len(h) == 6:
        return "#" + h
    if len(h) == 8:
        r, g, b, a = (int(h[i:i + 2], 16) for i in (0, 2, 4, 6))
        return f"rgba({r},{g},{b},{a / 255:.3f})"
    return str(hex_color)


def number_parts(v):
    m = re.search(r"-?[\d,]*\.?\d+", v)
    num = m.group(0)
    return v[:m.start()], float(num.replace(",", "")), v[m.end():], len(num.split(".")[1]) if "." in num else 0


def synth_sfx(kind, sr=SR):
    """Subtle synthesized UI tap and transition swell (zero external audio dependencies)."""
    rng = np.random.default_rng(7 if kind == "tap" else 11)
    if kind == "tap":
        n = int(0.045 * sr)
        x = rng.standard_normal(n) * np.exp(-np.linspace(0, 9, n))
        x = np.convolve(x, np.ones(18) / 18, "same")
        amp = 0.045
    else:
        n = int(0.30 * sr)
        x = rng.standard_normal(n)
        x = np.convolve(x, np.ones(60) / 60, "same") * np.sin(np.linspace(0, np.pi, n)) ** 2
        amp = 0.032
    x /= np.max(np.abs(x)) + 1e-9
    return np.stack([x, x], 1) * amp


# ---------- captions ----------

def clean_word(w):
    return re.sub(r"^[\"'“‘(]+|[\"”’),.!?;:]+$", "", w)


def apply_fixes(words, fixes):
    words = [dict(w) for w in words]
    for wrong, right in fixes:
        target = [t.lower() for t in wrong.split()]
        i = 0
        while i <= len(words) - len(target):
            seg = words[i:i + len(target)]
            if [clean_word(w["text"]).lower() for w in seg] == target:
                tail = re.search(r"[,.!?;:]*$", seg[-1]["text"]).group(0)
                words[i:i + len(target)] = [{"text": right + tail, "start": seg[0]["start"], "end": seg[-1]["end"]}]
            i += 1
    return words


def emphasis_spans(words, emphasis):
    norm = lambda t: re.sub(r"[^\w.$%]+", "", t.lower())
    toks, spans = [norm(w) for w in words], []
    for phrase in emphasis:
        p = [norm(t) for t in phrase.split()]
        for i in range(len(toks) - len(p) + 1):
            if toks[i:i + len(p)] == p:
                spans.append((i, i + len(p)))
    return spans


def caption_chunks(words, fixes, max_words=6, max_chars=38):
    words = apply_fixes(words, fixes)
    chunks, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        chars = sum(len(x["text"]) + 1 for x in cur)
        punct = w["text"][-1:] in ".,!?;:"
        gap = nxt["start"] - w["end"] if nxt else 9
        if nxt is None or len(cur) >= max_words or punct or gap >= 0.16 or chars + len(nxt["text"]) > max_chars:
            text = " ".join(t for t in (clean_word(x["text"]) for x in cur) if t)
            if text:
                start = max(0.0, cur[0]["start"] - 2 / FPS)
                if chunks and chunks[-1]["end"] > start:
                    chunks[-1]["end"] = start
                chunks.append({"start": start, "end": cur[-1]["end"] + 0.06, "text": text})
            cur = []
    return chunks


def caption_track(chunks, scenes, total_frames):
    out = []
    for c in chunks:
        a, b = frames(c["start"]), min(total_frames, frames(c["end"]))
        pieces = [(max(a, frames(sc["start"])), min(b, frames(sc["end"])), c["text"]) for sc in scenes]
        pieces = [p for p in pieces if p[1] > p[0]]
        out += [p for p in pieces if len(pieces) == 1 or p[1] - p[0] >= 4]
    return out


# ---------- audio ----------

def read_pcm(path, seconds):
    raw = run_bytes(["ffmpeg", "-v", "error", "-i", path, "-t", f"{seconds:.4f}", "-vn", "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"])
    a = np.frombuffer(raw, dtype=np.float32)
    return a[: len(a) // 2 * 2].reshape(-1, 2).astype(np.float64)


def run_bytes(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode:
        die(f"{cmd[0]} failed: {r.stderr.decode(errors='replace')[-800:]}")
    return r.stdout


def lufs(pcm):
    r = subprocess.run(
        ["ffmpeg", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-", "-af", "ebur128", "-f", "null", "-"],
        input=pcm.astype(np.float32).tobytes(), capture_output=True,
    )
    m = re.findall(rb"I:\s+(-?[\d.]+)\s+LUFS", r.stderr)
    return float(m[-1]) if m else -70.0


def fit_length(pcm, n):
    if len(pcm) >= n:
        return pcm[:n]
    return np.vstack([pcm, np.zeros((n - len(pcm), 2))])


def duck_curve(voice, n, dip_db=5.0, hop=0.05):
    h = int(hop * SR)
    frames_ = max(1, n // h)
    mono = voice[: frames_ * h].mean(axis=1).reshape(frames_, h)
    db = 10 * np.log10(np.mean(mono ** 2, axis=1) + 1e-12)
    talk = (db > np.percentile(db, 90) - 25).astype(float)
    g = np.empty(frames_)
    level = 0.0
    for i, t in enumerate(talk):
        level += (t - level) * (0.5 if t > level else 0.1)
        g[i] = level
    gain = 10 ** (-dip_db * g / 20)
    return np.interp(np.arange(n), np.arange(frames_) * h + h / 2, gain)


def mix_audio(narration_wav, has_voice, music, level_db, duration, out_wav, lifts=(), sfx=()):
    n = int(round(duration * SR))
    mix = np.zeros((n, 2), dtype=np.float64)

    if has_voice and narration_wav and os.path.isfile(narration_wav):
        voice = fit_length(read_pcm(narration_wav, duration), n)
        v = lufs(voice)
        if v > -60:
            voice *= min(10 ** ((-14 - v) / 20), 8.0)
            mix += voice

    if music:
        m_low = music.lower()
        if m_low == "auto" or m_low.startswith("synth"):
            mood = music.split(":", 1)[1].strip() if ":" in music else "cosmic"
            bed = synth_ambient_score(duration, mood=mood, sr=SR)
        else:
            bed = read_pcm(music, duration + 1)
            while 0 < len(bed) < n:
                bed = np.vstack([bed, bed])
            bed = fit_length(bed, n)
        b = lufs(bed)
        if b > -60:
            target_lufs = (-14 + level_db) if has_voice else level_db
            bed *= 10 ** ((target_lufs - b) / 20)
        if has_voice:
            bed *= duck_curve(mix, n, dip_db=6.5)[:, None]
        for a, z in lifts:
            env = np.ones(n)
            i, j, r = int(a * SR), min(n, int(z * SR)), int(0.25 * SR)
            if j > i:
                env[i:j] = 10 ** (9 / 20)
                env[max(0, i - r):i] = np.linspace(1, 10 ** (9 / 20), i - max(0, i - r))
                env[j:min(n, j + r)] = np.linspace(10 ** (9 / 20), 1, min(n, j + r) - j)
                bed *= env[:, None]
        ramp = min(n, int((1.0 if has_voice else 0.8) * SR))
        bed[:ramp] *= np.linspace(0.35 if has_voice else 0.0, 1.0, ramp)[:, None]
        tail = min(n, int(0.9 * SR))
        bed[-tail:] *= np.linspace(1.0, 0.0, tail)[:, None]
        mix += bed

    for idx_cue, item in enumerate(sfx):
        if isinstance(item, dict):
            s = synth_cue(item["kind"], intensity=item.get("intensity", 1.0), pan=item.get("pan", 0.0),
                          duration=item.get("duration"), seed=idx_cue, sr=SR)
            t = item["t"]
        else:
            kind, t = item
            s = synth_cue(kind, seed=idx_cue, sr=SR)
        k = int(round(t * SR))
        e = min(n, k + len(s))
        if 0 <= k < n and e > k:
            mix[k:e] += s[: e - k]

    # Only normalize when continuous voice or music is present; never boost sparse SFX-only silence to -14 LUFS.
    if has_voice or music:
        m = lufs(mix)
        if m > -55:
            mix *= 10 ** ((-14 - m) / 20)

    ceiling = 10 ** (-1.5 / 20)
    if np.max(np.abs(mix)) > ceiling:
        mix = np.tanh(mix / ceiling) * ceiling

    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-", out_wav],
        input=mix.astype(np.float32).tobytes(), capture_output=True,
    )
    if p.returncode:
        die("could not write the audio mix")


def _copy_dir_contents(src_dir, dst_dir):
    if not os.path.isdir(src_dir):
        return
    for root, _, files in os.walk(src_dir):
        rel_dir = os.path.relpath(root, src_dir)
        out_dir = dst_dir if rel_dir == "." else os.path.join(dst_dir, rel_dir)
        os.makedirs(out_dir, exist_ok=True)
        for fn in files:
            if fn.startswith("."):
                continue
            shutil.copy2(os.path.join(root, fn), os.path.join(out_dir, fn))


def _ensure_rel_link(link_path, rel_target, fallback_src):
    if os.path.islink(link_path):
        os.unlink(link_path)
    elif os.path.isdir(link_path):
        shutil.rmtree(link_path, ignore_errors=True)
    elif os.path.exists(link_path):
        os.remove(link_path)
    try:
        os.symlink(rel_target, link_path)
    except OSError:
        if os.path.isdir(fallback_src):
            shutil.copytree(fallback_src, link_path, dirs_exist_ok=True)


def _stage_media_file(abs_path, sid, project_root, A):
    for folder in ("media", "captures"):
        folder_abs = os.path.join(project_root, folder)
        try:
            rel = os.path.relpath(abs_path, folder_abs)
            if not rel.startswith("..") and not os.path.isabs(rel):
                rel_posix = rel.replace(os.sep, "/")
                dst = os.path.join(A, "media", rel)
                if not os.path.isfile(dst):
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(abs_path, dst)
                return f"assets/media/{rel_posix}"
        except ValueError:
            pass
    key = f"{os.path.realpath(abs_path)}|{os.path.getmtime(abs_path)}"
    ext = os.path.splitext(abs_path)[1].lower()
    name = f"{sid}-{hashlib.md5(key.encode()).hexdigest()[:8]}{ext}"
    shutil.copy2(abs_path, os.path.join(A, "media", name))
    return f"assets/media/{name}"


def _render_media_meta(caption, credit):
    if not caption and not credit:
        return ""
    cap_html = f'<div class="media-cap">{esc(caption)}</div>' if caption else ""
    cred_html = f'<span class="media-pill">{esc(credit)}</span>' if credit else ""
    align_cls = " media-meta-single" if not (caption and credit) else ""
    return f'<div class="media-meta{align_cls}">{cap_html}{cred_html}</div>'


def prep_clip(src_abs, dur, out, loop_short=False):
    if os.path.isfile(out):
        return
    ff = ["ffmpeg", "-v", "error", "-y"]
    if loop_short:
        ff += ["-stream_loop", "-1"]
    ff += [
        "-i", src_abs, "-t", f"{dur:.3f}",
        "-vf", f"scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps={FPS}",
        "-r", str(FPS), "-an", "-c:v", "libx264", "-crf", "19", "-g", "15", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
    ]
    run(ff)

def prep_page(vis, dur, out, pw, ph):
    if os.path.isfile(out):
        return
    y0, y1 = vis["drift"]
    y = f"min(ih-oh,{y0}+({y1 - y0})*{EASE.format(d=dur)})"
    run([
        "ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", str(FPS), "-t", f"{dur:.3f}", "-i", vis["abs"],
        "-vf", f"scale={pw}:-2,pad=iw:max(ih\\,{ph}):0:0:white,crop={pw}:{ph}:0:'{y}',fps={FPS}",
        "-frames:v", str(frames(dur)), "-an", "-c:v", "libx264", "-crf", "17", "-g", "15", "-pix_fmt", "yuv420p", out,
    ])


def _ensure_three_script_src(A):
    dst = os.path.join(A, "three.min.js")
    if os.path.isfile(dst):
        return "../assets/three.min.js"
    if not os.path.isfile(THREE_CACHE):
        try:
            os.makedirs(os.path.dirname(THREE_CACHE), exist_ok=True)
            with urllib.request.urlopen(THREE_CDN, timeout=15) as resp:
                data = resp.read()
            if len(data) > 100_000:
                open(THREE_CACHE, "wb").write(data)
        except Exception:
            pass
    if os.path.isfile(THREE_CACHE):
        shutil.copy2(THREE_CACHE, dst)
        return "../assets/three.min.js"
    return THREE_CDN


def render_primitive(sc, i, t0, d, W, H, safe_w, safe_h, A, hf, final_rows, prev_card, js, sfx, visual_mode="motion"):
    v, sid = sc["visual"], sc["id"]
    vt = v["type"]

    if vt == "graphic":
        text = open(v["abs"], encoding="utf-8").read()
        m = re.search(r'data-composition-id="([^"]+)"', text)
        if not m:
            die(f"{v['src']}: graphic needs an element with data-composition-id (see reference.md)")
        mw = re.search(r'data-width="(\d+)"', text)
        mh = re.search(r'data-height="(\d+)"', text)
        if (mw and int(mw.group(1)) != W) or (mh and int(mh.group(1)) != H):
            got = f"{mw.group(1) if mw else '?'}x{mh.group(1) if mh else '?'}"
            die(f"{v['src']}: graphic size is {got}, expected {W}x{H} for current Aspect")
        os.makedirs(os.path.join(hf, "graphics"), exist_ok=True)

        uses_illustrated = visual_mode == "illustrated" or "IllustratedStage" in text or "StoryBrush" in text
        uses_3d = visual_mode == "3d" or "Studio3D" in text or "THREE." in text
        uses_stage = uses_illustrated or uses_3d or "ExplainerStage" in text or "__EXPLAINER_DATA__" in text

        inject_parts = []
        if uses_stage and "stage.js" not in text:
            inject_parts.extend([
                '<link rel="stylesheet" href="../assets/stage.css">',
                '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>',
                '<script src="../assets/explainer-data.js"></script>',
                '<script src="../assets/stage.js"></script>',
            ])
        if uses_illustrated and "illustrated.js" not in text:
            inject_parts.append('<script src="../assets/illustrated.js"></script>')
        if uses_3d:
            if "three.min.js" not in text and "three@" not in text:
                inject_parts.append(f'<script src="{_ensure_three_script_src(A)}"></script>')
            if "studio3d.js" not in text:
                inject_parts.append('<script src="../assets/studio3d.js"></script>')
        if inject_parts:
            text = re.sub(
                r'(<div\b[^>]*data-composition-id="[^"]+"[^>]*>)',
                lambda match: match.group(1) + "\n" + "".join(inject_parts),
                text,
                count=1,
            )
        open(os.path.join(hf, "graphics", f"{sid}.html"), "w", encoding="utf-8").write(text)
        return (
            f'<div id="{sid}g" class="clip" data-composition-id="{esc(m.group(1))}" '
            f'data-composition-src="graphics/{sid}.html" data-start="{t0:.3f}" data-duration="{d:.3f}" '
            f'data-track-index="{20 + i}" style="position:absolute;inset:0"></div>'
        )

    if vt == "title":
        kicker = f'<div id="{sid}k" class="kicker">{esc(v["kicker"])}</div>' if v["kicker"] else ""
        sub = f'<div id="{sid}sub" class="title-sub">{esc(v["subtitle"])}</div>' if v["subtitle"] else ""
        if v["kicker"]:
            js.append(f'gsap.set("#{sid}k", {{ autoAlpha: 0, y: 18 }}); tl.to("#{sid}k", {{ autoAlpha: 1, y: 0, duration: .35, ease: "power3.out" }}, {t0 + .05:.3f});')
        js.append(f'gsap.set("#{sid}h", {{ autoAlpha: 0, y: 34 }}); tl.to("#{sid}h", {{ autoAlpha: 1, y: 0, duration: .48, ease: "power3.out" }}, {t0 + .12:.3f});')
        sfx.append(("tap", t0 + .12))
        if v["subtitle"]:
            js.append(f'gsap.set("#{sid}sub", {{ autoAlpha: 0, y: 24 }}); tl.to("#{sid}sub", {{ autoAlpha: 1, y: 0, duration: .42, ease: "power3.out" }}, {t0 + .34:.3f});')
        return f'<div class="stage"><div class="title-wrap">{kicker}<h1 id="{sid}h" class="title-head">{esc(v["headline"])}</h1>{sub}</div></div>'

    if vt == "card":
        same = prev_card and prev_card["title"] == v["title"] and v["rows"][:len(prev_card["rows"])] == prev_card["rows"]
        shown = len(prev_card["rows"]) if same else 0
        rows_html = "".join(
            f'<div id="{sid}r{k}" class="card-row"{"" if k < len(v["rows"]) else " style=\'visibility:hidden\'"}>'
            f'<span class="rn">{k + 1:02d}</span><span class="rt">{esc(r)}</span></div>'
            for k, r in enumerate(final_rows[i])
        )
        if not same:
            js.append(f'gsap.set("#{sid}card", {{ autoAlpha: 0, y: 32 }}); tl.to("#{sid}card", {{ autoAlpha: 1, y: 0, duration: .4, ease: "power3.out" }}, {t0 + .04:.3f});')
            sfx.append(("tap", t0 + .04))
        for k in range(shown, len(v["rows"])):
            tk = t0 + (.24 if not same else .06) + .16 * (k - shown)
            js.append(f'gsap.set("#{sid}r{k}", {{ autoAlpha: 0, x: -30 }}); tl.to("#{sid}r{k}", {{ autoAlpha: 1, x: 0, duration: .35, ease: "power3.out" }}, {tk:.3f});')
            sfx.append(("tap", tk))
        return f'<div class="stage"><div id="{sid}card" class="card"><div class="card-title">{esc(v["title"])}</div><div class="card-rows">{rows_html}</div></div></div>'

    if vt == "flow":
        nodes = v["nodes"]
        n = len(nodes)
        step_dt = min(0.45, max(0.22, (d * 0.55) / max(n, 1)))
        heading = f'<div id="{sid}ft" class="sec-head">{esc(v["title"])}</div>' if v["title"] else ""
        if v["title"]:
            js.append(f'gsap.set("#{sid}ft", {{ autoAlpha: 0, y: 20 }}); tl.to("#{sid}ft", {{ autoAlpha: 1, y: 0, duration: .35, ease: "power3.out" }}, {t0 + .04:.3f});')
        items = []
        portrait = H > W
        arrow_svg = (
            '<svg class="flow-arrow" viewBox="0 0 36 48" width="36" height="48"><path d="M18 4 V40 M8 30 L18 42 L28 30" /></svg>'
            if portrait else
            '<svg class="flow-arrow" viewBox="0 0 56 32" width="56" height="32"><path d="M4 16 H48 M38 6 L50 16 L38 26" /></svg>'
        )
        for k, node in enumerate(nodes):
            tk = t0 + .12 + k * step_dt
            cls = "flow-node active" if node["active"] else "flow-node"
            js.append(f'gsap.set("#{sid}fn{k}", {{ autoAlpha: 0, y: 24, scale: .96 }}); tl.to("#{sid}fn{k}", {{ autoAlpha: 1, y: 0, scale: 1, duration: .38, ease: "power3.out" }}, {tk:.3f});')
            sfx.append(("tap", tk))
            items.append(f'<div id="{sid}fn{k}" class="{cls}"><span class="flow-idx">{k + 1:02d}</span><span class="flow-lbl">{esc(node["label"])}</span></div>')
            if k < n - 1:
                ta = t0 + .12 + (k + 1) * step_dt + .08
                js.append(f'gsap.set("#{sid}fa{k}", {{ autoAlpha: 0, scale: .85 }}); tl.to("#{sid}fa{k}", {{ autoAlpha: 1, scale: 1, duration: .24, ease: "power2.out" }}, {ta:.3f});')
                items.append(f'<div id="{sid}fa{k}" class="flow-conn">{arrow_svg}</div>')
        return f'<div class="stage">{heading}<div class="flow-row">{"".join(items)}</div></div>'

    if vt == "compare":
        heading = f'<div id="{sid}ct" class="sec-head">{esc(v["title"])}</div>' if v["title"] else ""
        if v["title"]:
            js.append(f'gsap.set("#{sid}ct", {{ autoAlpha: 0, y: 20 }}); tl.to("#{sid}ct", {{ autoAlpha: 1, y: 0, duration: .35, ease: "power3.out" }}, {t0 + .04:.3f});')
        cols = []
        for idx, (side_key, delay) in enumerate((("left", .10), ("right", .52))):
            side = v[side_key]
            cls = "cmp-col right" if idx == 1 else "cmp-col left"
            li = "".join(f'<li id="{sid}c{idx}_{k}">{esc(it)}</li>' for k, it in enumerate(side["items"]))
            js.append(f'gsap.set("#{sid}col{idx}", {{ autoAlpha: 0, y: 28 }}); tl.to("#{sid}col{idx}", {{ autoAlpha: 1, y: 0, duration: .42, ease: "power3.out" }}, {t0 + delay:.3f});')
            sfx.append(("tap", t0 + delay))
            for k in range(len(side["items"])):
                tk = t0 + delay + .18 + .12 * k
                js.append(f'gsap.set("#{sid}c{idx}_{k}", {{ autoAlpha: 0, x: -18 }}); tl.to("#{sid}c{idx}_{k}", {{ autoAlpha: 1, x: 0, duration: .3, ease: "power2.out" }}, {tk:.3f});')
            cols.append(f'<div id="{sid}col{idx}" class="{cls}"><div class="cmp-head">{esc(side["heading"])}</div><ul class="cmp-list">{li}</ul></div>')
        return f'<div class="stage">{heading}<div class="cmp-grid">{"".join(cols)}</div></div>'

    if vt == "number":
        pre, val, suf, dec = number_parts(v["value"])
        js.append(f'countUp("#{sid}num", {val}, {dec}, {json.dumps(pre)}, {json.dumps(suf)}, {t0 + .10:.3f}, .9);')
        sfx.append(("tap", t0 + .10))
        lab = f'<div id="{sid}lab" class="num-lab">{esc(v["label"])}</div>' if v["label"] else ""
        sub = f'<div id="{sid}nsub" class="num-sub">{esc(v["subtext"])}</div>' if v["subtext"] else ""
        if v["label"]:
            js.append(f'gsap.set("#{sid}lab", {{ autoAlpha: 0, y: 18 }}); tl.to("#{sid}lab", {{ autoAlpha: 1, y: 0, duration: .4, ease: "power3.out" }}, {t0 + .32:.3f});')
        if v["subtext"]:
            js.append(f'gsap.set("#{sid}nsub", {{ autoAlpha: 0, y: 14 }}); tl.to("#{sid}nsub", {{ autoAlpha: 1, y: 0, duration: .35, ease: "power2.out" }}, {t0 + .50:.3f});')
        return f'<div class="stage"><div class="num-wrap"><div id="{sid}num" class="bignum">{esc(pre)}0{esc(suf)}</div>{lab}{sub}</div></div>'

    if vt == "code":
        step_dt = min(0.28, max(0.14, (d * 0.55) / max(len(v["lines"]), 1)))
        lines_html = []
        js.append(f'gsap.set("#{sid}win", {{ autoAlpha: 0, y: 28 }}); tl.to("#{sid}win", {{ autoAlpha: 1, y: 0, duration: .4, ease: "power3.out" }}, {t0 + .04:.3f});')
        sfx.append(("tap", t0 + .04))
        for k, ln in enumerate(v["lines"]):
            tk = t0 + .18 + k * step_dt
            cls = "code-ln hl" if ln["highlight"] else "code-ln"
            js.append(f'gsap.set("#{sid}cl{k}", {{ autoAlpha: 0, x: -16 }}); tl.to("#{sid}cl{k}", {{ autoAlpha: 1, x: 0, duration: .28, ease: "power2.out" }}, {tk:.3f});')
            if ln["highlight"]:
                sfx.append(("tap", tk))
            lines_html.append(f'<div id="{sid}cl{k}" class="{cls}"><span class="ln-no">{k + 1}</span><code>{esc(ln["text"])}</code></div>')
        return (
            f'<div class="stage"><div id="{sid}win" class="code-win">'
            f'<div class="code-bar"><span class="dots"><i></i><i></i><i></i></span><span class="code-fn">{esc(v["title"])}</span></div>'
            f'<div class="code-body">{"".join(lines_html)}</div></div></div>'
        )

    if vt == "page":
        pw, ph = min(safe_w, int(W * 0.84)), safe_h
        key = f"{os.path.realpath(v['abs'])}|{os.path.getmtime(v['abs'])}|{v['drift']}|{pw}x{ph}|{d:.3f}"
        name = f"{sid}-{hashlib.md5(key.encode()).hexdigest()[:8]}.mp4"
        prep_page(v, d, os.path.join(A, "clips", name), pw, ph)
        js.append(f'gsap.set("#{sid}pg", {{ autoAlpha: 0, y: 24 }}); tl.to("#{sid}pg", {{ autoAlpha: 1, y: 0, duration: .38, ease: "power3.out" }}, {t0 + .03:.3f});')
        sfx.append(("air", t0))
        return (
            f'<div class="stage"><div id="{sid}pg" class="capture-frame" style="width:{pw}px;height:{ph}px">'
            f'<video id="{sid}v" class="clip" src="assets/clips/{name}" data-start="{t0:.3f}" data-duration="{d:.3f}" '
            f'data-media-start="0" data-track-index="{40 + i}" muted playsinline style="width:100%;height:100%;object-fit:cover"></video>'
            f'</div></div>'
        )

    if vt == "receipt":
        key = f"{os.path.realpath(v['abs'])}|{os.path.getmtime(v['abs'])}"
        name = f"{sid}-{hashlib.md5(key.encode()).hexdigest()[:8]}{os.path.splitext(v['abs'])[1].lower()}"
        shutil.copy(v["abs"], os.path.join(A, "clips", name))
        iw, ih, _ = probe(v["abs"])
        s = min(safe_w / iw, safe_h / ih)
        rw, rh = iw * s, ih * s
        marks = "".join(
            f'<div id="{sid}m{k}" class="mark" style="left:{x * 100:.2f}%;top:{y * 100:.2f}%;width:{mw * 100:.2f}%;height:{mh * 100:.2f}%"></div>'
            for k, (x, y, mw, mh) in enumerate(v["marks"])
        )
        js.append(f'gsap.set("#{sid}rc", {{ autoAlpha: 0, y: 30 }}); tl.to("#{sid}rc", {{ autoAlpha: 1, y: 0, duration: .4, ease: "power3.out" }}, {t0 + .04:.3f});')
        js.append(f'tl.fromTo("#{sid}rc", {{ scale: 1 }}, {{ scale: 1.025, duration: {d:.3f}, ease: "none", immediateRender: false }}, {t0:.3f});')
        sfx.append(("tap", t0 + .04))
        for k in range(len(v["marks"])):
            js.append(f'gsap.set("#{sid}m{k}", {{ scaleX: 0 }}); tl.to("#{sid}m{k}", {{ scaleX: 1, duration: .45, ease: "power2.inOut" }}, {t0 + .45 + .5 * k:.3f});')
        return f'<div class="stage"><div id="{sid}rc" class="receipt" style="width:{rw:.0f}px;height:{rh:.0f}px"><img src="assets/clips/{name}" alt="">{marks}</div></div>'

    if vt == "image":
        proj_root = os.path.dirname(hf)
        rel_src = _stage_media_file(v["abs"], sid, proj_root, A)
        iw, ih, _ = probe(v["abs"])
        iw, ih = iw or 1600, ih or 900
        has_meta = bool(v["caption"] or v["credit"])
        avail_w = min(safe_w, int(W * 0.82))
        avail_h = max(200, safe_h - (108 if has_meta else 10))
        s = min(avail_w / iw, avail_h / ih)
        fw, fh = max(240, round(iw * s)), max(160, round(ih * s))
        meta_html = _render_media_meta(v["caption"], v["credit"])
        js.append(f'gsap.set("#{sid}imw", {{ autoAlpha: 0, y: 28 }}); tl.to("#{sid}imw", {{ autoAlpha: 1, y: 0, duration: .42, ease: "power3.out" }}, {t0 + .04:.3f});')
        js.append(f'tl.fromTo("#{sid}img", {{ scale: 1 }}, {{ scale: 1.04, duration: {d:.3f}, ease: "none", immediateRender: false }}, {t0:.3f});')
        sfx.append(("tap", t0 + .04))
        return (
            f'<div class="stage"><div id="{sid}imw" class="media-wrap">'
            f'<div class="media-frame" style="width:{fw}px;height:{fh}px">'
            f'<img id="{sid}img" src="{esc(rel_src)}" alt=""></div>{meta_html}</div></div>'
        )

    if vt == "clip":
        proj_root = os.path.dirname(hf)
        vw, vh, vdur = probe(v["abs"])
        vw, vh = vw or 1280, vh or 720
        needs_prep = (not v["abs"].lower().endswith(".mp4")) or (vdur > 0 and vdur + 0.05 < d)
        if needs_prep:
            key = f"{os.path.realpath(v['abs'])}|{os.path.getmtime(v['abs'])}|{d:.3f}"
            cname = f"{sid}-{hashlib.md5(key.encode()).hexdigest()[:8]}.mp4"
            prep_clip(v["abs"], d, os.path.join(A, "clips", cname), loop_short=(vdur > 0 and vdur + 0.05 < d))
            rel_src = f"assets/clips/{cname}"
        else:
            rel_src = _stage_media_file(v["abs"], sid, proj_root, A)
        has_meta = bool(v["caption"] or v["credit"])
        avail_w = min(safe_w, int(W * 0.82))
        avail_h = max(200, safe_h - (108 if has_meta else 10))
        s = min(avail_w / vw, avail_h / vh)
        fw, fh = max(240, round(vw * s)), max(160, round(vh * s))
        meta_html = _render_media_meta(v["caption"], v["credit"])
        js.append(f'gsap.set("#{sid}clw", {{ autoAlpha: 0, y: 26 }}); tl.to("#{sid}clw", {{ autoAlpha: 1, y: 0, duration: .40, ease: "power3.out" }}, {t0 + .03:.3f});')
        sfx.append(("air", t0))
        return (
            f'<div class="stage"><div id="{sid}clw" class="media-wrap">'
            f'<div class="media-frame" style="width:{fw}px;height:{fh}px">'
            f'<video id="{sid}vid" class="clip" src="{esc(rel_src)}" data-start="{t0:.3f}" data-duration="{d:.3f}" '
            f'data-media-start="0" data-track-index="{40 + i}" muted playsinline '
            f'style="width:100%;height:100%;object-fit:cover;display:block"></video></div>{meta_html}</div></div>'
        )

    if vt == "quote":
        proj_root = os.path.dirname(hf)
        av_html = ""
        if v.get("avatar_abs"):
            av_src = _stage_media_file(v["avatar_abs"], sid + "av", proj_root, A)
            av_html = f'<img class="quote-avatar" src="{esc(av_src)}" alt="">'
        src_html = f'<div class="quote-source">{esc(v["source"])}</div>' if v["source"] else ""
        long_cls = " quote-text-long" if len(v["text"]) > 150 else ""
        js.append(f'gsap.set("#{sid}qc", {{ autoAlpha: 0, y: 30 }}); tl.to("#{sid}qc", {{ autoAlpha: 1, y: 0, duration: .42, ease: "power3.out" }}, {t0 + .04:.3f});')
        js.append(f'gsap.set("#{sid}qt", {{ autoAlpha: 0, y: 16 }}); tl.to("#{sid}qt", {{ autoAlpha: 1, y: 0, duration: .42, ease: "power3.out" }}, {t0 + .16:.3f});')
        js.append(f'gsap.set("#{sid}qf", {{ autoAlpha: 0, y: 12 }}); tl.to("#{sid}qf", {{ autoAlpha: 1, y: 0, duration: .36, ease: "power2.out" }}, {t0 + .34:.3f});')
        sfx.append(("tap", t0 + .04))
        return (
            f'<div class="stage"><div id="{sid}qc" class="quote-card">'
            f'<div class="quote-mark" aria-hidden="true">&ldquo;</div>'
            f'<blockquote id="{sid}qt" class="quote-text{long_cls}">{esc(v["text"])}</blockquote>'
            f'<div id="{sid}qf" class="quote-foot">{av_html}'
            f'<div class="quote-by"><div class="quote-author">{esc(v["author"])}</div>{src_html}</div></div>'
            f'</div></div>'
        )

    die(f"unhandled visual type: {vt}")


# ---------- project builder ----------

def build(project, style_arg=None):
    paths = project_paths(project)
    script = parse_script(paths["script"])
    aspect_name, (W, H) = resolve_aspect(script)
    style = load_style(paths["root"], style_arg, setting(script, "style"))
    mode, _ = resolve_voice(script, paths["root"])
    has_voice = mode != "none"

    if has_voice:
        if not os.path.isfile(paths["narration"]):
            die("work/narration.wav not found. Run narrate.py first.")
        _, _, duration = probe(paths["narration"])
        scenes = validate_scenes(script, paths["root"], duration)
    else:
        scenes = validate_scenes(script, paths["root"])
        duration = frames(scenes[-1]["end"]) / FPS

    words = json.load(open(paths["words"], encoding="utf-8")) if os.path.isfile(paths["words"]) else []
    captions_on = captions_enabled(script, paths["root"]) and bool(words)

    total = frames(duration)
    dur = total / FPS
    hf = os.path.join(paths["root"], "hf")
    shutil.rmtree(os.path.join(hf, "graphics"), ignore_errors=True)
    A = os.path.join(hf, "assets")
    media_dst = os.path.join(A, "media")
    shutil.rmtree(media_dst, ignore_errors=True)
    os.makedirs(os.path.join(A, "fonts"), exist_ok=True)
    os.makedirs(os.path.join(A, "clips"), exist_ok=True)
    os.makedirs(media_dst, exist_ok=True)
    os.makedirs(os.path.join(hf, "graphics"), exist_ok=True)
    _copy_dir_contents(os.path.join(paths["root"], "captures"), media_dst)
    _copy_dir_contents(os.path.join(paths["root"], "media"), media_dst)
    _ensure_rel_link(os.path.join(hf, "media"), os.path.join("assets", "media"), media_dst)
    _ensure_rel_link(os.path.join(hf, "captures"), os.path.join("assets", "media"), media_dst)
    _ensure_rel_link(os.path.join(hf, "graphics", "assets"), os.path.join("..", "assets"), A)
    _ensure_rel_link(os.path.join(hf, "graphics", "media"), os.path.join("..", "assets", "media"), media_dst)
    _ensure_rel_link(os.path.join(hf, "graphics", "captures"), os.path.join("..", "assets", "media"), media_dst)
    for asset_name in ("stage.css", "stage.js", "illustrated.js", "studio3d.js"):
        src_asset = os.path.join(SKILL_DIR, "assets", asset_name)
        if os.path.isfile(src_asset):
            shutil.copy(src_asset, os.path.join(A, asset_name))
    if script["mode"] == "3d":
        _ensure_three_script_src(A)
    explainer_payload = {
        "width": W,
        "height": H,
        "fps": FPS,
        "duration": round(dur, 4),
        "mode": script["mode"],
        "audience": script["audience"],
        "scenes": [{"id": s["id"], "start": s["start"], "end": s["end"]} for s in scenes],
        "words": words,
    }
    open(os.path.join(A, "explainer-data.js"), "w", encoding="utf-8").write(
        "window.__EXPLAINER_DATA__ = " + json.dumps(explainer_payload, separators=(",", ":")) + ";\n"
    )

    cs, th = style["caption"], style["theme"]
    fonts = {}
    for key, path in (("cap", cs["font"]), ("title", th["title_font"]), ("body", th["body_font"]), ("num", th["number_font"])):
        name = os.path.basename(path)
        shutil.copy(path, os.path.join(A, "fonts", name))
        fonts[key] = name
    face_css = "\n".join(f'@font-face {{ font-family: "F{k}"; src: url("assets/fonts/{v}"); font-weight: 100 900; }}' for k, v in fonts.items())

    portrait = H > W
    square = W == H
    if captions_on:
        safe_bottom = 500 if portrait else (170 if square else 190)
    else:
        safe_bottom = 64
    safe_pad_x = 64 if portrait else (80 if square else 120)
    safe_pad_top = 96 if portrait else (72 if square else 68)
    safe_w = W - 2 * safe_pad_x
    safe_h = H - safe_pad_top - safe_bottom

    # Reserve full height for cards that grow sequentially across scenes.
    final_rows = {}
    for i in range(len(scenes) - 1, -1, -1):
        v = scenes[i]["visual"]
        if v["type"] == "card":
            nxt = scenes[i + 1]["visual"] if i + 1 < len(scenes) else None
            grows = nxt and nxt["type"] == "card" and nxt["title"] == v["title"] and nxt["rows"][:len(v["rows"])] == v["rows"]
            final_rows[i] = final_rows[i + 1] if grows else v["rows"]

    hosts, js, sfx = [], [], []
    spans = []
    idx = 0
    while idx < len(scenes):
        sc = scenes[idx]
        v = sc["visual"]
        if v["type"] == "graphic":
            gpath = os.path.realpath(v["abs"])
            j = idx + 1
            while (
                j < len(scenes)
                and scenes[j]["visual"]["type"] == "graphic"
                and os.path.realpath(scenes[j]["visual"]["abs"]) == gpath
            ):
                j += 1
            spans.append({
                "idx": idx,
                "scene": sc,
                "start": sc["start"],
                "end": scenes[j - 1]["end"],
                "shared_beats": [scenes[k]["start"] for k in range(idx + 1, j)],
            })
            idx = j
        else:
            spans.append({"idx": idx, "scene": sc, "start": sc["start"], "end": sc["end"], "shared_beats": []})
            idx += 1

    trans_mode = (setting(script, "transition") or "motion").strip().lower()
    use_pan = trans_mode != "cut" and len(spans) > 1
    pan_half = []
    for k in range(len(spans) - 1):
        a_sc, b_sc = spans[k]["scene"], spans[k + 1]["scene"]
        a_v, b_v = a_sc["visual"], b_sc["visual"]
        same_card = (
            a_v["type"] == "card"
            and b_v["type"] == "card"
            and b_v["title"] == a_v["title"]
            and b_v["rows"][:len(a_v["rows"])] == a_v["rows"]
        )
        if not use_pan or same_card:
            pan_half.append(0.0)
        else:
            da = spans[k]["end"] - spans[k]["start"]
            db_dur = spans[k + 1]["end"] - spans[k + 1]["start"]
            pan_half.append(round(min(0.18, 0.2 * min(da, db_dur)), 3))

    prev_card = None
    for k, sp in enumerate(spans):
        sc = sp["scene"]
        i = sp["idx"]
        t0 = max(0.0, frames(sp["start"]) - 0.5) / FPS
        t1 = (frames(sp["end"]) - 0.5) / FPS
        ov_in = pan_half[k - 1] if k > 0 else 0.0
        ov_out = pan_half[k] if k < len(pan_half) else 0.0
        mount_t0 = max(0.0, t0 - ov_in)
        mount_t1 = min((total - 0.5) / FPS, t1 + ov_out)
        mount_d = max(1 / FPS, mount_t1 - mount_t0)
        sid = sc["id"]
        inner = render_primitive(sc, i, mount_t0, mount_d, W, H, safe_w, safe_h, A, hf, final_rows, prev_card, js, sfx, script["mode"])
        for beat_t in sp["shared_beats"]:
            sfx.append(("air", beat_t))
        prev_card = sc["visual"] if sc["visual"]["type"] == "card" else None
        js.append(f'gsap.set("#{sid}", {{ autoAlpha: 0, x: 0 }});')
        if ov_in > 0:
            js.append(
                f'tl.set("#{sid}", {{ autoAlpha: 1, x: {W} }}, {mount_t0:.3f}); '
                f'tl.to("#{sid}", {{ x: 0, duration: {2 * ov_in:.3f}, ease: "power3.inOut" }}, {mount_t0:.3f});'
            )
            sfx.append(("air", t0 - ov_in * 0.5))
        else:
            js.append(f'tl.set("#{sid}", {{ autoAlpha: 1, x: 0 }}, {t0:.3f});')
        if ov_out > 0:
            js.append(
                f'tl.to("#{sid}", {{ x: -{W}, duration: {2 * ov_out:.3f}, ease: "power3.inOut", immediateRender: false }}, {t1 - ov_out:.3f}); '
                f'tl.set("#{sid}", {{ autoAlpha: 0 }}, {mount_t1:.3f});'
            )
        else:
            js.append(f'tl.set("#{sid}", {{ autoAlpha: 0 }}, {t1:.3f});')
        hosts.append(f'  <div id="{sid}" class="scene" data-scene="{esc(sc["visual"]["type"])}">{inner}</div>')

    # Captions track
    caps = []
    track = []
    if captions_on:
        default_mw = 4 if portrait else 6
        default_mc = 24 if portrait else 38
        mw = cs.get("max_words", default_mw)
        mc = cs.get("max_chars", default_mc)
        if not portrait and mw == 6 and aspect_name == "1:1":
            mw, mc = 5, 30
        track = caption_track(caption_chunks(words, script["fixes"], mw, mc), scenes, total)
        cap_y = style.get("caption_y", {}).get(aspect_name, 965 if aspect_name == "16:9" else (1480 if portrait else 960))
        for k, (fa, fb, text) in enumerate(track):
            text = text.upper() if cs.get("uppercase", False) else text
            ws = text.split(" ")
            marks = set()
            if cs.get("emphasis"):
                for x, y in emphasis_spans(ws, script["emphasis"]):
                    marks.update(range(x, y))
            inner_cap, j = [], 0
            while j < len(ws):
                m = j
                while m < len(ws) and (m in marks) == (j in marks):
                    m += 1
                seg = esc(" ".join(ws[j:m]))
                inner_cap.append(f'<span class="em">{seg}</span>' if j in marks else seg)
                j = m
            caps.append(
                f'<div id="cap{k}" class="clip cap caption-cue" data-layout-allow-caption-zone data-start="{max(0.0, fa - 0.5) / FPS:.4f}" '
                f'data-duration="{(fb - fa) / FPS:.4f}" data-track-index="100" style="top:{cap_y}px">'
                f'<span class="band" data-layout-allow-caption-zone>{" ".join(inner_cap)}</span></div>'
            )

    # Audio mix
    music = setting(script, "music")
    if music and music.lower() != "none":
        m_low = music.strip().lower()
        if m_low == "auto" or m_low.startswith("synth"):
            music = music.strip()
        else:
            music = music if os.path.isabs(music) else os.path.join(paths["root"], music)
            if not os.path.isfile(music):
                die(f"music file not found: {music}")
    else:
        music = None
    default_lvl = "-19" if has_voice else "-14"
    level = float(re.findall(r"-?[\d.]+", setting(script, "music level", default_lvl))[0])
    lifts = [tuple(float(x) for x in r.split("-")) for r in re.findall(r"\d+(?:\.\d+)?-\d+(?:\.\d+)?", setting(script, "music lift", ""))]
    use_sfx = (setting(script, "sound effects") or style.get("sound_effects", "subtle")).lower() in ("subtle", "on", "studio", "auto")

    explicit_cues = []
    for c in script.get("sounds", []):
        t_cue = resolve_cue_time(c["anchor"], scenes, words, dur)
        explicit_cues.append({
            "kind": c["kind"],
            "t": t_cue,
            "intensity": c["intensity"],
            "duration": c["duration"],
            "pan": c["pan"],
        })
    if explicit_cues:
        # Suppress automatic shared-beat 'air' swells when an explicit sound cue already lands nearby
        sfx = [
            item for item in sfx
            if not (isinstance(item, tuple) and item[0] == "air" and any(abs(item[1] - ec["t"]) < 0.45 for ec in explicit_cues))
        ] + explicit_cues

    mix = os.path.join(A, "mix.wav")
    mix_audio(paths["narration"] if has_voice else None, has_voice, music, level, dur, mix, lifts, sfx if use_sfx else ())

    scale_css = "0.78" if portrait else ("0.84" if square else "1")
    page = PAGE.format(
        dur=f"{(total - 0.25) / FPS:.4f}",
        W=W, H=H, faces=face_css,
        bg=css_color(th["background"]),
        surface=css_color(th["surface"]),
        surface_2=css_color(th["surface_2"]),
        border=css_color(th["border"]),
        text=css_color(th["text"]),
        muted=css_color(th["muted"]),
        accent=css_color(th["accent"]),
        accent_2=css_color(th["accent_2"]),
        good=css_color(th["good"]),
        warn=css_color(th["warn"]),
        danger=css_color(th["danger"]),
        safe_x=safe_pad_x, safe_top=safe_pad_top, safe_bottom=safe_bottom,
        w_cap=cs.get("weight", 600), cap_size=cs["size"],
        cap_color=css_color(cs["color"]), cap_box=css_color(cs["box"]),
        cap_radius=cs.get("radius", 12),
        pad_x=cs.get("pad", [24, 12])[0], pad_y=cs.get("pad", [24, 12])[1],
        cap_border=css_color(cs.get("border", "#00000000")),
        em=css_color(cs.get("emphasis") or th["accent"]),
        cap_max_w=int(W * (0.86 if portrait else 0.78)),
        w_title=th.get("title_weight", 800),
        w_body=th.get("body_weight", 500),
        w_num=th.get("number_weight", 700),
        flow_dir="column" if portrait else "row",
        cmp_cols="1fr" if portrait else "1fr 1fr",
        scale=scale_css,
        hosts="\n".join(hosts),
        caps="\n  ".join(caps),
        script="\n".join(js),
    )
    open(os.path.join(hf, "index.html"), "w", encoding="utf-8").write(page)
    print(f"Built {len(scenes)} scenes ({W}x{H}) and {len(track)} captions ({dur:.2f}s).")
    return hf, mix, dur


PAGE = """<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Explainer</title>
<link rel="stylesheet" href="assets/stage.css">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script src="assets/explainer-data.js"></script>
<script src="assets/stage.js"></script>
<style>
{faces}
:root {{
  --bg: {bg};
  --surface: {surface};
  --surface-2: {surface_2};
  --border: {border};
  --text: {text};
  --muted: {muted};
  --accent: {accent};
  --accent-2: {accent_2};
  --good: {good};
  --warn: {warn};
  --danger: {danger};
  --w: {W}px;
  --h: {H}px;
  --safe-bottom: {safe_bottom}px;
}}
html, body {{ margin: 0; width: 100%; height: 100%; overflow: hidden; background: var(--bg); color: var(--text); font-family: Fbody, sans-serif; }}
#root {{ position: relative; width: {W}px; height: {H}px; overflow: hidden; background: var(--bg); }}
#bg-world {{ position: absolute; inset: 0; overflow: hidden; pointer-events: none; }}
#bg-orb {{ position: absolute; left: 14%; top: 10%; width: 72%; height: 68%; border-radius: 50%; background: radial-gradient(ellipse at center, color-mix(in srgb, var(--accent) 13%, rgba(0,0,0,0)), rgba(0,0,0,0) 70%); }}
.scene {{ position: absolute; inset: 0; background: transparent; }}
.stage {{ position: absolute; inset: 0; padding: {safe_top}px {safe_x}px {safe_bottom}px {safe_x}px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 36px; box-sizing: border-box; }}
.sec-head {{ font: {w_title} calc(50px * {scale})/1.15 Ftitle, sans-serif; color: var(--text); letter-spacing: -0.02em; text-align: center; }}

/* title */
.title-wrap {{ max-width: 1460px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 26px; }}
.kicker {{ display: inline-block; padding: 10px 24px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 16%, var(--surface)); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); color: var(--accent-2); font: 700 24px/1.2 Fbody, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }}
.title-head {{ margin: 0; font: {w_title} calc(96px * {scale})/1.06 Ftitle, sans-serif; letter-spacing: -0.03em; color: var(--text); }}
.title-sub {{ font: {w_body} calc(40px * {scale})/1.38 Fbody, sans-serif; color: var(--muted); max-width: 1160px; }}

/* card */
.card {{ width: min(100%, 1320px); box-sizing: border-box; padding: 52px 60px; border-radius: 26px; background: var(--surface); border: 1.5px solid var(--border); box-shadow: 0 24px 60px rgba(0,0,0,.22); }}
.card-title {{ font: {w_title} calc(58px * {scale})/1.12 Ftitle, sans-serif; letter-spacing: -0.02em; color: var(--text); }}
.card-rows {{ margin-top: 28px; display: flex; flex-direction: column; gap: 22px; }}
.card-row {{ display: flex; gap: 28px; align-items: baseline; padding: 18px 24px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--border); font: {w_body} calc(38px * {scale})/1.3 Fbody, sans-serif; color: var(--text); }}
.card-row .rn {{ font: {w_num} calc(34px * {scale})/1 Fnum, sans-serif; color: var(--accent); flex: none; min-width: 58px; font-variant-numeric: tabular-nums; }}

/* flow */
.flow-row {{ display: flex; flex-direction: {flow_dir}; align-items: center; justify-content: center; gap: 20px; width: 100%; max-width: 1640px; }}
.flow-node {{ flex: 1 1 0; min-width: 200px; max-width: 380px; width: 100%; padding: 34px 28px; border-radius: 22px; background: var(--surface); border: 1.5px solid var(--border); display: flex; flex-direction: column; gap: 14px; text-align: left; box-shadow: 0 18px 44px rgba(0,0,0,.18); }}
.flow-node.active {{ border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--surface)); box-shadow: 0 20px 54px color-mix(in srgb, var(--accent) 22%, transparent); }}
.flow-idx {{ font: {w_num} 22px/1 Fnum, sans-serif; color: var(--accent-2); letter-spacing: 0.04em; }}
.flow-lbl {{ font: {w_title} calc(34px * {scale})/1.25 Ftitle, sans-serif; color: var(--text); }}
.flow-conn {{ flex: none; display: flex; align-items: center; justify-content: center; }}
.flow-arrow {{ stroke: var(--accent-2); stroke-width: 3.2; fill: none; stroke-linecap: round; stroke-linejoin: round; }}

/* compare */
.cmp-grid {{ display: grid; grid-template-columns: {cmp_cols}; gap: 36px; width: 100%; max-width: 1520px; }}
.cmp-col {{ padding: 44px 48px; border-radius: 24px; background: var(--surface); border: 1.5px solid var(--border); box-sizing: border-box; }}
.cmp-col.right {{ border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }}
.cmp-head {{ font: {w_title} calc(44px * {scale})/1.15 Ftitle, sans-serif; margin-bottom: 24px; color: var(--muted); }}
.cmp-col.right .cmp-head {{ color: var(--accent-2); }}
.cmp-list {{ margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 18px; font: {w_body} calc(34px * {scale})/1.35 Fbody, sans-serif; }}
.cmp-list li {{ padding-left: 30px; position: relative; }}
.cmp-list li::before {{ content: "–"; position: absolute; left: 0; color: var(--muted); }}
.cmp-col.right .cmp-list li::before {{ content: "✓"; color: var(--good); font-weight: 800; }}

/* number */
.num-wrap {{ text-align: center; max-width: 1320px; }}
.bignum {{ font: {w_num} calc(184px * {scale})/1 Fnum, sans-serif; color: var(--accent); font-variant-numeric: tabular-nums; letter-spacing: -0.04em; }}
.num-lab {{ margin-top: 24px; font: {w_title} calc(48px * {scale})/1.2 Ftitle, sans-serif; color: var(--text); }}
.num-sub {{ margin-top: 14px; font: {w_body} calc(30px * {scale})/1.35 Fbody, sans-serif; color: var(--muted); }}

/* code */
.code-win {{ width: min(100%, 1400px); border-radius: 22px; overflow: hidden; background: var(--surface); border: 1.5px solid var(--border); box-shadow: 0 26px 70px rgba(0,0,0,.28); }}
.code-bar {{ display: flex; align-items: center; gap: 18px; padding: 18px 26px; background: var(--surface-2); border-bottom: 1px solid var(--border); }}
.dots {{ display: flex; gap: 9px; }}
.dots i {{ width: 14px; height: 14px; border-radius: 50%; background: var(--border); display: block; }}
.code-fn {{ font: 600 24px/1 "JetBrains Mono", monospace; color: var(--muted); }}
.code-body {{ padding: 28px 24px; display: flex; flex-direction: column; gap: 10px; font: 500 calc(30px * {scale})/1.45 "JetBrains Mono", monospace; }}
.code-ln {{ display: flex; align-items: baseline; gap: 22px; padding: 10px 18px; border-radius: 10px; border-left: 4px solid transparent; }}
.code-ln.hl {{ background: color-mix(in srgb, var(--accent) 16%, transparent); border-left-color: var(--accent); color: var(--text); }}
.ln-no {{ color: var(--muted); opacity: .65; min-width: 34px; text-align: right; user-select: none; }}
.code-ln code {{ font-family: inherit; white-space: pre-wrap; }}

/* capture & receipt */
.capture-frame {{ border-radius: 20px; overflow: hidden; border: 1.5px solid var(--border); box-shadow: 0 24px 60px rgba(0,0,0,.26); background: #fff; }}
.receipt {{ position: relative; border-radius: 20px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.28); background: #fff; }}
.receipt img {{ position: absolute; inset: 0; width: 100%; height: 100%; }}
.receipt .mark {{ position: absolute; background: #FFE34D; mix-blend-mode: multiply; transform-origin: left center; border-radius: 4px; }}

/* image, clip & quote */
.media-wrap {{ display: flex; flex-direction: column; align-items: center; gap: 18px; max-width: 100%; }}
.media-frame {{ position: relative; border-radius: 22px; overflow: hidden; border: 1.5px solid var(--border); background: var(--surface-2); box-shadow: 0 26px 68px rgba(0,0,0,.28); }}
.media-frame img {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
.media-meta {{ width: min(100%, 1440px); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; }}
.media-meta.media-meta-single {{ justify-content: center; }}
.media-cap {{ font: {w_title} calc(30px * {scale})/1.3 Ftitle, sans-serif; color: var(--text); letter-spacing: -0.01em; }}
.media-pill {{ display: inline-block; padding: 7px 16px; border-radius: 999px; background: var(--surface); border: 1.5px solid var(--border); font: {w_body} calc(21px * {scale})/1.2 Fbody, sans-serif; color: var(--muted); }}
.quote-card {{ width: min(100%, 1340px); box-sizing: border-box; padding: 52px 64px; border-radius: 28px; background: var(--surface); border: 1.5px solid var(--border); border-left: 6px solid var(--accent); box-shadow: 0 26px 68px rgba(0,0,0,.24); display: flex; flex-direction: column; gap: 26px; }}
.quote-mark {{ font: 800 calc(88px * {scale})/0.72 Ftitle, Georgia, serif; color: var(--accent); user-select: none; }}
.quote-text {{ margin: 0; font: {w_title} calc(44px * {scale})/1.32 Ftitle, sans-serif; letter-spacing: -0.02em; color: var(--text); }}
.quote-text.quote-text-long {{ font-size: calc(35px * {scale}); line-height: 1.36; }}
.quote-foot {{ display: flex; align-items: center; gap: 20px; margin-top: 4px; }}
.quote-avatar {{ width: 68px; height: 68px; border-radius: 50%; object-fit: cover; flex: none; border: 2px solid var(--accent); }}
.quote-by {{ display: flex; flex-direction: column; gap: 6px; }}
.quote-author {{ font: {w_title} calc(30px * {scale})/1.2 Ftitle, sans-serif; color: var(--text); }}
.quote-source {{ font: {w_body} calc(23px * {scale})/1.25 Fbody, sans-serif; color: var(--muted); }}

/* captions */
.cap {{ position: absolute; left: 0; width: {W}px; z-index: 50; text-align: center; transform: translateY(-50%); pointer-events: none; }}
.cap .band {{ display: inline-block; max-width: {cap_max_w}px; padding: {pad_y}px {pad_x}px; border-radius: {cap_radius}px; background: {cap_box};
             box-shadow: 0 0 0 1.5px {cap_border}; font: {w_cap} {cap_size}px/1.25 Fcap, sans-serif; color: {cap_color}; }}
.cap .em {{ background: {em}; color: #FFFFFF; padding: 2px 10px; border-radius: 6px; }}
</style></head><body>
<div id="root" data-composition-id="explainer" data-width="{W}" data-height="{H}" data-fps="30" data-start="0" data-duration="{dur}">
  <div id="bg-world" data-layout-allow-overflow><div id="bg-orb"></div></div>
{hosts}
  <div id="captions" data-layout-allow-caption-zone>
  {caps}
  </div>
  <audio id="mix" src="assets/mix.wav" data-start="0" data-duration="{dur}" data-track-index="200"></audio>
</div>
<script>
window.__timelines = window.__timelines || {{}};
const tl = gsap.timeline({{ paused: true }});
function countUp(sel, to, dec, pre, suf, t, d) {{
  const o = {{ v: 0 }}, el = document.querySelector(sel);
  tl.fromTo(o, {{ v: 0 }}, {{ v: to, duration: d, ease: "power2.out", immediateRender: false,
    onUpdate: () => {{ el.textContent = pre + o.v.toLocaleString("en-US", {{ minimumFractionDigits: dec, maximumFractionDigits: dec }}) + suf; }} }}, t);
  tl.fromTo(sel, {{ scale: .92 }}, {{ scale: 1, duration: .48, ease: "back.out(1.5)", immediateRender: false }}, t);
}}
tl.fromTo("#bg-orb", {{ x: -42, y: -18, scale: 0.95 }}, {{ x: 42, y: 18, scale: 1.07, duration: {dur}, ease: "sine.inOut" }}, 0);
{script}
tl.to({{}}, {{ duration: {dur} }}, 0);
window.__timelines["explainer"] = tl;
</script></body></html>
"""
