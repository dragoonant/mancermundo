import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// base must match the GitHub Pages project path (github.com/<org>/mancermundo ->
// <org>.github.io/mancermundo/) in production; dev server stays at root.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/mancermundo/' : '/',
  plugins: [react()],
  build: {
    // the lazily loaded 3D chunk (three.js + react-three-fiber + drei) is large by nature; the first load stays small
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
      output: {
        // with more than one entry (the vfx gallery returns in S5b) shared modules and the bundler runtime can land in a
        // common chunk that the react chunk imports and that imports react back (an invalid cycle that left the runtime
        // helper undefined and broke every page); strict execution order keeps such chunks valid.
        strictExecutionOrder: true,
        // The menus need only react, the engine and the data; three.js and react-three-fiber/drei belong to the lazily
        // loaded battle, team-builder preview and gallery chunks (App.tsx), so they stay out of the first load.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\/](react|react-dom|scheduler|zustand)[\/]/, priority: 40 },
            { name: 'three', test: /node_modules[\/]three[\/]/, priority: 30 },
            { name: 'r3f', test: /node_modules[\/](@react-three|three-stdlib|three-mesh-bvh|troika-[^\/]+|suspend-react|react-use-measure|its-fine|maath|meshline|camera-controls|stats-gl|bidi-js|webgl-sdf-generator|@monogrid)[\/]/, priority: 20 },
            { name: 'engine', test: /[\/]src[\/](engine|data)[\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000, // CI runners are ~2x slower than local
  },
}))
