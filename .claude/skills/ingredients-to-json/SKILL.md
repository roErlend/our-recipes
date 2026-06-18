---
name: ingredients-to-json
description: Convert a free-text (Norwegian or English) ingredient list into the JSON the recipe app's "Importer JSON" button accepts. Use when someone pastes recipe ingredients as plain text and wants importable JSON.
---

# Ingredients → import JSON

Turn a plain-text ingredient list into JSON you can paste into the recipe form's
**Importer JSON** dialog (Ny oppskrift / Rediger oppskrift → Ingredienser →
Importer JSON).

## Output format

A JSON **array** of objects. Each object:

| Field      | Type            | Required | Notes                                                      |
| ---------- | --------------- | -------- | ---------------------------------------------------------- |
| `name`     | string          | yes      | The ingredient itself, e.g. `"Hvitløk"`.                   |
| `quantity` | number \| null  | no       | Numeric amount only. Omit (or `null`) when there's none.   |
| `unit`     | string \| null  | no       | Metric unit of measure, e.g. `"g"`, `"dl"`, `"ss"`.        |
| `note`     | string \| null  | no       | Prep/qualifier, e.g. `"finhakket"`, `"delt i to"`.         |

The parser also accepts `ingredient` (for `name`) and `amount`/`qty` (for
`quantity`), and an object wrapper `{ "ingredients": [ ... ] }` — but prefer the
clean shape above. Only `name` is mandatory; items without one are skipped.

```json
[
  { "name": "Spaghetti", "quantity": 400, "unit": "g" },
  { "name": "Hvitløk", "quantity": 2, "unit": "fedd", "note": "finhakket" },
  { "name": "Salt" }
]
```

## Conversion rules

1. **Split** the text into one ingredient per line/bullet.
2. **Pull out the number** → `quantity`. Convert fractions and decimals to a
   number: `1/2` → `0.5`, `1,5` → `1.5` (Norwegian comma decimals), `½` → `0.5`.
3. **Pull out the unit** → `unit`. Keep it **metric** (see vocabulary below). If
   the source uses imperial (cups, oz, lb, °F), convert to metric.
4. **The rest is the `name`.** Move preparation words ("finhakket", "delt i to",
   "romtemperert", "minced") into `note`, not `name`.
5. **No number?** Omit `quantity` (e.g. "Salt", "salt etter smak" →
   `{ "name": "Salt" }`).
6. **Ranges** ("1/2 – 1 lime", "2-3 ss"): pick the lower/typical value for
   `quantity` and put the range in `note` (e.g. `"note": "½–1"`), so the
   shopping-list math still works.
7. Keep ingredient names in the **source language** (don't translate the food).

### Metric unit vocabulary (Norwegian)

`g`, `kg`, `ml`, `dl`, `l`, `ts` (teskje), `ss` (spiseskje), `stk` (stykk),
`fedd` (garlic clove), `klype` (pinch). Convert: 1 cup ≈ 2.4 dl, 1 tbsp ≈ 1 ss,
1 tsp ≈ 1 ts, 1 oz ≈ 28 g, 1 lb ≈ 450 g.

## Example

Input:

```
2,5 ss rød curry paste
400 g kyllingkjøttdeig
1/2 - 1 lime, saften
1 stor sjalottløk, delt i to
Salt og pepper
```

Output:

```json
[
  { "name": "Rød curry paste", "quantity": 2.5, "unit": "ss" },
  { "name": "Kyllingkjøttdeig", "quantity": 400, "unit": "g" },
  { "name": "Lime", "quantity": 0.5, "unit": "stk", "note": "saften, ½–1" },
  { "name": "Sjalottløk", "quantity": 1, "unit": "stk", "note": "stor, delt i to" },
  { "name": "Salt og pepper" }
]
```

English input works the same way — just convert any imperial units to metric.

## Finishing up

Output **only** the JSON array (no markdown fences) so it can be pasted straight
into the Importer JSON textarea. Quickly sanity-check it's valid JSON before
handing it over.
Copy the **only** the JSON output to the clipboard and confirm with the user that it's ready to paste into the recipe app.
