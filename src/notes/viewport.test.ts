import { expect, test } from 'vitest'
import { clampZoom, pageCssWidth, zoomScroll } from './viewport.ts'

test('clampZoom keeps zoom between fit-width and 400 %', () => {
  expect(clampZoom(0.5)).toBe(1)
  expect(clampZoom(5)).toBe(4)
  expect(clampZoom(2.5)).toBe(2.5)
})

test('pageCssWidth fits the widest page into the pane less 16 px each side', () => {
  expect(pageCssWidth(210, 210, 872, 1)).toBe(840)
  expect(pageCssWidth(160.5, 210, 872, 2)).toBeCloseTo(1284)
})

test('zoomScroll keeps the point under the pinch centre still', () =>
  expect(zoomScroll({ left: 0, top: 100 }, { x: 200, y: 300 }, 1, 2)).toEqual({ left: 200, top: 500 }))
