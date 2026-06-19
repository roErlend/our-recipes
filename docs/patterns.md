# Patterns & conventions

How code is organized here. Match these when adding features — they're load-bearing
(several prevent the [server-import leak](./gotchas.md#server-import-leak)).

## Server functions are the only DB door

All database access goes through `src/server/*`, and every export there is either:

- a `createServerFn({ method })` with a `.validator((input) => zodSchema.parse(input))`
  and a `.handler(async ({ data }) => ...)`, or
- a `createServerOnlyFn(async (...) => ...)` helper (internal, not an RPC endpoint).

Client code never imports `@/db` or `drizzle-orm`. It imports the server fn and
calls it (`addManualItem({ data: input })`). Keep `db`/`postgres`/`perf_hooks`
**inside handler bodies**, never at module scope of anything a client file can
reach. See [gotchas.md](./gotchas.md#server-import-leak).

### Standard handler shape

```ts
export const doThing = createServerFn({ method: 'POST' })
  .validator((input: { recipeId: string }) =>
    z.object({ recipeId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()                       // 1. authenticate
    const { householdId, ownerIds } = await accessibleScope(user.id) // 2. resolve scope
    // 3. authorize (e.g. ownerIds.includes(recipe.ownerId)) then mutate, scoped to householdId
    return { ... }                                         // 4. return plain JSON
  })
```

- **Auth guards** (`src/server/auth.ts`): `requireUser()` throws `UNAUTHORIZED` if
  no session; `requireAdmin()` throws `FORBIDDEN` unless the email is `ADMIN_EMAIL`.
  `fetchSession()` is the nullable read used by the `_authed` route's `beforeLoad`.
- **Scope** every shared query/mutation by `householdId`; authorize recipe access
  by `ownerIds`. Never trust a scope/owner id from client input — derive it from
  the session via `accessibleScope`.
- Multi-statement writes run in `db.transaction(async (tx) => ...)`.

## Query/cache conventions

- All `queryOptions` live in `src/lib/queries.ts` — the **query-key registry**.
  Reuse them; don't hand-write `queryKey` arrays elsewhere. Keys in use:
  `['recipes']`, `['recipe', id]`, `['shopping']`, `['ingredients']`,
  `['categories']`, `['sharing']`, `['pending-invites']`, `['admin','ingredients']`.
- Route `loader`s prefetch with `context.queryClient.ensureQueryData(...)`;
  components read with `useSuspenseQuery`. The router has `defaultPreload: 'intent'`
  and nav links use `preload="render"`, so sections warm in the background.
- Mutations wrap server fns with `useMutation`, typically **optimistic**:
  `onMutate` cancels + snapshots + writes the optimistic cache, `onError` rolls
  back from the snapshot, `onSettled`/`onSuccess` invalidates. See the cart toggle
  in `src/routes/_authed/recipes/index.tsx` for the canonical example.

## Auth & route protection

- `src/routes/_authed.tsx` is the layout gate: `beforeLoad` redirects to `/login`
  without a session and puts `user` in route context (`Route.useRouteContext()`).
- Admin: the `/admin` nav + route are shown only for `isAdminEmail(user.email)`,
  but the **real enforcement is server-side** in `requireAdmin`. `ADMIN_EMAIL` is
  hardcoded in `src/lib/admin.ts` (it's an email, not a secret).
- better-auth config is in `src/lib/auth.ts` (email/password, 30-day sessions,
  `tanstackStartCookies()` plugin must stay **last**). The client helpers
  (`signIn`/`signOut`/`useSession`) are in `src/lib/auth-client.ts`.

## URL-synced search (no extra deps)

Recipe search syncs to `?q=` using native TanStack Router, **not** a library.
Pattern (see `src/routes/_authed/recipes/index.tsx`):

- `validateSearch` returns `{ q?: string }` — optional, **omitted when empty** so
  other links to `/recipes` needn't pass it.
- The input is driven by local `useState` (seeded from `Route.useSearch()`), and
  each edit mirrors to the URL inside the change handler with
  `navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true })`.
  Binding the input directly to async router state drops fast keystrokes — keep
  the local state. **No `useEffect`** is used for this (the maintainer dislikes
  unnecessary effects — prefer event handlers / derived values).

## Realtime writes (TanStack DB collections)

Realtime collections (`src/lib/shopping-collection.ts`) persist through the same
server fns and reconcile via the Postgres `txid`. See
[realtime-shopping-list.md](./realtime-shopping-list.md) for the full contract.

## UI conventions

- Components use **React Aria Components** wrapped with **tailwind-variants** (see
  `src/components/ui/*`). Buttons take `onPress` (not `onClick`), `isDisabled`,
  `variant`/`size` props.
- All user-facing copy is **Norwegian (bokmål)**; units are metric.
- Tailwind v4 (config-less; theme tokens like `brand-*` come from `styles.css`).
- The `/ingredients-to-json` skill (`.claude/skills/`) converts a plain-text
  ingredient list into the JSON the recipe form's "Importer JSON" dialog accepts.

## Code-style

`tsconfig` is strict with `noUnusedLocals`/`noUnusedParameters` and
`verbatimModuleSyntax` — use `import type { ... }` for type-only imports, and
remove unused bindings or `tsc` fails. Run `pnpm typecheck` before committing.
`routeTree.gen.ts` is generated by `tsr generate` (runs via the Vite plugin in
dev) — never edit it by hand; if a new route isn't picked up, run
`pnpm generate-routes`.
