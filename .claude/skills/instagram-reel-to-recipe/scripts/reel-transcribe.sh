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
INFO="$(ls "$WORK"/reel*.info.json 2>/dev/null | head -1 || true)"
[[ -n "$INFO" ]] && CAPTION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("description") or "")' "$INFO")"

# Recipe creators very often put the full ingredient list + steps in a PINNED
# (or author) comment rather than the caption/narration. Fetch comments
# best-effort — a failure here (rate limit, login-gated, no comments) must never
# block transcription.
PINNED=""
echo "→ Checking pinned/author comment…" >&2
if yt-dlp --skip-download --write-info-json --write-comments \
    --extractor-args "youtube:max_comments=60,all,60,10;comment_sort=top" \
    -o "$WORK/c.%(ext)s" "$URL" >/dev/null 2>&1; then
  CINFO="$(ls "$WORK"/c*.info.json 2>/dev/null | head -1 || true)"
  # Prefer a pinned comment, else the uploader's own top comment.
  [[ -n "$CINFO" ]] && PINNED="$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit()
cs = d.get("comments") or []
pick = next((c for c in cs if c.get("is_pinned")), None) or next(
    (c for c in cs if c.get("author_is_uploader")), None)
if pick:
    print((pick.get("text") or "").strip())
' "$CINFO")"
fi

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
    # mlx defaults to a weak `tiny`; pass a good repo explicitly (fast + accurate
    # on Apple Silicon). Override with MLX_MODEL=<hf-repo> if needed.
    mlx_whisper "$WORK/audio.wav" \
      --model "${MLX_MODEL:-mlx-community/whisper-large-v3-turbo}" \
      --output-dir "$WORK" --output-format txt >&2 ;;
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
echo "===== PINNED/AUTHOR COMMENT ====="
printf '%s\n' "$PINNED"
echo "===== TRANSCRIPT ====="
cat "$TXT"
echo "===== END ====="
