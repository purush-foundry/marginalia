import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Bundles the host into a single ESM file for Node; the SDK and node built-ins stay external.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rolldownOptions: {
      external: [/^@anthropic-ai\//, /^node:/],
      output: { format: 'esm', entryFileNames: 'main.js' },
    },
  },
})
