import { describe, expect, it } from 'vitest'
import { fitTo, panBy, toMap, zoomAt, type Viewport } from './viewport'

const screen = (v: Viewport, p: { x: number; y: number }) => ({ x: v.x + p.x * v.k, y: v.y + p.y * v.k })

describe('viewport', () => {
  it('zoomAt keeps the map point under the cursor fixed', () => {
    const v = { x: 30, y: -20, k: 1.5 }
    const before = toMap(v, 200, 150)
    const after = zoomAt(v, 1.7, 200, 150)
    expect(after.k).toBeCloseTo(2.55)
    const p = toMap(after, 200, 150)
    expect(p.x).toBeCloseTo(before.x)
    expect(p.y).toBeCloseTo(before.y)
  })

  it('panBy shifts the translation only', () => {
    expect(panBy({ x: 1, y: 2, k: 3 }, 10, -5)).toEqual({ x: 11, y: -3, k: 3 })
  })

  it('fitTo places every point inside the padded box', () => {
    const pts = [{ x: 100, y: 900 }, { x: 640, y: 120 }, { x: 400, y: 500 }, { x: 950, y: 610 }]
    const v = fitTo(pts, 800, 600, 40)
    for (const p of pts) {
      const s = screen(v, p)
      expect(s.x).toBeGreaterThanOrEqual(40 - 1e-9)
      expect(s.x).toBeLessThanOrEqual(760 + 1e-9)
      expect(s.y).toBeGreaterThanOrEqual(40 - 1e-9)
      expect(s.y).toBeLessThanOrEqual(560 + 1e-9)
    }
  })

  it('fitTo centres a single point', () => {
    const v = fitTo([{ x: 300, y: 700 }], 800, 600)
    const s = screen(v, { x: 300, y: 700 })
    expect(s.x).toBeCloseTo(400)
    expect(s.y).toBeCloseTo(300)
  })
})
