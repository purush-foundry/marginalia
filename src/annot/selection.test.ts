import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageText } from '../types.ts'
import { selectionToBoxes } from './selection.ts'

// A 1000x1000 px text layer at client (100, 50); every span lays its characters out evenly over its rect.
const LAYER = { left: 100, top: 50, width: 1000, height: 1000 }

interface SpanSpec {
  text: string
  x: number
  y: number
  w: number
  h: number
}

function makeLayer(spans: SpanSpec[]): HTMLElement {
  const layer = document.createElement('div')
  layer.className = 'textLayer'
  for (const s of spans) {
    const el = document.createElement('span')
    el.textContent = s.text
    el.dataset.rect = JSON.stringify([s.x, s.y, s.w, s.h])
    layer.append(el)
  }
  layer.getBoundingClientRect = () => new DOMRect(LAYER.left, LAYER.top, LAYER.width, LAYER.height)
  document.body.append(layer)
  return layer
}

function rectsOf(range: Range): DOMRect[] {
  const node = range.startContainer
  const span = node.parentElement
  if (node !== range.endContainer || !span?.dataset.rect) return []
  const [x, y, w, h] = JSON.parse(span.dataset.rect) as number[]
  const len = node.textContent!.length
  const a = range.startOffset / len
  const b = range.endOffset / len
  return [new DOMRect(LAYER.left + x + a * w, LAYER.top + y, (b - a) * w, h)]
}

function rangeOver(layer: HTMLElement, from: [number, number], to: [number, number]): Range {
  const spans = layer.querySelectorAll('span')
  const r = document.createRange()
  r.setStart(spans[from[0]].firstChild!, from[1])
  r.setEnd(spans[to[0]].firstChild!, to[1])
  return r
}

// Two columns: left x 100..450 px, right x 550..900 px of the 1000 px layer.
const pageText: PageText = {
  page: 1,
  lines: [],
  columns: [
    { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    { x: 0.1, y: 0.1, w: 0.35, h: 0.8 },
    { x: 0.55, y: 0.1, w: 0.35, h: 0.8 },
  ],
  text: '',
}

beforeEach(() => {
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
    return rectsOf(this) as unknown as DOMRectList
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('selectionToBoxes', () => {
  it('merges the spans of one line into one normalised box', () => {
    const layer = makeLayer([
      { text: 'The ', x: 100, y: 100, w: 40, h: 20 },
      { text: 'quick', x: 140, y: 100, w: 50, h: 20 },
      { text: ' fox', x: 190, y: 98, w: 40, h: 24 },
    ])
    const res = selectionToBoxes(rangeOver(layer, [0, 0], [2, 4]), layer, pageText)!
    expect(res.text).toBe('The quick fox')
    expect(res.boxes).toHaveLength(1)
    const [b] = res.boxes
    expect(b.x).toBeCloseTo(0.1)
    expect(b.y).toBeCloseTo(0.098)
    expect(b.w).toBeCloseTo(0.13)
    expect(b.h).toBeCloseTo(0.024)
  })

  it('returns one box per line and joins hyphenated line breaks', () => {
    const layer = makeLayer([
      { text: 'sequence transduc-', x: 100, y: 100, w: 300, h: 20 },
      { text: 'tion models', x: 100, y: 125, w: 200, h: 20 },
    ])
    const res = selectionToBoxes(rangeOver(layer, [0, 9], [1, 11]), layer, pageText)!
    expect(res.text).toBe('transduction models')
    expect(res.boxes).toHaveLength(2)
    expect(res.boxes[0].x).toBeCloseTo(0.1 + 0.3 * (9 / 18))
    expect(res.boxes[1].y).toBeCloseTo(0.125)
  })

  it('clamps a selection to the column it started in', () => {
    const layer = makeLayer([
      { text: 'left one', x: 100, y: 100, w: 350, h: 20 },
      { text: 'left two', x: 100, y: 125, w: 350, h: 20 },
      { text: 'right one', x: 550, y: 100, w: 350, h: 20 },
      { text: 'right two', x: 550, y: 125, w: 350, h: 20 },
    ])
    const res = selectionToBoxes(rangeOver(layer, [0, 5], [2, 5]), layer, pageText)!
    expect(res.text).toBe('one left two')
    expect(res.boxes).toHaveLength(2)
    for (const b of res.boxes) expect(b.x + b.w).toBeLessThanOrEqual(0.45 + 1e-9)
  })

  it('clips a span that sticks out of the start column', () => {
    const layer = makeLayer([
      { text: 'inside', x: 550, y: 100, w: 350, h: 20 },
      { text: 'wide caption line', x: 300, y: 125, w: 650, h: 20 },
    ])
    const res = selectionToBoxes(rangeOver(layer, [0, 0], [1, 17]), layer, pageText)!
    expect(res.boxes[1].x).toBeCloseTo(0.55, 1)
    expect(res.boxes[1].x).toBeGreaterThan(0.54)
    expect(res.boxes[1].x + res.boxes[1].w).toBeLessThan(0.91)
  })

  it('returns null when the range has no text in this layer', () => {
    const layer = makeLayer([{ text: 'here', x: 100, y: 100, w: 40, h: 20 }])
    const other = makeLayer([{ text: 'elsewhere', x: 100, y: 100, w: 90, h: 20 }])
    expect(selectionToBoxes(rangeOver(other, [0, 0], [0, 9]), layer, pageText)).toBeNull()
  })

  it('returns null for a whitespace-only selection', () => {
    const layer = makeLayer([{ text: 'a   b', x: 100, y: 100, w: 50, h: 20 }])
    expect(selectionToBoxes(rangeOver(layer, [0, 1], [0, 4]), layer, pageText)).toBeNull()
  })
})
