import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { Highlight } from '../types.ts'
import { HighlightLayer } from './HighlightLayer.tsx'

const base = { createdAt: 0, updatedAt: 0, page: 1 }
const highlights: Highlight[] = [
  {
    ...base,
    id: 't',
    kind: 'text',
    color: 'yellow',
    text: 'two lines',
    boxes: [
      { x: 0.1, y: 0.1, w: 0.3, h: 0.02 },
      { x: 0.1, y: 0.12, w: 0.2, h: 0.02 },
    ],
  },
  { ...base, id: 'a', kind: 'area', color: 'blue', box: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 } },
  { ...base, id: 'gone', kind: 'area', color: 'pink', box: { x: 0, y: 0, w: 1, h: 1 }, deleted: true },
]

const root = document.createElement('div')
afterEach(() => act(() => render(null, root)))

it('draws one rect per box, skips deleted highlights and reports taps by id', () => {
  const onTap = vi.fn()
  act(() => render(<HighlightLayer highlights={highlights} onTap={onTap} />, root))
  const rects = [...root.querySelectorAll('rect')]
  expect(rects.map((r) => r.dataset.id)).toEqual(['t', 't', 'a'])
  expect(rects[0].getAttribute('fill')).toBe('var(--hl-yellow)')
  expect(rects[2].getAttribute('class')).toBe('area')
  rects[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(onTap).toHaveBeenCalledWith('t', expect.any(Object))
})
