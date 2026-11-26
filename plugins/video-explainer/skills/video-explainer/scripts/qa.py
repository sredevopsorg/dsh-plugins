"""Measure a rendered explainer video, run HyperFrames layout/contrast checks, and export QA frames in parallel.
usage: qa.py PROJECT [VIDEO]   (VIDEO defaults to the newest renders/*.mp4)
Writes work/qa/report.md, contact.jpg (adaptive 0.5-2 fps), opening.jpg (first 3s), and cuts/*.jpg (10 frames around each scene boundary)."""
from concurrent.futures import ThreadPoolExecutor
import glob, json, math, os, re, subprocess, sys

import numpy as np

from common import (FPS, captions_enabled, hf_cmd, hf_env, parse_json_output, parse_script, project_paths,
                    resolve_aspect, resolve_max_duration, resolve_voice, run, setting)

DURATION_GRACE_SECONDS = 2.0
MOTION_FPS = 2.0
MOTION_W, MOTION_H = 80, 45
MOTION_UPPER_ROWS = 36          # y = 0..35 inclusive (upper 80% visual canvas; excludes y > 35 caption band)
MOTION_DIFF_THRESH = 0.25       # mean grayscale diff (0..255) per 0.5s interval
MOTION_MAX_FROZEN_INTERVALS = 8 # 8 intervals * 0.5s = 4.0s frozen slide stretch limit
MOTION_MIN_ACTIVE_RATIO = 0.65  # required active interval ratio for videos >= 8.0s
MOTION_MIN_RATIO_DURATION = 8.0


def duration_cap_check(vdur, max_duration, grace=DURATION_GRACE_SECONDS):
    limit = max_duration + grace
    ok = vdur <= limit
    if ok:
        detail = f"{vdur:.2f}s <= {max_duration:g}s (+{grace:g}s grace = {limit:g}s)"
    else:
        detail = (
            f"FAIL {vdur:.2f}s > {limit:g}s ({max_duration:g}s cap + {grace:g}s grace; "
            f"trim script or set Max duration: in script.md)"
        )
    return ("Duration cap (duration_cap)", ok, detail)


def extract_upper_canvas_diffs(video):
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", video,
         "-vf", f"fps={MOTION_FPS:g},scale={MOTION_W}:{MOTION_H}",
         "-an", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True,
    )
    if p.returncode != 0:
        return np.array([], dtype=np.float64)
    frame_bytes = MOTION_W * MOTION_H
    n_frames = len(p.stdout) // frame_bytes
    if n_frames < 2:
        return np.array([], dtype=np.float64)
    buf = np.frombuffer(p.stdout[:n_frames * frame_bytes], dtype=np.uint8)
    upper = buf.reshape(n_frames, MOTION_H, MOTION_W)[:, :MOTION_UPPER_ROWS, :].astype(np.float32)
    return np.mean(np.abs(upper[1:] - upper[:-1]), axis=(1, 2)).astype(np.float64)


def evaluate_motion_liveliness(diffs, vdur):
    label = "Motion liveliness (motion_liveliness)"
    diffs = np.asarray(diffs, dtype=np.float64)
    total = int(diffs.size)
    if total == 0:
        return (label, True, f"short clip ({vdur:.2f}s, <2 sampled frames)")

    active = int(np.sum(diffs >= MOTION_DIFF_THRESH))
    active_ratio = active / total
    mean_diff = float(np.mean(diffs))

    max_frozen_run = 0
    cur_run = 0
    for d in diffs:
        if d < MOTION_DIFF_THRESH:
            cur_run += 1
            if cur_run > max_frozen_run:
                max_frozen_run = cur_run
        else:
            cur_run = 0
    max_frozen_sec = max_frozen_run / MOTION_FPS

    no_frozen_stretch = max_frozen_run < MOTION_MAX_FROZEN_INTERVALS
    enforce_ratio = vdur >= MOTION_MIN_RATIO_DURATION
    ratio_ok = (active_ratio >= MOTION_MIN_ACTIVE_RATIO) if enforce_ratio else True
    ok = no_frozen_stretch and ratio_ok

    ratio_note = (
        f"active={active_ratio:.0%} ({active}/{total} >= {MOTION_DIFF_THRESH:g})"
        if enforce_ratio else
        f"active={active_ratio:.0%} ({active}/{total}, short <{MOTION_MIN_RATIO_DURATION:g}s)"
    )
    frozen_note = f"max_frozen={max_frozen_sec:.1f}s (<4.0s)"
    diff_note = f"mean_diff={mean_diff:.2f}"

    if ok:
        detail = f"{ratio_note}, {frozen_note}, {diff_note}"
    else:
        reasons = []
        if not no_frozen_stretch:
            reasons.append(f"frozen stretch {max_frozen_sec:.1f}s >= 4.0s ({max_frozen_run} intervals < {MOTION_DIFF_THRESH:g})")
        if not ratio_ok:
            reasons.append(f"active ratio {active_ratio:.0%} < {MOTION_MIN_ACTIVE_RATIO:.0%} ({active}/{total})")
        detail = f"FAIL {'; '.join(reasons)} [{diff_note}]"
    return (label, ok, detail)


def motion_liveliness(video, vdur):
    return evaluate_motion_liveliness(extract_upper_canvas_diffs(video), vdur)


def loudness(video):
    err = subprocess.run(["ffmpeg", "-i", video, "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    i = re.findall(r"I:\s+(-?[\d.]+)\s+LUFS", err)
    tp = re.findall(r"Peak:\s+(-?inf|-?[\d.]+)\s+dBFS", err, re.I)
    lufs_val = float(i[-1]) if i else None
    peak_val = float("-inf") if (tp and tp[-1].lower() == "-inf") else (float(tp[-1]) if tp else None)
    return lufs_val, peak_val


def streams(video):
    info = json.loads(run([
        "ffprobe", "-v", "error", "-count_frames",
        "-show_entries", "stream=codec_type,width,height,r_frame_rate,nb_read_frames,duration",
        "-of", "json", video,
    ]).stdout)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    return v, a


def black_frames(video):
    err = subprocess.run(["ffmpeg", "-i", video, "-vf", "blackdetect=d=0.03:pix_th=0.08", "-an", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", err)


def run_hyperframes_check(hf_dir, captions_on, W, H):
    if not os.path.isdir(hf_dir):
        return False, "hf/ missing", []
    cmd = hf_cmd("check", hf_dir, "--json")
    if captions_on:
        y0 = 0.83 if W >= H else 0.73
        cmd.append(f"--caption-zone=x0=0;y0={y0};x1=1;y1=1;severity=warning")
    p = subprocess.run(cmd, capture_output=True, text=True, env=hf_env())
    data = parse_json_output(p.stdout, "hyperframes check")
    sections = ("lint", "runtime", "layout", "contrast")
    errs = sum(data.get(sec, {}).get("errorCount", 0) for sec in sections)
    warns = sum(data.get(sec, {}).get("warningCount", 0) for sec in sections)
    notes = []
    for sec in sections:
        for f in data.get(sec, {}).get("findings", [])[:6]:
            sev = f.get("severity", "info")
            msg = f.get("message") or f.get("detail") or f.get("code") or str(f)
            notes.append(f"[{sec}/{sev}] {msg}")
    detail = f"errors={errs}, warnings={warns}"
    return (errs == 0 and p.returncode == 0), detail, notes


def main():
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    paths = project_paths(sys.argv[1])
    renders = glob.glob(os.path.join(paths["renders"], "*.mp4"))
    if len(sys.argv) == 2 and not renders:
        sys.exit("error: no rendered video found in renders/. Run render.py first.")
    video = sys.argv[2] if len(sys.argv) == 3 else max(renders, key=os.path.getmtime)

    script = parse_script(paths["script"])
    aspect_name, (W, H) = resolve_aspect(script)
    max_duration = resolve_max_duration(script)
    mode, _ = resolve_voice(script, paths["root"])
    has_voice = mode != "none"
    music = setting(script, "music")
    has_music = bool(music and music.lower() != "none")
    has_words = os.path.isfile(paths["words"]) and bool(json.load(open(paths["words"], encoding="utf-8")))
    captions_on = captions_enabled(script, paths["root"]) and has_words

    qa = os.path.join(paths["work"], "qa")
    os.makedirs(os.path.join(qa, "cuts"), exist_ok=True)
    for f in glob.glob(os.path.join(qa, "cuts", "*.jpg")):
        os.remove(f)

    if aspect_name == "16:9":
        c_wh, c_cols, o_wh, cut_wh, cut_tile = "384:216", 6, "480:270", "320:180", "5x2"
    elif aspect_name == "9:16":
        c_wh, c_cols, o_wh, cut_wh, cut_tile = "216:384", 8, "270:480", "162:288", "10x1"
    else:
        c_wh, c_cols, o_wh, cut_wh, cut_tile = "288:288", 6, "360:360", "240:240", "5x2"

    with ThreadPoolExecutor(max_workers=6) as pool:
        fut_streams = pool.submit(streams, video)
        fut_loud = pool.submit(loudness, video)
        fut_black = pool.submit(black_frames, video)
        fut_motion = pool.submit(extract_upper_canvas_diffs, video)
        fut_hf = pool.submit(run_hyperframes_check, os.path.join(paths["root"], "hf"), captions_on, W, H)

        v, a = fut_streams.result()
        num, den = (int(x) for x in v["r_frame_rate"].split("/"))
        vdur, adur = float(v["duration"]), float(a["duration"]) if a else 0.0

        c_fps = 2 if vdur <= 75 else (1 if vdur <= 150 else 0.5)
        c_rows = max(1, math.ceil(max(1, vdur * c_fps) / c_cols))

        img_futs = [
            pool.submit(run, ["ffmpeg", "-v", "error", "-y", "-i", video,
                              "-vf", f"fps={c_fps:g},scale={c_wh},tile={c_cols}x{c_rows}",
                              "-frames:v", "1", os.path.join(qa, "contact.jpg")]),
            pool.submit(run, ["ffmpeg", "-v", "error", "-y", "-t", "3", "-i", video,
                              "-vf", f"fps=6,scale={o_wh},tile=6x3",
                              "-frames:v", "1", os.path.join(qa, "opening.jpg")]),
        ]
        for sc in script["scenes"][1:]:
            if sc["start"] is None:
                continue
            t = max(0.0, sc["start"] - 5 / FPS)
            img_futs.append(pool.submit(
                run,
                ["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", video,
                 "-vf", f"scale={cut_wh},tile={cut_tile}", "-frames:v", "1",
                 os.path.join(qa, "cuts", f"{sc['id']}_{sc['start']:.2f}.jpg")],
            ))

        lufs_val, peak_val = fut_loud.result()
        blacks = fut_black.result()
        motion_diffs = fut_motion.result()
        hf_ok, hf_detail, hf_notes = fut_hf.result()
        for f in img_futs:
            f.result()

    loudness_check = (
        ("Loudness is -15 to -13 LUFS", lufs_val is not None and -15 <= lufs_val <= -13, f"{lufs_val} LUFS")
        if (has_voice or has_music) else
        ("Audio mode is unvoiced (no loudness target)", True, f"{lufs_val} LUFS (SFX/silent)")
    )
    peak_str = "-inf dBFS" if peak_val is not None and math.isinf(peak_val) else f"{peak_val} dBFS"

    checks = [
        (f"Size is {W}x{H}", v["width"] == W and v["height"] == H, f"{v['width']}x{v['height']}"),
        ("Frame rate is 30", num / den == FPS, f"{num / den:g} fps"),
        ("Has audio", a is not None, "yes" if a else "no audio stream"),
        ("Audio and video lengths match within 1 frame", abs(vdur - adur) <= 1 / FPS, f"video {vdur:.3f}s, audio {adur:.3f}s"),
        duration_cap_check(vdur, max_duration),
        loudness_check,
        ("Peak is at or below -1.0 dBFS", peak_val is not None and peak_val <= -1.0, peak_str),
        ("No black gaps", not blacks, ", ".join(f"{s}-{e}s" for s, e in blacks) or "none"),
        evaluate_motion_liveliness(motion_diffs, vdur),
        ("HyperFrames check (lint/runtime/layout/contrast)", hf_ok, hf_detail),
    ]

    passed = sum(1 for _, ok, _ in checks if ok)
    lines = [f"# QA: {os.path.basename(video)} ({passed}/{len(checks)} checks)", ""]
    lines += [f"- [{'x' if ok else ' '}] {name}: {detail}" for name, ok, detail in checks]
    if hf_notes:
        lines += ["", "## HyperFrames check findings", *hf_notes]
    lines += ["", "Inspect contact.jpg, opening.jpg, and cuts/*.jpg (5 frames before and after each scene boundary)."]
    open(os.path.join(qa, "report.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\nFiles in {qa}")
    sys.exit(0 if all(ok for _, ok, _ in checks) else 1)


if __name__ == "__main__":
    main()
