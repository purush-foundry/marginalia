import { describe, expect, test } from 'vitest'
import { polylineLength } from './geometry.ts'
import { createLiveOutline, LIVE_CHUNK_OVERLAP_PX, LIVE_CHUNK_SAMPLES } from './liveOutline.ts'

interface Call {
  points: number[]
  ends: { start: boolean; end: boolean }
  strokeLength: number
}

// A live outline whose outline function records its calls and returns `${samples}:${start}:${end}`.
function spied() {
  const calls: Call[] = []
  const live = createLiveOutline((points, ends, strokeLength) => {
    calls.push({ points: points.slice(), ends, strokeLength })
    return `${points.length / 3}:${ends.start}:${ends.end}`
  })
  return { live, calls }
}

// A stroke of n samples 1 px apart along x.
function straight(n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(i, 10, 0.5)
  return out
}

// Feeds the stroke one sample per update and returns every update's result.
function feed(live: ReturnType<typeof createLiveOutline>, points: number[], extra?: number[]) {
  const results = []
  for (let n = 3; n <= points.length; n += 3) {
    const { frozen, tail } = live.update(points.slice(0, n), extra)
    results.push({ frozen: [...frozen], tail })
  }
  return results
}

function arcLength(points: number[]): number {
  let total = 0
  for (let i = 3; i + 1 < points.length; i += 3) total += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2])
  return total
}

describe('createLiveOutline', () => {
  test('freezes chunks of 300 samples and re-outlines only the tail', () => {
    const { live, calls } = spied()
    const results = feed(live, straight(1000))
    const last = results.at(-1)!
    expect(last.frozen).toHaveLength(3)
    results.forEach((r) => r.frozen.forEach((chunk, i) => expect(chunk).toBe(last.frozen[i])))
    expect(calls.filter((c) => !c.ends.end)).toHaveLength(3)
    for (const c of calls) expect(c.points.length / 3).toBeLessThanOrEqual(LIVE_CHUNK_SAMPLES + 1)
  })

  test('a chunk never freezes the newest sample, which the next update may still replace', () => {
    const { live, calls } = spied()
    const stroke = straight(400)
    for (let n = 3; n <= stroke.length; n += 3) {
      const before = calls.length
      live.update(stroke.slice(0, n))
      for (const c of calls.slice(before)) if (!c.ends.end) expect(c.points.at(-3)).toBeLessThan(stroke[n - 3])
    }
    expect(calls.some((c) => !c.ends.end)).toBe(true)
  })

  test('only the first chunk keeps the start taper and only the tail gets the end taper', () => {
    const { live } = spied()
    const results = feed(live, straight(1000))
    const ends = (outline: string) => outline.split(':').slice(1).join(':')
    expect(results[10].tail).toBe('11:true:true')
    const { frozen, tail } = results.at(-1)!
    expect(frozen.map(ends)).toEqual(['true:false', 'false:false', 'false:false'])
    expect(ends(tail)).toBe('false:true')
  })

  test('consecutive chunks overlap by at least 6 px of arc length', () => {
    const { live, calls } = spied()
    feed(live, straight(1000))
    const pieces = [...calls.filter((c) => !c.ends.end), calls.at(-1)!].map((c) => c.points)
    for (let i = 0; i + 1 < pieces.length; i++) {
      const firstX = pieces[i + 1][0]
      const shared = pieces[i].filter((_, k) => k % 3 === 0 && pieces[i][k] >= firstX).length * 3
      expect(arcLength(pieces[i].slice(pieces[i].length - shared))).toBeGreaterThanOrEqual(LIVE_CHUNK_OVERLAP_PX)
    }
  })

  test('every piece is outlined with the whole stroke\'s length so far, predicted samples excluded', () => {
    const { live, calls } = spied()
    const stroke = straight(700)
    for (let n = 3; n <= stroke.length; n += 3) {
      const before = calls.length
      live.update(stroke.slice(0, n), [5000, 10, 0.9])
      for (const c of calls.slice(before)) expect(c.strokeLength).toBe(polylineLength(stroke.slice(0, n)))
    }
  })

  test('predicted samples go into the tail and never into a frozen chunk', () => {
    const { live, calls } = spied()
    const predicted = [5000, 10, 0.9]
    feed(live, straight(700), predicted)
    for (const c of calls) {
      const hasPredicted = c.points.at(-3) === 5000
      expect(hasPredicted).toBe(c.ends.end)
      expect(c.points.filter((v, k) => k % 3 === 0 && v === 5000)).toHaveLength(hasPredicted ? 1 : 0)
    }
  })
})
