---
name: recipe-url-to-json
description: Crawl a recipe URL and produce a full recipe JSON (title, description, steps/instructions, ingredients, image, servings, tags) for the recipe app. Use when someone gives a link to a recipe and wants it as importable JSON.
---

# Recipe URL → full recipe JSON

Given a **recipe URL**, fetch the page and turn it into one JSON object that
matches the recipe form (Ny oppskrift). The `ingredients` array is the same shape
the **Importer JSON** dialog accepts, so the whole object can be pasted there to
import the ingredients; the other fields map to the form's inputs.

## How to fetch

1. **Fetch the page with `WebFetch`**, giving it a focused extraction prompt,
   e.g.: *"Extract this page's recipe: exact title, the full ingredient list with
   amounts and units, the numbered preparation steps, the number of servings, and
   the main recipe image URL. Prefer the page's schema.org/Recipe (JSON-LD)
   structured data if present; ignore ads, comments, and life-story preamble."*
2. **Prefer structured data.** Most recipe sites embed `schema.org/Recipe` as
   JSON-LD — it gives clean `name`, `recipeIngredient`, `recipeInstructions`,
   `image`, `recipeYield`. Use it when available; fall back to the visible recipe
   card otherwise.
3. If the page is paywalled / blocked / clearly not a recipe, say so instead of
   inventing content. If `WebFetch` is blocked, ask the user to paste the recipe
   text and use the `ingredients-to-json` flow for the ingredients.

## Output format

A single JSON **object**:

| Field          | Type             | Required | Notes                                                                 |
| -------------- | ---------------- | -------- | --------------------------------------------------------------------- |
| `title`        | string           | yes      | The dish name in **Norwegian** (translate; keep proper/brand names — see Language). |
| `description`  | string \| null   | no       | One short line if the page has a natural summary; else `null`.        |
| `sourceUrl`    | string           | yes      | The **input URL** (so it lands in the recipe's "Kilde" field).        |
| `imageUrl`     | string \| null   | no       | Absolute URL of the main image (JSON-LD `image` / `og:image`), else `null`. |
| `servings`     | number \| null   | no       | Numeric portions only (from `recipeYield`); strip words like "porsjoner". |
| `instructions` | string           | no       | The steps as one text block — one step per line, numbered `1.`, `2.`… |
| `tags`         | string[]         | no       | A few short labels if obvious (cuisine, course, "vegetar"); else `[]`. |
| `ingredients`  | array            | yes      | Same shape as the `ingredients-to-json` skill (see below).            |

Each `ingredients` item:

| Field      | Type            | Required | Notes                                                    |
| ---------- | --------------- | -------- | -------------------------------------------------------- |
| `name`     | string          | yes      | The ingredient in **Norwegian** (translate — see Language), e.g. `"Hvitløk"`. |
| `quantity` | number \| null  | no       | Numeric amount only. `null`/omit when there's none.       |
| `unit`     | string \| null  | no       | Metric unit, e.g. `"g"`, `"dl"`, `"ss"`.                  |
| `note`     | string \| null  | no       | Prep/qualifier, e.g. `"finhakket"`, `"romtemperert"`.     |

## Conversion rules (same as `ingredients-to-json`)

1. **Numbers** → `quantity`: `1/2` → `0.5`, `1,5` → `1.5`, `½` → `0.5`.
2. **Units** → `unit`, kept **metric**. Convert imperial: 1 cup ≈ 2.4 dl,
   1 tbsp ≈ 1 ss, 1 tsp ≈ 1 ts, 1 oz ≈ 28 g, 1 lb ≈ 450 g, °F → °C.
   - **Prefer spoon/volume units over weight when a source gives both.** For
     `1 tsp (4 g)` use `1 ts`, not `4 g` — spoons are friendlier to cook with.
     Same for `ss`/`dl`/`ml`. Keep weight (`g`/`kg`) for things normally weighed
     (meat, vegetables, cheese, larger amounts) and for `stk`/`fedd` where those
     fit best.
   - **Cups:** convert to metric as usual (1 cup ≈ 2.4 dl), but **keep the
     original `… cup(s)` in the `note`, in parentheses** — e.g. `1,8 dl` with
     note `"(¾ cup)"`, or `2,4–3,6 dl` with note `"(1–1½ cups)"`.
3. **Prep words** ("finely chopped", "delt i to", "romtemperert") → `note`, not `name`.
4. **No number** → omit `quantity` (e.g. "Salt etter smak" → `{ "name": "Salt" }`).
5. **Ranges** ("2-3 ss") → pick the lower value, put the range in `note` (`"2–3"`).
6. **Translate to Norwegian** — see **Language** below. (This is the one rule that
   differs from `ingredients-to-json`, which keeps the source language.)

Norwegian metric vocabulary: `g`, `kg`, `ml`, `dl`, `l`, `ts`, `ss`, `stk`,
`fedd` (garlic clove), `klype`, `boks`, `pk`.

## Language

Translate everything user-facing into **Norwegian (bokmål)** — the `title`,
`description`, `instructions`, every ingredient `name`, every `note`, and the
units — translating by meaning, not word for word. Use Norwegian metric units
(`ts`, `ss`, `dl`, `stk`, `fedd`, `klype`…).

**Don't guess.** If you're unsure of a term, or something has no clean Norwegian
equivalent (a specialty product, a regional item, an unfamiliar cut), **leave
that part in English** rather than inventing a translation — an honest English
word beats a wrong Norwegian one. Keep proper/brand names as-is (e.g. `"Knorr"`,
`"Aleppo"`, `"Shatta"`).

Whenever you leave something untranslated or you're unsure, collect it and show
the user a short **"Sjekk oversettelsen"** list afterward (ingredient/word →
why), so they can correct it. If everything translated cleanly, say so.

### Instructions

Flatten `recipeInstructions` (or the visible steps) into a single string, one
step per line, numbered. Drop "Step 1"/"Trinn 1" prefixes the site adds — just
use `1.`, `2.`, … Translate the steps to Norwegian (see **Language**). Example:

```
1. Kok pastaen al dente i godt saltet vann.
2. Stek guanciale sprø. Visp egg og parmesan.
3. Bland alt utenfor varmen, spe med pastavann til kremet.
```

## Example output

```json
{
  "title": "Pasta Carbonara",
  "description": "Romersk klassiker med egg, ost og guanciale.",
  "sourceUrl": "https://example.com/carbonara",
  "imageUrl": "https://example.com/img/carbonara.jpg",
  "servings": 4,
  "instructions": "1. Kok spagettien al dente.\n2. Stek guanciale sprø.\n3. Visp egg, eggeplomme og parmesan.\n4. Bland alt utenfor varmen og spe med pastavann.",
  "tags": ["italiensk", "pasta"],
  "ingredients": [
    { "name": "Spaghetti", "quantity": 400, "unit": "g" },
    { "name": "Guanciale", "quantity": 150, "unit": "g", "note": "i terninger" },
    { "name": "Egg", "quantity": 3, "unit": "stk" },
    { "name": "Eggeplomme", "quantity": 1, "unit": "stk" },
    { "name": "Parmesan", "quantity": 50, "unit": "g", "note": "revet" },
    { "name": "Sort pepper" },
    { "name": "Salt" }
  ]
}
```

## Finishing up

- **Copy the JSON to the clipboard automatically.** Write the JSON to a temp file
  and pipe it through `pbcopy` (macOS) so the exact bytes land on the clipboard —
  e.g. `pbcopy < /tmp/recipe.json` (using a file avoids quoting/newline mangling).
  Tell the user it's copied.
- Also show the JSON (a ```json block is fine for readability) and
  sanity-check it's valid and that `sourceUrl` is the URL you were given.
- Show a short **"Sjekk oversettelsen"** list of anything you left in English or
  were unsure about (ingredient/word → why). If everything translated cleanly,
  say so.
- Tell the user how to import: on the recipes page, **⋯ next to «Ny oppskrift» →
  «Importer fra JSON»**, paste the whole object, review, and save. Flag if
  `imageUrl` might be hotlink-protected (some sites block external embedding).
