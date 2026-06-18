import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '@/db'
import { account, session, user, verification } from '@/db/schema'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    // Hobby app for two people — no email server wired up, so don't gate on it.
    requireEmailVerification: false,
  },
  session: {
    // Keep us logged in for a good while; this is a private personal app.
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once a day
  },
  plugins: [
    // Must be last — bridges better-auth's cookie handling into TanStack Start.
    tanstackStartCookies(),
  ],
})
