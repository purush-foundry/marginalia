import { describe, expect, test, vi } from 'vitest'
import { convertV1, emptyNotebook, type NotePage, type NotebookStroke, type NotesDocV2, type TextObject } from '../notes/model'
import { emptyNotes, emptySidecar, type AreaHighlight, type NotesDoc, type Sidecar } from '../types'
import { mergeNotebooks, mergeSidecars } from './merge'

function hl(id: string, updatedAt: number, extra: Partial<AreaHighlight> = {}): AreaHighlight {
  return {
    kind: 'area',
    id,
    createdAt: 1,
    updatedAt,
    page: 1,
    color: 'yellow',
    box: { x: 0, y: 0, w: 0.1, h: 0.1 },
    ...extra,
  }
}

function sidecar(patch: Partial<Sidecar>): Sidecar {
  return { ...emptySidecar('pdf1', 'paper.pdf', 0), ...patch }
}

describe('mergeSidecars', () => {
  test('keeps items from both sides and the newest version of shared ids', () => {
    const a = sidecar({ highlights: [hl('x', 10, { note: 'old' }), hl('onlyA', 5)] })
    const b = sidecar({ highlights: [hl('x', 20, { note: 'new' }), hl('onlyB', 7)] })

    const merged = mergeSidecars(a, b)

    const byId = Object.fromEntries(merged.highlights.map((h) => [h.id, h]))
    expect(Object.keys(byId).sort()).toEqual(['onlyA', 'onlyB', 'x'])
    expect(byId.x.note).toBe('new')
    expect(mergeSidecars(b, a).highlights.find((h) => h.id === 'x')?.note).toBe('new')
  })

  test('a tombstone wins a tie and a newer edit beats an older tombstone', () => {
    const live = hl('x', 10)
    const dead = hl('x', 10, { deleted: true })
    expect(mergeSidecars(sidecar({ highlights: [live] }), sidecar({ highlights: [dead] })).highlights[0].deleted).toBe(true)
    expect(mergeSidecars(sidecar({ highlights: [dead] }), sidecar({ highlights: [live] })).highlights[0].deleted).toBe(true)

    const revived = hl('x', 11)
    expect(mergeSidecars(sidecar({ highlights: [dead] }), sidecar({ highlights: [revived] })).highlights[0].deleted).toBeUndefined()
  })

  test('merges inks and threads by id too', () => {
    const ink = { kind: 'ink' as const, id: 'i', createdAt: 1, page: 1, color: '#000', width: 0.01, tool: 'pen' as const, points: [] }
    const thread = { kind: 'thread' as const, id: 't', createdAt: 1, anchor: { page: 1, boxes: [] }, model: 'm' }
    const a = sidecar({ inks: [{ ...ink, updatedAt: 1 }], threads: [{ ...thread, updatedAt: 9, messages: [] }] })
    const b = sidecar({
      inks: [{ ...ink, updatedAt: 2, deleted: true }],
      threads: [{ ...thread, updatedAt: 3, messages: [{ role: 'user', content: 'stale', createdAt: 3 }] }],
    })

    const merged = mergeSidecars(a, b)

    expect(merged.inks[0].deleted).toBe(true)
    expect(merged.threads[0].messages).toEqual([])
  })

  test('reading state: newest wins', () => {
    const a = sidecar({ reading: { page: 3, offset: 0, zoom: 1, status: 'reading', updatedAt: 50 } })
    const b = sidecar({ reading: { page: 9, offset: 0.5, zoom: 1, status: 'done', updatedAt: 40 } })
    expect(mergeSidecars(a, b).reading.page).toBe(3)
    expect(mergeSidecars(b, a).reading.page).toBe(3)
  })

  test('color labels: union, with the newer sidecar winning per color', () => {
    const older = sidecar({
      highlights: [hl('h', 5)],
      colorLabels: { yellow: 'claims', green: 'methods' },
    })
    const newer = sidecar({
      highlights: [hl('h', 6)],
      colorLabels: { yellow: 'key claims', pink: 'questions' },
    })

    const expected = { yellow: 'key claims', green: 'methods', pink: 'questions' }
    expect(mergeSidecars(older, newer).colorLabels).toEqual(expected)
    expect(mergeSidecars(newer, older).colorLabels).toEqual(expected)
  })

  test('no labels on either side leaves colorLabels absent', () => {
    expect(mergeSidecars(sidecar({}), sidecar({})).colorLabels).toBeUndefined()
  })
})

describe('mergeNotebooks', () => {
  const page = (id: string, updatedAt: number, extra: Partial<NotePage> = {}): NotePage =>
    ({ id, createdAt: 1, updatedAt, order: 'V', size: { w: 210, h: 297 }, template: 'blank', color: 'white', ...extra })
  const ink = (id: string, updatedAt: number, extra: Partial<NotebookStroke> = {}): NotebookStroke =>
    ({ id, createdAt: 1, updatedAt, page: 'p', tool: 'pen', pen: 'ball', color: '#000', width: 0.004, points: [], z: 'V', ...extra })
  const text = (id: string, updatedAt: number, extra: Partial<TextObject> = {}): TextObject =>
    ({ id, createdAt: 1, updatedAt, page: 'p', box: { x: 0, y: 0, w: 0.5 }, text: id, size: 'm', color: '#000', z: 'V', ...extra })
  const notebook = (patch: Partial<NotesDocV2>): NotesDocV2 => ({ ...emptyNotebook('pdf1', 'paper.pdf', 0), pages: [], ...patch })

  test('mergeNotebooks merges pages, strokes, texts and images by id with tombstones', () => {
    const image = { id: 'img', createdAt: 1, page: 'p', box: { x: 0, y: 0, w: 0.5 }, src: 'x', aspect: 1, z: 'W' }
    const a = notebook({
      pdfName: 'old.pdf',
      pages: [page('p', 5, { template: 'grid' }), page('onlyA', 2)],
      strokes: [ink('s', 3)],
      texts: [text('t', 10, { text: 'old' })],
      images: [{ ...image, updatedAt: 4 }],
    })
    const b = notebook({
      pdfName: 'renamed.pdf',
      pages: [page('p', 6, { template: 'dots' }), page('onlyB', 2)],
      strokes: [ink('s', 4, { deleted: true })],
      texts: [text('t', 20, { text: 'new' })],
      images: [{ ...image, updatedAt: 4, deleted: true }],
    })

    for (const merged of [mergeNotebooks(a, b), mergeNotebooks(b, a)]) {
      expect(merged.pages.map((p) => p.id).sort()).toEqual(['onlyA', 'onlyB', 'p'])
      expect(merged.pages.find((p) => p.id === 'p')!.template).toBe('dots')
      expect(merged.strokes).toEqual([ink('s', 4, { deleted: true })])
      expect(merged.texts).toEqual([text('t', 20, { text: 'new' })])
      expect(merged.images).toEqual([{ ...image, updatedAt: 4, deleted: true }])
      expect(merged).toMatchObject({ schema: 2, kind: 'notes', pdfId: 'pdf1', pdfName: 'renamed.pdf' })
    }
  })

  test('two devices converting the same schema-1 notes merge without duplicate pages or items', () => {
    const v1: NotesDoc = {
      ...emptyNotes('pdf1', 'paper.pdf', 0),
      background: 'grid',
      blocks: [
        { kind: 'text', id: 't1', order: 'a', text: 'Title', createdAt: 1, updatedAt: 1 },
        { kind: 'text', id: 't2', order: 'b', text: 'Body', createdAt: 2, updatedAt: 2 },
        { kind: 'image', id: 'i1', order: 'c', src: 'x', w: 0.8, aspect: 0.5, page: 3, createdAt: 3, updatedAt: 3 },
        { kind: 'text', id: 't3', order: 'd', text: '', createdAt: 4, updatedAt: 4 },
      ],
      strokes: [0.25, 1.6, 1.4].map((y, i) => ({
        kind: 'ink' as const, id: `s${i + 1}`, color: '#000', width: 0.004, points: [0.1, y - 0.05, 0.5, 0.2, y + 0.05, 0.5], createdAt: 5 + i, updatedAt: 5 + i,
      })),
    }
    const a = convertV1(v1)
    const b = convertV1(v1)
    b.texts = b.texts.map((t) => (t.id === 't2' ? { ...t, text: 'Body, edited', updatedAt: 50 } : t))

    for (const merged of [mergeNotebooks(a, b), mergeNotebooks(b, a)]) {
      expect(merged.pages.map((p) => p.id)).toEqual(['page-1', 'page-2'])
      expect(merged.strokes.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
      expect(merged.texts.map((t) => t.id)).toEqual(['t1', 't2'])
      expect(merged.images.map((i) => i.id)).toEqual(['i1'])
      expect(merged.texts[1]).toEqual(b.texts[1])
    }
  })

  test('two conversions that differ by one block in the middle merge the same in either order', () => {
    const block = (id: string, order: string, t: number) => ({ kind: 'text' as const, id, order, text: `${id} `.repeat(200), createdAt: t, updatedAt: t })
    const base: NotesDoc = {
      ...emptyNotes('pdf1', 'paper.pdf', 0),
      blocks: [block('t1', 'a', 1), block('t3', 'c', 3), block('t4', 'd', 4), block('gone', 'e', 5)],
      strokes: [{ kind: 'ink', id: 's1', color: '#000', width: 0.004, points: [0.1, 0.2, 0.5], createdAt: 6, updatedAt: 6 }],
    }
    base.blocks[3] = { ...base.blocks[3], deleted: true }
    const a = convertV1(base)
    const b = convertV1({ ...base, blocks: [...base.blocks, block('t2', 'b', 2)] })
    expect(a.texts.find((t) => t.id === 't3')!.box).not.toEqual(b.texts.find((t) => t.id === 't3')!.box)

    expect(mergeNotebooks(a, b)).toEqual(mergeNotebooks(b, a))
    expect(mergeNotebooks(a, b).texts.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4', 'gone'])

    const live = { ...a, strokes: [{ ...a.strokes[0], updatedAt: 9 }] }
    const dead = { ...a, strokes: [{ ...a.strokes[0], updatedAt: 9, deleted: true }] }
    expect(mergeNotebooks(live, dead).strokes[0].deleted).toBe(true)
    expect(mergeNotebooks(dead, live).strokes[0].deleted).toBe(true)
  })

  test('two versions that differ only in points or src at the same time merge the same in either order', () => {
    const image = { id: 'img', createdAt: 1, updatedAt: 4, page: 'p', box: { x: 0, y: 0, w: 0.5 }, src: 'data:a', aspect: 1, z: 'W' }
    const a = notebook({ strokes: [ink('s', 3, { points: [0.1, 0.2, 0.5] })], images: [image] })
    const b = notebook({ strokes: [ink('s', 3, { points: [0.1, 0.3, 0.5] })], images: [{ ...image, src: 'data:b' }] })
    expect(mergeNotebooks(a, b)).toEqual(mergeNotebooks(b, a))
  })

  test('a large notebook with snips merges with its stored copy quickly and never stringifies points or src', () => {
    const points = Array.from({ length: 150 }, (_, i) => i / 150)
    const pages = Array.from({ length: 20 }, (_, i) => page(`p${i}`, 5))
    const strokes = Array.from({ length: 6000 }, (_, i) => ink(`s${i}`, 7, { page: `p${i % 20}`, points: [...points] }))
    const src = `data:image/png;base64,${'A'.repeat(1_000_000)}`
    const images = Array.from({ length: 5 }, (_, i) => ({ id: `img${i}`, createdAt: 1, updatedAt: 8, page: 'p0', box: { x: 0, y: 0, w: 0.5 }, src: src + i, aspect: 1, z: 'W' }))
    const doc = notebook({ pages, strokes, texts: [text('t', 9)], images })
    const stored = structuredClone(doc)
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      const start = performance.now()
      const merged = mergeNotebooks(doc, stored)
      mergeNotebooks(doc, doc)
      const elapsed = performance.now() - start
      expect([merged.pages.length, merged.strokes.length, merged.images.map((i) => i.src.length)]).toEqual([20, 6000, images.map((i) => i.src.length)])
      expect(elapsed).toBeLessThan(100)
      const heavy = stringify.mock.calls.filter(([v]) => typeof v === 'object' && v !== null && ('src' in v || 'points' in v))
      expect(heavy).toHaveLength(0)
    } finally {
      stringify.mockRestore()
    }
  })
})
