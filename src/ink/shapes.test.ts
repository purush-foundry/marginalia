import { expect, test } from 'vitest'
import { adjustShape, fitShape } from './shapes.ts'

// Hand-drawn style samples along a polyline: one every `step` units, jittered, pressure varying.
function jittered(vertices: [number, number][], step = 1.5, jitter = 0.3, seed = 7): number[] {
  let s = seed >>> 0
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return (s / 4294967296) * 2 - 1
  }
  const out: number[] = []
  for (let v = 0; v + 1 < vertices.length; v++) {
    const [ax, ay] = vertices[v]
    const [bx, by] = vertices[v + 1]
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step))
    for (let k = v === 0 ? 0 : 1; k <= n; k++) {
      out.push(ax + ((bx - ax) * k) / n + r() * jitter, ay + ((by - ay) * k) / n + r() * jitter, 0.4 + 0.1 * r())
    }
  }
  return out
}

function xy(points: number[]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i + 2 < points.length; i += 3) out.push([points[i], points[i + 1]])
  return out
}

// Every expected corner has a fitted point within tol units.
function expectCorners(points: number[], corners: [number, number][], tol = 3) {
  const fitted = xy(points)
  for (const [cx, cy] of corners) {
    expect(Math.min(...fitted.map(([x, y]) => Math.hypot(x - cx, y - cy)))).toBeLessThan(tol)
  }
}

function expectClosed(points: number[]) {
  expect(points.slice(-3)).toEqual(points.slice(0, 3))
}

function pressures(points: number[]): number[] {
  return points.filter((_, i) => i % 3 === 2)
}

test('a closed loop without corners fits an ellipse', () => {
  const loop: [number, number][] = Array.from({ length: 101 }, (_, i) => {
    const a = (i / 100) * 2 * Math.PI
    return [60 + 50 * Math.cos(a), 50 + 30 * Math.sin(a)]
  })
  const shape = fitShape(jittered(loop))!
  expect(shape.kind).toBe('ellipse')
  expect(shape.points).toHaveLength(65 * 3)
  expectClosed(shape.points)
  expect(shape.anchor[0]).toBeCloseTo(60, 0)
  expect(shape.anchor[1]).toBeCloseTo(50, 0)
  const xs = xy(shape.points).map(([x]) => x)
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 0)
  expect(new Set(pressures(shape.points))).toEqual(new Set([0.5]))
})

test('a closed stroke with four corners fits a rectangle of 5 samples', () => {
  const corners: [number, number][] = [
    [10, 10],
    [110, 10],
    [110, 70],
    [10, 70],
  ]
  const shape = fitShape(jittered([...corners, corners[0]]))!
  expect(shape.kind).toBe('rectangle')
  expect(shape.points).toHaveLength(5 * 3)
  expectClosed(shape.points)
  expectCorners(shape.points, corners)
  expect(shape.anchor[0]).toBeCloseTo(60, 0)
  expect(shape.anchor[1]).toBeCloseTo(40, 0)
  expect(new Set(pressures(shape.points))).toEqual(new Set([0.5]))
})

test('a closed stroke with three corners fits a triangle', () => {
  const corners: [number, number][] = [
    [100, 0],
    [50, 80],
    [0, 0],
  ]
  const shape = fitShape(jittered([[50, 0], ...corners, [50, 0]]))!
  expect(shape.kind).toBe('triangle')
  expect(shape.points).toHaveLength(4 * 3)
  expectClosed(shape.points)
  expectCorners(shape.points, corners)
})

test('an open stroke without corners fits a line from first to last sample', () => {
  const samples = jittered([
    [5, 5],
    [105, 45],
  ])
  const shape = fitShape(samples)!
  expect(shape.kind).toBe('line')
  expect(shape.points).toEqual([samples[0], samples[1], 0.5, samples.at(-3), samples.at(-2), 0.5])
  expect(shape.anchor).toEqual([samples[0], samples[1]])
})

test('a straight stroke ending in a hook fits an arrow', () => {
  const samples = jittered([
    [0, 50],
    [100, 50],
    [85, 40],
  ])
  const shape = fitShape(samples)!
  expect(shape.kind).toBe('arrow')
  const [tail, tip, barbA, tip2, barbB] = xy(shape.points)
  expect(xy(shape.points)).toHaveLength(5)
  expect(tail).toEqual([samples[0], samples[1]])
  expect(tip2).toEqual(tip)
  expectCorners(shape.points, [[100, 50]])
  const shaft = Math.hypot(tip[0] - tail[0], tip[1] - tail[1])
  const back = Math.atan2(tail[1] - tip[1], tail[0] - tip[0])
  const turns = [barbA, barbB].map((barb) => {
    expect(Math.hypot(barb[0] - tip[0], barb[1] - tip[1])).toBeCloseTo(0.2 * shaft, 6)
    const turn = Math.atan2(barb[1] - tip[1], barb[0] - tip[0]) - back
    return Math.atan2(Math.sin(turn), Math.cos(turn))
  })
  expect(turns[0]).toBeCloseTo(-turns[1], 6)
  expect(Math.abs(turns[0])).toBeCloseTo(Math.PI / 6, 6)
  expect(shape.anchor).toEqual(tail)
})

test('a scribble fits nothing', () => {
  const zigzag: [number, number][] = Array.from({ length: 9 }, (_, i) => [15 * i, i % 2 ? 30 : 0])
  expect(fitShape(jittered(zigzag))).toBeNull()
  const star: [number, number][] = Array.from({ length: 6 }, (_, i) => {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2
    return [60 + 50 * Math.cos(a), 60 + 50 * Math.sin(a)]
  })
  expect(fitShape(jittered(star))).toBeNull()
})

test('fits nothing below 8 samples or 10 units of path', () => {
  expect(fitShape(jittered([[0, 0], [60, 0]], 10))).toBeNull()
  expect(fitShape(jittered([[0, 0], [8, 0]], 0.5, 0))).toBeNull()
})

test('adjustShape rotates and scales about the anchor', () => {
  const line = { kind: 'line' as const, points: [0, 0, 0.5, 10, 0, 0.5], anchor: [0, 0] as [number, number] }
  const moved = adjustShape(line, [10, 0], [0, 20])
  expect(moved.points[0]).toBeCloseTo(0)
  expect(moved.points[1]).toBeCloseTo(0)
  expect(moved.points[3]).toBeCloseTo(0)
  expect(moved.points[4]).toBeCloseTo(20)
  expect(moved.points[5]).toBe(0.5)
  expect(moved.anchor).toEqual([0, 0])
  expect(moved.kind).toBe('line')
})
