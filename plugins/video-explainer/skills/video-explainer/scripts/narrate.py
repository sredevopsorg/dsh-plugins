"""Synthesize or align narration for script.md, producing work/narration.wav, work/words.json, and work/transcript.md.
usage: narrate.py PROJECT [--no-sync]
Supports:
  Voice: none               (unvoiced mode; validates explicit scene durations, writes silent narration.wav)
  Voice: kokoro[:voice_id]  (local Kokoro-82M via HyperFrames, cached per scene, synced via Parakeet)
  Voice: gemini[:voice]     (cloud Gemini TTS via GEMINI_API_KEY, cached per scene, synced via Parakeet)
  Voice: path/to/audio.m4a  (bring-your-own recording, aligned via Parakeet)"""
import argparse, base64, hashlib, importlib.util, json, os, re, subprocess, sys, tempfile, urllib.error, urllib.request, wave

import numpy as np
from common import (FPS, SETTINGS_ENV, captions_enabled, die, energy_db, frames, hf_cmd, hf_env,
                    parse_json_output, parse_script, probe, project_paths, read_wav_mono, resolve_voice,
                    run, setting, settings_key, silence_threshold, validate_scenes)

SR = 48000
SAMPLES_PER_FRAME = SR // FPS   # 1600 exact samples per frame at 48 kHz / 30 fps
API = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_TTS_MODEL = "gemini-3.8-flash-tts"
_PARAKEET_READY = False
_KOKORO_MODEL = None


def write_wav_mono(path, pcm_float):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    clipped = np.clip(pcm_float, -1.0, 1.0)
    int16 = (clipped * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(int16.tobytes())


def ensure_parakeet():
    global _PARAKEET_READY
    if _PARAKEET_READY:
        return
    p = subprocess.run(hf_cmd("models", "list", "--json"), capture_output=True, text=True, env=hf_env())
    if p.returncode == 0:
        data = parse_json_output(p.stdout, "hyperframes models list")
        for m in data.get("models", []):
            if m.get("engine") == "parakeet" and m.get("installed"):
                _PARAKEET_READY = True
                return
    r = subprocess.run(hf_cmd("models", "install", "parakeet"), capture_output=True, text=True, env=hf_env())
    if r.returncode:
        die("could not install Parakeet model:\n" + (r.stdout + r.stderr)[-800:])
    _PARAKEET_READY = True


def trim_ends(words, audio_path, hop=0.01):
    """End each word where speech energy actually drops, avoiding trailing dead air in word timings."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "voice16k.wav")
        run(["ffmpeg", "-v", "error", "-y", "-i", audio_path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav])
        db = energy_db(*read_wav_mono(wav), hop_s=hop)
    thr = silence_threshold(db)
    for w in words:
        k = min(len(db) - 1, int(w["end"] / hop))
        floor = int((w["start"] + 0.08) / hop)
        while k > floor and db[k] < thr:
            k -= 1
        w["end"] = round(min(w["end"], max(w["start"] + 0.08, k * hop + 0.05)), 3)
    return words


def align_words(audio_path):
    ensure_parakeet()
    with tempfile.TemporaryDirectory() as tmp:
        p = subprocess.run(
            hf_cmd("transcribe", os.path.abspath(audio_path), "--engine", "parakeet", "--json", "-d", tmp),
            capture_output=True, text=True, env=hf_env(),
        )
        if p.returncode:
            die("Parakeet alignment failed. Run setup.sh --voice.\n" + (p.stdout + p.stderr)[-800:])
        info = parse_json_output(p.stdout, "hyperframes transcribe")
        raw_words = json.load(open(info["transcriptPath"], encoding="utf-8"))
    words = [
        {"text": w["text"].strip(), "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3)}
        for w in raw_words if w.get("text", "").strip()
    ]
    return trim_ends(words, audio_path)


def _kokoro_split_create(model, text, voice_id, speed):
    try:
        return model.create(text, voice=voice_id, speed=float(speed))
    except IndexError as err:
        if "size 510" not in str(err) or len(text) < 2:
            raise
        mid = len(text) // 2
        cuts = [i + 1 for i, ch in enumerate(text) if (ch in "。！？!?\n" or ch.isspace()) and 0 < i < len(text) - 1]
        at = min(cuts, key=lambda i: abs(i - mid)) if cuts else mid
        ls, lr = _kokoro_split_create(model, text[:at], voice_id, speed)
        rs, _ = _kokoro_split_create(model, text[at:], voice_id, speed)
        return np.concatenate([np.asarray(ls), np.asarray(rs)]), lr


def synth_kokoro(text, voice_id, speed, out_wav):
    global _KOKORO_MODEL
    if not importlib.util.find_spec("kokoro_onnx") or not importlib.util.find_spec("soundfile"):
        die("Kokoro TTS requires kokoro-onnx and soundfile. Run setup.sh --voice first.")
    model_path = os.path.expanduser("~/.cache/hyperframes/tts/models/kokoro-v1.0.onnx")
    voices_path = os.path.expanduser("~/.cache/hyperframes/tts/voices/voices-v1.0.bin")
    if os.path.isfile(model_path) and os.path.isfile(voices_path):
        import kokoro_onnx, soundfile as sf
        if _KOKORO_MODEL is None:
            _KOKORO_MODEL = kokoro_onnx.Kokoro(model_path, voices_path)
        samples, sr = _kokoro_split_create(_KOKORO_MODEL, text, voice_id, speed)
        sf.write(out_wav, samples, sr)
        return
    with tempfile.TemporaryDirectory() as tmp:
        txt = os.path.join(tmp, "line.txt")
        open(txt, "w", encoding="utf-8").write(text)
        env = hf_env({"HYPERFRAMES_PYTHON": sys.executable})
        p = subprocess.run(
            hf_cmd("tts", "--text-file", txt, "-v", voice_id, "-s", str(speed), "-o", out_wav, "--json"),
            capture_output=True, text=True, env=env,
        )
        if p.returncode:
            die("Kokoro TTS failed:\n" + (p.stdout + p.stderr)[-800:])
        res = parse_json_output(p.stdout, "hyperframes tts")
        if not res.get("ok"):
            die(f"Kokoro TTS failed: {res.get('error', 'unknown error')}")


def _pcm_to_wav_bytes(pcm, mime):
    rate_m = re.search(r"(?:^|;)\s*rate=(\d+)(?:;|$)", mime or "", re.I)
    rate = int(rate_m.group(1)) if rate_m else 24000
    hdr = bytearray(44)
    hdr[0:4] = b"RIFF"
    hdr[4:8] = (36 + len(pcm)).to_bytes(4, "little")
    hdr[8:12] = b"WAVE"
    hdr[12:16] = b"fmt "
    hdr[16:20] = (16).to_bytes(4, "little")
    hdr[20:22] = (1).to_bytes(2, "little")
    hdr[22:24] = (1).to_bytes(2, "little")
    hdr[24:28] = rate.to_bytes(4, "little")
    hdr[28:32] = (rate * 2).to_bytes(4, "little")
    hdr[32:34] = (2).to_bytes(2, "little")
    hdr[34:36] = (16).to_bytes(2, "little")
    hdr[36:40] = b"data"
    hdr[40:44] = len(pcm).to_bytes(4, "little")
    return bytes(hdr) + pcm


def synth_gemini(text, voice_id, model, style_prompt, out_wav):
    key = settings_key()
    if not key:
        die(f"Voice: gemini needs GEMINI_API_KEY in env or {SETTINGS_ENV}")
    modern = model.startswith("gemini-3.8-")
    content = {
        "type": "text",
        "text": (f"Read the following text with this delivery: {style_prompt}\n\n{text}" if (not modern and style_prompt) else text),
    }
    if modern and style_prompt:
        content["annotations"] = [{"type": "speech_metadata", "style": style_prompt}]
    body = {
        "model": model,
        "input": [{"type": "user_input", "content": [content]}],
        "response_format": {"type": "audio", "mime_type": "audio/wav"} if modern else {"type": "audio"},
        "generation_config": {"speech_config": [{"voice": voice_id}]},
        "store": False,
    }
    req = urllib.request.Request(
        f"{API}/interactions",
        data=json.dumps(body).encode(),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")[:600].replace(key, "[redacted]")
        die(f"Gemini TTS HTTP {e.code}: {msg}")
    except Exception as e:
        die(f"Gemini TTS request failed: {str(e).replace(key, '[redacted]')}")

    for step in payload.get("steps", []):
        if step.get("type") == "model_output":
            for item in step.get("content", []):
                if item.get("type") == "audio" and item.get("data"):
                    raw = base64.b64decode(item["data"])
                    mime = item.get("mime_type", "")
                    if not modern and mime.lower().startswith("audio/l16"):
                        raw = _pcm_to_wav_bytes(raw, mime)
                    open(out_wav, "wb").write(raw)
                    return
    die(f"Gemini TTS returned no audio: {json.dumps(payload)[:400]}")


def trim_and_pad_scene(raw_audio, out_wav, is_last=False):
    """Trim leading/trailing dead air, add crisp natural breath margins, and quantize to exact video frames."""
    with tempfile.TemporaryDirectory() as tmp:
        mono = os.path.join(tmp, "mono.wav")
        run(["ffmpeg", "-v", "error", "-y", "-i", raw_audio, "-vn", "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", mono])
        pcm, _ = read_wav_mono(mono)
    hop_s = 0.01
    hop = int(SR * hop_s)
    db = energy_db(pcm, SR, hop_s=hop_s)
    thr = silence_threshold(db)
    active = np.where(db > thr)[0]
    if len(active):
        i0 = max(0, int(active[0] * hop - 0.04 * SR))
        i1 = min(len(pcm), int((active[-1] + 1) * hop + 0.08 * SR))
        core = pcm[i0:i1]
    else:
        core = pcm
    lead = np.zeros(int(0.08 * SR), dtype=np.float32)
    tail_s = 0.45 if is_last else 0.26
    trail = np.zeros(int(tail_s * SR), dtype=np.float32)
    combined = np.concatenate([lead, core, trail])
    n_frames = max(15, int(np.ceil(len(combined) / SAMPLES_PER_FRAME)))
    target_samples = n_frames * SAMPLES_PER_FRAME
    if len(combined) < target_samples:
        combined = np.concatenate([combined, np.zeros(target_samples - len(combined), dtype=np.float32)])
    else:
        combined = combined[:target_samples]
    write_wav_mono(out_wav, combined)
    return n_frames / FPS


def sync_script_times(script_path, updated_scenes):
    """Update start and end columns in script.md's ## Scenes table cleanly."""
    lines = open(script_path, encoding="utf-8").read().splitlines(keepends=True)
    by_line = {sc["line"]: sc for sc in updated_scenes}
    out = []
    for idx, line in enumerate(lines, 1):
        if idx in by_line:
            sc = by_line[idx]
            ending = "\n" if line.endswith("\n") else ""
            raw = line.rstrip("\r\n")
            lead_pipe = raw.startswith("|")
            trail_pipe = raw.endswith("|")
            parts = raw.strip("|").split("|")
            # Replace columns 1 (start) and 2 (end) assuming standard | id | start | end | ... |
            if len(parts) >= 4:
                parts[1] = f" {sc['start']:.2f} "
                parts[2] = f" {sc['end']:.2f} "
                rebuilt = "|".join(parts)
                if lead_pipe:
                    rebuilt = "|" + rebuilt
                if trail_pipe:
                    rebuilt = rebuilt + "|"
                out.append(rebuilt + ending)
                continue
        out.append(line)
    open(script_path, "w", encoding="utf-8").write("".join(out))


def format_scene_cues(words, scene_start):
    if not words:
        return "Cues (scene-local s): (none)"
    parts = [f"{w['text']}(+{max(0.0, w['start'] - scene_start):.2f})" for w in words]
    return "Cues (scene-local s): " + " ".join(parts)


def write_transcript(path, total_dur, scenes, narration_map, all_words):
    lines = [
        "# transcript",
        "",
        f"Duration: {total_dur:.2f}s ({frames(total_dur)} frames at {FPS} fps). Words: {len(all_words)}.",
        "Times inside `Cues` are scene-local seconds (+0.00s from each scene's start) for GSAP timing.",
        "",
    ]
    for sc in scenes:
        sid, t0, t1 = sc["id"], sc["start"], sc["end"]
        dur = t1 - t0
        lines.append(f"## {sid} [{t0:.2f}-{t1:.2f}] (duration: {dur:.2f}s)")
        spoken = narration_map.get(sid, "").strip()
        if spoken:
            lines.append(spoken)
        local_words = [w for w in all_words if w["end"] > t0 + 0.02 and w["start"] < t1 - 0.02]
        if local_words:
            lines.append(format_scene_cues(local_words, t0))
            if t0 > 0:
                g_parts = [f"{w['text']}(@{w['start']:.2f})" for w in local_words]
                lines.append("Cues (global s): " + " ".join(g_parts))
        lines.append("")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    open(path, "w", encoding="utf-8").write("\n".join(lines))


def proportional_words(scenes, narration_map):
    """Fallback word timing when Captions: on is paired with Voice: none."""
    out = []
    for sc in scenes:
        text = narration_map.get(sc["id"], "").strip()
        if not text:
            continue
        tokens = text.split()
        dur = sc["end"] - sc["start"]
        pad_l = min(0.12, dur * 0.1)
        pad_r = min(0.15, dur * 0.1)
        span = max(0.2, dur - pad_l - pad_r)
        weights = [max(2, len(t) + 1) for t in tokens]
        total_w = sum(weights)
        cur = sc["start"] + pad_l
        for tok, w in zip(tokens, weights):
            dt = span * (w / total_w)
            out.append({"text": tok, "start": round(cur, 3), "end": round(cur + dt * 0.9, 3)})
            cur += dt
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--no-sync", action="store_true", help="Do not update start/end times inside script.md")
    a = ap.parse_args()

    paths = project_paths(a.project)
    os.makedirs(paths["work"], exist_ok=True)
    script = parse_script(paths["script"])
    mode, voice_val = resolve_voice(script, paths["root"])

    if mode == "none":
        scenes = validate_scenes(script, paths["root"])
        total_dur = frames(scenes[-1]["end"]) / FPS
        write_wav_mono(paths["narration"], np.zeros(int(round(total_dur * SR)), dtype=np.float32))
        words = proportional_words(scenes, script["narration"]) if captions_enabled(script, paths["root"]) else []
        json.dump(words, open(paths["words"], "w", encoding="utf-8"), indent=1)
        write_transcript(paths["transcript"], total_dur, scenes, script["narration"], words)
        print(f"Unvoiced timeline ready: {len(scenes)} scenes, {total_dur:.2f}s -> {paths['transcript']}")
        return

    if mode == "file":
        if not os.path.isfile(voice_val):
            die(f"voice audio file not found: {voice_val}")
        run(["ffmpeg", "-v", "error", "-y", "-i", voice_val, "-vn", "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", paths["narration"]])
        _, _, dur = probe(paths["narration"])
        words = align_words(paths["narration"])
        json.dump(words, open(paths["words"], "w", encoding="utf-8"), indent=1)
        scenes = validate_scenes(script, paths["root"], dur)
        write_transcript(paths["transcript"], dur, scenes, script["narration"], words)
        print(f"Aligned {len(words)} words ({dur:.2f}s) -> {paths['words']} and {paths['transcript']}")
        return

    # mode in ("kokoro", "gemini")
    if not script["scenes"]:
        die("script.md has no rows under '## Scenes'")
    speed = float(setting(script, "voice speed", "1.0"))
    style_prompt = setting(script, "voice style", "")
    model = setting(script, "voice model", GEMINI_TTS_MODEL)
    cache_dir = os.path.join(paths["work"], "voice_cache")
    os.makedirs(cache_dir, exist_ok=True)

    pcm_chunks = []
    scene_meta = []
    cursor = 0.0
    n_scenes = len(script["scenes"])
    need_align = []
    for idx, sc in enumerate(script["scenes"]):
        sid = sc["id"]
        text = script["narration"].get(sid, "").strip()
        is_last = idx == n_scenes - 1
        if text:
            sig = json.dumps([mode, voice_val, speed, style_prompt if mode == "gemini" else "", model if mode == "gemini" else "", is_last, text])
            h = hashlib.sha256(sig.encode()).hexdigest()[:16]
            c_wav = os.path.join(cache_dir, f"{sid}-{h}.wav")
            c_words = os.path.join(cache_dir, f"{sid}-{h}.words.json")
            if not os.path.isfile(c_wav):
                with tempfile.TemporaryDirectory() as tmp:
                    raw = os.path.join(tmp, "raw.wav")
                    if mode == "kokoro":
                        synth_kokoro(text, voice_val, speed, raw)
                    else:
                        synth_gemini(text, voice_val, model, style_prompt, raw)
                    trim_and_pad_scene(raw, c_wav, is_last=is_last)
            pcm, _ = read_wav_mono(c_wav)
            dur = len(pcm) / SR
            if not os.path.isfile(c_words):
                need_align.append((idx, c_wav, c_words))
        else:
            c_wav, c_words = None, None
            dur_raw = (sc["end"] - sc["start"]) if (sc["start"] is not None and sc["end"] is not None and sc["end"] > sc["start"]) else 2.5
            n_fr = max(15, frames(dur_raw))
            pcm = np.zeros(n_fr * SAMPLES_PER_FRAME, dtype=np.float32)
            dur = n_fr / FPS

        pcm_chunks.append(pcm)
        t0, t1 = cursor, cursor + dur
        sc["start"] = round(t0, 2)
        sc["end"] = round(t1, 2)
        scene_meta.append((t0, t1, c_words))
        cursor = t1

    full_pcm = np.concatenate(pcm_chunks) if pcm_chunks else np.zeros(SAMPLES_PER_FRAME, dtype=np.float32)
    write_wav_mono(paths["narration"], full_pcm)
    total_dur = len(full_pcm) / SR
    script["scenes"][-1]["end"] = round(total_dur, 2)

    if len(need_align) >= 2:
        # Single-pass Parakeet alignment across the full WAV (~8x faster than per-scene subprocesses)
        full_words = align_words(paths["narration"])
        for idx, _, c_words in need_align:
            t0, t1, _ = scene_meta[idx]
            # Scenes tile the WAV, so slice by half-open [t0, t1) windows; padding both ends gave a
            # boundary word to two scenes. Only the outer ends of the WAV get slack.
            lo = float("-inf") if idx == 0 else t0
            hi = float("inf") if idx == len(scene_meta) - 1 else t1
            sliced = [
                {
                    "text": w["text"],
                    "start": round(max(0.0, w["start"] - t0), 3),
                    "end": round(max(0.04, min(t1 - t0, w["end"] - t0)), 3),
                }
                for w in full_words
                if lo <= 0.5 * (w["start"] + w["end"]) < hi
            ]
            json.dump(sliced, open(c_words, "w", encoding="utf-8"), indent=1)
    elif len(need_align) == 1:
        _, c_wav, c_words = need_align[0]
        json.dump(align_words(c_wav), open(c_words, "w", encoding="utf-8"), indent=1)

    all_words = []
    for t0, _, c_words in scene_meta:
        if c_words and os.path.isfile(c_words):
            for k, w in enumerate(json.load(open(c_words, encoding="utf-8"))):
                prev = all_words[-1] if all_words else None
                if k == 0 and prev and prev["text"] == w["text"] and w["start"] + t0 - prev["end"] < 0.05:
                    continue  # a boundary word cached in both adjacent scenes
                all_words.append({
                    "text": w["text"],
                    "start": round(w["start"] + t0, 3),
                    "end": round(w["end"] + t0, 3),
                })

    json.dump(all_words, open(paths["words"], "w", encoding="utf-8"), indent=1)
    if not a.no_sync:
        sync_script_times(paths["script"], script["scenes"])
    write_transcript(paths["transcript"], total_dur, script["scenes"], script["narration"], all_words)
    print(f"Narrated {n_scenes} scenes ({mode}:{voice_val}), {len(all_words)} words, {total_dur:.2f}s -> {paths['transcript']}")


if __name__ == "__main__":
    main()
