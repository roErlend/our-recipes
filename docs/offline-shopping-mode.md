# Offline "in-store mode" for the shopping list

The shopping list is used exactly where signal is worst — in a shop — so it has to
keep working offline: open the app, see the list, tick items off and adjust
amounts, and have those edits sync once you're back on the network. All of this
lives in **`src/lib/offline.ts`** (client-only, dependency-free) plus its wiring in
`shopping.tsx` and `queries.ts`.

## Two pieces

### 1. Reading the list offline — query snapshot cache

`withOfflineCache(key, fn)` wraps a query fn: on success it stashes the result in
IndexedDB (`ourrecipes-offline` → `cache` store); on failure it returns the last
stashed result instead of throwing. Applied to `shopping`, `ingredients` and
`categories` in `queries.ts`, so the shopping route loader resolves offline and the
page renders from the cached snapshot. (The service worker, `public/sw.js`, caches
the HTML/JS so the app shell loads with no signal; it still **never** caches `/api`.)

### 2. Writing offline — the durable outbox

Check toggles and quantity edits are **not** sent directly. They're enqueued into
IndexedDB (`outbox` store) and replayed later:

- `enqueueOp({type:'check'|'quantity', key, value})` — coalesced to one pending op
  per `(type, item)` (id `check:<key>` / `quantity:<key>`); a re-toggle replaces
  the previous one. Each op gets a monotonic `seq` (orders the queue and uniquely
  identifies an instance — a wall clock can collide at sub-ms speed).
- **The outbox *is* the optimistic overlay.** `useOutbox()` derives
  `pendingChecked` / `pendingOverride` maps; in `RealtimeShoppingList` a pending
  value wins over the Electric-synced value. So a queued change keeps showing —
  instantly, and across a reload while offline (the outbox is persisted) — until it
  has actually synced.
- `flushOutbox(execute)` replays ops oldest-first via the server fns. It stops at
  the first failure (we're likely offline) and retries on the next trigger. An op
  is dropped **only if it still holds the value we sent** (`seq` unchanged), so a
  re-toggle mid-flight isn't lost. The executor waits for the write's `txid` via
  `shoppingChecksCollection.utils.awaitTxId` (and, for quantities, refetches the
  server-computed snapshot) before the pending overlay is dropped — no flicker.
- **Flush triggers** (`useShoppingFlush`): on mount, on the `online` event, on tab
  `visibilitychange`, and right after each enqueue. `flushOutbox` no-ops when
  `navigator.onLine === false` or already flushing.

## Scope / deliberate limits

- **Queued offline:** check toggles + quantity edits (incl. the ± steppers and
  clearing back to the computed sum). That's the in-store flow.
- **Online-only (disabled with a hint when offline):** adding a new item, removing
  a line, and "Fjern avhukede". These touch the catalog / recipe-expansion /
  entry deletes server-side; they wait for signal.
- A banner shows the **offline** state (with an "N venter" queued count). Online
  syncing is intentionally silent — it's sub-second, and flashing a banner on every
  toggle just shifts the layout.

## Gotchas

- **Test offline with a production build.** The SW is registered only in prod
  (`import.meta.env.PROD`) and actively unregistered in dev (see `__root.tsx`), so
  cold-open-offline only works under `pnpm build` + `pnpm preview` (or deployed) —
  not `pnpm dev`.
- **IndexedDB is best-effort.** Every idb call is wrapped in try/catch and degrades
  to in-memory (so jsdom/SSR and private-mode quirks don't break the queue). jsdom
  has no IndexedDB, which is why `offline.test.ts` exercises the in-memory queue.
- **The checks collection is read-only now.** Don't re-add `onInsert/onUpdate` to
  `shoppingChecksCollection` — writes must stay on the outbox path or offline edits
  will roll back again. See [realtime-shopping-list.md](realtime-shopping-list.md).
