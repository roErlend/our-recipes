# Backlog / ideas

Things worth doing next, captured so they're not lost. Effort is rough
(S = an hour-ish, M = a few hours, L = a day+). Not prioritized beyond the
grouping. Update status as these get picked up.

## Done this session (for context)
- ✅ Editable shopping quantities — override + stepper + Electric sync (optimistic).
- ✅ Admin mobile layout fixes + React Aria ComboBox (replaced the PWA-broken `<datalist>`).
- ✅ Recipe-from-JSON import — `recipe-url-to-json` skill + segmented "Ny oppskrift" menu → pre-filled review form (subscription-friendly path).
- ✅ Re-baselined drizzle migrations against the live DB (drift fixed).
- ✅ First test suite — 30 tests on the pure logic (`vitest.config.ts`).

---

## Quick wins / housekeeping

### Wire `pnpm test` into the workflow — S
Now that tests exist, make the safety net automatic: a pre-push hook (Husky or a
`.git/hooks/pre-push`) and/or a CI check on the Vercel deploy. Keeps the green
bar honest without remembering to run it.

### Grow the test suite — S–M
Current tests cover the pure logic (`shopping-aggregate`, `categories`,
`parseRecipeImport`). Next candidates that are pure/client-safe:
`filterIngredients` ranking (needs decoupling from `@/server/ingredients`'s
`@/db` import first), `formatAmount`/`effectiveQuantity`, `groupItems`. Server
functions need DB mocking — lower priority.

---

## Features (well-aligned)

### In-app URL crawl (Path A — needs the API) — S–M
Today's importer is paste-JSON (Path B, free, via the skill). The smoother
version: paste a URL in-app, the server calls Claude (Haiku 4.5) to extract the
recipe, and the form pre-fills. Needs an `ANTHROPIC_API_KEY` (server-side) and
pay-as-you-go billing — cost is cents/month at this volume. The
`parseRecipeImport` + pre-fill plumbing already exists; this just swaps the
"paste JSON" step for "paste URL → server extracts".

### Recipe scaling by servings — M
`recipe.servings` exists in the schema but isn't used. Let a recipe be added to
the list at "×N servings" and scale its quantities into `shopping_entry`.
Natural follow-on to the quantity work.

### Pantry / staples — M
Flag catalog ingredients you always have (salt, oil, flour) so they're
auto-excluded or greyed on the generated list. Natural home: a `staple` flag on
`ingredient_catalog`. Removes recurring manual deletions.

### Unit-aware merging + light metric conversion — M
Lines merge only on exact `name__unit`, so "2 dl" + "1 l" stay separate and
"tomat"/"tomater" don't combine. A small normalization layer (dl↔l, g↔kg, simple
singular/plural) in the aggregation would cut duplicate lines. (Pairs well with
the new aggregation tests — write the cases first.)

---

## UX polish

### Shopping ergonomics pass — S–M
Swipe-to-check / swipe-to-delete on mobile; an "uncheck all / clear list" action
(the `clearShoppingChecks` collection-delete path exists but isn't surfaced);
persist per-household category order so the list matches your store's layout.

---

## Outside the box

### Offline-capable in-store mode — M–L
`public/sw.js` deliberately never caches `/api`, and Electric needs the network —
so in a shop with bad signal, checking items can fail. Queue check/quantity
mutations locally (the optimistic UI is already there) and flush on reconnect.
The shopping list is exactly the screen used where connectivity is worst.

### Cook history → "what should we make?" — M
The app grew out of a Google Keep dinner list. Log when a recipe was cooked, then
surface gentle suggestions (highly-rated + not-made-recently), or a one-tap "plan
this week" that drops 3–5 dinners onto the shopping list. Combines data you
already have (ratings, recipes) into the weekly decision you actually make.
