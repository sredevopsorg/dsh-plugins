"""Render script.md into the finished explainer video: build HyperFrames, render, and mux audio.
usage: render.py PROJECT [--style STYLE] [--draft] [--share] [--preview] [--at t1,t2,...]
--preview builds hf/, snapshots keyframes into work/preview/, and tiles work/preview/contact.jpg in ~3s.
--draft renders fast for review.
--share also writes a smaller 720p copy to renders/share/.
Output: renders/<project>-vN.mp4 (1080p on 16:9). A draft keeps one earlier draft;
a final render replaces every earlier version, and later drafts leave it alone."""
import argparse, glob, math, os, re, shutil, subprocess, sys, tempfile

from build import build
from common import FPS, die, hf_cmd, hf_env, parse_script, project_paths, resolve_aspect, run


def hyperframes(*args, allow_fail=False):
    p = subprocess.run(hf_cmd(*args), capture_output=True, text=True, env=hf_env())
    if p.returncode and not allow_fail:
        die(f"hyperframes {args[0]} failed:\n{(p.stdout + p.stderr)[-1500:]}")
    return p


def next_version(renders, slug):
    os.makedirs(renders, exist_ok=True)
    taken = [int(m.group(1)) for f in os.listdir(renders) if (m := re.fullmatch(rf"{re.escape(slug)}-v(\d+)\.mp4", f))]
    return os.path.join(renders, f"{slug}-v{max(taken, default=0) + 1}.mp4")


def prune(out, final):
    """Keep the newest two drafts + saved final; a final render replaces every earlier version."""
    renders = os.path.dirname(out)
    slug = re.fullmatch(r"(.+)-v\d+\.mp4", os.path.basename(out)).group(1)
    versions = {int(m.group(1)): f for f in os.listdir(renders) if (m := re.fullmatch(rf"{re.escape(slug)}-v(\d+)\.mp4", f))}
    marker = os.path.join(renders, ".final")
    if final:
        keep = {os.path.basename(out)}
        open(marker, "w", encoding="utf-8").write(os.path.basename(out))
    else:
        saved = open(marker, encoding="utf-8").read().strip() if os.path.exists(marker) else ""
        drafts = [versions[n] for n in sorted(versions) if versions[n] != saved]
        keep = {saved, *drafts[-2:]}
    for name in versions.values():
        if name not in keep:
            for path in (os.path.join(renders, name), os.path.join(renders, "share", name)):
                if os.path.exists(path):
                    os.remove(path)


def encode_share_copy(src, dst, share_scale):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if sys.platform == "darwin":
        r = subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-i", src, "-vf", f"scale={share_scale}",
            "-c:v", "h264_videotoolbox", "-b:v", "2200k", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dst,
        ], capture_output=True, text=True)
        if r.returncode == 0:
            return
    run([
        "ffmpeg", "-v", "error", "-y", "-i", src, "-vf", f"scale={share_scale}",
        "-c:v", "libx264", "-crf", "26", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dst,
    ])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--style")
    ap.add_argument("--draft", action="store_true")
    ap.add_argument("--share", action="store_true", help="Also write a smaller 720p copy in renders/share/")
    ap.add_argument("--preview", action="store_true", help="Fast ~3s 8-frame snapshot check into work/preview/")
    ap.add_argument("--at", help="Comma-separated timestamps in seconds for --preview")
    a = ap.parse_args()
    if not shutil.which("npx") and not shutil.which("node"):
        die("HyperFrames needs Node.js 22 or newer: https://nodejs.org")

    paths = project_paths(a.project)
    aspect_name, _ = resolve_aspect(parse_script(paths["script"]))
    share_scale = {"16:9": "1280:720", "9:16": "720:1280", "1:1": "720:720"}[aspect_name]

    hf, mix, dur = build(a.project, a.style)
    hyperframes("lint", hf)

    if a.preview:
        prev_dir = os.path.join(paths["work"], "preview")
        os.makedirs(prev_dir, exist_ok=True)
        for old_png in glob.glob(os.path.join(prev_dir, "*.png")):
            os.remove(old_png)
        snap_args = ["snapshot", hf, "-o", prev_dir, "--describe", "false"]
        if a.at:
            snap_args += ["--at", a.at, "--no-end"]
        else:
            snap_args += ["--frames", "8"]
        hyperframes(*snap_args)
        pngs = sorted(glob.glob(os.path.join(prev_dir, "*.png")))
        contact_jpg = os.path.join(prev_dir, "contact.jpg")
        if pngs:
            tile_wh = {"16:9": "480:270", "9:16": "270:480", "1:1": "360:360"}[aspect_name]
            cols = min(4, len(pngs))
            rows = max(1, math.ceil(len(pngs) / cols))
            cmd = ["ffmpeg", "-v", "error", "-y"]
            for p_img in pngs:
                cmd += ["-i", p_img]
            inputs_tag = "".join(f"[{idx}:v]scale={tile_wh}[s{idx}];" for idx in range(len(pngs)))
            concat_in = "".join(f"[s{idx}]" for idx in range(len(pngs)))
            vf = f"{inputs_tag}{concat_in}concat=n={len(pngs)}:v=1:a=0,tile={cols}x{rows}"
            cmd += ["-filter_complex", vf, "-frames:v", "1", "-q:v", "3", contact_jpg]
            run(cmd)
        print(f"Captured {len(pngs)} preview snapshots ({dur:.2f}s) -> {contact_jpg} (frames in {prev_dir})")
        return

    quality = "draft" if a.draft else "looks"
    with tempfile.TemporaryDirectory() as tmp:
        silent = os.path.join(tmp, "video.mp4")
        rendered = False
        if sys.platform == "darwin":
            p = hyperframes("render", hf, "-o", silent, "--quality", quality, "--gpu", allow_fail=True)
            rendered = (p.returncode == 0 and os.path.isfile(silent))
        if not rendered:
            hyperframes("render", hf, "-o", silent, "--quality", quality)
        out = next_version(paths["renders"], os.path.basename(paths["root"]))
        run([
            "ffmpeg", "-v", "error", "-y", "-i", silent, "-i", mix, "-map", "0:v", "-map", "1:a",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-frames:v", str(round(dur * FPS)),
            "-t", f"{dur:.6f}", "-movflags", "+faststart", out,
        ])

    if a.share:
        share = os.path.join(paths["renders"], "share", os.path.basename(out))
        encode_share_copy(out, share, share_scale)
        prune(out, final=not a.draft)
        print(f"Rendered {out} ({dur:.2f}s), share copy at {share}. Run qa.py next.")
    else:
        prune(out, final=not a.draft)
        print(f"Rendered {out} ({dur:.2f}s). Run qa.py next.")


if __name__ == "__main__":
    main()
