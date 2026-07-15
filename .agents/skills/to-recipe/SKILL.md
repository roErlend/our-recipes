---
name: to-recipe
description: One entry point for turning anything into importable recipe JSON. Look at whatever the user gives — an ingredient list, a recipe web page URL, a recipe video link (Instagram reel / TikTok / YouTube Short), or an image of a recipe — figure out which kind it is, and run the matching converter skill. Use this when the user wants a recipe imported but you'd otherwise have to guess which specific skill fits.
---

# Recipe → JSON (router)

This skill is a **dispatcher**. It doesn't do the conversion itself — it looks at
the argument, decides which kind of input it is, and hands off to the matching
skill. All four produce the **same** full-recipe JSON object (ready for the app's
**Importer JSON** dialog) under the **same** rules (metric conversion, Norwegian
bokmål translation, `pbcopy` to clipboard, "Sjekk oversettelsen" list, import
instructions), so the only decision here is *which* skill to run.

## Classify the input, then delegate

Check in **this order** and stop at the first match:

1. **Image** → `recipe-image-to-json`
   - The message includes an attached image, a local path to an image file
     (`.png`, `.jpg`, `.jpeg`, `.heic`, `.webp`, …), or a URL that points
     directly at an image file (ends in an image extension).
   - Photo of a cookbook page / handwritten card, a screenshot of a post/story.

2. **Recipe video URL** → `instagram-reel-to-recipe`
   - The argument is a URL on a video platform, or a link to a specific video
     post: `instagram.com/reel/…` or `/p/…`, `tiktok.com/…`, a YouTube
     `watch`/`shorts`/`youtu.be` link, Facebook `watch`, etc.
   - Rule of thumb: the recipe lives in the **audio/caption/pinned comment**, not
     in crawlable page HTML.

3. **Recipe web page URL** → `recipe-url-to-json`
   - Any other `http(s)://` URL — an ordinary recipe page/blog/site that
     `WebFetch` can read (schema.org/Recipe, a visible recipe card).

4. **Ingredient list / pasted text** → `ingredients-to-json`
   - No URL and no image: the user pasted an ingredient list (or a block of
     recipe text). This is the fallback when nothing above matches.

### Edge cases

- **Instagram/TikTok/YouTube links are always videos** — route them to
  `instagram-reel-to-recipe`, never `recipe-url-to-json`, even though they're
  `http(s)` URLs (rule 2 is checked before rule 3 for exactly this reason).
- **A page URL vs. an image URL:** if the URL ends in an image extension it's an
  image (rule 1); otherwise treat a non-video URL as a web page (rule 3).
- **Text that contains a URL** (e.g. "here's the link plus my notes"): if there's
  a usable recipe URL, route by the URL (rules 2/3); only fall to
  `ingredients-to-json` when there's no fetchable link.
- **Genuinely ambiguous** (e.g. a bare domain, or you can't tell if pasted text
  is ingredients or something else): say which one you're about to use and why in
  one line, then proceed — don't stall. Ask only if you truly can't tell.

## How to hand off

Once you've classified it, **invoke the matching skill** (via the Skill tool)
with the user's original argument, and let that skill do the rest — it already
owns the output format, conversions, translation, clipboard copy, and the import
instructions. Don't re-implement any of that here, and don't produce your own
JSON: this skill's only job is to pick the right one and pass the input through.

Briefly tell the user which skill you're routing to (one short line) so the
choice is visible, then run it.
