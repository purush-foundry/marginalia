import { describe, expect, it, vi } from 'vitest'
import { createAnnotationStore, type NewHighlight } from './store'
import { emptySidecar, type InkStroke, type Sidecar, type Thread } from '../types'

const box = (x: number, y: number) => ({ x, y, w: 0.1, h: 0.02 })
const text = (page: number, x: number, y: number): NewHighlight => ({
  kind: 'text', page, color: 'yellow', boxes: [box(x, y)], text: `t${page}-${x}-${y}`,
})

function make() {
  const persist = vi.fn<(s: Sidecar) => void>()
  const store = createAnnotationStore(emptySidecar('pdf', 'a.pdf', 1), persist)
  return { store, persist }
}

const stroke = (id: string): InkStroke => ({
  id, kind: 'ink', page: 1, color: '#000', width: 0.01, tool: 'pen', points: [0, 0, 1], createdAt: 1, updatedAt: 1,
})
const thread = (id: string, createdAt: number): Thread => ({
  id, kind: 'thread', anchor: { page: 1, boxes: [] }, model: 'm', messages: [], createdAt, updatedAt: createdAt,
})

describe('annotation store', () => {
  it('adds a highlight, stamps it and persists a new object', () => {
    const { store, persist } = make()
    const before = store.sidecar.value
    const h = store.addHighlight(text(1, 0.1, 0.1))
    expect(h.id).toBeTruthy()
    expect(h.createdAt).toBe(h.updatedAt)
    expect(store.highlights.value).toHaveLength(1)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0][0]).toBe(store.sidecar.value)
    expect(store.sidecar.value).not.toBe(before)
    expect(before.highlights).toHaveLength(0)
  })

  it('updates color and note', () => {
    const { store, persist } = make()
    const h = store.addHighlight(text(1, 0.1, 0.1))
    store.updateHighlight(h.id, { color: 'pink', note: 'hi' })
    const got = store.highlights.value[0]
    expect(got.color).toBe('pink')
    expect(got.note).toBe('hi')
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('removes as tombstone and hides it', () => {
    const { store } = make()
    const h = store.addHighlight(text(1, 0.1, 0.1))
    store.removeHighlight(h.id)
    expect(store.highlights.value).toHaveLength(0)
    expect(store.sidecar.value.highlights).toHaveLength(1)
    expect(store.sidecar.value.highlights[0].deleted).toBe(true)
  })

  it('sorts by page, y, x without columns', () => {
    const { store } = make()
    store.addHighlight(text(2, 0.1, 0.1))
    store.addHighlight(text(1, 0.6, 0.5))
    store.addHighlight(text(1, 0.1, 0.5))
    store.addHighlight(text(1, 0.6, 0.1))
    expect(store.highlights.value.map((h) => (h as { text: string }).text)).toEqual([
      't1-0.6-0.1', 't1-0.1-0.5', 't1-0.6-0.5', 't2-0.1-0.1',
    ])
  })

  it('sorts by column when columns are known', () => {
    const { store } = make()
    store.setColumns(1, [{ x: 0.05, y: 0, w: 0.4, h: 1 }, { x: 0.55, y: 0, w: 0.4, h: 1 }])
    store.addHighlight(text(1, 0.6, 0.1))
    store.addHighlight(text(1, 0.1, 0.8))
    expect(store.highlights.value.map((h) => (h as { text: string }).text)).toEqual(['t1-0.1-0.8', 't1-0.6-0.1'])
  })

  it('area highlights sort by their box', () => {
    const { store } = make()
    store.addHighlight({ kind: 'area', page: 1, color: 'blue', box: box(0.1, 0.9) })
    store.addHighlight({ kind: 'area', page: 1, color: 'blue', box: box(0.1, 0.2) })
    expect(store.highlights.value.map((h) => (h.kind === 'area' ? h.box.y : -1))).toEqual([0.2, 0.9])
  })

  it('undo/redo round-trips highlights', () => {
    const { store } = make()
    expect(store.canUndo.value).toBe(false)
    const h = store.addHighlight(text(1, 0.1, 0.1))
    expect(store.canUndo.value).toBe(true)
    store.undo()
    expect(store.highlights.value).toHaveLength(0)
    expect(store.canRedo.value).toBe(true)
    store.redo()
    expect(store.highlights.value).toHaveLength(1)
    store.updateHighlight(h.id, { note: 'n' })
    store.undo()
    expect(store.highlights.value[0].note).toBeUndefined()
    store.redo()
    expect(store.highlights.value[0].note).toBe('n')
    store.removeHighlight(h.id)
    expect(store.highlights.value).toHaveLength(0)
    store.undo()
    expect(store.highlights.value).toHaveLength(1)
    expect(store.sidecar.value.highlights[0].deleted).toBe(false)
    store.redo()
    expect(store.highlights.value).toHaveLength(0)
  })

  it('undo/redo round-trips strokes', () => {
    const { store } = make()
    store.addStroke(stroke('s1'))
    expect(store.inks.value).toHaveLength(1)
    store.undo()
    expect(store.inks.value).toHaveLength(0)
    store.redo()
    expect(store.inks.value).toHaveLength(1)
    store.removeStroke('s1')
    expect(store.inks.value).toHaveLength(0)
    expect(store.sidecar.value.inks[0].deleted).toBe(true)
    store.undo()
    expect(store.inks.value).toHaveLength(1)
  })

  it('saving a thread persists without an undo step; removing one is undoable', () => {
    const { store, persist } = make()
    store.upsertThread(thread('a', 1))
    store.upsertThread(thread('b', 2))
    expect(store.threads.value.map((t) => t.id)).toEqual(['b', 'a'])
    store.upsertThread({ ...thread('a', 1), model: 'm2' })
    expect(store.threads.value.find((t) => t.id === 'a')?.model).toBe('m2')
    expect(persist.mock.calls.at(-1)![0].threads.find((t) => t.id === 'a')?.model).toBe('m2')
    expect(store.canUndo.value).toBe(false)
    store.undo()
    expect(store.threads.value.find((t) => t.id === 'a')?.model).toBe('m2')

    store.removeThread('a')
    expect(store.threads.value.map((t) => t.id)).toEqual(['b'])
    store.undo()
    expect(store.threads.value.map((t) => t.id)).toEqual(['b', 'a'])
    store.redo()
    expect(store.threads.value.map((t) => t.id)).toEqual(['b'])
  })

  it('a new mutation clears redo', () => {
    const { store } = make()
    store.addHighlight(text(1, 0.1, 0.1))
    store.undo()
    store.addHighlight(text(1, 0.2, 0.2))
    expect(store.canRedo.value).toBe(false)
  })

  it('setReading persists but is not undoable', () => {
    const { store, persist } = make()
    store.setReading({ page: 4 })
    expect(store.sidecar.value.reading.page).toBe(4)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(store.canUndo.value).toBe(false)
  })

  it('setColorLabel persists the label', () => {
    const { store, persist } = make()
    store.setColorLabel('green', 'method')
    expect(store.sidecar.value.colorLabels?.green).toBe('method')
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('replaceFromRemote swaps state and clears history', () => {
    const { store } = make()
    store.addHighlight(text(1, 0.1, 0.1))
    const remote = emptySidecar('pdf', 'a.pdf', 5)
    store.replaceFromRemote(remote)
    expect(store.sidecar.value).toBe(remote)
    expect(store.canUndo.value).toBe(false)
    expect(store.canRedo.value).toBe(false)
  })

  it('caps history at 100', () => {
    const { store } = make()
    for (let i = 0; i < 105; i++) store.addStroke(stroke(`s${i}`))
    for (let i = 0; i < 200; i++) store.undo()
    expect(store.inks.value).toHaveLength(5)
  })

  it('handles document undo and redo events', () => {
    const { store } = make()
    store.addHighlight(text(1, 0.1, 0.1))
    document.dispatchEvent(new CustomEvent('marginalia:undo'))
    expect(store.highlights.value).toHaveLength(0)
    document.dispatchEvent(new CustomEvent('marginalia:redo'))
    expect(store.highlights.value).toHaveLength(1)
  })

  it('ignores document events after dispose', () => {
    const { store } = make()
    store.addHighlight(text(1, 0.1, 0.1))
    store.dispose()
    document.dispatchEvent(new CustomEvent('marginalia:undo'))
    expect(store.highlights.value).toHaveLength(1)
  })
})
