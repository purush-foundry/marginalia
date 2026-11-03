import { describe, expect, it } from 'vitest'
import { simplifyPoints, strokeHitsPoint, strokeOutlinePath } from './geometry.ts'

function pathNumbers(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
}

function maxX(d: string): number {
  return Math.max(...pathNumbers(d).filter((_, i) => i % 2 === 0))
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
