# Architecture

A small, private recipe + shopping-list app for a two-person household. Save or
link recipes, add a recipe's ingredients to a shared shopping list, and tick
items off in realtime across both members' devices. UI copy is **Norwegian
(bokmål)**; quantities are **metric**.

## Tech stack

| Concern         | Choice                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| Framework       | [TanStack Start](https://tanstack.com/start) (React 19, Vite 7, Nitro) |
| Routing / data  | TanStack Router (file-based) + server functions                        |
| Server state    | TanStack Query (`@tanstack/react-query`)                               |
| Realtime sync   | [Electric](https://electric-sql.com) Cloud + [TanStack DB](https://tanstack.com/db) (`@tanstack/react-db` + `@tanstack/electric-db-collection`) |
| Database        | Postgres on [Neon](https://neon.tech), via `postgres.js`               |
| ORM / migrations| [Drizzle ORM](https://orm.drizzle.team) + drizzle-kit (`snake_case`)   |
| Auth            | [better-auth](https://better-auth.com) (email/password)                |
| Styling         | Tailwind CSS v4 + tailwind-variants                                    |
| UI primitives   | [React Aria Components](https://react-spectrum.adobe.com/react-aria/)  |
| Icons           | lucide-react                                                           |
| Validation      | Zod v4                                                                  |
| Hosting         | Vercel (Nitro `vercel` preset), London region `lhr1`                   |
| Package manager | **pnpm** (`pnpm-lock.yaml` is canonical)                               |

## Rendering model

TanStack Start is **isomorphic-by-default**: route components run on both server
(SSR) and client (hydration). Anything that must run only on the server (DB
access, secrets, session) goes through `createServerFn` / `createServerOnlyFn`.
This boundary is load-bearing — see [gotchas.md](./gotchas.md#server-import-leak).

Typical request flow for an authed page:

1. `_authed` route `beforeLoad` calls `fetchSession()` (server fn) and redirects
   to `/login` if there's no session.
2. The route `loader` calls `queryClient.ensureQueryData(...)` to prefetch data
   (server functions → Drizzle → Neon), so the first paint is populated.
3. The component reads that data with `useSuspenseQuery`, and mutates via
   `useMutation` wrapping server functions (usually with optimistic updates).
4. The shopping list's *checked* state additionally syncs live through Electric
   (see [realtime-shopping-list.md](./realtime-shopping-list.md)).

## Source map (`src/`)

```
src/
├── router.tsx                 # createRouter + Query integration, defaultPreload
├── styles.css                 # Tailwind v4 entry
├── db/
│   ├── schema.ts              # Drizzle schema — the source of truth for the data model
│   └── index.ts               # postgres.js client + drizzle instance (HMR-safe singleton)
├── lib/                       # client-safe + isomorphic helpers (NO top-level db imports here except auth.ts/queries.ts edges)
│   ├── auth.ts                # better-auth server instance (imports db — server-only in practice)
│   ├── auth-client.ts         # better-auth React client (signIn/signOut/useSession)
│   ├── admin.ts               # ADMIN_EMAIL + isAdminEmail (pure)
│   ├── categories.ts          # canonical grocery categories, ordering, normalize (pure, client-safe)
│   ├── image.ts               # client-side image resize before upload
│   ├── queries.ts             # shared TanStack Query `queryOptions` (the query-key registry)
│   ├── shopping-aggregate.ts  # pure shopping-list aggregation (shared by server + types)
│   └── shopping-collection.ts # TanStack DB collections synced from Electric (checks + entries)
├── server/                    # server-only modules; every export is a server fn or createServerOnlyFn
│   ├── auth.ts                # fetchSession, requireUser, requireAdmin
│   ├── sharing.ts             # accessibleScope (household resolution) + invites
│   ├── recipes.ts             # recipe CRUD / search / ratings / images
│   ├── ingredients.ts         # ingredient catalog + categories
│   ├── shopping.ts            # shopping-list read + mutations + realtime check fns
│   └── admin.ts               # admin-only catalog/category management
├── components/
│   ├── RecipeForm.tsx         # shared create/edit form (+ JSON import)
│   ├── AddShoppingItem.tsx    # add box with catalog autocomplete
│   ├── StarRating.tsx
│   └── ui/                    # Button, TextField, Checkbox (React Aria + tailwind-variants)
└── routes/                    # file-based routes; routeTree.gen.ts is generated (do not hand-edit)
    ├── __root.tsx             # document shell, head/meta, service-worker registration
    ├── index.tsx              # → redirects to /recipes
    ├── login.tsx              # sign in / sign up
    ├── api/
    │   ├── auth/$.ts          # better-auth request handler
    │   ├── recipes/$recipeId/image.ts   # serves uploaded recipe images (bytea)
    │   └── shapes/            # Electric auth proxies (shopping, shopping-entries)
    └── _authed/               # behind the login wall; renders pending-invite banner + nav
        ├── recipes/           # index (list), new, $recipeId (detail), $recipeId_.edit
        ├── shopping.tsx       # the shared shopping list
        ├── deling.tsx         # invites & household sharing ("deling" = sharing)
        └── admin.tsx          # admin-only ingredient/category management
```

## Path aliases

`@/*` and `#/*` both map to `src/*` (see `tsconfig.json`). The codebase uses
`@/` everywhere, e.g. `import { db } from '@/db'`.

## Where to look first

- **Data model / "what is X stored as"** → `src/db/schema.ts` and [data-model.md](./data-model.md).
- **"How does the app talk to the DB"** → `src/server/*` and [patterns.md](./patterns.md).
- **Query keys / cache** → `src/lib/queries.ts`.
- **Realtime / Electric** → [realtime-shopping-list.md](./realtime-shopping-list.md).
- **"Why did this break"** → [gotchas.md](./gotchas.md).
- **Commands / env / deploy** → [dev-workflow.md](./dev-workflow.md).
