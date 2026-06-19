import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'

const config = defineConfig(({ command }) => ({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart(),
    // Configure the build for Netlify. Only applied to `vite build` — its dev
    // emulation isn't needed here and interfered with local routing. Must come
    // after tanstackStart().
    ...(command === 'build' ? [netlify()] : []),
    viteReact(),
  ],
}))

export default config
