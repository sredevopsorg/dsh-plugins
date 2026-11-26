#!/bin/bash
# Check what Video Explainer needs and report it. This script NEVER installs anything:
# it prints each missing tool or asset with the exact command that prepares it and
# exits 1, so the agent can ask the user before anything is downloaded or installed.
#
# usage: setup.sh [--voice] [--json]
#   --voice   also check the optional local narration stack (Kokoro TTS + Parakeet alignment)
#   --json    print one JSON object instead of human-readable lines
#
# DSH adaptation (documented in plugins/video-explainer/docs/UPSTREAM.md): upstream
# downloaded headless Chrome (~390 MB), installed Python packages, and fetched models
# on every first run. That is now an explicit, user-approved step, so upstream's
# bootstrap flags are reported as `bootstrap[]` commands and nothing executes them.
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
WITH_VOICE=0
JSON=0
for arg in "$@"; do
  case "$arg" in
    --voice) WITH_VOICE=1 ;;
    --json) JSON=1 ;;
    *) echo "usage: setup.sh [--voice] [--json]" >&2; exit 2 ;;
  esac
done

HF=hyperframes@0.9.79
HYPERFRAMES_BIN="${HYPERFRAMES:-npx -y $HF}"
VENV="${VIDEO_EXPLAINER_VENV:-$HOME/.cache/video-explainer/venv}"
THREE_CACHE="$HOME/.cache/video-explainer/vendor/three.min.js"

if [ "$(uname)" = Darwin ]; then hint() { echo "brew install $1"; }; else hint() { echo "$2"; }; fi

missing=()
optional=()
bootstrap=()
notes=()

command -v ffmpeg >/dev/null || missing+=("ffmpeg|$(hint ffmpeg 'sudo apt install ffmpeg')|mix audio and encode video")
command -v ffprobe >/dev/null || missing+=("ffprobe|$(hint ffmpeg 'sudo apt install ffmpeg')|probe renders for QA and the review page")
command -v python3 >/dev/null || missing+=("python3|$(hint python 'sudo apt install python3 python3-venv')|run the pipeline scripts")
if command -v node >/dev/null; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
  if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 22 ]; then
    missing+=("node|$(hint node 'Node 22+ from https://nodejs.org')|HyperFrames needs Node 22 or newer (found $(node -v 2>/dev/null))")
  fi
else
  missing+=("node|$(hint node 'Node 22+ from https://nodejs.org')|HyperFrames needs Node 22 or newer")
fi

if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c "import numpy" 2>/dev/null; then
  VENV_PY="$VENV/bin/python"
  notes+=("venv: $VENV")
else
  VENV_PY=""
  if command -v uv >/dev/null; then
    missing+=("venv|uv venv -p 3.12 \"$VENV\" && uv pip install -r \"$ROOT/requirements.txt\" -p \"$VENV/bin/python\"|the isolated Python environment the scripts run in (numpy)")
  else
    missing+=("venv|python3 -m venv \"$VENV\" && \"$VENV/bin/pip\" install --disable-pip-version-check -r \"$ROOT/requirements.txt\"|the isolated Python environment the scripts run in (numpy)")
  fi
fi

# The HyperFrames renderer is pinned to one version; report how it is provided.
if [ -n "${HYPERFRAMES:-}" ]; then
  notes+=("hyperframes: $HYPERFRAMES (HYPERFRAMES override)")
elif command -v npx >/dev/null; then
  if [ -f "$THREE_CACHE" ]; then
    notes+=("hyperframes: npx -y $HF (pinned; Chrome availability is checked by the first render)")
  else
    notes+=("hyperframes: npx -y $HF (pinned)")
  fi
  bootstrap+=("npx -y $HF browser ensure|download HyperFrames' pinned headless Chrome (~390 MB) once")
else
  missing+=("npx|$(hint node 'Node 22+ from https://nodejs.org')|run HyperFrames")
fi

if [ ! -f "$THREE_CACHE" ]; then
  optional+=("three.js r149|curl -fsSL https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js -o \"$THREE_CACHE\"|cache the 3D engine for Mode: 3d (build.py downloads it on demand)")
fi

if [ "$WITH_VOICE" = 1 ]; then
  if [ -n "$VENV_PY" ] && "$VENV_PY" -c "import kokoro_onnx, soundfile" 2>/dev/null; then
    notes+=("voice: kokoro-onnx + soundfile installed")
  elif command -v uv >/dev/null; then
    missing+=("kokoro|uv pip install -r \"$ROOT/requirements-voice.txt\" -p \"$VENV/bin/python\"|generate local voiceover with Kokoro")
  else
    missing+=("\"$VENV/bin/pip\" install --disable-pip-version-check -r \"$ROOT/requirements-voice.txt\"|generate local voiceover with Kokoro")
  fi
  bootstrap+=("npx -y $HF models install parakeet|download the Parakeet speech model for word alignment (~590 MB)")
fi

command -v yt-dlp >/dev/null || optional+=("yt-dlp|$(hint yt-dlp 'pipx install yt-dlp')|pull web video clips for clip: scenes")
command -v blender >/dev/null || optional+=("blender|$(hint blender 'download from https://www.blender.org')|sculpt or fracture custom 3D meshes")
if [ -n "${GEMINI_API_KEY:-}" ] || [ -n "${GOOGLE_API_KEY:-}" ]; then
  notes+=("gemini: API key present in the environment")
elif [ -f "$HOME/.config/video-explainer/.env" ]; then
  notes+=("gemini: key file found at ~/.config/video-explainer/.env")
else
  optional+=("GEMINI_API_KEY|put GEMINI_API_KEY=... in ~/.config/video-explainer/.env|Gemini TTS voiceover and Lyria music")
fi

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}

# missing/optional entries are "<name>|<command>|<why>"; bootstrap entries are
# "<command>|<why>"; notes entries are free-form strings.
json_list() {
  local kind="$1" first=1 item name cmd why
  shift
  printf '['
  for item in "$@"; do
    [ "$first" = 1 ] || printf ','
    first=0
    case "$kind" in
      bootstrap)
        IFS='|' read -r cmd why <<<"$item"
        printf '{"command":%s,"why":%s}' "$(json_escape "$cmd")" "$(json_escape "$why")"
        ;;
      notes)
        printf '%s' "$(json_escape "$item")"
        ;;
      *)
        IFS='|' read -r name cmd why <<<"$item"
        printf '{"name":%s,"command":%s,"why":%s}' "$(json_escape "$name")" "$(json_escape "$cmd")" "$(json_escape "$why")"
        ;;
    esac
  done
  printf ']'
}

if [ "$JSON" = 1 ]; then
  printf '{"ok":%s,"voice":%s,"missing":%s,"optional":%s,"bootstrap":%s,"notes":%s,"installed":false}\n' \
    "$([ ${#missing[@]} -eq 0 ] && echo true || echo false)" \
    "$([ "$WITH_VOICE" = 1 ] && echo true || echo false)" \
    "$(json_list missing "${missing[@]+"${missing[@]}"}")" \
    "$(json_list optional "${optional[@]+"${optional[@]}"}")" \
    "$(json_list bootstrap "${bootstrap[@]+"${bootstrap[@]}"}")" \
    "$(json_list notes "${notes[@]+"${notes[@]}"}")"
else
  echo "Video Explainer preflight: nothing is installed by this script."
  if [ ${#missing[@]} -gt 0 ]; then
    echo
    echo "Missing (ask the user before installing):"
    for item in "${missing[@]}"; do
      IFS='|' read -r name cmd why <<<"$item"
      echo "  - $name: $why"
      echo "      $cmd"
    done
  fi
  if [ ${#bootstrap[@]} -gt 0 ]; then
    echo
    echo "One-time downloads the first render needs (ask the user first):"
    for item in "${bootstrap[@]}"; do
      IFS='|' read -r cmd why <<<"$item"
      echo "  - $why"
      echo "      $cmd"
    done
  fi
  if [ ${#optional[@]} -gt 0 ]; then
    echo
    echo "Optional:"
    for item in "${optional[@]}"; do
      IFS='|' read -r name cmd why <<<"$item"
      echo "  - $name: $why"
      echo "      $cmd"
    done
  fi
  if [ ${#notes[@]} -gt 0 ]; then
    echo
    echo "Environment:"
    for note in "${notes[@]}"; do echo "  - $note"; done
  fi
  echo
  if [ ${#missing[@]} -eq 0 ]; then
    echo "ready: every required tool is present"
  else
    echo "not ready: ${#missing[@]} required item(s) missing"
  fi
fi

[ ${#missing[@]} -eq 0 ] || exit 1
exit 0
