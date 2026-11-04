import { expect, test, vi } from 'vitest'
import { emptyNotes, type NoteStroke, type NotesDoc, type TextBlock } from '../types.ts'
import { createNotesStore } from './notesStore.ts'

function make(doc: NotesDoc = emptyNotes('pdf', 'a.pdf', 1)) {
  const persist = vi.fn<(d: NotesDoc) => void>()
  const store = createNotesStore(doc, persist)
  return { store, persist }
}

const texts = (store: ReturnType<typeof make>['store']) =>
  store.blocks.value.map((b) => (b.kind === 'text' ? b.text : `[img ${b.id}]`))

const stroke = (id: string): NoteStroke => ({
  id, kind: 'ink', color: '#000', width: 0.004, points: [0.1, 0.2, 0.5], createdAt: 1, updatedAt: 1,
})

test('adds text blocks in order and persists each change', () => {
  const { store, persist } = make()
  store.addTextBlock('one')
  store.addTextBlock('two')
  store.addTextBlock('three')
  expect(texts(store)).toEqual(['one', 'two', 'three'])
  expect(persist).toHaveBeenCalledTimes(3)
  expect(persist.mock.calls[2][0]).toBe(store.doc.value)
  const orders = store.blocks.value.map((b) => b.order)
  for (let i = 1; i < orders.length; i++) expect(orders[i] > orders[i - 1]).toBe(true)
})

test('afterId places a block right after another; null puts it first', () => {
  const { store } = make()
  const a = store.addTextBlock('a')
  store.addTextBlock('c')
  store.addTextBlock('b', a.id)
  store.addTextBlock('first', null)
  expect(texts(store)).toEqual(['first', 'a', 'b', 'c'])
})

test('splitText at 3 turns "Hello" into "Hel" + "lo" right after it; one undo restores "Hello"', () => {
  const { store, persist } = make()
  const a = store.addTextBlock('Hello')
  store.addTextBlock('after')
  persist.mockClear()
  const b = store.splitText(a.id, 3)
  expect(b.text).toBe('lo')
  expect(texts(store)).toEqual(['Hel', 'lo', 'after'])
  expect(persist).toHaveBeenCalledTimes(1)
  store.undo()
  expect(texts(store)).toEqual(['Hello', 'after'])
  expect(store.doc.value.blocks.find((x) => x.id === b.id)?.deleted).toBe(true)
})

test('joinWithPrevious appends to the previous text block and returns its caret', () => {
  const { store } = make()
  const first = store.addTextBlock('ab')
  const second = store.addTextBlock('cd')
  expect(store.joinWithPrevious(second.id)).toEqual({ kind: 'text', id: first.id, caret: 2 })
  expect(texts(store)).toEqual(['abcd'])
  expect(store.doc.value.blocks.find((x) => x.id === second.id)?.deleted).toBe(true)
  store.undo()
  expect(texts(store)).toEqual(['ab', 'cd'])
})

test('joinWithPrevious after an image selects the image and deletes nothing', () => {
  const { store, persist } = make()
  const img = store.addImageBlock({ src: 'data:x', aspect: 0.5 })
  const t = store.addTextBlock('text')
  persist.mockClear()
  expect(store.joinWithPrevious(t.id)).toEqual({ kind: 'image', id: img.id })
  expect(store.blocks.value).toHaveLength(2)
  expect(persist).not.toHaveBeenCalled()
  expect(store.joinWithPrevious(img.id)).toBeNull()
})

test('consecutive updateText calls on one block undo as one step', () => {
  const { store, persist } = make()
  const a = store.addTextBlock('')
  const b = store.addTextBlock('x')
  store.updateText(a.id, 'H')
  store.updateText(a.id, 'He')
  store.updateText(a.id, 'Hey')
  expect(persist).toHaveBeenCalledTimes(5)
  store.updateText(b.id, 'xy')
  store.undo()
  expect(texts(store)).toEqual(['Hey', 'x'])
  store.undo()
  expect(texts(store)).toEqual(['', 'x'])
  store.redo()
  expect(texts(store)).toEqual(['Hey', 'x'])
})

test('resizeImage clamps to [0.15, 1]', () => {
  const { store } = make()
  const img = store.addImageBlock({ src: 'data:x', aspect: 0.5, page: 4 })
  expect(img.w).toBe(0.8)
  expect(img.page).toBe(4)
  store.resizeImage(img.id, 0.05)
  expect(store.blocks.value[0]).toMatchObject({ w: 0.15 })
  store.resizeImage(img.id, 1.4)
  expect(store.blocks.value[0]).toMatchObject({ w: 1 })
  store.resizeImage(img.id, 0.5)
  expect(store.blocks.value[0]).toMatchObject({ w: 0.5 })
})

test('removeBlock tombstones and undo restores it; redo removes it again', () => {
  const { store, persist } = make()
  const a = store.addTextBlock('a')
  const before = a.updatedAt
  vi.spyOn(Date, 'now').mockReturnValue(before + 10)
  store.removeBlock(a.id)
  vi.restoreAllMocks()
  const tomb = store.doc.value.blocks.find((x) => x.id === a.id) as TextBlock
  expect(tomb.deleted).toBe(true)
  expect(tomb.updatedAt).toBe(before + 10)
  expect(store.blocks.value).toHaveLength(0)
  expect(persist).toHaveBeenCalledTimes(2)
  store.undo()
  expect(texts(store)).toEqual(['a'])
  expect(store.canRedo.value).toBe(true)
  store.redo()
  expect(store.blocks.value).toHaveLength(0)
  expect(store.doc.value.blocks).toHaveLength(1)
})

test('strokes add, erase, undo and redo', () => {
  const { store } = make()
  store.addStroke(stroke('s1'))
  store.addStroke(stroke('s2'))
  store.removeStroke('s1')
  expect(store.strokes.value.map((s) => s.id)).toEqual(['s2'])
  store.undo()
  expect(store.strokes.value.map((s) => s.id)).toEqual(['s1', 's2'])
  store.undo()
  expect(store.strokes.value.map((s) => s.id)).toEqual(['s1'])
  store.redo()
  store.redo()
  expect(store.strokes.value.map((s) => s.id)).toEqual(['s2'])
  expect(store.canRedo.value).toBe(false)
})

test('setBackground persists and is not undoable', () => {
  const { store, persist } = make()
  store.setBackground('grid')
  expect(store.doc.value.background).toBe('grid')
  expect(store.doc.value.backgroundUpdatedAt).toBeGreaterThan(1)
  expect(persist).toHaveBeenCalledTimes(1)
  expect(store.canUndo.value).toBe(false)
})

test('replaceFromRemote swaps the doc and clears history', () => {
  const { store } = make()
  store.addTextBlock('local')
  const remote = { ...emptyNotes('pdf', 'a.pdf', 5), background: 'dots' as const }
  store.replaceFromRemote(remote)
  expect(store.doc.value).toBe(remote)
  expect(store.blocks.value).toHaveLength(0)
  expect(store.canUndo.value).toBe(false)
  expect(store.canRedo.value).toBe(false)
})

test('ignores the document marginalia:undo event', () => {
  const { store } = make()
  store.addTextBlock('a')
  document.dispatchEvent(new CustomEvent('marginalia:undo'))
  expect(texts(store)).toEqual(['a'])
  expect(store.canUndo.value).toBe(true)
})
