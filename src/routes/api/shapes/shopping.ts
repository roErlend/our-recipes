import { createFileRoute } from '@tanstack/react-router'

import { auth } from '@/lib/auth'
import { accessibleScope } from '@/server/sharing'

/**
 * Auth proxy for the realtime shopping-list shape (Electric Cloud).
 *
 * The browser's TanStack DB collection points at this route — never at Electric
 * directly. Here we (1) authenticate the better-auth session, (2) resolve the
 * caller's household, and (3) forward to Electric's Shape API while injecting
 * the bits the client must NOT control: the table, a household-scoped `where`,
 * and the source credentials. This keeps the source secret server-side and
 * guarantees one household can never sync another's list.
 *
 * See https://electric-sql.com/docs/guides/auth (reverse-proxy pattern).
 */

const ELECTRIC_URL = process.env.ELECTRIC_URL ?? 'https://api.electric-sql.cloud'

/** Shape-definition + credential params the client is not allowed to set. */
const PROTECTED_PARAMS = new Set(['table', 'where', 'columns', 'replica', 'source_id', 'secret'])

export const Route = createFileRoute('/api/shapes/shopping')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session?.user) {
          return new Response('Unauthorized', { status: 401 })
        }

        const sourceId = process.env.ELECTRIC_SOURCE_ID
        const secret = process.env.ELECTRIC_SOURCE_SECRET
        if (!sourceId || !secret) {
          return new Response('Electric source is not configured', { status: 500 })
        }

        const { householdId } = await accessibleScope(session.user.id)

        const incoming = new URL(request.url)
        const upstream = new URL('/v1/shape', ELECTRIC_URL)

        // Pass through Electric's protocol params (offset, handle, live, cursor,
        // cache-busters…) but never the shape definition or credentials.
        for (const [key, value] of incoming.searchParams) {
          if (PROTECTED_PARAMS.has(key) || key.startsWith('params[')) continue
          upstream.searchParams.set(key, value)
        }

        // Server-controlled shape: this household's shopping_check rows only.
        upstream.searchParams.set('table', 'shopping_check')
        upstream.searchParams.set(
          'columns',
          'user_id,item_key,checked,override_quantity,updated_at',
        )
        upstream.searchParams.set('where', 'user_id = $1')
        upstream.searchParams.set('params[1]', householdId)
        upstream.searchParams.set('source_id', sourceId)
        upstream.searchParams.set('secret', secret)

        const res = await fetch(upstream, { signal: request.signal })

        // Stream Electric's response straight back, preserving the electric-*
        // and cache-control headers the client relies on. Drop encoding/length
        // since fetch may have already decompressed the body.
        const headers = new Headers(res.headers)
        headers.delete('content-encoding')
        headers.delete('content-length')

        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        })
      },
    },
  },
})
