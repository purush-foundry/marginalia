import { columnAt, fixLigatures, joinLines } from '../pdf/text.ts'
import type { Box, PageText } from '../types.ts'

const COLUMN_SLACK = 0.005
const MIN_BOX = 1e-4

interface Slice {
  text: string
  boxes: Box[]
}

function sameLine(a: Box, b: Box): boolean {
  const ov = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return ov > 0.5 * Math.min(a.h, b.h)
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
}

function clip(b: Box, x0: number, x1: number): Box | null {
  const left = Math.max(b.x, x0)
  const right = Math.min(b.x + b.w, x1)
  const top = Math.max(b.y, 0)
  const bottom = Math.min(b.y + b.h, 1)
  if (right - left < MIN_BOX || bottom - top < MIN_BOX) return null
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function slices(range: Range, textLayer: HTMLElement): Slice[] {
  const layer = textLayer.getBoundingClientRect()
  if (!layer.width || !layer.height) return []
  const doc = textLayer.ownerDocument
  const walker = doc.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
  const out: Slice[] = []
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!range.intersectsNode(node)) continue
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.length
    if (end <= start) continue
    const sub = doc.createRange()
    sub.setStart(node, start)
    sub.setEnd(node, end)
    const boxes: Box[] = []
    for (const r of Array.from(sub.getClientRects())) {
      if (!r.width || !r.height) continue
      const b = clip(
        {
          x: (r.left - layer.left) / layer.width,
          y: (r.top - layer.top) / layer.height,
          w: r.width / layer.width,
          h: r.height / layer.height,
        },
        0,
        1,
      )
      if (b) boxes.push(b)
    }
    if (boxes.length) out.push({ text: node.data.slice(start, end), boxes })
  }
  return out
}

/** Client rects of the selection within one text layer → page-normalised boxes merged per line and clamped to the column the selection started in; null when the selection has no text in this layer. */
export function selectionToBoxes(
  range: Range,
  textLayer: HTMLElement,
  pageText: PageText,
): { boxes: Box[]; text: string } | null {
  const all = slices(range, textLayer)
  if (!all.length) return null

  const column = columnAt(pageText, all[0].boxes[0])
  const bounds = column > 0 ? pageText.columns[column] : null
  const x0 = bounds ? bounds.x - COLUMN_SLACK : 0
  const x1 = bounds ? bounds.x + bounds.w + COLUMN_SLACK : 1

  const lines: Box[] = []
  let text = ''
  let last: Box | null = null
  for (const s of all) {
    const kept = s.boxes.map((b) => clip(b, x0, x1)).filter((b): b is Box => b !== null)
    if (!kept.length) continue
    for (const b of kept) {
      const i = lines.findIndex((l) => sameLine(l, b))
      if (i >= 0) lines[i] = union(lines[i], b)
      else lines.push(b)
    }
    text = last && !sameLine(last, kept[0]) ? joinLines(text, s.text) : text + s.text
    last = kept[kept.length - 1]
  }

  const clean = fixLigatures(text).replace(/\s+/g, ' ').trim()
  if (!lines.length || !clean) return null
  return { boxes: lines, text: clean }
}
