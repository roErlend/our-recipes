import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { recipe, recipeImage } from '@/db/schema'
import { auth } from '@/lib/auth'
import { accessibleScope } from '@/server/sharing'

/**
 * Serves a recipe's uploaded image (stored as bytes in Postgres). Same-origin
 * `<img>` requests carry the better-auth cookie, so we can authenticate and
 * scope-check here: a member may only fetch images for recipes their household
 * can see. The URL is cache-busted by the image's updated time, so we can cache
 * privately for a while.
 */
export const Route = createFileRoute('/api/recipes/$recipeId/image')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        // Never let an error response get (heuristically) cached by the browser
        // — otherwise a transient 401/404 sticks to this URL even after it's
        // fixed, and the image stays broken until the cache is purged.
        const errorHeaders = { 'cache-control': 'no-store' }

        const session = await auth.api.getSession({ headers: request.headers })
        if (!session?.user) {
          return new Response('Unauthorized', { status: 401, headers: errorHeaders })
        }

        // Derive the id from the path rather than relying on the handler's
        // `params` shape (it isn't reliably populated for server routes here).
        const match = new URL(request.url).pathname.match(
          /\/api\/recipes\/([^/]+)\/image\/?$/,
        )
        const recipeId = match
          ? decodeURIComponent(match[1])
          : (params as { recipeId?: string })?.recipeId
        if (!recipeId) {
          return new Response('Not found', { status: 404, headers: errorHeaders })
        }

        const { ownerIds } = await accessibleScope(session.user.id)

        const [owner] = await db
          .select({ ownerId: recipe.ownerId })
          .from(recipe)
          .where(eq(recipe.id, recipeId))
          .limit(1)
        if (!owner || !ownerIds.includes(owner.ownerId)) {
          return new Response('Not found', { status: 404, headers: errorHeaders })
        }

        const [img] = await db
          .select()
          .from(recipeImage)
          .where(eq(recipeImage.recipeId, recipeId))
          .limit(1)
        if (!img) {
          return new Response('Not found', { status: 404, headers: errorHeaders })
        }

        return new Response(new Uint8Array(img.data), {
          status: 200,
          headers: {
            'content-type': img.contentType,
            'content-length': String(img.byteSize),
            'cache-control': 'private, max-age=31536000, immutable',
          },
        })
      },
    },
  },
})
