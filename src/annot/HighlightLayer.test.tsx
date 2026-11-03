import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { Highlight } from '../types.ts'
import { HighlightLayer, highlightAt } from './HighlightLayer.tsx'

const base = { createdAt: 0, updatedAt: 0, page: 1 }
const second = { x: 0.1, y: 0.12, w: 0.2, h: 0.02 }
const highlights: Highlight[] = [
  {
    ...base,
    id: 't',
    kind: 'text',
    color: 'yellow',
    text: 'two lines',
    boxes: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.02 }, second],
  },
  { ...base, id: 'a', kind: 'area', color: 'blue', box: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 } },
  { ...base, id: 'gone', kind: 'area', color: 'pink', box: { x: 0, y: 0, w: 1, h: 1 }, deleted: true },
]

const root = document.createElement('div')
afterEach(() => act(() => render(null, root)))

describe('HighlightLayer', () => {
  it('draws one rect per box and skips deleted highlights', () => {
    act(() => render(<HighlightLayer highlights={highlights} />, root))
    const rects = [...root.querySelectorAll('rect')]
    expect(rects.map((r) => r.dataset.id)).toEqual(['t', 't', 'a'])
    expect(rects[0].getAttribute('fill')).toBe('var(--hl-yellow)')
    expect(rects[0].getAttribute('x')).toBe('10%')
    expect(rects[2].getAttribute('class')).toBe('area')
  })
})

describe('highlightAt', () => {
  it('finds the highlight and box under a point, ignoring deleted ones', () => {
    expect(highlightAt(highlights, 0.15, 0.13)).toEqual({ id: 't', box: second })
    expect(highlightAt(highlights, 0.6, 0.55)?.id).toBe('a')
    expect(highlightAt(highlights, 0.9, 0.9)).toBeNull()
  })
})
