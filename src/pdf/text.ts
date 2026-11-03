import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { Box, PageText, TextLine } from '../types.ts'

// Column 0 is the full-width column: lines spanning the text block, and columns[0] is the box around all text.

const FULL_WIDTH = 0.7
const COLUMN_OVERLAP = 0.5
const WIDE_LINE = 0.2
const MIN_COLUMN_WIDTH = 0.15
const BASELINE_TOLERANCE = 0.5
const LINE_GAP = 1.0
const WORD_GAP = 0.15
const PARAGRAPH_GAP = 0.5
const ASCENT = 0.8
const DESCENT = 0.2

const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'st',
  'ﬆ': 'st',
}

interface Glyph {
  str: string
  x0: number
  x1: number
  base: number
  size: number
}

interface RawLine {
  text: string
  x0: number
  x1: number
  top: number
  bottom: number
  size: number
  column: number
}

/** Replaces ligature code points with their letters. */
export function fixLigatures(s: string): string {
  return s.replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
}

/** Joins two consecutive lines of running text, removing an end-of-line hyphen before a lowercase continuation. */
export function joinLines(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  if (/\p{L}[-­‐]$/u.test(a) && /^\p{Ll}/u.test(b)) return a.slice(0, -1) + b
  return /\s$/.test(a) || /^\s/.test(b) ? a + b : `${a} ${b}`
}

function toGlyphs(items: TextItem[], pageH: number): Glyph[] {
  const glyphs: Glyph[] = []
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue
    const [a, b, c, d, e, f] = it.transform as number[]
    if (Math.abs(b) > Math.abs(a) * 0.1 || Math.abs(c) > Math.abs(d) * 0.1) continue
    const size = Math.hypot(c, d)
    if (!size || it.width <= 0) continue
    glyphs.push({ str: it.str, x0: e, x1: e + it.width, base: pageH - f, size })
  }
  return glyphs
}

function groupRows(glyphs: Glyph[]): Glyph[][] {
  const sorted = [...glyphs].sort((p, q) => p.base - q.base || p.x0 - q.x0)
  const rows: { base: number; size: number; glyphs: Glyph[] }[] = []
  for (const g of sorted) {
    const row = rows.find(
      (r) => Math.abs(r.base - g.base) <= BASELINE_TOLERANCE * Math.max(r.size, g.size),
    )
    if (!row) {
      rows.push({ base: g.base, size: g.size, glyphs: [g] })
      continue
    }
    row.glyphs.push(g)
    if (g.size > row.size) {
      row.size = g.size
      row.base = g.base
    }
  }
  return rows.map((r) => r.glyphs)
}

function splitRow(row: Glyph[]): RawLine[] {
  const sorted = [...row].sort((p, q) => p.x0 - q.x0)
  const lines: RawLine[] = []
  let cur: RawLine | null = null
  for (const g of sorted) {
    const top = g.base - ASCENT * g.size
    const bottom = g.base + DESCENT * g.size
    if (cur && g.x0 - cur.x1 <= LINE_GAP * Math.max(cur.size, g.size)) {
      const gap = g.x0 - cur.x1
      const spaced = /\s$/.test(cur.text) || /^\s/.test(g.str)
      cur.text += gap > WORD_GAP * Math.max(cur.size, g.size) && !spaced ? ` ${g.str}` : g.str
      cur.x1 = Math.max(cur.x1, g.x1)
      cur.top = Math.min(cur.top, top)
      cur.bottom = Math.max(cur.bottom, bottom)
      cur.size = Math.max(cur.size, g.size)
      continue
    }
    cur = { text: g.str, x0: g.x0, x1: g.x1, top, bottom, size: g.size, column: -1 }
    lines.push(cur)
  }
  for (const l of lines) l.text = fixLigatures(l.text).replace(/\s+/g, ' ').trim()
  return lines.filter((l) => l.text)
}

function overlap(a: RawLine, b: RawLine): number {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
}

function sameColumn(a: RawLine, b: RawLine): boolean {
  return overlap(a, b) > COLUMN_OVERLAP * Math.min(a.x1 - a.x0, b.x1 - b.x0)
}

function isBridge(line: RawLine, wide: RawLine[]): boolean {
  let minRight = Infinity
  let maxLeft = -Infinity
  for (const w of wide) {
    if (w === line || !sameColumn(line, w)) continue
    minRight = Math.min(minRight, w.x1)
    maxLeft = Math.max(maxLeft, w.x0)
  }
  return minRight < maxLeft
}

function assignColumns(lines: RawLine[], pageW: number): { x0: number; x1: number }[] {
  const full = lines.filter((l) => l.x1 - l.x0 > FULL_WIDTH * pageW)
  const wide = lines.filter((l) => !full.includes(l) && l.x1 - l.x0 > WIDE_LINE * pageW)
  const bridges = lines.filter((l) => !full.includes(l) && isBridge(l, wide))
  const spanning = new Set(full)
  if (bridges.length * 2 < wide.length - bridges.length) bridges.forEach((l) => spanning.add(l))
  const body: RawLine[] = []
  for (const l of lines) {
    if (spanning.has(l)) l.column = 0
    else body.push(l)
  }

  const parent = body.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < body.length; i++)
    for (let j = i + 1; j < body.length; j++)
      if (sameColumn(body[i], body[j])) parent[find(i)] = find(j)

  const groups = new Map<number, RawLine[]>()
  body.forEach((l, i) => {
    const root = find(i)
    groups.set(root, [...(groups.get(root) ?? []), l])
  })
  let clusters = [...groups.values()].map((ls) => ({
    lines: ls,
    x0: Math.min(...ls.map((l) => l.x0)),
    x1: Math.max(...ls.map((l) => l.x1)),
  }))
  const big = clusters.filter((c) => c.x1 - c.x0 >= MIN_COLUMN_WIDTH * pageW)
  if (big.length) {
    for (const small of clusters.filter((c) => !big.includes(c))) {
      const mid = (small.x0 + small.x1) / 2
      const near = big.reduce((best, c) =>
        distance(mid, c) < distance(mid, best) ? c : best,
      )
      near.lines.push(...small.lines)
    }
    clusters = big
  }
  clusters.sort((p, q) => p.x0 - q.x0)
  clusters.forEach((c, k) => c.lines.forEach((l) => (l.column = k + 1)))
  return clusters.map((c) => ({ x0: c.x0, x1: c.x1 }))
}

function distance(x: number, c: { x0: number; x1: number }): number {
  return x < c.x0 ? c.x0 - x : x > c.x1 ? x - c.x1 : 0
}

function readingOrder(lines: RawLine[]): RawLine[] {
  const byTop = [...lines].sort((p, q) => p.top - q.top || p.x0 - q.x0)
  const out: RawLine[] = []
  let band: RawLine[] = []
  const flush = () => {
    band.sort((p, q) => p.column - q.column || p.top - q.top || p.x0 - q.x0)
    out.push(...band)
    band = []
  }
  for (const l of byTop) {
    if (l.column === 0) {
      flush()
      out.push(l)
    } else band.push(l)
  }
  flush()
  return out
}

function plainText(lines: RawLine[]): string {
  const paragraphs: string[] = []
  let cur = ''
  let prev: RawLine | null = null
  for (const l of lines) {
    const breaks =
      prev !== null &&
      (l.column !== prev.column ||
        l.top < prev.top ||
        l.top - prev.bottom > PARAGRAPH_GAP * Math.max(l.size, prev.size))
    if (breaks) {
      paragraphs.push(cur)
      cur = l.text
    } else cur = joinLines(cur, l.text)
    prev = l
  }
  if (cur) paragraphs.push(cur)
  return paragraphs.join('\n\n')
}

/** Groups text items into lines (same baseline ±, sorted by x), clusters lines into columns by x-overlap, orders reading order column-major, joins text with hyphenation/ligature fixes. */
export function buildPageText(
  page: number,
  items: TextItem[],
  viewportW: number,
  viewportH: number,
): PageText {
  const raw = groupRows(toGlyphs(items, viewportH)).flatMap(splitRow)
  const spans = assignColumns(raw, viewportW)
  const ordered = readingOrder(raw)
  const norm = (x0: number, top: number, x1: number, bottom: number): Box => ({
    x: x0 / viewportW,
    y: top / viewportH,
    w: (x1 - x0) / viewportW,
    h: (bottom - top) / viewportH,
  })
  const lines: TextLine[] = ordered.map((l) => ({
    text: l.text,
    box: norm(l.x0, l.top, l.x1, l.bottom),
    column: l.column,
  }))
  const columns: Box[] = []
  if (raw.length) {
    const all = (ls: RawLine[]) =>
      norm(
        Math.min(...ls.map((l) => l.x0)),
        Math.min(...ls.map((l) => l.top)),
        Math.max(...ls.map((l) => l.x1)),
        Math.max(...ls.map((l) => l.bottom)),
      )
    columns.push(all(raw))
    spans.forEach((_, k) => columns.push(all(raw.filter((l) => l.column === k + 1))))
  }
  return { page, lines, columns, text: plainText(ordered) }
}

function intersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

/** Column index under a box: 0 when it touches a full-width line or no column, else the column with the most horizontal overlap. */
export function columnAt(pageText: PageText, box: Box): number {
  if (pageText.lines.some((l) => l.column === 0 && intersects(l.box, box))) return 0
  let best = 0
  let bestOverlap = -Infinity
  for (let k = 1; k < pageText.columns.length; k++) {
    const c = pageText.columns[k]
    const ov = Math.min(c.x + c.w, box.x + box.w) - Math.max(c.x, box.x)
    if (ov >= 0 && ov > bestOverlap) {
      best = k
      bestOverlap = ov
    }
  }
  return best
}

/** Lines whose boxes intersect the box, in reading order. */
export function linesIntersecting(pageText: PageText, box: Box): TextLine[] {
  return pageText.lines.filter((l) => intersects(l.box, box))
}
