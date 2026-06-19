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

/** Register the service worker (client + production only). */
function useRegisterServiceWorker() {
  useEffect(() => {
    if (!import.meta.env.PROD) return
    if (!('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register('/sw.js')
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
