import { QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Two-person app, data changes rarely, and our own mutations already
        // invalidate the cache — so cache aggressively for instant navigation.
        // Returning to the tab still revalidates (refetchOnWindowFocus is on by
        // default), and the shopping list stays live via Electric regardless.
        staleTime: 5 * 60_000, // 5 min: revisits within a session are instant
        gcTime: 60 * 60_000, // keep cached an hour so back-nav stays warm
      },
    },
  })

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
