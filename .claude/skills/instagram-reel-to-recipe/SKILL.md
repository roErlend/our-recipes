---
name: instagram-reel-to-recipe
description: Download a recipe video by URL (Instagram reel, TikTok, YouTube Short — anything yt-dlp supports), transcribe its audio + read its caption, and turn it into importable recipe JSON. Use when someone gives a link to a recipe *video* (not a normal web page — that's recipe-url-to-json).
---

# Instagram reel → recipe JSON

Given a link to a recipe **video**, get a transcript of what's said plus the
post caption, then turn it into the same full-recipe JSON the `recipe-url-to-json`
skill produces (ready for the app's **Importer JSON** dialog).

Use this when the URL is a video (Instagram reel, TikTok, YouTube Short/clip).
For an ordinary recipe web page, use `recipe-url-to-json` instead. `WebFetch`
can't read these — Instagram serves a login wall and the recipe is in the
audio/caption, not the HTML.

## How it works

1. **Run the helper** (it downloads, extracts audio, and transcribes locally):

   ```bash
   .claude/skills/instagram-reel-to-recipe/scripts/reel-transcribe.sh "<URL>"
   ```

   It prints two blocks to stdout:

   ```
   ===== CAPTION =====
   …the post's caption/description (often has the full recipe)…
   ===== TRANSCRIPT =====
   …Whisper transcript of the narration…
   ===== END =====
   ```

2. **If it reports missing tools**, relay the one-time install it prints
   (`brew install yt-dlp ffmpeg pipx` → `pipx install openai-whisper`) and offer
   to run it. Don't hand-fake a transcript.

3. **If the download fails** because the post is private/login-gated, re-run with
   the user's browser cookies:

   ```bash
   IG_COOKIES_FROM=chrome .claude/skills/instagram-reel-to-recipe/scripts/reel-transcribe.sh "<URL>"
   ```

   (`chrome`/`firefox`/`safari` — whichever they're logged into.)

## Turning it into the recipe

You now have a **caption** and a **transcript**. Combine them:

- **Prefer the caption** for ingredients + amounts when it lists them — captions
  usually have clean quantities; spoken narration rarely does.
- **Use the transcript for the method** — flatten it into concise, numbered
  steps (drop filler like "save that takeout money", "give it a mix", "you just
  gotta make it"). One action per line.
- If the transcript names something the caption omits (e.g. "green onions"), add
  it to the ingredients and **flag it** so the user can confirm the amount.

Then produce the JSON exactly per the **`recipe-url-to-json`** skill's output
format and rules — same object shape (`title`, `description`, `sourceUrl`,
`imageUrl`, `servings`, `instructions`, `tags`, `ingredients[]` with optional
`component`), same conversion rules (numbers, metric units, ranges → note), and
**the same Norwegian-translation rule**: translate ingredient names, notes,
title, and steps to Norwegian (bokmål) where a good term exists; keep source
language only when there isn't one, and show a short **"Sjekk oversettelsen"**
list of anything left untranslated or uncertain.

Set `sourceUrl` to the **input URL**. For `imageUrl`, leave it `null` (the reel
video isn't an image; the user can paste a still later).

## Finishing up

- **Copy only the JSON object to the clipboard** (write to a temp file and
  `pbcopy < file` to avoid quoting issues), and tell the user it's copied.
- Show the JSON in a ```json block, and the **"Sjekk oversettelsen"** list.
- Note that audio-only transcription can miss steps shown *only* on-screen
  (text overlays with no narration) — ask the user to skim the result.
- Tell them how to import: recipes page → **⋯ next to «Ny oppskrift» →
  «Importer fra JSON»**, paste, review, save.
