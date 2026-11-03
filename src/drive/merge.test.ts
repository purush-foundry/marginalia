import { describe, expect, test } from 'vitest'
import { emptySidecar, type AreaHighlight, type Sidecar } from '../types'
import { mergeSidecars } from './merge'

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
