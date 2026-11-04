import { describe, expect, test } from 'vitest'
import { orderBetween } from '../lib/order.ts'
import { emptyNotes, type ImageBlock, type NoteStroke, type NotesDoc, type TextBlock } from '../types.ts'
import {
  FIRST_PAGE_ID, convertV1, emptyNotebook, isNotebookDoc, pageLayers,
  type ImageObject, type NotebookStroke, type TextObject,
} from './model.ts'

const A = 297 / 210

const textBlock = (id: string, order: string, text: string, t: number): TextBlock =>
  ({ kind: 'text', id, order, text, createdAt: t, updatedAt: t + 100 })

const imageBlock = (id: string, order: string, t: number, extra: Partial<ImageBlock> = {}): ImageBlock =>
  ({ kind: 'image', id, order, src: 'data:image/jpeg;base64,AAAA', w: 0.8, aspect: 0.5, createdAt: t, updatedAt: t + 100, ...extra })

const v1Stroke = (id: string, y0: number, y1: number, t: number): NoteStroke =>
  ({ kind: 'ink', id, color: '#123456', width: 0.004, points: [0.1, y0, 0.5, 0.2, y1, 0.6], createdAt: t, updatedAt: t + 1 })

function fixture(): NotesDoc {
  return {
    ...emptyNotes('pdf1', 'paper.pdf', 3),
    background: 'lines',
    blocks: [
      imageBlock('i1', 'c', 3, { page: 3 }),
      textBlock('t3', 'd', '', 4),
      textBlock('t2', 'b', 'Body line', 2),
      textBlock('t1', 'a', 'Title', 1),
    ],
    strokes: [v1Stroke('s2', 1.55, 1.65, 6), v1Stroke('s1', 0.2, 0.3, 5), v1Stroke('s3', 1.3, 1.5, 7)],
  }
}

const byId = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map((i) => [i.id, i]))

describe('convertV1', () => {
  test('convertV1 maps strokes into A4 pages by the middle of their y-range', () => {
    const doc = convertV1(fixture())
    expect(doc.pages.map((p) => p.id)).toEqual(['page-1', 'page-2'])
    for (const p of doc.pages) expect(p).toMatchObject({ template: 'ruled-college', size: { w: 210, h: 297 }, color: 'white' })
    const strokes = byId(doc.strokes)
    expect(strokes.s1).toMatchObject({ page: 'page-1', points: [0.1, 0.2, 0.5, 0.2, 0.3, 0.6] })
    expect(strokes.s3).toMatchObject({ page: 'page-1', points: [0.1, 1.3, 0.5, 0.2, 1.5, 0.6] })
    expect(strokes.s2.page).toBe('page-2')
    const s2 = strokes.s2.points
    expect([s2[0], s2[2], s2[3], s2[5]]).toEqual([0.1, 0.5, 0.2, 0.6])
    expect(s2[1]).toBeCloseTo(1.55 - A)
    expect(s2[4]).toBeCloseTo(1.65 - A)
    for (const s of doc.strokes) expect(s).toMatchObject({ tool: 'pen', pen: 'fountain', color: '#123456', width: 0.004 })
  })

  test('convertV1 stacks text and images from the top of page 1 with the fixed line height', () => {
    const doc = convertV1(fixture())
    const texts = byId(doc.texts)
    expect(Object.keys(texts).sort()).toEqual(['t1', 't2'])
    expect(texts.t1).toMatchObject({ page: 'page-1', box: { x: 0.08, y: 0.08, w: 0.84 }, size: 'l', color: '#1c1c1a', text: 'Title' })
    expect(texts.t2).toMatchObject({ page: 'page-1', size: 'm', color: '#1c1c1a', text: 'Body line' })
    expect(texts.t2.box.x).toBe(0.08)
    expect(texts.t2.box.y).toBeCloseTo(0.08 + (0.032 * 18) / 13 + 0.016)
    const [i1] = doc.images
    expect(i1).toMatchObject({ id: 'i1', page: 'page-1', pdfPage: 3, aspect: 0.5, src: 'data:image/jpeg;base64,AAAA' })
    expect(i1.box.x).toBe(0.08)
    expect(i1.box.w).toBe(0.8)
    expect(i1.box.y).toBeCloseTo(texts.t2.box.y + 0.032 + 0.016)
  })

  test('convertV1 moves a block that would pass the bottom margin to the next page', () => {
    const body = [...Array.from({ length: 28 }, () => 'line'), 'x'.repeat(141)].join('\n')
    const doc = convertV1({
      ...emptyNotes('pdf1', 'paper.pdf', 0),
      blocks: [
        textBlock('title', 'a', 'Title', 1),
        textBlock('body', 'b', body, 2),
        textBlock('tail', 'c', 'tail', 3),
        imageBlock('wide', 'd', 4, { w: 1, aspect: 0.5 }),
      ],
    })
    const texts = byId(doc.texts)
    const tailY = 0.08 + (0.032 * 18) / 13 + 0.016 + 31 * 0.032 + 0.016
    expect(texts.tail.page).toBe('page-1')
    expect(texts.tail.box.y).toBeCloseTo(tailY)
    expect(doc.images[0]).toMatchObject({ page: 'page-2', box: { x: 0.08, y: 0.08, w: 0.84 } })
    expect(doc.pages.map((p) => p.id)).toEqual(['page-1', 'page-2'])
    expect(doc.pages.every((p) => p.template === 'blank')).toBe(true)
  })

  test('convertV1 is deterministic and keeps the v1 ids and times', () => {
    const v1 = fixture()
    const doc = convertV1(v1)
    expect(doc).toEqual(convertV1(structuredClone(v1)))
    expect(JSON.stringify(doc)).toBe(JSON.stringify(convertV1(structuredClone(v1))))
    expect(byId(doc.texts).t1).toMatchObject({ createdAt: 1, updatedAt: 101 })
    expect(byId(doc.images).i1).toMatchObject({ createdAt: 3, updatedAt: 103 })
    expect(byId(doc.strokes).s2).toMatchObject({ createdAt: 6, updatedAt: 7 })
    expect(doc.pages.map((p) => [p.createdAt, p.updatedAt])).toEqual([[0, 0], [0, 0]])
    expect(doc.pages[0].order).toBe(orderBetween(null, null))
    expect(doc.pages[1].order).toBe(orderBetween(doc.pages[0].order, null))
    const pageOne = [...doc.texts, ...doc.images, ...doc.strokes].filter((i) => i.page === 'page-1')
    expect(pageOne.sort((x, y) => (x.z < y.z ? -1 : 1)).map((i) => i.id)).toEqual(['t1', 't2', 'i1', 's1', 's3'])
    expect(doc).toMatchObject({ schema: 2, kind: 'notes', pdfId: 'pdf1', pdfName: 'paper.pdf' })
  })

  test('an empty v1 doc converts to one blank A4 page with id page-1', () => {
    const doc = convertV1(emptyNotes('pdf1', 'paper.pdf', 5))
    expect(doc).toEqual(emptyNotebook('pdf1', 'paper.pdf', 0))
    expect(doc.pages.map((p) => p.id)).toEqual([FIRST_PAGE_ID])
  })
})

test('emptyNotebook has one white blank A4 portrait page', () => {
  const doc = emptyNotebook('pdf1', 'paper.pdf', 9)
  expect(doc).toEqual({
    schema: 2, kind: 'notes', pdfId: 'pdf1', pdfName: 'paper.pdf', strokes: [], texts: [], images: [],
    pages: [{ id: 'page-1', order: orderBetween(null, null), size: { w: 210, h: 297 }, template: 'blank', color: 'white', createdAt: 9, updatedAt: 9 }],
  })
})

test('isNotebookDoc accepts schema 2 only', () => {
  const doc = emptyNotebook('pdf1', 'paper.pdf', 0)
  expect(isNotebookDoc(doc)).toBe(true)
  expect(isNotebookDoc(emptyNotes('pdf1', 'paper.pdf', 0))).toBe(false)
  expect(isNotebookDoc({ ...doc, schema: 3 })).toBe(false)
  expect(isNotebookDoc({ ...doc, kind: 'annotations' })).toBe(false)
  expect(isNotebookDoc({ ...doc, images: undefined })).toBe(false)
  expect(isNotebookDoc(null)).toBe(false)
  expect(isNotebookDoc('notes')).toBe(false)
})

test('pageLayers groups consecutive strokes into one ink layer between objects by z', () => {
  const base = { createdAt: 1, updatedAt: 1, page: 'page-1' }
  const stroke = (id: string, z: string): NotebookStroke => ({ ...base, id, z, tool: 'pen', pen: 'ball', color: '#000', width: 0.004, points: [] })
  const image: ImageObject = { ...base, id: 'img', z: 'c', box: { x: 0, y: 0, w: 0.5 }, src: 'x', aspect: 1 }
  const text: TextObject = { ...base, id: 'txt', z: 'e', box: { x: 0, y: 0, w: 0.5 }, text: 'hi', size: 'm', color: '#000' }
  const [s1, s2, s3] = [stroke('s1', 'a'), stroke('s2', 'b'), stroke('s3', 'd')]
  expect(pageLayers({ strokes: [s1, s2, s3], texts: [text], images: [image] })).toEqual([
    { kind: 'ink', strokes: [s1, s2] },
    { kind: 'image', item: image },
    { kind: 'ink', strokes: [s3] },
    { kind: 'text', item: text },
  ])
  expect(pageLayers({ strokes: [], texts: [], images: [] })).toEqual([])
})
