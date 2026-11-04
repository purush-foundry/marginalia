import { describe, expect, it, test } from 'vitest'
import { inkOutlinePath, type PenStyle, simplifyPoints, strokeHitsPoint, strokeOutlinePath } from './geometry.ts'
import { slowCurveSamples, turning } from './testStrokes.ts'

function pathNumbers(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
}

function maxX(d: string): number {
  return Math.max(...pathNumbers(d).filter((_, i) => i % 2 === 0))
}

// Vertical extent of the outline polygon (control points and midpoints) where it crosses x.
function heightAt(d: string, x: number): number {
  const n = pathNumbers(d)
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i + 1 < n.length; i += 2) {
    const j = (i + 2) % n.length
    const [ax, ay, bx, by] = [n[i], n[i + 1], n[j], n[j + 1]]
    if ((ax - x) * (bx - x) > 0 || ax === bx) continue
    const y = ay + ((by - ay) * (x - ax)) / (bx - ax)
    lo = Math.min(lo, y)
    hi = Math.max(hi, y)
  }
  return hi > lo ? hi - lo : 0
}

// A horizontal 200 px line sampled every 2 px at one pressure.
function flatLine(pressure: number): number[] {
  const out: number[] = []
  for (let x = 0; x <= 200; x += 2) out.push(x, 50, pressure)
  return out
}

const line = [10, 10, 0.5, 30, 12, 0.6, 60, 15, 0.7, 100, 20, 0.5]

describe('strokeOutlinePath', () => {
  it('returns a closed, non-empty SVG path', () => {
    const d = strokeOutlinePath(line, 4, true)
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(pathNumbers(d).length).toBeGreaterThan(8)
  })

  it('scales with the input coordinates and width', () => {
    const small = strokeOutlinePath(line, 4, true)
    const big = strokeOutlinePath(
      line.map((v, i) => (i % 3 === 2 ? v : v * 2)),
      8,
      true,
    )
    expect(maxX(big) / maxX(small)).toBeCloseTo(2, 1)
  })

  it('outlines a single tap as a dot', () => {
    expect(pathNumbers(strokeOutlinePath([50, 50, 0.5], 4, false)).length).toBeGreaterThan(4)
  })

  it('is empty for no points', () => {
    expect(strokeOutlinePath([], 4, true)).toBe('')
  })
})

describe('strokeHitsPoint', () => {
  const stroke = [0.1, 0.1, 0.5, 0.5, 0.1, 0.5, 0.5, 0.5, 0.5]

  it('hits a point near the middle of a segment', () => {
    expect(strokeHitsPoint(stroke, 0.3, 0.105, 0.01)).toBe(true)
    expect(strokeHitsPoint(stroke, 0.505, 0.3, 0.01)).toBe(true)
  })

  it('misses a point farther than the radius', () => {
    expect(strokeHitsPoint(stroke, 0.3, 0.3, 0.01)).toBe(false)
    expect(strokeHitsPoint(stroke, 0.6, 0.1, 0.05)).toBe(false)
  })

  it('hits a single-point stroke within the radius', () => {
    expect(strokeHitsPoint([0.2, 0.2, 0.5], 0.205, 0.2, 0.01)).toBe(true)
    expect(strokeHitsPoint([0.2, 0.2, 0.5], 0.25, 0.2, 0.01)).toBe(false)
  })
})

describe('simplifyPoints', () => {
  it('drops near-duplicate samples and keeps both endpoints', () => {
    const pts = [0, 0, 0.5, 0.0001, 0, 0.5, 0.1, 0, 0.6, 0.1001, 0, 0.6, 0.1002, 0, 0.7]
    expect(simplifyPoints(pts, 0.001)).toEqual([0, 0, 0.5, 0.1, 0, 0.6, 0.1002, 0, 0.7])
  })

  it('keeps a single sample', () => {
    expect(simplifyPoints([0.3, 0.3, 0.5], 0.01)).toEqual([0.3, 0.3, 0.5])
  })

  it('keeps distinct endpoints even when the whole stroke is within tolerance', () => {
    expect(simplifyPoints([0, 0, 0.5, 0.0001, 0, 0.5, 0.0002, 0, 0.5], 0.01)).toEqual([
      0, 0, 0.5, 0.0002, 0, 0.5,
    ])
  })
})

describe('inkOutlinePath', () => {
  it('scales normalised points to CSS px', () => {
    expect(inkOutlinePath([0.1, 0.1, 0.5, 0.5, 0.5, 0.6], 0.01, 200, 400)).toBe(
      strokeOutlinePath([20, 40, 0.5, 100, 200, 0.6], 2, true),
    )
  })
})

describe('pen styles', () => {
  const PAGE = { w: 800, h: 1035 }
  const stored = (noise: number) =>
    simplifyPoints(
      slowCurveSamples(noise).flatMap((s) => [s.x / PAGE.w, s.y / PAGE.h, s.p]),
      0.5 / PAGE.w,
    )
  const wiggle = (pen: PenStyle) =>
    turning(inkOutlinePath(stored(1), 0.004, PAGE.w, PAGE.h, pen)) -
    turning(inkOutlinePath(stored(0), 0.004, PAGE.w, PAGE.h, pen))

  test.each(['ball', 'fountain', 'brush'] as const)('the slow curve wiggles under half a turn with the %s pen', (pen) => {
    expect(wiggle(pen)).toBeLessThan(0.5)
  })

  test('a ball stroke keeps one width whatever the pressure', () => {
    const light = strokeOutlinePath(flatLine(0.2), 6, true, 'ball')
    const heavy = strokeOutlinePath(flatLine(0.9), 6, true, 'ball')
    expect(Math.abs(heightAt(light, 100) - heightAt(heavy, 100))).toBeLessThan(0.1)
    expect(Math.abs(heightAt(light, 5) - heightAt(light, 100))).toBeLessThan(0.1)
  })

  test('fountain and brush taper their ends, and the brush swings more with pressure', () => {
    const fountain = strokeOutlinePath(flatLine(0.5), 6, true, 'fountain')
    expect(heightAt(fountain, 2)).toBeLessThan(0.6 * heightAt(fountain, 100))
    const swing = (pen: PenStyle) =>
      heightAt(strokeOutlinePath(flatLine(0.9), 6, true, pen), 100) /
      heightAt(strokeOutlinePath(flatLine(0.2), 6, true, pen), 100)
    expect(swing('brush')).toBeGreaterThan(swing('fountain'))
  })

  test('strokeOutlinePath without end tapers leaves full-width ends', () => {
    const d = strokeOutlinePath(flatLine(0.5), 6, true, 'fountain', { start: false, end: false })
    expect(heightAt(d, 2)).toBeGreaterThanOrEqual(0.9 * heightAt(d, 100))
  })
})
