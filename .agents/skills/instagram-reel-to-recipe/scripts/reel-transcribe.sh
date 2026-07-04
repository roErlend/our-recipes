#!/usr/bin/env bash
# Download a reel/video by URL (yt-dlp), extract its audio (ffmpeg), and
# transcribe it (Whisper). Prints the post CAPTION and the audio TRANSCRIPT to
# stdout between markers; all progress noise goes to stderr.
#
# Usage:   reel-transcribe.sh <url>
# Cookies: for login-gated posts, set IG_COOKIES_FROM=chrome (or firefox/safari).
set -euo pipefail

# pipx installs console scripts (whisper, mlx_whisper) here — make sure they're
# reachable even if the shell profile hasn't picked it up yet.
export PATH="$HOME/.local/bin:$PATH"

URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "Usage: reel-transcribe.sh <instagram-or-video-url>" >&2
  exit 2
fi

# --- dependency check ---------------------------------------------------------
missing=()
command -v yt-dlp >/dev/null 2>&1 || missing+=("yt-dlp")
command -v ffmpeg >/dev/null 2>&1 || missing+=("ffmpeg")

TRANSCRIBER=""
if   command -v mlx_whisper >/dev/null 2>&1; then TRANSCRIBER="mlx_whisper"
elif command -v whisper      >/dev/null 2>&1; then TRANSCRIBER="whisper"
elif command -v whisper-cli  >/dev/null 2>&1; then TRANSCRIBER="whisper-cli"
fi
[[ -z "$TRANSCRIBER" ]] && missing+=("a Whisper transcriber")

if (( ${#missing[@]} > 0 )); then
  cat >&2 <<'EOF'
Missing tools: install once with Homebrew + pipx:

  brew install yt-dlp ffmpeg pipx
  pipx ensurepath
  pipx install openai-whisper        # stable CLI, auto-downloads models
  # optional, faster on Apple Silicon:
  #   pipx install mlx-whisper

Then re-run this script.
EOF
  echo "(missing: ${missing[*]})" >&2
  exit 1
fi

# --- download -----------------------------------------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ Downloading via yt-dlp…" >&2
ytdlp_args=(--no-playlist --write-info-json -o "$WORK/reel.%(ext)s")
[[ -n "${IG_COOKIES_FROM:-}" ]] && ytdlp_args+=(--cookies-from-browser "$IG_COOKIES_FROM")
if ! yt-dlp "${ytdlp_args[@]}" "$URL" >&2; then
  echo "yt-dlp failed. If the post is private/login-gated, retry with:" >&2
  echo "  IG_COOKIES_FROM=chrome reel-transcribe.sh '$URL'" >&2
  exit 1
fi

# caption / description from the metadata sidecar
CAPTION=""
INFO="$(ls "$WORK"/*.info.json 2>/dev/null | head -1 || true)"
[[ -n "$INFO" ]] && CAPTION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("description") or "")' "$INFO")"

VIDEO="$(ls "$WORK"/reel.* 2>/dev/null | grep -vi '\.info\.json$' | head -1 || true)"
if [[ -z "$VIDEO" ]]; then
  echo "No video file downloaded (private/login-gated?). Try IG_COOKIES_FROM=chrome." >&2
  exit 1
fi

# --- audio + transcribe -------------------------------------------------------
echo "→ Extracting audio (ffmpeg)…" >&2
ffmpeg -y -i "$VIDEO" -vn -ac 1 -ar 16000 "$WORK/audio.wav" >/dev/null 2>&1

echo "→ Transcribing with $TRANSCRIBER (auto language)…" >&2
case "$TRANSCRIBER" in
  mlx_whisper)
    mlx_whisper "$WORK/audio.wav" --output-dir "$WORK" --output-format txt >&2 ;;
  whisper)
    whisper "$WORK/audio.wav" --model base --output_format txt \
      --output_dir "$WORK" --verbose False >&2 ;;
  whisper-cli)
    : "${WHISPER_CPP_MODEL:?Set WHISPER_CPP_MODEL to a ggml model path}"
    whisper-cli -m "$WHISPER_CPP_MODEL" -f "$WORK/audio.wav" -otxt -of "$WORK/audio" >&2 ;;
esac

TXT="$WORK/audio.txt"
[[ -f "$TXT" ]] || { echo "Transcription produced no text file." >&2; exit 1; }

# --- output -------------------------------------------------------------------
echo "===== CAPTION ====="
printf '%s\n' "$CAPTION"
echo "===== TRANSCRIPT ====="
cat "$TXT"
echo "===== END ====="
