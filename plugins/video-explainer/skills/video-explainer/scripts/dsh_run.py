"""Run one Video Explainer pipeline step for the DSH plugin tool.

This module is the only entry point the `video_explainer_render` tool uses. It maps a
small, fixed set of step names onto the upstream scripts, runs exactly one of them, and
prints one JSON line describing the result. It adds no behavior of its own: every step
is the upstream script with the same arguments the skill documents.

usage:
  dsh_run.py --project <dir> --step <preflight|narrate|preview|draft|final|qa>
             [--voice] [--share] [--batch <id>]
  dsh_run.py --project <dir> --step review [--port 8791] [--timeout 7200]
  dsh_run.py --project <dir> --step review-poll [--timeout 3600]
  dsh_run.py --project <dir> --step review-ack --batch <id>

Output (one line on stdout):
  {"ok": true, "step": "draft", "exitCode": 0, "outputs": ["<path>", ...],
   "remarks": ["..."], "logTail": "<tail of the step's output>"}
"""
import argparse, glob, json, os, subprocess, sys

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
LOG_TAIL = 4000

# step -> (script, extra argv, outputs to report)
STEPS = {
    "preflight": ("setup.sh", [], []),
    "narrate": ("narrate.py", [], ["work/transcript.md", "work/words.json"]),
    "preview": ("render.py", ["--preview"], ["work/preview/contact.jpg"]),
    "draft": ("render.py", ["--draft"], ["renders"]),
    "final": ("render.py", [], ["renders"]),
    "qa": ("qa.py", [], ["work/qa/report.md", "work/qa/contact.jpg", "work/qa/opening.jpg"]),
}


def project_paths(project):
    root = os.path.abspath(project)
    if not os.path.isdir(root):
        raise SystemExit(f"error: project folder does not exist: {root}")
    if not os.path.isfile(os.path.join(root, "script.md")):
        raise SystemExit(f"error: {root} has no script.md; write script.md before running a pipeline step")
    return root


def run(argv, timeout):
    """Run one script; return (exitCode, combined stdout+stderr, timedOut)."""
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as expired:
        text = (expired.stdout or b"") if isinstance(expired.stdout, bytes) else (expired.stdout or "")
        if isinstance(text, bytes):
            text = text.decode(errors="replace")
        err = (expired.stderr or b"") if isinstance(expired.stderr, bytes) else (expired.stderr or "")
        if isinstance(err, bytes):
            err = err.decode(errors="replace")
        return None, text + err, True
    return done.returncode, (done.stdout or "") + (done.stderr or ""), False


def python_argv():
    """Run a script through scripts/py so it uses the venv the skill documents.

    `py` refuses to create or populate a venv (see docs/UPSTREAM.md), so a missing
    environment surfaces as a clear non-zero exit instead of a silent download.
    """
    return [os.path.join(SCRIPTS, "py")]


def collect(root, targets):
    found, remarks = [], []
    for rel in targets:
        path = os.path.join(root, rel)
        if os.path.isfile(path):
            found.append(path)
        elif os.path.isdir(path):
            renders = sorted(
                glob.glob(os.path.join(path, "*.mp4")),
                key=os.path.getmtime,
                reverse=True,
            )
            if renders:
                found.append(renders[0])
            else:
                remarks.append(f"no render in {rel} yet")
        else:
            remarks.append(f"not produced: {rel}")
    return found, remarks


def review_url(work):
    try:
        with open(os.path.join(work, "review-server.json"), encoding="utf-8") as handle:
            url = json.load(handle).get("url", "")
    except (OSError, ValueError):
        return None
    return url if isinstance(url, str) and url.startswith("http://127.0.0.1:") else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--step", required=True)
    ap.add_argument("--voice", action="store_true")
    ap.add_argument("--share", action="store_true")
    ap.add_argument("--batch")
    ap.add_argument("--port", type=int, default=8791)
    ap.add_argument("--timeout", type=float, default=7200)
    a = ap.parse_args()

    root = project_paths(a.project)
    work = os.path.join(root, "work")
    result = {"ok": False, "step": a.step, "exitCode": None, "outputs": [], "remarks": [], "logTail": ""}

    if a.step in STEPS:
        script, extra, targets = STEPS[a.step]
        if a.step == "preflight":
            # setup.sh is a read-only preflight in this port; it never installs.
            argv = [os.path.join(SCRIPTS, script), "--json", *(["--voice"] if a.voice else [])]
        else:
            if a.share and a.step == "final":
                extra = extra + ["--share"]
            argv = [*python_argv(), os.path.join(SCRIPTS, script), root, *extra]
    elif a.step in ("review", "review-poll", "review-ack"):
        script = os.path.join(SCRIPTS, "review.py")
        if a.step == "review":
            argv = [*python_argv(), script, root, "--no-open", "--port", str(a.port), "--timeout", str(a.timeout)]
        elif a.step == "review-poll":
            argv = [*python_argv(), script, "--poll", work, "--timeout", str(a.timeout)]
        else:
            if not a.batch:
                result["logTail"] = "error: --batch is required with --step review-ack"
                print(json.dumps(result))
                return 2
            argv = [*python_argv(), script, "--ack", work, a.batch]
    else:
        result["logTail"] = f"error: unknown step {a.step!r}"
        print(json.dumps(result))
        return 2

    code, text, timed_out = run(argv, a.timeout)
    result["exitCode"] = code
    result["logTail"] = text[-LOG_TAIL:]
    if timed_out:
        result["remarks"].append(f"the step exceeded {a.timeout:g}s and was stopped; run it again as a background job")
    if a.step == "preflight":
        # setup.sh --json prints the machine-readable report; surface it verbatim.
        for line in reversed(text.strip().splitlines()):
            try:
                report = json.loads(line)
            except ValueError:
                continue
            result["report"] = report
            break
    if a.step in STEPS and a.step != "preflight":
        result["outputs"], found_remarks = collect(root, STEPS[a.step][2])
        result["remarks"].extend(found_remarks)
    if a.step in ("review", "review-poll", "review-ack"):
        url = review_url(work)
        if url:
            result["reviewUrl"] = url
        if a.step == "review-ack":
            result["outputs"] = [os.path.join(work, "feedback.md")]
        if a.step == "review-poll":
            result["outputs"] = [os.path.join(work, "feedback.md")]
    result["ok"] = code == 0
    print(json.dumps(result))
    return 0 if code == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
