# Data model

The schema lives in `src/db/schema.ts` (Drizzle, `snake_case` columns). Migrations
are in `drizzle/*.sql`. This doc explains the non-obvious relationships — read it
alongside the schema, not instead of it.

## Households and scope (the key concept)

There is no separate "household" table. Membership lives in `household_member`:

- `household_member.user_id` (PK) → `household_member.household_id` (the shared scope).
- A user **with no row** is their own household: their scope id **is their own user id**.
- Accepting an invite ([sharing.ts](../src/server/sharing.ts)) puts both users'
  rows under one `household_id` (the inviter's, materialized on first share).

`accessibleScope(userId)` in `src/server/sharing.ts` is the single resolver every
server function uses. It returns:

- `householdId` — the shared scope id. **Everything shared is keyed by this**:
  the shopping list (`shopping_entry.scope_id`, `shopping_check.user_id`) and
  household ingredient catalog entries.
- `ownerIds` — the user ids whose recipes this user may see/administer (all
  household members, or just themselves when solo).

> The `shopping_check.user_id` column name is historical — it actually holds a
> **household id**, not a user id. Same for the opaque `scope_id` columns.

## Recipes

`recipe` — owned by a user (`owner_id`, stored in the DB column `created_by`).
Recipes are **private to the owner** unless shared via the household. A recipe
can be fully written out (with `ingredient` rows + `instructions`) or just a
title + `source_url` linking to an external site. `tags` (text[]) power search.

- `ingredient` — a recipe's ingredient lines (`recipe_id`, name, quantity, unit,
  note, sort_order). Distinct from the **catalog** below.
- `recipe_image` — one uploaded image per recipe, stored as `bytea`. Kept in its
  own table so ordinary recipe queries never load the blob; served only via
  `/api/recipes/$recipeId/image`. A recipe has *either* an uploaded image here
  *or* an external `recipe.image_url`, never both.
- `recipe_rating` — one 1–10 score per (recipe, user). The overview's default
  ordering is by average rating; the detail page shows each member's vote.

Access checks use `ownerIds`: a server fn loads the recipe, then verifies
`ownerIds.includes(recipe.ownerId)` before mutating.

## Shopping list (materialized)

The list is an explicit, persistent table — **not** derived live from "active"
recipes. See [shopping-list-model below](#shopping-list-flow).

- `shopping_entry` — **one row per contribution**. Added either from a recipe
  (`source_recipe_id` set, `source_title` denormalized for display) or typed
  ad-hoc (`source_recipe_id` null). Persists until explicitly removed.
- `shopping_check` — per-item state, keyed by `(scope_id, item_key)`:
  - `checked` — "ticked off" state. Syncs in realtime via Electric.
  - `override_quantity` (nullable) — a **manual quantity override** for the
    aggregated line. When set, it replaces the summed quantity on display (the
    contributing entries are untouched, so recipe linkage / on-list status are
    preserved); null means "use the computed sum". Edited via `setItemQuantity`
    and applied at read time in `getShoppingList`. It lives here (not on
    `shopping_entry`) precisely so it survives recipe re-aggregation, like
    `checked`. It rides the same Electric `shopping` shape, so an edit syncs
    across devices: locally it's optimistic via the `['shopping']` query cache;
    remotely the streamed override change triggers a `['shopping']` refetch
    (signal→refetch, like the list contents — see
    [realtime-shopping-list.md](./realtime-shopping-list.md)).

### item_key — the merge key

```
item_key = `${name.trim().toLowerCase()}__${(unit ?? '').trim().toLowerCase()}`
```

Defined by `itemKey()` in `src/server/shopping.ts`. Two contributions with the
same name+unit (e.g. garlic from two recipes) **merge into one displayed line**,
summing quantities. `shopping_check` rows are keyed by the same `item_key`, so
ticking survives recipe re-aggregation. **If you change the key formula, change
it in one place** — checks and entries must agree.

### shopping-list flow

- **Add a recipe** → delete that recipe's prior `shopping_entry` rows, insert
  fresh ones (idempotent), and clear any leftover `shopping_check` for those keys
  (so a re-added recipe isn't pre-ticked).
- **Remove a recipe** → delete its `shopping_entry` rows; orphaned `shopping_check`
  rows (no surviving entry) are cleaned up.
- **A recipe counts as "on the list"** (`recipesOnShoppingList` in
  `src/server/recipes.ts`) as long as it has **any** `shopping_entry` row.
  Ticking items off does **not** drop it — removal is manual. (An earlier
  auto-drop-when-all-checked behavior was deliberately removed; don't reintroduce
  it.)

The displayed list is computed by `getShoppingList` (server) via the pure
`aggregateShoppingEntries` helper in `src/lib/shopping-aggregate.ts` (merge by
key, sum quantities, resolve category, attach checked state).

## Ingredient catalog

`ingredient_catalog` powers the add-box autocomplete and the shopping list's
category grouping. Two kinds of rows, distinguished by `scope_id`:

- **template** (`scope_id` NULL) — the admin-curated starter set (`pnpm db:seed`,
  edited on `/admin`). Households never read templates directly.
- **household** (`scope_id` = household id) — the rows a household actually sees:
  its private copy of the templates plus everything it added or edited itself.

**Template copy model.** A household's catalog is initialized as a full **copy**
of the templates the first time the household touches the catalog
(`ensureScopeSeeded` in `src/server/ingredients.ts`; the `catalog_seed` marker
table makes this once-per-scope). From then on the household owns every row
outright — `/ingredienser` (`src/routes/_authed/ingredienser.tsx`, all users)
edits, renames and deletes freely, always scoped by `householdId`. Later admin
changes to the templates do **not** propagate; a household pulls a fresh copy
via the **reset** buttons on `/ingredienser` (`resetHouseholdCatalog` /
`resetHouseholdCategories` — destructive, confirmation-gated: they wipe the
household's rows and re-copy the templates). Migration `0004` backfilled the
copy into every scope that existed at the switch (additive, `ON CONFLICT DO
NOTHING`, existing household rows won).

`ingredient_category` follows the same model: `scope_id` NULL = template (the
canonical list in `src/lib/categories.ts` ∪ admin-created rows), else the
household's own category. Partial unique indexes keep the two kinds from
colliding. The category set a household sees = its own rows ∪ categories used by
its catalog rows (`listCategories`); the default category («Annet») can't be
deleted since it's the reassignment target. Ordering/normalization helpers live
in `src/lib/categories.ts` (client-safe, no DB import). `/admin` server fns
(`src/server/admin.ts`) are all scoped `scope_id IS NULL` — they must never
touch household copies.

## Auth tables

`user`, `session`, `account`, `verification` — standard better-auth tables
(column names match better-auth defaults so the Drizzle adapter maps them). Don't
rename their columns.

## Invites

`invite` — a pending invitation (`from_user_id` → `to_email`, lowercased). No
email is sent; the invitee sees it as a banner on login. Consumed (deleted) on
accept/decline.
