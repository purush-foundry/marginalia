import { describe, expect, it, test } from 'vitest'
import {
  highlighterPath,
  inkOutlinePath,
  type PenStyle,
  polylineLength,
  simplifyPoints,
  strokeHitsPoint,
  strokeOutlinePath,
} from './geometry.ts'
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

// Filled area of the outline polygon under the nonzero rule, by scanlines 0.2 px apart.
function inkArea(d: string): number {
  const n = pathNumbers(d)
  const ys = n.filter((_, i) => i % 2 === 1)
  const step = 0.2
  let area = 0
  for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
    const hits: [number, number][] = []
    for (let i = 0; i + 1 < n.length; i += 2) {
      const j = (i + 2) % n.length
      const [ax, ay, bx, by] = [n[i], n[i + 1], n[j], n[j + 1]]
      if (ay <= y !== by <= y) hits.push([ax + ((bx - ax) * (y - ay)) / (by - ay), by > ay ? 1 : -1])
    }
    hits.sort((a, b) => a[0] - b[0])
    let winding = 0
    for (let k = 0; k < hits.length; k++) {
      if (winding !== 0) area += (hits[k][0] - hits[k - 1][0]) * step
      winding += hits[k][1]
    }
  }
  return area
}

// A horizontal line from x = 0 to length, sampled every 2 px and at its end, at one pressure.
function flatLine(pressure: number, length = 200): number[] {
  const out: number[] = []
  for (let x = 0; x < length; x += 2) out.push(x, 50, pressure)
  out.push(length, 50, pressure)
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

  test('a long stroke keeps the full taper lengths', () => {
    const long = strokeOutlinePath(flatLine(0.5, 200), 3.2, true, 'fountain')
    const longer = strokeOutlinePath(flatLine(0.5, 400), 3.2, true, 'fountain')
    for (let x = 5; x <= 9; x++) {
      expect(heightAt(long, x)).toBeCloseTo(heightAt(longer, x), 1)
      expect(heightAt(long, 200 - x)).toBeCloseTo(heightAt(longer, 400 - x), 1)
    }
    expect(heightAt(long, 198)).toBeLessThan(0.6 * heightAt(long, 100))
  })

  test('a short stroke caps each taper at a quarter of its length', () => {
    const d = strokeOutlinePath(flatLine(0.5, 40), 6, true, 'brush')
    expect(heightAt(d, 8)).toBeGreaterThan(0.85 * heightAt(d, 20))
  })

  test('a 15 px fountain stroke keeps round caps and about the ball pen\'s ink area', () => {
    const fountain = inkArea(strokeOutlinePath(flatLine(0.5, 15), 3.2, true, 'fountain'))
    const ball = inkArea(strokeOutlinePath(flatLine(0.5, 15), 3.2, true, 'ball'))
    expect(fountain / ball).toBeGreaterThanOrEqual(0.9)
  })

  test('a 40 px brush stroke at size 3 keeps a taper capped at a quarter of its length', () => {
    const d = strokeOutlinePath(flatLine(0.5, 40), 3, true, 'brush')
    const mid = heightAt(d, 20)
    expect(heightAt(d, 38)).toBeLessThan(0.6 * mid)
    expect(heightAt(d, 35)).toBeGreaterThan(0.8 * mid)
    expect(heightAt(strokeOutlinePath(flatLine(0.5, 200), 3, true, 'brush'), 195)).toBeLessThan(0.7 * mid)
  })

  test('a piece of a long stroke given the whole length tapers its end like the whole stroke', () => {
    const whole = flatLine(0.5, 600)
    const committed = strokeOutlinePath(whole, 3.2, true, 'fountain')
    const piece = (length?: number) =>
      strokeOutlinePath(whole.slice(-15), 3.2, true, 'fountain', { start: false, end: true }, length)
    for (const x of [596, 598, 599]) {
      expect(heightAt(piece(polylineLength(whole)), x)).toBeCloseTo(heightAt(committed, x), 1)
    }
    expect(heightAt(piece(), 599)).toBeGreaterThan(heightAt(committed, 599) + 1)
  })

  test('the fountain pen keeps the v2 ink area of the slow curve within 7 %', () => {
    const v2 = [760.87, 733.06]
    for (const noise of [0, 1]) {
      const ratio = inkArea(inkOutlinePath(stored(noise), 0.004, PAGE.w, PAGE.h, 'fountain')) / v2[noise]
      expect(ratio).toBeGreaterThan(0.93)
      expect(ratio).toBeLessThan(1.07)
    }
  })

  test('the ball and brush pens stay near the v2 ink area of the slow curve', () => {
    const ratio = (pen: PenStyle) => inkArea(inkOutlinePath(stored(0), 0.004, PAGE.w, PAGE.h, pen)) / 760.87
    expect(ratio('ball')).toBeGreaterThan(0.9)
    expect(ratio('ball')).toBeLessThan(1.1)
    expect(ratio('brush')).toBeGreaterThan(0.8)
    expect(ratio('brush')).toBeLessThan(1.0)
  })

  test('strokeOutlinePath without end tapers leaves full-width ends', () => {
    const d = strokeOutlinePath(flatLine(0.5), 6, true, 'fountain', { start: false, end: false })
    expect(heightAt(d, 2)).toBeGreaterThanOrEqual(0.9 * heightAt(d, 100))
  })
})

test('highlighterPath draws the smoothed centreline in CSS px', () => {
  const d = highlighterPath([0.1, 0.1, 0.5, 0.3, 0.2, 0.5, 0.5, 0.1, 0.5], 200, 400)
  expect(d).toMatch(/^M20,40 L/)
  expect(d).not.toContain('Q')
  expect(d.endsWith('100,40')).toBe(true)
})

test('highlighterPath of one sample is a zero-length line so a tap leaves a square', () => {
  expect(highlighterPath([0.5, 0.5, 0.5], 200, 400)).toBe('M100,200 L100,200')
})
