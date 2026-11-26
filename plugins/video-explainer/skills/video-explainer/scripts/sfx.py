"""Procedural motion-graphics sound effects and ambient synth score engine.
Synthesizes studio-clean motion cues (whooshes, sub-drops, risers, rumbles, chimes, pops, ticks)
and speech-pocketed ambient pads in pure NumPy at 48 kHz stereo with zero external assets or API keys."""
import hashlib, re
import numpy as np

SR = 48000

CHORD_BANKS = {
    "cosmic": [
        (73.42, 146.83, 220.00, 261.63, 329.63, 440.00),   # Dm9
        (58.27, 116.54, 174.61, 220.00, 293.66, 392.00),   # Bbmaj9(#11)
        (87.31, 174.61, 261.63, 329.63, 392.00, 523.25),   # Fmaj9
        (65.41, 130.81, 196.00, 246.94, 293.66, 392.00),   # Cmaj9
    ],
    "warm": [
        (87.31, 174.61, 220.00, 261.63, 392.00),           # Fmaj9
        (73.42, 146.83, 220.00, 261.63, 329.63),           # Dm9
        (58.27, 116.54, 174.61, 220.00, 293.66),           # Bbmaj7
        (65.41, 130.81, 196.00, 220.00, 329.63),           # C6/9
    ],
    "minimal": [
        (73.42, 146.83, 220.00, 329.63),                   # D5 add9
        (65.41, 130.81, 196.00, 293.66),                   # C5 add9
        (58.27, 116.54, 174.61, 261.63),                   # Bb5 add9
        (65.41, 130.81, 196.00, 293.66),                   # C5 add9
    ],
}


def _one_pole_lp(x, cutoff_hz, sr=SR):
    """Fast vectorized-chunk or recursive 1-pole low-pass filter; keeps speech band uncluttered."""
    rc = 1.0 / (2.0 * np.pi * max(20.0, float(cutoff_hz)))
    dt = 1.0 / sr
    alpha = dt / (rc + dt)
    # Use scipy-free fast IIR via block convolution approximation when long, exact loop when short.
    n = len(x)
    if n <= sr * 3:
        out = np.empty_like(x)
        y = 0.0
        for i in range(n):
            y += alpha * (x[i] - y)
            out[i] = y
        return out
    # Impulse response of 1-pole LP decays to < -90 dB within ~10 time constants
    ir_len = min(4096, max(32, int(10.0 / alpha)))
    k = np.arange(ir_len, dtype=np.float64)
    ir = alpha * ((1.0 - alpha) ** k)
    ir /= np.sum(ir)
    if x.ndim == 2:
        return np.column_stack([np.convolve(x[:, c], ir, mode="same") for c in range(x.shape[1])])
    return np.convolve(x, ir, mode="same")


def _stereo_pan(mono, pan=0.0):
    """Equal-power stereo panner (-1.0 left .. +1.0 right)."""
    p = float(np.clip(pan, -1.0, 1.0))
    angle = (p + 1.0) * (np.pi / 4.0)
    return np.column_stack([mono * np.cos(angle), mono * np.sin(angle)])


def _fade_edges(sig, attack_s=0.008, release_s=0.03, sr=SR):
    n = len(sig)
    na = min(n // 2, max(1, int(attack_s * sr)))
    nr = min(n // 2, max(1, int(release_s * sr)))
    env = np.ones(n, dtype=np.float64)
    env[:na] = 0.5 * (1.0 - np.cos(np.pi * np.linspace(0.0, 1.0, na)))
    env[-nr:] = 0.5 * (1.0 + np.cos(np.pi * np.linspace(0.0, 1.0, nr)))
    return sig * env[:, None] if sig.ndim == 2 else sig * env


def _stereo_wash(stereo, sr=SR):
    """Lush stereo feedback delay wash (Haas + multi-tap) so pads and chimes sit wide around center speech."""
    n = len(stereo)
    out = stereo.copy()
    taps = ((0.113, 0.26, 0), (0.179, 0.22, 1), (0.293, 0.16, 1), (0.419, 0.12, 0))
    for delay_s, gain, swap in taps:
        d = int(delay_s * sr)
        if d < n:
            src = stereo[:-d, ::-1] if swap else stereo[:-d]
            out[d:] += src * gain
    return out


def synth_ambient_score(duration, mood="cosmic", sr=SR):
    """Generate a warm, slow-evolving stereo ambient synth bed pocketed below/around spoken voice."""
    n = max(1, int(round(duration * sr)))
    chords = CHORD_BANKS.get((mood or "cosmic").lower(), CHORD_BANKS["cosmic"])
    chord_dur = 8.5
    n_slots = max(1, int(np.ceil(duration / chord_dur)) + 1)
    left = np.zeros(n, dtype=np.float64)
    right = np.zeros(n, dtype=np.float64)
    xfade = 2.4

    for slot in range(n_slots):
        t0 = slot * chord_dur - (xfade if slot > 0 else 0.0)
        t1 = (slot + 1) * chord_dur + xfade
        i0 = max(0, int(t0 * sr))
        i1 = min(n, int(t1 * sr))
        if i1 <= i0:
            continue
        m = i1 - i0
        t = np.arange(m, dtype=np.float64) / sr
        freqs = chords[slot % len(chords)]

        # Smooth raised-cosine crossfade envelope per chord
        env = np.ones(m, dtype=np.float64)
        fi = min(m // 2, int(xfade * sr)) if slot > 0 else min(m // 3, int(1.1 * sr))
        fo = min(m // 2, int(xfade * sr))
        if fi > 1:
            env[:fi] = 0.5 * (1.0 - np.cos(np.pi * np.linspace(0.0, 1.0, fi)))
        if fo > 1:
            env[-fo:] = 0.5 * (1.0 + np.cos(np.pi * np.linspace(0.0, 1.0, fo)))

        chord_l = np.zeros(m, dtype=np.float64)
        chord_r = np.zeros(m, dtype=np.float64)
        for idx, f in enumerate(freqs):
            # Weight bass/low-mid warmly; keep upper voices delicate so 1-3 kHz stays clear for speech
            weight = 0.42 if idx == 0 else (0.30 if idx == 1 else 0.16 / (1 + 0.32 * (idx - 2)))
            detune = 1.0022 if (idx % 2 == 0) else 0.9978
            ph_l = 0.7 * idx + 0.4 * slot
            ph_r = 1.9 * idx + 0.9 * slot
            lfo = 0.85 + 0.15 * np.sin(2.0 * np.pi * (0.09 + 0.02 * idx) * t + idx)
            sig_l = np.sin(2.0 * np.pi * f * t + ph_l) + 0.22 * np.sin(2.0 * np.pi * (f * 2.0) * t + ph_l * 1.3)
            sig_r = np.sin(2.0 * np.pi * (f * detune) * t + ph_r) + 0.22 * np.sin(2.0 * np.pi * (f * 2.0 / detune) * t + ph_r * 1.3)
            chord_l += weight * lfo * sig_l
            chord_r += weight * lfo * sig_r

        left[i0:i1] += chord_l * env
        right[i0:i1] += chord_r * env

    bed = np.column_stack([left, right])
    bed = _one_pole_lp(bed, cutoff_hz=680.0, sr=sr)
    bed = _stereo_wash(bed, sr=sr)
    peak = np.max(np.abs(bed)) + 1e-9
    return _fade_edges(bed / peak * 0.22, attack_s=0.8, release_s=1.2, sr=sr)


def synth_cue(kind, intensity=1.0, pan=0.0, duration=None, seed=0, sr=SR):
    """Synthesize a single stereo sound effect cue at 48 kHz."""
    kind = (kind or "tap").strip().lower()
    gain = float(np.clip(intensity, 0.05, 2.0))
    rng = np.random.default_rng(101 + abs(hash((kind, seed))) % 10000)

    if kind == "tap":
        n = int((duration or 0.045) * sr)
        x = rng.standard_normal(n) * np.exp(-np.linspace(0, 9.5, n))
        x = np.convolve(x, np.ones(18) / 18, "same")
        x /= np.max(np.abs(x)) + 1e-9
        return _stereo_pan(x * 0.045 * gain, pan)

    if kind == "tick":
        n = int((duration or 0.038) * sr)
        t = np.arange(n, dtype=np.float64) / sr
        # Crisp watch/counter tick: short damped 1.4 kHz + 2.9 kHz woody transient
        x = (0.7 * np.sin(2 * np.pi * 1380 * t) + 0.3 * np.sin(2 * np.pi * 2850 * t)) * np.exp(-t * 135.0)
        x /= np.max(np.abs(x)) + 1e-9
        return _fade_edges(_stereo_pan(x * 0.048 * gain, pan), 0.001, 0.008, sr)

    if kind == "pop":
        n = int((duration or 0.095) * sr)
        t = np.arange(n, dtype=np.float64) / sr
        # Warm marimba/bubble upward-then-soft pitch pop
        freq = 250.0 + 230.0 * np.exp(-t * 36.0)
        phase = 2.0 * np.pi * np.cumsum(freq) / sr
        x = np.sin(phase) * np.exp(-t * 34.0)
        x /= np.max(np.abs(x)) + 1e-9
        return _fade_edges(_stereo_pan(x * 0.072 * gain, pan), 0.002, 0.02, sr)

    if kind in ("air", "whoosh", "pan"):
        dur = duration or (0.30 if kind == "air" else 0.46)
        n = int(dur * sr)
        t = np.linspace(0.0, 1.0, n)
        noise = rng.standard_normal(n)
        # Smooth swept low-pass + high-pass (soft velvet air, zero harsh hiss)
        low1 = _one_pole_lp(noise, 950.0 if kind == "whoosh" else 620.0, sr)
        low2 = _one_pole_lp(low1, 180.0, sr)
        band = low1 - 0.72 * low2
        # Add subtle tonal air body so camera movement feels physical
        f_glide = 130.0 + 150.0 * np.sin(np.pi * t)
        tonal = 0.22 * np.sin(2.0 * np.pi * np.cumsum(f_glide) / sr)
        env = np.sin(np.pi * t) ** 1.7
        mono = (band / (np.max(np.abs(band)) + 1e-9) + tonal) * env
        mono /= np.max(np.abs(mono)) + 1e-9
        amp = (0.035 if kind == "air" else 0.075) * gain
        # Dynamic stereo pan glide across the whoosh
        p0 = np.clip(pan - 0.35, -0.9, 0.9)
        p1 = np.clip(pan + 0.35, -0.9, 0.9)
        angles = (np.linspace(p0, p1, n) + 1.0) * (np.pi / 4.0)
        return np.column_stack([mono * np.cos(angles), mono * np.sin(angles)]) * amp

    if kind == "zoom":
        dur = duration or 0.54
        n = int(dur * sr)
        t = np.linspace(0.0, 1.0, n)
        noise = _one_pole_lp(rng.standard_normal(n), 780.0, sr)
        noise /= np.max(np.abs(noise)) + 1e-9
        f_glide = 92.0 + 190.0 * (t ** 1.4)
        body = np.sin(2.0 * np.pi * np.cumsum(f_glide) / sr)
        env = np.sin(np.pi * t) ** 1.5
        mono = (0.58 * noise + 0.42 * body) * env
        mono /= np.max(np.abs(mono)) + 1e-9
        return _stereo_pan(mono * 0.078 * gain, pan)

    if kind in ("impact", "boom", "sub_drop"):
        dur = duration or (1.15 if kind == "sub_drop" else (0.95 if kind == "boom" else 0.72))
        n = int(dur * sr)
        t = np.arange(n, dtype=np.float64) / sr
        f_start = 128.0 if kind == "sub_drop" else (105.0 if kind == "boom" else 94.0)
        f_end = 28.0 if kind == "sub_drop" else 33.0
        decay = 4.2 if kind == "sub_drop" else (4.8 if kind == "boom" else 6.5)
        freq = f_end + (f_start - f_end) * np.exp(-t * 11.5)
        phase = 2.0 * np.pi * np.cumsum(freq) / sr
        sub = np.tanh(1.45 * np.sin(phase)) * np.exp(-t * decay)
        # Soft low-passed air bloom on impact
        thud = _one_pole_lp(rng.standard_normal(n), 420.0 if kind == "boom" else 310.0, sr)
        thud = (thud / (np.max(np.abs(thud)) + 1e-9)) * np.exp(-t * (6.0 if kind == "boom" else 12.0))
        mono = 0.76 * sub + 0.24 * thud
        mono /= np.max(np.abs(mono)) + 1e-9
        amp = (0.155 if kind == "boom" else 0.135) * gain
        return _stereo_wash(_fade_edges(_stereo_pan(mono * amp, pan), 0.005, 0.06, sr), sr)

    if kind == "riser":
        dur = duration or 1.15
        n = int(dur * sr)
        t = np.linspace(0.0, 1.0, n)
        f1 = 110.0 * (2.0 ** (t * 1.25))
        f2 = 164.81 * (2.0 ** (t * 1.25))
        harm = 0.6 * np.sin(2 * np.pi * np.cumsum(f1) / sr) + 0.4 * np.sin(2 * np.pi * np.cumsum(f2) / sr)
        air = _one_pole_lp(rng.standard_normal(n), 1100.0, sr)
        air /= np.max(np.abs(air)) + 1e-9
        env = (t ** 2.1) * np.sin(np.pi * np.minimum(1.0, (1.0 - t) * 14.0 + 0.01))
        mono = (0.55 * harm + 0.45 * air) * (t ** 2.0)
        mono /= np.max(np.abs(mono)) + 1e-9
        return _fade_edges(_stereo_pan(mono * 0.082 * gain, pan), 0.04, 0.03, sr)

    if kind == "rumble":
        dur = duration or 1.90
        n = int(dur * sr)
        t = np.arange(n, dtype=np.float64) / sr
        noise = _one_pole_lp(rng.standard_normal(n), 95.0, sr)
        noise /= np.max(np.abs(noise)) + 1e-9
        drone = 0.55 * np.sin(2 * np.pi * 46.25 * t) + 0.45 * np.sin(2 * np.pi * 69.3 * t + 0.6 * np.sin(2 * np.pi * 3.2 * t))
        env = np.sin(np.pi * np.linspace(0.0, 1.0, n)) ** 1.1
        mono = (0.55 * noise + 0.45 * drone) * env
        mono /= np.max(np.abs(mono)) + 1e-9
        return _fade_edges(_stereo_pan(mono * 0.095 * gain, pan), 0.08, 0.12, sr)

    if kind == "chime":
        dur = duration or 0.85
        n = int(dur * sr)
        t = np.arange(n, dtype=np.float64) / sr
        # Warm celesta fifth (D5 + A5 + soft F#6/E6 shimmer)
        x = (
            0.55 * np.sin(2 * np.pi * 587.33 * t) * np.exp(-t * 4.5)
            + 0.30 * np.sin(2 * np.pi * 880.00 * t) * np.exp(-t * 6.0)
            + 0.15 * np.sin(2 * np.pi * 1318.51 * t) * np.exp(-t * 8.5)
        )
        x /= np.max(np.abs(x)) + 1e-9
        return _stereo_wash(_fade_edges(_stereo_pan(x * 0.072 * gain, pan), 0.004, 0.05, sr), sr)

    if kind == "shimmer":
        dur = duration or 1.25
        n = int(dur * sr)
        out = np.zeros((n, 2), dtype=np.float64)
        notes = (587.33, 659.25, 880.00, 1046.50, 1318.51)   # D5 E5 A5 C6 E6
        for idx, f in enumerate(notes):
            i0 = int(idx * 0.065 * sr)
            if i0 >= n:
                break
            m = n - i0
            t = np.arange(m, dtype=np.float64) / sr
            note = np.sin(2 * np.pi * f * t) * np.exp(-t * (4.2 + 0.5 * idx))
            p = np.clip(pan + (-0.45 + 0.22 * idx), -0.85, 0.85)
            out[i0:] += _fade_edges(_stereo_pan(note, p), 0.003, 0.04, sr)
        out /= np.max(np.abs(out)) + 1e-9
        return _stereo_wash(out * 0.078 * gain, sr)

    if kind == "pulse":
        dur = duration or 0.42
        n = int(dur * sr)
        t = np.arange(n, dtype=np.float64) / sr
        # Rhythmic magnetic pulsar ping
        x = np.zeros(n, dtype=np.float64)
        for offset, amp_k in ((0.0, 1.0), (0.16, 0.55)):
            i0 = int(offset * sr)
            if i0 < n:
                tt = t[: n - i0]
                ping = (0.65 * np.sin(2 * np.pi * 330.0 * tt) + 0.35 * np.sin(2 * np.pi * 660.0 * tt)) * np.exp(-tt * 18.0)
                x[i0:] += amp_k * ping
        x /= np.max(np.abs(x)) + 1e-9
        return _stereo_wash(_fade_edges(_stereo_pan(x * 0.068 * gain, pan), 0.003, 0.03, sr), sr)

    # Fallback gentle tap
    return synth_cue("tap", intensity=gain, pan=pan, sr=sr)


def _norm_tok(w):
    return re.sub(r"[^\w]+", "", str(w).lower())


def resolve_cue_time(spec, scenes, words, total_dur):
    """Resolve a ## Sound anchor into seconds:
      - '12.40'                 -> 12.40s
      - '@s05+1.20' / '@s05'    -> scene s05 start + 1.20s
      - '@s05:iron'             -> exact start of word/phrase 'iron' in scene s05 (fallback: midpoint)
      - '@s06:supernova-0.90'   -> 0.90s before spoken 'supernova' in scene s06
    """
    raw = spec.strip()
    if not raw.startswith("@"):
        return max(0.0, min(total_dur, float(raw)))

    body = raw[1:]
    offset = 0.0
    m_off = re.search(r"([+-]\d+(?:\.\d+)?)\s*$", body)
    if m_off:
        offset = float(m_off.group(1))
        body = body[: m_off.start()].strip()

    sid, _, phrase = body.partition(":")
    sid = sid.strip()
    phrase = phrase.strip()
    sc = next((s for s in scenes if s["id"] == sid), None)
    if sc is None:
        return max(0.0, min(total_dur, offset))

    if not phrase:
        return max(0.0, min(total_dur, sc["start"] + offset))

    targets = [_norm_tok(t) for t in phrase.split() if _norm_tok(t)]
    local_words = [w for w in words if w["end"] > sc["start"] and w["start"] < sc["end"]]
    if targets and local_words:
        toks = [_norm_tok(w["text"]) for w in local_words]
        k = len(targets)
        for i in range(len(toks) - k + 1):
            if toks[i:i + k] == targets:
                return max(0.0, min(total_dur, float(local_words[i]["start"]) + offset))
        # Prefix / substring match fallback (e.g. 'quarter' matching 'quarter-second' or 'kilometers')
        for i, tok in enumerate(toks):
            if tok.startswith(targets[0]) or targets[0] in tok:
                return max(0.0, min(total_dur, float(local_words[i]["start"]) + offset))

    # Proportional fallback when Voice: none or phrase not aligned
    fallback = sc["start"] + 0.35 * (sc["end"] - sc["start"]) + offset
    return max(0.0, min(total_dur, fallback))


def parse_sound_line(line, line_no=0):
    """Parse '- @s05:iron: rumble 0.8 2.2s pan=-0.3' -> dict(anchor, kind, intensity, duration, pan)."""
    s = re.sub(r"^-\s*", "", line.strip())
    # Split on the LAST ': ' or ':' that separates anchor from cue spec
    # Anchors look like '12.4', '@s01', '@s01+0.5', '@s05:iron', '@s06:quarter of a second-0.4'
    m = re.match(r"^(@[A-Za-z0-9_-]+(?::[^:]+?)?(?:[+-]\d+(?:\.\d+)?)?|\d+(?:\.\d+)?)\s*:\s*(.+)$", s)
    if not m:
        raise ValueError(f"script.md line {line_no}: sound cue must look like '- @s03:word: chime 0.8', got '{line.strip()}'")
    anchor, rest = m.group(1).strip(), m.group(2).strip()
    tokens = rest.split()
    if not tokens:
        raise ValueError(f"script.md line {line_no}: missing sound effect name in '{line.strip()}'")
    kind = tokens[0].lower()
    intensity = 1.0
    duration = None
    pan = 0.0
    for tok in tokens[1:]:
        low = tok.lower()
        if low.startswith("pan="):
            pan = float(low.split("=", 1)[1])
        elif low.startswith("dur="):
            duration = float(low.split("=", 1)[1].rstrip("s"))
        elif low.endswith("s") and re.fullmatch(r"\d+(?:\.\d+)?s", low):
            duration = float(low[:-1])
        elif re.fullmatch(r"\d+(?:\.\d+)?", low):
            intensity = float(low)
    return {"anchor": anchor, "kind": kind, "intensity": intensity, "duration": duration, "pan": pan, "line": line_no}
