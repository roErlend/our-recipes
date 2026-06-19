import { defineConfig, type Plugin } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'

/**
 * Dev-only shim. Vite's dev server routes requests carrying
 * `Sec-Fetch-Dest: image` (i.e. every `<img>`) to its static/asset pipeline,
 * which 404s our dynamic `/api/recipes/:id/image` server route before it can
 * run. Stripping that one header in dev lets the request reach the TanStack
 * server route. Production (Nitro) serves the route correctly without this, so
 * the shim is scoped to `serve` and never affects the build.
 */
function devRecipeImagePassthrough(): Plugin {
  return {
    name: 'recipe-image-dev-passthrough',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/api\/recipes\/[^/]+\/image(?:\?|$)/.test(req.url)) {
          delete req.headers['sec-fetch-dest']
        }
        next()
      })
    },
  }
}

const config = defineConfig({
  plugins: [
    devRecipeImagePassthrough(),
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart(),
    // Nitro powers the server build. Vercel auto-detects TanStack Start + Nitro
    // and picks its `vercel` preset, so no build command/output config needed.
    nitro(),
    viteReact(),
  ],
})

export default config
