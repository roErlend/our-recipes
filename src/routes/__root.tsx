import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        // viewport-fit=cover lets the app draw under the notch; the CSS uses
        // env(safe-area-inset-*) to keep content clear of it.
        content:
          'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: 'Våre oppskrifter' },
      { name: 'theme-color', content: '#2f9e5e' },
      // iOS: open fullscreen from the home screen and label/style it like an app.
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'Oppskrifter' },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'default',
      },
      { name: 'mobile-web-app-capable', content: 'yes' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  shellComponent: RootDocument,
})

/**
 * In production: register the service worker.
 * In development: do the opposite — actively unregister any service worker and
 * drop its caches. A SW registered by an earlier `vite preview`/production build
 * on this same localhost origin keeps controlling the dev site and serves stale
 * assets/HTML that survive hard refreshes (and confusingly breaks things like
 * freshly added image routes). This makes dev self-heal on next load.
 */
function useRegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (import.meta.env.PROD) {
      void navigator.serviceWorker.register('/sw.js')
      return
    }
    void navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => void r.unregister()))
    if ('caches' in window) {
      void caches.keys().then((keys) => keys.forEach((k) => void caches.delete(k)))
    }
  }, [])
}

function RootDocument({ children }: { children: React.ReactNode }) {
  useRegisterServiceWorker()
  return (
    <html lang="no">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
