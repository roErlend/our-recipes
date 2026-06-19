# Dev workflow

## Commands

Package manager is **pnpm** (canonical lockfile). Scripts:

| Command               | What it does                                              |
| --------------------- | -------------------------------------------------------- |
| `pnpm dev`            | Dev server on **http://localhost:3001**                  |
| `pnpm build`          | Production build (Vite + Nitro → `.output/`)             |
| `pnpm preview`        | Serve the production build locally                       |
| `pnpm typecheck`      | `tsc --noEmit`                                            |
| `pnpm test`           | `vitest run` — harness installed (vitest + jsdom + Testing Library), but there are **no test files yet** |
| `pnpm generate-routes`| `tsr generate` — regenerate `routeTree.gen.ts`           |
| `pnpm db:generate`    | Generate a migration from `schema.ts` changes            |
| `pnpm db:migrate`     | Apply pending `drizzle/*.sql` migrations                 |
| `pnpm db:push`        | Push schema directly (skips migration files)             |
| `pnpm db:studio`      | Drizzle Studio (browse/edit data)                        |
| `pnpm db:seed`        | Seed the stock ingredient catalog (`scripts/seed-ingredients.mjs`) |

### Before committing

Run `pnpm typecheck` and `pnpm build`, and for any change touching the server/DB
boundary, the [client-leak grep](./gotchas.md#server-import-leak). These three are
the standard pre-commit checks used in this repo.

## Schema changes

Edit `src/db/schema.ts`, then `pnpm db:generate` → `pnpm db:migrate`. drizzle-kit
is configured for `snake_case` and reads `DATABASE_URL` from `.env`
(`drizzle.config.ts`).

## Environment (`.env`, gitignored)

| Var                       | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`            | Neon connection string                                         |
| `BETTER_AUTH_SECRET`      | 32+ char random string                                         |
| `BETTER_AUTH_URL`         | App base URL (`http://localhost:3001` in dev)                  |
| `ELECTRIC_SOURCE_ID`      | Electric Cloud source id (realtime)                            |
| `ELECTRIC_SOURCE_SECRET`  | Electric Cloud source secret (server-side only)                |
| `ELECTRIC_URL`            | optional; defaults to `https://api.electric-sql.cloud`         |

Restart the dev server after changing any of these (read at boot).

## Deployment

- Hosted on **Vercel**. The Vite config includes the Nitro plugin; Vercel
  auto-detects TanStack Start + Nitro and uses its `vercel` preset (no build
  command/output config needed). `vercel.json` pins the function region to
  **`lhr1` (London)** — close to the users and to Neon, for low latency. Don't
  move it to a US region.
- **Auto-deploys on push to `main`.** The repo workflow is direct-to-`main` (no
  PR flow). Push happens manually by the maintainer.

## Working in this repo (agent notes)

- **Commit only when explicitly asked.** End commit messages with no
  `Co-Authored-By` trailer.
- There are **real users with real data** in the production database this dev
  server points at. Don't mutate real recipes / shopping items as a test. If you
  need a test account, create it and delete it afterward; never touch the existing
  real users.
- Prefer the `Read`/`Grep`/`Glob` tools over `cat`/`grep`/`find` in shell.
- The maintainer dislikes unnecessary `useEffect`s — prefer event handlers and
  derived values (see the URL-search pattern in [patterns.md](./patterns.md)).
