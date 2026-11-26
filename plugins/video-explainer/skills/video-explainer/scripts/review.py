"""Open the draft render for review on the shared review page (review_page.py).
Listen with --poll WORK and acknowledge applied batches with --ack WORK BATCH_ID.
usage: review.py PROJECT [VIDEO] [--no-open] [--port 8791] [--timeout 7200]"""
import argparse, glob, json, os, sys

from common import parse_script, probe, project_paths, resolve_voice, validate_scenes
from review_page import handle_review_control, serve, words_between, write_page


def describe(vis):
    vt = vis["type"]
    if vt == "title":
        return f"title: {vis['headline']}"
    if vt == "card":
        return "card: " + " / ".join([vis["title"], *vis["rows"]])
    if vt == "flow":
        return "flow: " + " -> ".join(n["label"] for n in vis["nodes"])
    if vt == "compare":
        return f"compare: {vis['left']['heading']} vs {vis['right']['heading']}"
    if vt == "number":
        return f"number: {vis['value']} ({vis['label']})"
    if vt == "code":
        return f"code: {vis['title']}"
    if vt in ("image", "clip"):
        tail = f" ({vis['caption']})" if vis.get("caption") else ""
        return f"{vt}: {vis['src']}{tail}"
    if vt == "quote":
        snippet = vis["text"][:48] + ("..." if len(vis["text"]) > 48 else "")
        return f'quote: "{snippet}" ({vis["author"]})'
    return f"{vt}: {vis['src']}"


def build_review_page(paths, video, page):
    script = parse_script(paths["script"])
    mode, _ = resolve_voice(script, paths["root"])
    dur = probe(paths["narration"])[2] if (mode != "none" and os.path.isfile(paths["narration"])) else None
    validated = validate_scenes(script, paths["root"], dur)
    if os.path.isfile(paths["words"]):
        with open(paths["words"], encoding="utf-8") as fh:
            words = json.load(fh)
    else:
        words = []
    scenes = []
    for sc in validated:
        spoken = words_between(words, sc["start"], sc["end"]) if words else script["narration"].get(sc["id"], "")
        scenes.append({
            "id": sc["id"],
            "start": sc["start"],
            "end": sc["end"],
            "layout": sc["visual"]["type"],
            "visual": describe(sc["visual"]),
            "spoken": spoken,
        })
    write_page(paths["root"], page, video, scenes)
    return scenes, words


def main():
    if handle_review_control():
        return
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("video", nargs="?")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--port", type=int, default=8791)
    ap.add_argument("--timeout", type=int, default=7200)
    a = ap.parse_args()
    paths = project_paths(a.project)
    renders = glob.glob(os.path.join(paths["renders"], "*.mp4"))
    if not a.video and not renders:
        sys.exit("No render to review. Run render.py --draft first.")
    video = os.path.abspath(a.video or max(renders, key=os.path.getmtime))
    page = os.path.join(paths["work"], "review", "index.html")
    scenes, words = build_review_page(paths, video, page)
    serve(paths["root"], page, os.path.join(paths["work"], "feedback.md"), scenes, video, a.port, not a.no_open, a.timeout, words)


if __name__ == "__main__":
    main()
