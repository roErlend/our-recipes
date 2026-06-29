import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '@/db'
import { account, session, user, verification } from '@/db/schema'
import { sendEmail, verificationEmailHtml } from '@/server/email'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    // New signups must confirm their email before they can sign in. Existing
    // accounts were backfilled to email_verified = true so they're unaffected.
    requireEmailVerification: true,
  },
  emailVerification: {
    // The login page sends the verification link explicitly (inline) after
    // signup instead of relying on this background send — that's more reliable
    // and also covers a repeat signup of an unverified account, which better-auth
    // answers with a generic success and no email. Kept false to avoid a
    // duplicate for brand-new users. Sign-in of an unverified account still
    // auto-sends via better-auth.
    sendOnSignUp: false,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user: u, url }) => {
      await sendEmail({
        to: u.email,
        subject: 'Bekreft e-posten din – Våre oppskrifter',
        html: verificationEmailHtml(u.name, url),
      })
    },
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
