import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'
import { SW_FILE, swPrecache } from './src/app/sw-plugin.ts'

// Served from https://purush-foundry.github.io/marginalia/ on GitHub Pages and by `vite preview`; "/" in dev.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/marginalia/' : '/',
  plugins: [
    preact(),
    swPrecache(['manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']),
  ],
  build: {
    rolldownOptions: {
      input: { index: 'index.html', sw: 'src/sw.ts' },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? SW_FILE : 'assets/[name]-[hash].js'),
      },
    },
  },
}))
