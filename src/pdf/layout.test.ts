import { describe, expect, it } from 'vitest'
import { PAD_X, PAGE_GAP, anchorAt, fitWidthScale, layoutPages, positionAt, scrollFor } from './layout.ts'

const sizes = [
  { w: 612, h: 792 },
  { w: 612, h: 792 },
  { w: 792, h: 612 },
]
const none = { left: 0, right: 0 }

describe('layout', () => {
  it('fit-width fills the viewport with the widest cropped page', () => {
    expect(fitWidthScale(sizes, none, 808)).toBeCloseTo((808 - 2 * PAD_X) / 792)
    const crop = { left: 0.1, right: 0.1 }
    expect(fitWidthScale(sizes.slice(0, 2), crop, 400)).toBeCloseTo((400 - 2 * PAD_X) / (612 * 0.8))
  })

  it('stacks pages with gaps and centres them', () => {
    const l = layoutPages(sizes, 1, none, 1000)
    expect(l.tops).toEqual([PAGE_GAP, PAGE_GAP * 2 + 792, PAGE_GAP * 3 + 792 * 2])
    expect(l.lefts[0]).toBe((1000 - 612) / 2)
    expect(l.contentH).toBe(PAGE_GAP * 4 + 792 * 2 + 612)
  })

  it('round-trips a reading position through scroll offsets', () => {
    const l = layoutPages(sizes, 1.5, none, 800)
    const top = scrollFor(l, none, { page: 2, fy: 0.4, vy: 0 }).top
    expect(positionAt(l, top)).toEqual({ page: 2, offset: expect.closeTo(0.4) })
  })

  it('keeps the anchored point under the same viewport point across a zoom', () => {
    const crop = { left: 0.1, right: 0.05 }
    const before = layoutPages(sizes, 1, crop, 600)
    const a = anchorAt(before, crop, 20, 900, 150, 200)
    const after = layoutPages(sizes, 2.5, crop, 600)
    const s = scrollFor(after, crop, a)
    const again = anchorAt(after, crop, s.left!, s.top, 150, 200)
    expect(again.page).toBe(a.page)
    expect(again.fx).toBeCloseTo(a.fx!)
    expect(again.fy).toBeCloseTo(a.fy)
  })
})
