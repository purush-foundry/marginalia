import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

// Served from https://purush-foundry.github.io/marginalia/ on GitHub Pages; "/" in dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/marginalia/' : '/',
  plugins: [preact()],
}))
