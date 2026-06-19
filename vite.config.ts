import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'

const config = defineConfig({
  plugins: [
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
