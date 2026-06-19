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
| `title`        | string           | yes      | The dish name, in the source language. e.g. `"Pasta Carbonara"`.      |
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
| `name`     | string          | yes      | The ingredient, in the source language, e.g. `"Hvitløk"`. |
| `quantity` | number \| null  | no       | Numeric amount only. `null`/omit when there's none.       |
| `unit`     | string \| null  | no       | Metric unit, e.g. `"g"`, `"dl"`, `"ss"`.                  |
| `note`     | string \| null  | no       | Prep/qualifier, e.g. `"finhakket"`, `"romtemperert"`.     |

## Conversion rules (same as `ingredients-to-json`)

1. **Numbers** → `quantity`: `1/2` → `0.5`, `1,5` → `1.5`, `½` → `0.5`.
2. **Units** → `unit`, kept **metric**. Convert imperial: 1 cup ≈ 2.4 dl,
   1 tbsp ≈ 1 ss, 1 tsp ≈ 1 ts, 1 oz ≈ 28 g, 1 lb ≈ 450 g, °F → °C.
3. **Prep words** ("finely chopped", "delt i to", "romtemperert") → `note`, not `name`.
4. **No number** → omit `quantity` (e.g. "Salt etter smak" → `{ "name": "Salt" }`).
5. **Ranges** ("2-3 ss") → pick the lower value, put the range in `note` (`"2–3"`).
6. **Keep food names in the source language** — don't translate the ingredient or
   title. (The app UI is Norwegian, but the recipe stays in its own language.)

Norwegian metric vocabulary: `g`, `kg`, `ml`, `dl`, `l`, `ts`, `ss`, `stk`,
`fedd` (garlic clove), `klype`, `boks`, `pk`.

### Instructions

Flatten `recipeInstructions` (or the visible steps) into a single string, one
step per line, numbered. Drop "Step 1"/"Trinn 1" prefixes the site adds — just
use `1.`, `2.`, … Keep the steps in the source language. Example:

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

- Output **only** the JSON object (no markdown fences), so it can be used directly.
- Sanity-check it's valid JSON and that `sourceUrl` is the URL you were given.
- Tell the user the two-step import: paste the **whole object** into **Ny
  oppskrift → Ingredienser → Importer JSON** (the parser reads the `ingredients`
  key and ignores the rest), then copy `title`, `description`, `instructions`,
  `servings`, `imageUrl` and `sourceUrl` into their fields. Flag if `imageUrl`
  might be hotlink-protected (some sites block external embedding).
