import { expect, test } from 'vitest'
import { itemsBounds, LASSO_STROKE_SHARE, pointInLoop, rectLoop, selectInLoop, strokeInLoop, type LassoItem } from './lasso.ts'

// Square loop covering x and y in [0, 1].
const square = rectLoop(0, 0, 1, 1)

// A horizontal stroke of ten samples, `inside` of them at x < 1 and the rest at x > 1.
function row(inside: number): number[] {
  const points: number[] = []
  for (let i = 0; i < 10; i++) points.push(i < inside ? 0.05 + i * 0.09 : 1.5 + i * 0.1, 0.5, 0.5)
  return points
}

test('a stroke is selected with 60 % of its samples inside the loop and not with 50 %', () => {
  expect(LASSO_STROKE_SHARE).toBe(0.6)
  expect(strokeInLoop(row(6), square)).toBe(true)
  expect(strokeInLoop(row(5), square)).toBe(false)
  expect(strokeInLoop([], square)).toBe(false)

  const items: LassoItem[] = [
    { kind: 'stroke', id: 'six', points: row(6) },
    { kind: 'stroke', id: 'five', points: row(5) },
  ]
  expect(selectInLoop(items, square)).toEqual([{ kind: 'stroke', id: 'six' }])
})

test('objects are selected by their box centre', () => {
  // A triangle loop: the box centre decides, not the corners.
  const loop = [0, 0, 2, 0, 0, 2]
  expect(pointInLoop(0.5, 0.5, loop)).toBe(true)
  expect(pointInLoop(1.5, 1.5, loop)).toBe(false)
  const items: LassoItem[] = [
    { kind: 'text', id: 'in', box: { x: 0.2, y: 0.2, w: 1.2, h: 0.4 } },
    { kind: 'image', id: 'out', box: { x: 0.9, y: 0.9, w: 1, h: 1 } },
    { kind: 'image', id: 'corner', box: { x: -0.2, y: -0.2, w: 1.4, h: 0.6 } },
  ]
  expect(selectInLoop(items, loop)).toEqual([
    { kind: 'text', id: 'in' },
    { kind: 'image', id: 'corner' },
  ])
})

test('rectLoop selects like a dragged rectangle', () => {
  expect(rectLoop(0.6, 0.8, 0.2, 0.1)).toEqual([0.6, 0.8, 0.2, 0.8, 0.2, 0.1, 0.6, 0.1])
  const loop = rectLoop(0.6, 0.8, 0.2, 0.1)
  const items: LassoItem[] = [
    { kind: 'stroke', id: 'a', points: [0.3, 0.3, 0.5, 0.5, 0.5, 0.5] },
    { kind: 'stroke', id: 'b', points: [0.7, 0.3, 0.5, 0.9, 0.5, 0.5] },
    { kind: 'image', id: 'c', box: { x: 0.25, y: 0.5, w: 0.2, h: 0.2 } },
  ]
  expect(selectInLoop(items, loop)).toEqual([
    { kind: 'stroke', id: 'a' },
    { kind: 'image', id: 'c' },
  ])
})

test('itemsBounds covers strokes and boxes', () => {
  const items: LassoItem[] = [
    { kind: 'stroke', id: 'a', points: [0.3, 0.4, 0.5, 0.5, 0.2, 0.5] },
    { kind: 'text', id: 'b', box: { x: 0.4, y: 0.6, w: 0.3, h: 0.1 } },
    { kind: 'image', id: 'c', box: { x: 0, y: 0, w: 1, h: 1 } },
  ]
  const b = itemsBounds(items, [{ kind: 'stroke', id: 'a' }, { kind: 'text', id: 'b' }])!
  expect(b.x).toBeCloseTo(0.3)
  expect(b.y).toBeCloseTo(0.2)
  expect(b.w).toBeCloseTo(0.4)
  expect(b.h).toBeCloseTo(0.5)
  expect(itemsBounds(items, [{ kind: 'image', id: 'missing' }])).toBeNull()
  expect(itemsBounds(items, [])).toBeNull()
})
