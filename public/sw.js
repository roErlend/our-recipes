// Service worker for Våre oppskrifter (hand-rolled — robust with TanStack
// Start's SSR/Nitro build, which doesn't emit a static asset manifest).
//
// Strategy:
//   - API (/api/*) and non-GET requests: never touched -> always network.
//     This is critical: better-auth and the Electric realtime long-poll
//     (/api/shapes/shopping) must never be served from cache.
//   - Static assets (hashed js/css/img/fonts): cache-first (immutable).
//   - Page navigations: network-first, falling back to the last cached copy
//     (or a minimal offline page) so visited pages still open without signal.
//
// Bump CACHE to invalidate everything on the next visit.
const CACHE = 'or-cache-v1'

const OFFLINE_HTML =
  '<!doctype html><html lang="no"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Frakoblet</title><style>body{font-family:system-ui,sans-serif;' +
  'background:#f5f5f4;color:#1c1917;display:grid;place-items:center;' +
  'min-height:100vh;margin:0;padding:24px;text-align:center}</style></head>' +
  '<body><div><h1>Du er frakoblet</h1>' +
  '<p>Åpne en side du har besøkt før, eller koble til igjen.</p></div></body></html>'

const ASSET_RE = /\.(?:js|css|woff2?|png|svg|ico|jpe?g|webp|gif)$/

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop old cache versions.
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only same-origin GETs; never the API (auth + Electric realtime stream).
  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Page navigations: network-first, fall back to cache, then offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request)
          const cache = await caches.open(CACHE)
          cache.put(request, res.clone())
          return res
        } catch {
          const cached = await caches.match(request)
          return (
            cached ||
            new Response(OFFLINE_HTML, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          )
        }
      })(),
    )
    return
  }

  // Hashed static assets: cache-first.
  if (ASSET_RE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        const res = await fetch(request)
        const cache = await caches.open(CACHE)
        cache.put(request, res.clone())
        return res
      })(),
    )
  }
})
