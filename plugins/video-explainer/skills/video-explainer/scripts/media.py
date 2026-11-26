"""Fetch and normalize web or local images and video clips for /video-explainer projects.
usage:
  media.py image <URL_OR_WIKIMEDIA_QUERY_OR_PATH> <OUT_PATH> [--credit "..."]
  media.py clip  <URL_OR_LOCAL_VIDEO> <OUT_MP4> [--start 0] [--duration 6] [--credit "..."] [--keep-audio]"""
import argparse, html, json, os, re, shutil, subprocess, tempfile, urllib.error, urllib.parse, urllib.request

from common import FPS, die, probe, run

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
WIKI_UA = "VideoExplainerSkill/1.0 (https://github.com/petergyang/video-explainer; local-media-helper)"
SKIP_WIKI_EXTS = (".pdf", ".djvu", ".ogg", ".ogv", ".oga", ".webm", ".wav", ".mp3", ".flac", ".mid", ".stl")
DIRECT_VIDEO_EXTS = (".mp4", ".webm", ".mov", ".m4v", ".mkv", ".ogv")
CHALLENGE_MARKERS = ("cf-chl", "cloudflare", "turnstile", "g-recaptcha", "hcaptcha", "verify you are human", "captcha")


def _strip_html(raw):
    if not raw:
        return ""
    txt = re.sub(r"<[^>]+>", " ", str(raw))
    txt = html.unescape(txt)
    return re.sub(r"\s+", " ", txt).strip()


def _is_wiki_url(url):
    host = urllib.parse.urlparse(url).netloc.lower()
    return host.endswith("wikimedia.org") or host.endswith("wikipedia.org")


def _detect_project_root(out_path):
    """Return enclosing explainer project folder if out_path sits inside one, else None."""
    abs_out = os.path.abspath(out_path)
    parent = os.path.dirname(abs_out)
    if os.path.basename(parent) in ("media", "captures"):
        return os.path.dirname(parent)
    cur = parent
    for _ in range(4):
        if not cur or cur == os.path.dirname(cur):
            break
        if os.path.isfile(os.path.join(cur, "script.md")) or os.path.isdir(os.path.join(cur, "work")):
            return cur
        cur = os.path.dirname(cur)
    return None


def record_media_source(out_path, entry):
    proj = _detect_project_root(out_path)
    if not proj:
        return None
    work_dir = os.path.join(proj, "work")
    os.makedirs(work_dir, exist_ok=True)
    manifest_path = os.path.join(work_dir, "media-sources.json")
    items = []
    if os.path.isfile(manifest_path):
        try:
            loaded = json.load(open(manifest_path, encoding="utf-8"))
            if isinstance(loaded, list):
                items = loaded
        except Exception:
            items = []
    rel_out = os.path.relpath(os.path.abspath(out_path), proj).replace(os.sep, "/")
    record = dict(entry, out=rel_out)
    items = [it for it in items if it.get("out") != rel_out]
    items.append(record)
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(items, fh, indent=2)
        fh.write("\n")
    return manifest_path


def _download_bytes(url, dest_path, expect_media=True):
    ua_order = [WIKI_UA, BROWSER_UA] if _is_wiki_url(url) else [BROWSER_UA, WIKI_UA]
    last_err = None
    for ua in ua_order:
        req = urllib.request.Request(url, headers={
            "User-Agent": ua,
            "Accept": "image/avif,image/webp,image/apng,image/*,video/*,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                ctype = (resp.headers.get("Content-Type") or "").lower()
                data = resp.read()
            if expect_media and "text/html" in ctype:
                sample = data[:4096].decode("utf-8", errors="ignore").lower()
                if any(m in sample for m in CHALLENGE_MARKERS):
                    die(f"download blocked by anti-bot/CAPTCHA challenge at {url}; choose an open direct asset or Wikimedia Commons file")
                last_err = f"URL returned text/html instead of media ({url})"
                continue
            with open(dest_path, "wb") as fh:
                fh.write(data)
            return ctype
        except urllib.error.HTTPError as err:
            body = ""
            try:
                body = err.read(2048).decode("utf-8", errors="ignore").lower()
            except Exception:
                pass
            if any(m in body for m in CHALLENGE_MARKERS):
                die(f"download blocked by anti-bot/CAPTCHA challenge (HTTP {err.code}) at {url}")
            last_err = f"HTTP {err.code} ({err.reason}) for {url}"
        except Exception as err:
            last_err = f"{err} for {url}"
    die(f"could not download {url}: {last_err}")


def _wiki_api(host, params):
    req = urllib.request.Request(f"https://{host}/w/api.php?{urllib.parse.urlencode(params)}",
                                 headers={"User-Agent": WIKI_UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _commons_hit(pages):
    """First usable image among Commons API pages, as (url, credit, page_url), or None."""
    for page in sorted(pages, key=lambda p: p.get("index", 999)):
        title = page.get("title", "")
        if title.lower().endswith(SKIP_WIKI_EXTS):
            continue
        info = (page.get("imageinfo") or [{}])[0]
        mime = (info.get("mime") or "").lower()
        img_url = info.get("thumburl") or info.get("url")
        if not img_url:
            continue
        if mime and not mime.startswith("image/") and not info.get("thumburl"):
            continue
        ext = info.get("extmetadata") or {}
        artist = _strip_html((ext.get("Artist") or {}).get("value", ""))
        lic = _strip_html((ext.get("LicenseShortName") or {}).get("value", ""))
        if len(artist) > 64:
            artist = artist[:61].rstrip() + "..."
        credit = " / ".join(p for p in (artist, lic, "Wikimedia Commons") if p)
        return img_url, credit, info.get("descriptionurl") or img_url
    return None


IMAGE_INFO = {"prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": "1600", "format": "json"}


def _search_queries(q):
    """The full query, then shorter versions dropping trailing words, down to two words."""
    words = q.split()
    return [" ".join(words[:n]) for n in range(len(words), min(2, len(words)) - 1, -1)]


def search_wikimedia(query):
    """Find a Commons image: search Commons with the query and shorter versions of it,
    then fall back to the lead image of the best-matching Wikipedia article."""
    q = query.strip()
    if not q:
        die("wikimedia: search query cannot be empty")
    errors = []
    for attempt in _search_queries(q):
        try:
            payload = _wiki_api("commons.wikimedia.org", {"action": "query", "generator": "search", "gsrnamespace": "6",
                                                          "gsrsearch": attempt, "gsrlimit": "12", **IMAGE_INFO})
        except Exception as err:
            errors.append(str(err))
            continue
        hit = _commons_hit((payload.get("query") or {}).get("pages", {}).values())
        if hit:
            return hit
    try:
        payload = _wiki_api("en.wikipedia.org", {"action": "query", "generator": "search", "gsrsearch": q, "gsrlimit": "3",
                                                 "prop": "pageimages", "piprop": "name", "format": "json"})
        for page in sorted((payload.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 999)):
            name = page.get("pageimage")
            if not name:
                continue
            info = _wiki_api("commons.wikimedia.org", {"action": "query", "titles": f"File:{name}", **IMAGE_INFO})
            hit = _commons_hit((info.get("query") or {}).get("pages", {}).values())
            if hit:
                return hit
    except Exception as err:
        errors.append(str(err))
    if len(errors) == len(_search_queries(q)) + 1:
        die(f"Wikimedia Commons search failed for '{q}': {errors[-1]}")
    die(f"no Wikimedia Commons image found for '{q}'. Try a shorter query, an official page with capture.py, or a direct image URL.")


def search_wikimedia_video(query):
    q = query.strip()
    if not q:
        die("wikimedia: search query cannot be empty")
    params = urllib.parse.urlencode({
        "action": "query",
        "generator": "search",
        "gsrnamespace": "6",
        "gsrsearch": f"{q} filetype:video",
        "gsrlimit": "10",
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|mime",
        "format": "json",
    })
    api_url = f"https://commons.wikimedia.org/w/api.php?{params}"
    req = urllib.request.Request(api_url, headers={"User-Agent": WIKI_UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception as err:
        die(f"Wikimedia Commons video search failed for '{q}': {err}")
    pages = sorted((payload.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 999))
    for page in pages:
        info = (page.get("imageinfo") or [{}])[0]
        mime = (info.get("mime") or "").lower()
        vid_url = info.get("url")
        if vid_url and mime.startswith("video/"):
            ext = info.get("extmetadata") or {}
            artist = _strip_html((ext.get("Artist") or {}).get("value", ""))[:60]
            lic = _strip_html((ext.get("LicenseShortName") or {}).get("value", ""))
            credit = " / ".join(p for p in (artist, lic, "Wikimedia Commons") if p)
            return vid_url, credit, info.get("descriptionurl") or vid_url
    die(f"no Wikimedia Commons video found for '{q}'")


def _has_alpha(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    )
    pix = (r.stdout or "").strip().lower()
    return any(tag in pix for tag in ("rgba", "bgra", "argb", "abgr", "ya8", "ya16", "yuva", "pal8"))


def cmd_image(args):
    src = args.source.strip()
    out = os.path.abspath(args.out)
    ext = os.path.splitext(out)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png"):
        die(f"output image must end in .jpg, .jpeg, or .png: {args.out}")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    credit = (args.credit or "").strip()
    resolved_url = src

    with tempfile.TemporaryDirectory() as tmp:
        raw_path = os.path.join(tmp, "raw_input")
        if src.lower().startswith("wikimedia:"):
            img_url, auto_credit, page_url = search_wikimedia(src.split(":", 1)[1])
            _download_bytes(img_url, raw_path, expect_media=True)
            resolved_url = page_url
            if not credit:
                credit = auto_credit
        elif src.lower().startswith(("http://", "https://")):
            _download_bytes(src, raw_path, expect_media=True)
        else:
            local = os.path.expanduser(src[7:] if src.lower().startswith("file://") else src)
            if not os.path.isfile(local):
                die(f"image source not found: {src}")
            raw_path = local
            resolved_url = os.path.abspath(local)

        w0, h0, _ = probe(raw_path)
        if not w0 or not h0:
            die(f"source is not a valid readable image: {src}")

        scale_vf = "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease"
        if ext == ".png":
            pix_fmt = "rgba" if _has_alpha(raw_path) else "rgb24"
            run([
                "ffmpeg", "-v", "error", "-y", "-i", raw_path,
                "-vf", scale_vf, "-frames:v", "1", "-pix_fmt", pix_fmt, out,
            ])
        else:
            run([
                "ffmpeg", "-v", "error", "-y", "-i", raw_path,
                "-vf", f"{scale_vf},scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-frames:v", "1", "-q:v", "2", out,
            ])

    w, h, _ = probe(out)
    record_media_source(out, {
        "kind": "image",
        "url": resolved_url,
        "credit": credit,
        "width": w,
        "height": h,
    })
    credit_note = f" [{credit}]" if credit else ""
    print(f"Saved image {out} ({w}x{h}){credit_note}")


def _find_ytdlp():
    for cand in (shutil.which("yt-dlp"), "/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp"):
        if cand and os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def _check_ytdlp_error(stderr_text, url):
    low = (stderr_text or "").lower()
    if any(k in low for k in ("not a bot", "captcha", "sign in", "login required", "cookies", "drm", "protected")):
        die(
            f"site blocked automated clip download (bot/sign-in/DRM gate) for {url}. "
            "Use a public direct .mp4/.webm URL, Wikimedia Commons video, or local recording instead."
        )
    if "http error 403" in low or "http error 429" in low:
        die(f"remote host refused automated download (HTTP 403/429) for {url}")


def _download_clip_ytdlp(url, tmp_dir, start, duration):
    ytdlp = _find_ytdlp()
    if not ytdlp:
        die("yt-dlp is required for web video pages (install with: brew install yt-dlp)")
    fmt = (
        "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/"
        "best[height<=1080][ext=mp4]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"
    )
    out_tpl = os.path.join(tmp_dir, "dl.%(ext)s")
    end_t = max(start + 0.5, start + duration + 0.5)
    sec_cmd = [
        ytdlp, "--no-playlist", "--no-warnings",
        "-f", fmt, "--merge-output-format", "mp4",
        "--download-sections", f"*{start:.2f}-{end_t:.2f}",
        "-o", out_tpl, url,
    ]
    r = subprocess.run(sec_cmd, capture_output=True, text=True)
    if r.returncode == 0:
        matches = [os.path.join(tmp_dir, f) for f in os.listdir(tmp_dir) if f.startswith("dl.")]
        if matches:
            return matches[0], True
    _check_ytdlp_error((r.stderr or "") + "\n" + (r.stdout or ""), url)

    full_cmd = [
        ytdlp, "--no-playlist", "--no-warnings", "--max-filesize", "150M",
        "-f", fmt, "--merge-output-format", "mp4",
        "-o", out_tpl, url,
    ]
    r2 = subprocess.run(full_cmd, capture_output=True, text=True)
    if r2.returncode != 0:
        combined = (r2.stderr or "") + "\n" + (r2.stdout or "")
        _check_ytdlp_error(combined, url)
        die(f"yt-dlp failed for {url}:\n{combined[-900:]}")
    matches = [os.path.join(tmp_dir, f) for f in os.listdir(tmp_dir) if f.startswith("dl.")]
    if not matches:
        die(f"yt-dlp produced no output file for {url}")
    return matches[0], False


def cmd_clip(args):
    src = args.source.strip()
    out = os.path.abspath(args.out)
    if not out.lower().endswith(".mp4"):
        die(f"output clip must end in .mp4: {args.out}")
    if args.start < 0:
        die("--start must be >= 0")
    if args.duration <= 0:
        die("--duration must be > 0")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    credit = (args.credit or "").strip()
    resolved_url = src

    with tempfile.TemporaryDirectory() as tmp:
        already_trimmed = False
        if src.lower().startswith("wikimedia:"):
            vid_url, auto_credit, page_url = search_wikimedia_video(src.split(":", 1)[1])
            ext = os.path.splitext(urllib.parse.urlparse(vid_url).path)[1] or ".webm"
            raw_path = os.path.join(tmp, "wiki_vid" + ext)
            _download_bytes(vid_url, raw_path, expect_media=True)
            resolved_url = page_url
            if not credit:
                credit = auto_credit
        elif src.lower().startswith(("http://", "https://")):
            url_path = urllib.parse.urlparse(src).path.lower()
            if url_path.endswith(DIRECT_VIDEO_EXTS):
                raw_path = os.path.join(tmp, "direct" + os.path.splitext(url_path)[1])
                _download_bytes(src, raw_path, expect_media=True)
            else:
                raw_path, already_trimmed = _download_clip_ytdlp(src, tmp, args.start, args.duration)
        else:
            local = os.path.expanduser(src[7:] if src.lower().startswith("file://") else src)
            if not os.path.isfile(local):
                die(f"video source not found: {src}")
            raw_path = local
            resolved_url = os.path.abspath(local)

        w0, h0, _ = probe(raw_path)
        if not w0 or not h0:
            die(f"source has no readable video stream: {src}")

        vf = (
            f"scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease,"
            f"scale=trunc(iw/2)*2:trunc(ih/2)*2,fps={FPS}"
        )
        ff = ["ffmpeg", "-v", "error", "-y"]
        if not already_trimmed and args.start > 0:
            ff += ["-ss", f"{args.start:.3f}"]
        ff += [
            "-i", raw_path,
            "-t", f"{args.duration:.3f}",
            "-vf", vf,
            "-r", str(FPS),
            "-c:v", "libx264", "-crf", "19", "-g", "15", "-pix_fmt", "yuv420p",
        ]
        if args.keep_audio:
            ff += ["-c:a", "aac", "-b:a", "160k"]
        else:
            ff += ["-an"]
        ff += ["-movflags", "+faststart", out]
        run(ff)

    w, h, dur = probe(out)
    record_media_source(out, {
        "kind": "clip",
        "url": resolved_url,
        "credit": credit,
        "width": w,
        "height": h,
        "duration": round(dur, 3),
    })
    credit_note = f" [{credit}]" if credit else ""
    print(f"Saved clip {out} ({w}x{h}, {dur:.2f}s @ {FPS}fps){credit_note}")


def main():
    ap = argparse.ArgumentParser(description="Fetch and normalize images and clips for /video-explainer.")
    sub = ap.add_subparsers(dest="subcmd", required=True)

    p_img = sub.add_parser("image", help="Download or normalize an image (URL, wikimedia:<query>, or local path)")
    p_img.add_argument("source", help="https:// URL, wikimedia:<search query>, or local image path")
    p_img.add_argument("out", help="Output .jpg or .png path (e.g. $P/media/photo.jpg)")
    p_img.add_argument("--credit", default="", help="Optional source/attribution credit")
    p_img.set_defaults(func=cmd_image)

    p_clip = sub.add_parser("clip", help="Download or trim a video clip to seek-safe 30fps H.264 MP4")
    p_clip.add_argument("source", help="Video URL or local video path")
    p_clip.add_argument("out", help="Output .mp4 path (e.g. $P/media/demo.mp4)")
    p_clip.add_argument("--start", type=float, default=0.0, help="Start offset in seconds (default: 0)")
    p_clip.add_argument("--duration", type=float, default=6.0, help="Clip duration in seconds (default: 6)")
    p_clip.add_argument("--credit", default="", help="Optional source/attribution credit")
    p_clip.add_argument("--keep-audio", action="store_true", help="Keep audio track (muted -an by default)")
    p_clip.set_defaults(func=cmd_clip)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
