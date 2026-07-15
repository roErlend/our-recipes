---
name: recipe-image-to-json
description: Read a recipe from an image (photo of a cookbook page or handwritten card, a screenshot of a post/story, a phone photo) and produce a full recipe JSON (title, description, steps/instructions, ingredients, image, servings, tags) for the recipe app. Use when someone gives an image of a recipe rather than a URL (recipe-url-to-json) or a video (instagram-reel-to-recipe).
---

# Recipe image → full recipe JSON

Given one or more **images of a recipe**, read the recipe out of the picture and
turn it into the same full recipe JSON object the **`recipe-url-to-json`** skill
produces (ready for the app's **Importer JSON** dialog). Use this when the recipe
lives in a picture — a photographed cookbook page, a handwritten recipe card, a
screenshot of an Instagram/TikTok post or story, a WhatsApp photo — not on a
crawlable web page (that's `recipe-url-to-json`) or in a video (that's
`instagram-reel-to-recipe`).

## How to read the image

1. **Get the image on disk, then read it with the `Read` tool** — it can view
   PNG/JPG/etc. and you interpret the recipe directly from what you see.
   - If the argument is a **local path** (the usual case — the user drags a file
     in or pastes a path), `Read` it directly.
   - If it's an **image URL**, download it first, then `Read` the local file:
     ```bash
     curl -fsSL "<IMAGE_URL>" -o /tmp/recipe-image
     ```
   - If **several images** are given (e.g. one photo of the ingredients, one of
     the method), `Read` them all and combine them into one recipe.
2. **Read everything in the picture** — title, ingredient list with amounts and
   units, the numbered or prose steps, servings ("4 porsjoner"), any sub-recipe
   headings (they become `component`s). Ignore surrounding page furniture (ads,
   page numbers, unrelated recipes, life-story preamble).
3. **Don't invent.** If the photo is blurry, cropped, or a word is unreadable,
   transcribe what you can and **flag the uncertain bits** (see "Usikker lesning"
   below) instead of guessing an amount or ingredient. If the image clearly isn't
   a recipe, or is too illegible to use, say so rather than making one up.
4. If **no image is provided** (or the path/URL doesn't resolve), ask the user to
   attach the photo or paste its path.

## Turning it into the recipe

Produce the JSON **exactly per the `recipe-url-to-json` skill's output format and
rules** — the same object shape (`title`, `description`, `sourceUrl`, `imageUrl`,
`servings`, `instructions`, `tags`, `ingredients[]` with optional `component`),
the same conversion rules (numbers, metric units, imperial→metric, cups kept in
`note`, ranges → lower value + range in `note`), and the same **Norwegian
(bokmål) translation** rule for the title, description, steps, ingredient names,
notes, and units. Keep proper/brand names; leave a term in the source language
rather than inventing a wrong Norwegian one, and collect those for the check
below.

Image-specific field notes:

- **`sourceUrl`** — set it to the **image URL** when the input was a URL;
  otherwise leave it `""` (a photo has no web source). If the picture shows a
  clear source (a cookbook name, a handle like `@somechef`, a printed URL),
  put that short attribution in `description` instead.
- **`imageUrl`** — leave `null`. The photo is usually of the *recipe text*, not a
  hostable dish image; the user can upload the photo itself via the form's image
  upload if they want a picture.
- **`instructions`** — if the picture gives the method as a prose paragraph
  rather than numbered steps, split it into sensible numbered steps yourself.

## Finishing up

- **Copy only the JSON object to the clipboard.** Write it to a temp file and
  `pbcopy < /tmp/recipe.json` (a file avoids quoting/newline mangling). Tell the
  user it's copied.
- Show the JSON in a ```json block and sanity-check it's valid JSON.
- Show a short **"Sjekk oversettelsen"** list of anything left in English or you
  were unsure about (ingredient/word → why); say so if everything translated
  cleanly.
- Show a short **"Usikker lesning"** list of anything you couldn't read
  confidently from the image (smudged amount, ambiguous word, cut-off line) so
  the user can verify it. If the whole image read cleanly, say so.
- Tell them how to import: recipes page → **⋯ next to «Ny oppskrift» →
  «Importer fra JSON»**, paste the whole object, review, and save. If they want
  the photo as the recipe image, they can add it via the form's image upload.
