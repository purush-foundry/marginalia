import { afterEach, expect, test } from 'vitest'
import { clipboard, copyItems } from './clipboard.ts'
import type { PageContent } from './model.ts'

const item = { page: 'page-1', createdAt: 1, updatedAt: 2 }

const content: PageContent = {
  strokes: [
    { ...item, id: 's1', z: 'a', tool: 'pen', pen: 'ball', color: '#000', width: 0.004, points: [0.3, 0.5, 0.4, 0.6, 0.45, 0.8] },
    { ...item, id: 'left-out', z: 'b', tool: 'pen', pen: 'ball', color: '#000', width: 0.004, points: [0, 0, 0.5] },
  ],
  texts: [{ ...item, id: 't1', z: 'c', box: { x: 0.5, y: 0.4, w: 0.3 }, text: 'hi', size: 'm', color: '#00f' }],
  images: [{ ...item, id: 'i1', z: 'd', box: { x: 0.2, y: 0.7, w: 0.2 }, src: 'data:x', aspect: 0.5, pdfPage: 3 }],
}

afterEach(() => {
  clipboard.value = null
})

test('copyItems stores positions relative to the selection\'s top-left', () => {
  const clip = copyItems(content, [
    { kind: 'stroke', id: 's1' },
    { kind: 'text', id: 't1' },
    { kind: 'image', id: 'i1' },
  ])
  expect(clipboard.value).toBe(clip)
  expect(clip.strokes).toHaveLength(1)
  expect({ ...clip.strokes[0], points: [] }).toEqual({ tool: 'pen', pen: 'ball', color: '#000', width: 0.004, points: [] })
  clip.strokes[0].points.forEach((v, i) => expect(v).toBeCloseTo([0.1, 0.1, 0.4, 0.4, 0.05, 0.8][i]))
  expect(clip.texts).toEqual([{ box: { x: expect.closeTo(0.3), y: expect.closeTo(0), w: 0.3 }, text: 'hi', size: 'm', color: '#00f' }])
  expect(clip.images).toEqual([{ box: { x: expect.closeTo(0), y: expect.closeTo(0.3), w: 0.2 }, src: 'data:x', aspect: 0.5, pdfPage: 3 }])
  expect(clip.w).toBeCloseTo(0.6)
  expect(clip.h).toBeCloseTo(0.4)
  expect(content.strokes[0].points[0]).toBe(0.3)
})
