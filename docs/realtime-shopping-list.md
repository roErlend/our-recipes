# Realtime shopping list (Electric + TanStack DB)

The shared shopping list syncs across both household members via **Electric Cloud
+ TanStack DB**. This is the one piece of infrastructure beyond the otherwise
simple stack, and its gotchas aren't visible from the code alone.

## What syncs, and how

Two Electric **shapes** sync, each via an auth proxy under `src/routes/api/shapes/`
and a TanStack DB collection in `src/lib/shopping-collection.ts`:

| Shape          | Table            | Columns                                   | Client uses it to… |
| -------------- | ---------------- | ----------------------------------------- | ------------------ |
| `shopping`     | `shopping_check` | `checked` / `override_quantity`           | `checked` → **read directly** (synced truth; the optimistic overlay is the offline outbox, not the collection); `override_quantity` → **signal** (refetch on change) |
| `shopping-entries` | `shopping_entry` | list contents                         | **signal only** — detect contents changing, then refetch |

> Both collections are **read-only**. Writes never go through TanStack DB's
> optimistic transactions — see "Checks + quantities" below and
> [offline-shopping-mode.md](offline-shopping-mode.md).

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

## Checks + quantities: read-only collection, writes via the offline outbox

`shopping_check` rows are read straight from the collection via `useLiveQuery` for
the **synced server truth**. The collection is **read-only** — it defines no
`onInsert/onUpdate/onDelete`. Writes (check toggles and quantity overrides) instead
go through the **durable offline outbox** in `src/lib/offline.ts` (see
[offline-shopping-mode.md](offline-shopping-mode.md)):

- Toggling enqueues a `check` op; editing an amount enqueues a `quantity` op
  (coalesced per item). The **outbox is the optimistic overlay** — a pending op
  wins over the synced value until it has flushed, so the box flips instantly and
  *stays* flipped even if the network is down (or the page reloads offline).
- `flushOutbox` replays ops via the server fns (`setShoppingChecked` /
  `setItemQuantity`), which run the write **and** `SELECT pg_current_xact_id()` in
  one transaction and return the `txid`. The flusher waits for that txid via
  `shoppingChecksCollection.utils.awaitTxId(...)` before dropping the pending
  overlay, so there's no flicker between "queued" and "synced".

> Earlier this path used the collection's own optimistic transactions
> (`collection.update` → `onUpdate` → server fn → txid match). That **rolled the
> optimistic flip back when the write failed offline** — the whole point of the
> outbox is to keep it instead and retry on reconnect.

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
