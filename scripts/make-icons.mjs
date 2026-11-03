// Draws the "M" app icon as PNGs (any + maskable + apple-touch) and the SVG favicon into public/.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'icons')
const ACCENT = [0x2f, 0x6f, 0xed]
const GLYPH = [
  [24, 74], [24, 26], [35, 26], [50, 48], [65, 26], [76, 26],
  [76, 74], [65, 74], [65, 44], [50, 65], [35, 44], [35, 74],
]
const RADIUS = 22
const SAMPLES = 4

function inPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inRoundedSquare(x, y) {
  const cx = Math.min(Math.max(x, RADIUS), 100 - RADIUS)
  const cy = Math.min(Math.max(y, RADIUS), 100 - RADIUS)
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, rounded) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0
    for (let px = 0; px < size; px++) {
      let bg = 0
      let fg = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = ((px + (sx + 0.5) / SAMPLES) / size) * 100
          const y = ((py + (sy + 0.5) / SAMPLES) / size) * 100
          if (rounded && !inRoundedSquare(x, y)) continue
          if (inPolygon(x, y, GLYPH)) fg++
          else bg++
        }
      }
      const total = SAMPLES * SAMPLES
      const alpha = (bg + fg) / total
      const mix = bg + fg ? fg / (bg + fg) : 0
      const o = py * (size * 4 + 1) + 1 + px * 4
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(ACCENT[c] * (1 - mix) + 255 * mix)
      raw[o + 3] = Math.round(alpha * 255)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'icon-192.png'), png(192, true))
writeFileSync(join(out, 'icon-512.png'), png(512, true))
writeFileSync(join(out, 'maskable-512.png'), png(512, false))
writeFileSync(join(out, 'apple-touch-icon.png'), png(180, false))

const hex = `#${ACCENT.map((c) => c.toString(16).padStart(2, '0')).join('')}`
const points = GLYPH.map(([x, y]) => `${x},${y}`).join(' ')
writeFileSync(
  join(root, 'public', 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${RADIUS}" fill="${hex}"/><polygon points="${points}" fill="#fff"/></svg>\n`,
)
console.log(`wrote icons to ${out}`)
