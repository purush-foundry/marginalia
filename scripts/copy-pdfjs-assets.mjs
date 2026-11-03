// Copies the pdf.js CMaps, standard fonts and wasm decoders into public/pdfjs/ so they are served next to the app.
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', 'pdfjs-dist')
const target = join(root, 'public', 'pdfjs')

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(join(source, dir), join(target, dir), { recursive: true, dereference: true })
}
console.log(`copied pdf.js assets to ${target}`)
