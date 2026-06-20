# CLAUDE.md

Orientation for working in **OurRecipies** — a small, private recipe +
shopping-list app for a two-person household. UI copy is **Norwegian (bokmål)**;
units are **metric**. Package manager is **pnpm**; dev runs on **port 3001**.

## Documentation map (`docs/`)

Read the doc that matches the task before diving into code:

- [docs/architecture.md](docs/architecture.md) — tech stack, rendering model, full source map, "where to look first".
- [docs/data-model.md](docs/data-model.md) — DB schema relationships: households/scope, recipes, the **materialized** shopping list + `item_key`, ingredient catalog.
- [docs/patterns.md](docs/patterns.md) — server-fn shape, auth guards, query/cache conventions, optimistic mutations, URL-synced search, UI conventions.
- [docs/realtime-shopping-list.md](docs/realtime-shopping-list.md) — Electric + TanStack DB: the two read-only shapes; checks (synced truth) vs entries (signal→refetch).
- [docs/offline-shopping-mode.md](docs/offline-shopping-mode.md) — in-store offline: query snapshot cache (readable offline) + durable mutation outbox (check/quantity queued, flushed on reconnect); the outbox *is* the optimistic overlay.
- [docs/gotchas.md](docs/gotchas.md) — server-import leak, SSR-unsafe `useLiveQuery`, dev image shim, stale service worker, port sprawl, generated files.
- [docs/dev-workflow.md](docs/dev-workflow.md) — commands, env vars, schema migrations, deployment, agent working notes.

(The root `README.md` is user-facing setup; some of it predates the current
shopping-list model — trust `docs/` + `src/db/schema.ts` for current behavior.)

## Critical rules (don't violate without reason)

1. **Never let `@/db` / `postgres` / `drizzle-orm` reach a client bundle.** Keep DB
   access inside `src/server/*` server-fn handlers; client code calls the server fn.
   Verify with the build + grep in [docs/gotchas.md](docs/gotchas.md#server-import-leak).
   This is the #1 source of breakage.
2. **Scope every shared query/mutation by `householdId`** and authorize recipes by
   `ownerIds`, both from `accessibleScope(user.id)` — never from client input.
3. **`useLiveQuery` is client-only** — gate behind `useMounted()`.
4. **The production DB has real users + real data.** Don't mutate it as a test;
   create/delete a throwaway account if you must, and never touch the real users.
5. **Commit only when asked**, with no `Co-Authored-By` trailer. Direct-to-`main`.
6. Run `pnpm typecheck` (and `pnpm build` for boundary changes) before committing.
   `routeTree.gen.ts` is generated — don't hand-edit it.

## Quick facts

- Server fns: `createServerFn`/`createServerOnlyFn` in `src/server/*`; query keys
  registered in `src/lib/queries.ts`.
- Auth: better-auth (email/password); `_authed` route gates with `fetchSession`;
  server fns use `requireUser`/`requireAdmin`. Admin = `ADMIN_EMAIL` in `src/lib/admin.ts`.
- Realtime: Electric Cloud syncs `shopping_check` (live, optimistic) and
  `shopping_entry` (signal→refetch). Auth proxies in `src/routes/api/shapes/`.
