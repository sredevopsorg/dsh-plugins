"""Optional: generate an instrumental music bed with Lyria via the Gemini API.
Needs GEMINI_API_KEY with billing enabled, from the environment or ~/.config/video-explainer/.env.
usage: generate.py music OUT.mp3 --prompt "warm minimal synth pulse, soft marimba" [--seconds 60] [--model ...]"""
import argparse, base64, json, os, sys, urllib.error, urllib.request

from common import SETTINGS_ENV, settings_key

API = "https://generativelanguage.googleapis.com/v1beta"
CLIP_MODEL = "lyria-3-clip-preview"
LONG_MODEL = "lyria-3.5"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=("music",))
    ap.add_argument("out")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--seconds", type=float, default=60)
    ap.add_argument("--model")
    a = ap.parse_args()

    key = settings_key()
    if not key:
        sys.exit(f"No Gemini key. Put GEMINI_API_KEY=... in {SETTINGS_ENV} (key at https://aistudio.google.com/apikey).")

    model = a.model or (CLIP_MODEL if a.seconds <= 30 else LONG_MODEL)
    prompt = f"{a.prompt}. Instrumental only, no vocals." + (f" About {round(a.seconds)} seconds long." if model == LONG_MODEL else "")
    req = urllib.request.Request(
        f"{API}/interactions",
        data=json.dumps({"model": model, "input": prompt}).encode(),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            res = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")[:600].replace(key, "[redacted]")
        sys.exit(f"Gemini API error {e.code}: {msg}")

    for step in res.get("steps", []):
        if step.get("type") == "model_output":
            for item in step.get("content", []):
                if item.get("type") == "audio" and item.get("data"):
                    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
                    open(a.out, "wb").write(base64.b64decode(item["data"]))
                    print(f"music -> {a.out}")
                    return
    sys.exit(f"No audio returned. Response: {json.dumps(res)[:600]}")


if __name__ == "__main__":
    main()
