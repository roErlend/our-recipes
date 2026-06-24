# Backlog / ideas

Things worth doing next, captured so they're not lost. Effort is rough
(S = an hour-ish, M = a few hours, L = a day+). Not prioritized beyond the
grouping. Update status as these get picked up.

## Recently shipped (for context)
- ✅ **Offline in-store mode** — durable IndexedDB outbox queues check/quantity
  mutations and flushes on reconnect; the snapshot cache makes the list readable
  with no signal. (See `docs/offline-shopping-mode.md`.)
- ✅ **Pantry staples** — staple catalog ingredients are kept off the to-buy list.
- ✅ **New ingredients auto-join the catalog** with a guessed category.
- ✅ **Recipe scaling by servings** — and the servings control is now an inline
  stepper (with a reset-to-default icon) where the read-only "N porsjoner" label
  used to be; amounts + shopping-add scale in lockstep.
- ✅ **Sharing: remove one member** (with a two-click confirm) without dropping
  the others; plus the existing "leave household" now confirms too.
- ✅ **Recipe-from-JSON import** — paste-JSON review flow + a "Vis eksempel"
  button (Kylling Shawarma) so the expected shape is obvious.
- ✅ **Mobile polish** — swipe-right-anywhere to go back; press feedback on nav
  items + bottom tabs; shopping list is the default landing screen.
- ✅ Tag filtering + sort on the overview; one-off keyword tagger.
- ✅ Editable shopping quantities (stepper + Electric sync, optimistic).
- ✅ Admin mobile layout + React Aria ComboBox; drizzle migrations re-baselined.
- ✅ First test suite — pure-logic vitest coverage.

---

## Quick wins / housekeeping

### Wire `pnpm test` into the workflow — S
Tests exist but nothing runs them automatically. Add a `pre-push` hook (Husky via
a `prepare` script, or a plain `.git/hooks/pre-push`) and/or a CI check on the
Vercel deploy. Keeps the green bar honest without remembering to run it.

### Grow the test suite — S–M
Current tests cover the pure logic (`shopping-aggregate`, `categories`,
`parseRecipeImport`). Next candidates that are pure/client-safe:
`filterIngredients` ranking (needs decoupling from `@/server/ingredients`'s
`@/db` import first), `formatAmount`/`effectiveQuantity`, `groupItems`, and the
new `useSwipeBack` thresholds (extract the pure decision into a testable fn).
Server functions need DB mocking — lower priority.

---

## Features (well-aligned)

### In-app URL crawl (Path A — needs the API) — S–M
Today's importer is paste-JSON (Path B, free, via the skill). The smoother
version: paste a URL in-app, the server calls Claude (Haiku 4.5) to extract the
recipe, and the form pre-fills. Needs an `ANTHROPIC_API_KEY` (server-side) and
pay-as-you-go billing — cost is cents/month at this volume. The
`parseRecipeImport` + pre-fill plumbing already exists; this just swaps the
"paste JSON" step for "paste URL → server extracts".

### Unit-aware merging + light metric conversion — M
Lines merge only on exact `name__unit`, so "2 dl" + "1 l" stay separate and
"tomat"/"tomater" don't combine. A small normalization layer (dl↔l, g↔kg, simple
singular/plural) in the aggregation would cut duplicate lines. (Pairs well with
the aggregation tests — write the cases first.)

---

## UX polish

### Shopping ergonomics pass — S–M
Swipe-to-check / swipe-to-delete on list rows (the swipe-*nav* gesture exists, but
list-item swipes don't); a "fjern avhukede / tøm liste" action (the
`clearShoppingChecks` collection-delete path exists but isn't surfaced); persist
per-household category order so the list matches your store's layout.

---

## Outside the box

### Cook history → "what should we make?" — M
The app grew out of a Google Keep dinner list. Log when a recipe was cooked, then
surface gentle suggestions (highly-rated + not-made-recently), or a one-tap "plan
this week" that drops 3–5 dinners onto the shopping list. Combines data you
already have (ratings, recipes) into the weekly decision you actually make.

---

## New ideas (brainstorm — unsorted)

### Cooking mode (screen wake-lock + big steps) — S–M
A "Lag nå" toggle on the recipe detail that (1) holds a `navigator.wakeLock` so
the phone doesn't sleep mid-cook, and (2) bumps the instruction steps to large,
tappable, check-off-as-you-go text. Tiny API, big quality-of-life — the screen
sleeping with floury hands is the classic kitchen annoyance. Pairs naturally with
the servings stepper already in the header.

### Prep / cook time metadata — S
Add optional `prepMinutes` / `cookMinutes` to a recipe (and to the import JSON /
`recipe-url-to-json` schema, which most sites already expose as `prepTime`/
`cookTime`). Show "⏱ 25 min" next to "N porsjoner", and let the overview sort/
filter by total time ("noe raskt i kveld").

### Per-recipe household notes — M
A small freeform notes thread on a recipe ("vi doblet sausen", "godt med ekstra
chili"), scoped by household like ratings. Captures the tweaks that currently live
in your heads. Could reuse the rating table's per-member pattern.

### Camera capture for recipe photos — S
Image upload already supports clipboard paste + client resize; add an
`<input type="file" accept="image/*" capture="environment">` path so on mobile you
can snap the finished dish (or a cookbook page) straight into the recipe.

### Duplicate recipe as a starting point — S–M
A "Lag variant" action that clones a recipe into the new-recipe form (title +
" (variant)"), so iterating on a dish doesn't mean retyping it. Cheap given the
form already accepts pre-filled values from the import flow.
