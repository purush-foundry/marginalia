import { expect, test } from 'vitest'
import { splitStrokeAt } from './erase.ts'

// A straight stroke along y = 0 from x = 0 to 10, one sample per unit, pressure i / 10.
const line = Array.from({ length: 11 }, (_, i) => [i, 0, i / 10]).flat()

test('returns null when the circle misses', () => expect(splitStrokeAt(line, 5, 3, 1)).toBeNull())

test('a circle in the middle leaves two pieces cut at its edge', () => {
  const pieces = splitStrokeAt(line, 5, 0, 1.5)!
  expect(pieces).toHaveLength(2)
  expect(pieces[0].slice(0, 3)).toEqual([0, 0, 0])
  expect(pieces[0].slice(-3)).toEqual([3.5, 0, expect.closeTo(0.35)])
  expect(pieces[1].slice(0, 3)).toEqual([6.5, 0, expect.closeTo(0.65)])
  expect(pieces[1].slice(-3)).toEqual([10, 0, 1])
})

test('a circle over one end leaves one piece', () => {
  const pieces = splitStrokeAt(line, 0, 0, 1.5)!
  expect(pieces).toHaveLength(1)
  expect(pieces[0].slice(0, 3)).toEqual([1.5, 0, expect.closeTo(0.15)])
  expect(pieces[0].slice(-3)).toEqual([10, 0, 1])
})

test('a circle over the whole stroke leaves nothing', () => expect(splitStrokeAt(line, 5, 0, 20)).toEqual([]))

test('a long segment crossing the circle with both ends outside is cut twice', () => {
  const pieces = splitStrokeAt([0, 0, 0.5, 10, 0, 0.5], 5, 0, 1)!
  expect(pieces).toHaveLength(2)
  expect(pieces[0]).toEqual([0, 0, 0.5, expect.closeTo(4), 0, 0.5])
  expect(pieces[1]).toEqual([expect.closeTo(6), 0, 0.5, 10, 0, 0.5])
})

test('a one-sample stroke inside the circle leaves nothing and outside it is missed', () => {
  expect(splitStrokeAt([5, 0, 0.5], 5, 0, 1)).toEqual([])
  expect(splitStrokeAt([5, 3, 0.5], 5, 0, 1)).toBeNull()
})

test('a segment passing by at a tangent is missed', () => expect(splitStrokeAt([0, 1, 0.5, 10, 1, 0.5], 5, 0, 1)).toBeNull())

test('a cut that would leave a one-sample piece drops it', () => {
  const pieces = splitStrokeAt([0, 0, 0.5, 1, 0, 0.5, 2, 0, 0.5], 1, 0, 0.5)!
  expect(pieces).toEqual([
    [0, 0, 0.5, 0.5, 0, 0.5],
    [1.5, 0, 0.5, 2, 0, 0.5],
  ])
})
