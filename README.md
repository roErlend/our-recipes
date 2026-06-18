# Our Recipes 🍲

A small, private recipe app for two people. Save your own recipes or link to
ones you love, mark which ones you want to cook this week, and turn that
selection into a combined shopping list.

## Stack

| Concern        | Choice                                                        |
| -------------- | ------------------------------------------------------------- |
| Framework      | [TanStack Start](https://tanstack.com/start) (React 19, Vite) |
| Routing / data | TanStack Router (file-based) + server functions               |
| Styling        | Tailwind CSS v4 + [tailwind-variants](https://tailwind-variants.org) |
| UI primitives  | [React Aria Components](https://react-spectrum.adobe.com/react-aria/) |
| Database       | Postgres on [Neon](https://neon.tech) (generous free tier)    |
| ORM            | [Drizzle ORM](https://orm.drizzle.team)                       |
| Auth           | [better-auth](https://better-auth.com) (shared email/password)|

## Project layout

```
src/
├── db/
│   ├── schema.ts          # Drizzle schema: auth tables, recipe, ingredient, shopping_check
│   └── index.ts           # Drizzle client (postgres.js)
├── lib/
│   ├── auth.ts            # better-auth server instance
│   └── auth-client.ts     # better-auth React client
├── server/
│   ├── auth.ts            # session helpers (server-only)
│   ├── recipes.ts         # recipe CRUD / search / active toggle (server functions)
│   └── shopping.ts        # shopping-list aggregation (server functions)
├── components/
│   ├── RecipeForm.tsx     # shared create/edit form
│   └── ui/                # Button, TextField, Checkbox (React Aria + tailwind-variants)
└── routes/
    ├── __root.tsx
    ├── index.tsx          # → redirects to /recipes
    ├── login.tsx          # sign in / sign up
    ├── api/auth/$.ts      # better-auth request handler
    └── _authed/           # everything behind the login wall
        ├── recipes/       # list, new, $recipeId (detail), $recipeId/edit
        └── shopping.tsx   # generated shopping list
```

## Setup

### 1. Environment

Copy the example and fill in your values:

```bash
cp .env.example .env
```

- `DATABASE_URL` — your Neon connection string (Neon dashboard → Connection string).
- `BETTER_AUTH_SECRET` — any 32+ char random string. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
  ```
- `BETTER_AUTH_URL` — the app's base URL (`http://localhost:3000` in dev; your
  deployed URL in production).

> The database is already provisioned and the schema has been migrated. If you
> ever recreate the database, run the migration step below.

### 2. Install & migrate

```bash
pnpm install
pnpm db:migrate   # applies drizzle/*.sql to the database in DATABASE_URL
```

### 3. Run

```bash
pnpm dev          # http://localhost:3000
```

On first run, open the app and use **Sign up** to create your account (and one
for your partner). Everyone shares the same recipe collection.

## Database commands

| Command            | What it does                                                   |
| ------------------ | -------------------------------------------------------------- |
| `pnpm db:generate` | Generate a new SQL migration from changes to `schema.ts`       |
| `pnpm db:migrate`  | Apply pending migrations to the database                       |
| `pnpm db:push`     | Push the schema directly (quick, skips migration files)        |
| `pnpm db:studio`   | Open Drizzle Studio to browse/edit data                        |

After editing `src/db/schema.ts`, run `pnpm db:generate` then `pnpm db:migrate`.

## How it works

- **Recipes** can be fully written out (ingredients + instructions) or just a
  title plus a `sourceUrl` link to an external site. Tags power search.
- **Active this week** is a boolean on each recipe, toggled from the list or
  the detail page.
- **Shopping list** (`/shopping`) aggregates the ingredients of every active
  recipe, summing quantities that share the same name + unit. Ticked-off items
  are remembered in the `shopping_check` table; "Reset ticks" clears them.

## Other scripts

```bash
pnpm build        # production build
pnpm preview      # serve the production build locally
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest
```

## Deploying

`pnpm build` produces a Node server under `dist/` (run it with
`pnpm preview`, or deploy with a TanStack Start deployment adapter). Host it
anywhere that runs Node (Netlify, Railway, Fly, a VPS…). Set the same env vars
in your host, and point `BETTER_AUTH_URL` at the deployed URL. Neon works from
anywhere over its pooled connection string.
