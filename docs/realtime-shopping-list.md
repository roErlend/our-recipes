# Realtime shopping list (Electric + TanStack DB)

The shared shopping list syncs across both household members via **Electric Cloud
+ TanStack DB**. This is the one piece of infrastructure beyond the otherwise
simple stack, and its gotchas aren't visible from the code alone.

## What syncs, and how

Two Electric **shapes** sync, each via an auth proxy under `src/routes/api/shapes/`
and a TanStack DB collection in `src/lib/shopping-collection.ts`:

| Shape          | Table            | Columns                                   | Client uses it to… |
| -------------- | ---------------- | ----------------------------------------- | ------------------ |
| `shopping`     | `shopping_check` | `checked` / `override_quantity`           | `checked` → **read directly** (ticked-off overlay, optimistic); `override_quantity` → **signal** (refetch on change) |
| `shopping-entries` | `shopping_entry` | list contents                         | **signal only** — detect contents changing, then refetch |

> The `shopping` shape carries two columns with *different* sync styles.
> `checked` is read straight from the collection (a per-row overlay → instant
> optimistic toggle). `override_quantity` (manual quantity edit) is server-applied
> into the displayed amount, so it can't be a simple overlay — instead its change
> is a **signal**: a signature over the override values (NOT `checked`, so plain
> toggles don't trigger it) drives a `['shopping']` refetch. Locally the edit is
> optimistic via the query cache; the signal makes it land on the other device.

Data path: browser collection ← `/api/shapes/*` auth proxy ← Electric Cloud
(`https://api.electric-sql.cloud/v1/shape`) ← tails the Neon WAL. **Writes never
go through Electric** — they go through the existing server functions
(`setShoppingChecked`, `addRecipeToShopping`, …) → Postgres → Electric streams the
change back to every browser.

## Checks: direct read, optimistic

`shopping_check` rows are read straight from the collection via `useLiveQuery`.
Toggling calls `shoppingChecksCollection.update/insert`, which is **optimistic**
(the checkbox flips immediately, ~instant, not after a round-trip). The collection's
`onInsert/onUpdate/onDelete` call the server fns, which run the write **and**
`SELECT pg_current_xact_id()` in the same transaction and return the `txid`;
TanStack DB matches that `txid` in the synced stream to clear its optimistic state.

## Entries: signal → refetch (NOT direct read)

The list **contents** (`shopping_entry`) sync as a *signal*, not by reading the
collection directly. In `RealtimeShoppingList` (`src/routes/_authed/shopping.tsx`):

1. `useLiveQuery` over `shoppingEntriesCollection` gives the synced rows.
2. A signature string is derived from them; when it changes (a recipe/item added
   or removed on **either** device), `['shopping']` is invalidated → the
   **server** re-aggregates via `getShoppingList`.
3. The displayed list still comes from the server snapshot; checks stay an overlay
   read from the check collection.

> **Do not** re-attempt reading/aggregating the list directly from the entry
> collection on the client. That was tried and **regressed check optimism** (the
> displayed checked state stopped coming purely from the optimistic check
> collection, adding a ~1s lag). Route entries through the refetch signal.

`getShoppingList` and the (pure) client aggregation share `aggregateShoppingEntries`
in `src/lib/shopping-aggregate.ts`, but currently only the server calls it.

## Setup / env

An Electric Cloud "Postgres Sync" source is connected to Neon via OAuth (which
enables logical replication). Credentials live in `.env`:

- `ELECTRIC_SOURCE_ID`, `ELECTRIC_SOURCE_SECRET` (+ optional `ELECTRIC_URL`).
- **Restart the dev server after changing them** — they're only read at boot.
- New tables sync automatically (Electric Cloud adds them to its publication on
  first shape request); `shopping_entry` needs a primary key for replication (it
  has `id`).

## Gotchas specific to realtime

- **The proxy pins the shape server-side.** Each `/api/shapes/*` route injects
  `table`, a household-scoped `where` (`scope_id = $1` / `user_id = $1` + the
  household id), `columns`, and `source_id`/`secret`, and **blocks the client**
  from setting any of those (`PROTECTED_PARAMS`). This scopes one household's data
  and keeps the secret off the client. `columns` **must include the primary-key
  columns** the collection's `getKey` uses (`item_key` for checks; `id` for
  entries).
- **The shape URL must be absolute.** Electric's `ShapeStream` does `new URL(url)`
  with no base, so a relative `/api/shapes/...` throws in the browser and sync
  silently never starts. `shopping-collection.ts` builds
  `` `${window.location.origin}/api/shapes/...` `` with an SSR placeholder.
- **`useLiveQuery` is not SSR-safe.** It starts syncing during render and would
  fetch a relative URL on the server. `shopping.tsx` gates it behind `useMounted()`:
  first paint renders from the server snapshot, then the live collections take over
  on the client.
- **Empty-collection flash:** a collection starts empty and fills on first sync.
  For *checks* that's benign (absence = unchecked). That's exactly why entries use
  signal→refetch instead of direct read — an empty entries collection would flash
  an empty list before the snapshot.

See the project memory note `electric-realtime-shopping-list` for additional
historical context.
