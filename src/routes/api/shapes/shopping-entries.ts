import { createFileRoute } from '@tanstack/react-router'

import { auth } from '@/lib/auth'
import { accessibleScope } from '@/server/sharing'

/**
 * Auth proxy for the realtime shopping-list *entries* shape (Electric Cloud).
 *
 * Sibling of `/api/shapes/shopping` (the ticked-off state). This one streams the
 * `shopping_entry` rows — the actual contents of the list — so that when one
 * household member adds or removes a recipe (or an ad-hoc item), every member's
 * list updates live without a refresh. Same reverse-proxy contract: we
 * authenticate the session, resolve the household, and inject the table,
 * household `where` and credentials the client must not control.
 *
 * See https://electric-sql.com/docs/guides/auth (reverse-proxy pattern).
 */

const ELECTRIC_URL = process.env.ELECTRIC_URL ?? 'https://api.electric-sql.cloud'

/** Shape-definition + credential params the client is not allowed to set. */
const PROTECTED_PARAMS = new Set(['table', 'where', 'columns', 'replica', 'source_id', 'secret'])

export const Route = createFileRoute('/api/shapes/shopping-entries')({
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

        // Server-controlled shape: this household's shopping_entry rows only.
        // Columns mirror the client collection's schema (id is the row key).
        upstream.searchParams.set('table', 'shopping_entry')
        upstream.searchParams.set(
          'columns',
          'id,item_key,name,quantity,unit,source_recipe_id,source_title',
        )
        upstream.searchParams.set('where', 'scope_id = $1')
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
