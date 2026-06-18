import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
}

// Reuse the postgres client across HMR reloads in dev to avoid exhausting connections.
const globalForDb = globalThis as unknown as {
  __ourRecipesPg?: ReturnType<typeof postgres>
}

const client =
  globalForDb.__ourRecipesPg ?? postgres(connectionString, { prepare: false })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__ourRecipesPg = client
}

export const db = drizzle(client, { schema })
export { schema }
