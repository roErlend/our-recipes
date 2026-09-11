# Shared shopping list: cross-device sync (polling)

Both household members see one shopping list. Since September 2026 it stays in
sync by **polling the server snapshot** — no sync engine, no extra
infrastructure. The offline outbox (see
[offline-shopping-mode.md](offline-shopping-mode.md)) is the optimistic layer on
top.

> **History.** Until 2026-09-11 the list synced through Electric Cloud + TanStack
> DB (two read-only shapes over `shopping_check` and `shopping_entry`, auth
> proxies under `src/routes/api/shapes/`, txid round-trips). Electric Cloud was
> shut down that day (Electric joined Databricks; the engine stays open source),
> which made every check render as unchecked. Polling replaced it as the
> simplest fix for a two-person app. If realtime ever matters again, the
> candidates are self-hosting Electric or whatever Neon ships as its successor —
> the server functions and the outbox are unchanged, so only the read side would
> move.

## How it works

Everything lives in `src/routes/_authed/shopping.tsx`:

1. `getShoppingList` (server fn, `src/server/shopping.ts`) returns the whole
   list: aggregated items, each item's `checked` / `checkedAt`, manual quantity
   `overrides`, and the contributing recipes. It is the **single source of
   truth** for the page.
2. `ShoppingPage` reads it with `useSuspenseQuery` and `refetchInterval:
   POLL_INTERVAL_MS` (4 s). TanStack Query only polls while the tab is visible
   (`refetchIntervalInBackground` is off) and the interval is disabled while
   `navigator.onLine` is false. It also refetches on window focus and reconnect.
   So the other member's ticks, additions and quantity edits show up within one
   interval.
3. `SyncedShoppingList` layers the **outbox** on top: a pending check or quantity
   op wins over the snapshot until it has flushed. A pending check also floats to
   the top of the "Avhuket" section (`checkedAt = MAX_SAFE_INTEGER`).

## Writes

Checks and quantity edits never mutate the query cache directly:

- Toggling enqueues a `check` op, editing an amount a `quantity` op (coalesced per
  item / per unit) — `enqueueOp` in `src/lib/offline.ts`.
- `useShoppingFlush` replays them oldest-first through `setShoppingChecked` /
  `setItemQuantity`, then **awaits a `refetchQueries(['shopping'])` before the op
  is dropped**. That order matters: the overlay falls back to the snapshot, so the
  snapshot must already contain the write or the row would flick back to its old
  value until the next poll. `refetchQueries` cancels a poll that is already in
  flight, so a response captured before the write can't land afterwards.
- Adding/removing items and "Fjern avhukede" are ordinary TanStack Query
  mutations with optimistic updates that invalidate `['shopping']`.

## Things to keep in mind

- **Don't add a second source of truth for `checked`.** The previous design read
  checks from a synced collection while the list came from the snapshot; when the
  collection died, every item rendered unchecked even though the database was
  fine. Keep checks on the snapshot.
- **Keep the refetch before the op drop** in `useShoppingFlush` (see above).
- **Polling cost is one small server-fn call per 4 s per open tab**, only while
  visible and online. Tune `POLL_INTERVAL_MS` rather than adding cleverness.
- **Staleness window is one interval.** Two people ticking the *same* item within
  4 s can briefly disagree; the last write wins on the server and both converge
  on the next poll.
- The `['shopping']` query is wrapped in `withOfflineCache`, so the page still
  opens with the last snapshot when there is no signal.
