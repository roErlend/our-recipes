import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { auth } from '@/lib/auth'

/** Returns the current session (and user) or null. Safe to call anywhere on the server. */
export const fetchSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await auth.api.getSession({
      headers: new Headers(getRequestHeaders() as HeadersInit),
    })
    return session
  },
)

/**
 * Server-side guard for use inside server functions. Throws if not signed in,
 * otherwise returns the authenticated user.
 */
export const requireUser = createServerOnlyFn(async () => {
  const session = await auth.api.getSession({
    headers: new Headers(getRequestHeaders() as HeadersInit),
  })
  if (!session?.user) {
    throw new Error('UNAUTHORIZED')
  }
  return session.user
})
