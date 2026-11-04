import { expect, test, vi } from 'vitest'
import { emptyNotebook, type NotesDocV2 } from './model.ts'
import { createNotebookStore, type NewStroke } from './notebookStore.ts'

function make(doc: NotesDocV2 = emptyNotebook('pdf', 'a.pdf', 1)) {
  const persist = vi.fn<(d: NotesDocV2) => void>()
  const store = createNotebookStore(doc, persist)
  return { store, persist }
}

type Store = ReturnType<typeof make>['store']

const stroke = (id: string, page = 'page-1'): NewStroke => ({
  id, page, tool: 'pen', pen: 'ball', color: '#000', width: 0.004, points: [0.1, 0.2, 0.5], createdAt: 1, updatedAt: 1,
})

const pageIds = (store: Store) => store.pages.value.map((p) => p.id)
const box = { x: 0.1, y: 0.1, w: 0.5 }

test('addPage appends a copy of the last page\'s style; null puts it first; after places it between', () => {
  const { store, persist } = make()
  store.setPageStyle('page-1', { template: 'grid', color: 'yellow' }, false)
  persist.mockClear()

  const last = store.addPage()
  expect(persist).toHaveBeenCalledTimes(1)
  expect(persist.mock.calls[0][0]).toBe(store.doc.value)
  expect(last).toMatchObject({ template: 'grid', color: 'yellow', size: { w: 210, h: 297 } })
  expect(pageIds(store)).toEqual(['page-1', last.id])

  const first = store.addPage(null, { template: 'dots' })
  expect(first).toMatchObject({ template: 'dots', color: 'yellow' })
  const between = store.addPage('page-1', { color: 'dark' })
  expect(between).toMatchObject({ template: 'grid', color: 'dark' })
  expect(pageIds(store)).toEqual([first.id, 'page-1', between.id, last.id])
})

test('deletePage tombstones the page and hides its items; undo restores both', () => {
  const { store } = make()
  const second = store.addPage()
  store.addStroke(stroke('s1', second.id))
  const t = store.addText({ page: second.id, box, text: 'hi', size: 'm', color: '#000' })
  const third = store.pages.value[2]

  store.deletePage(second.id)
  expect(pageIds(store)).toEqual(['page-1', third.id])
  expect(store.content.value.has(second.id)).toBe(false)
  expect(store.doc.value.pages.find((p) => p.id === second.id)?.deleted).toBe(true)
  expect(store.doc.value.texts.find((x) => x.id === t.id)?.deleted).toBeUndefined()

  store.undo()
  expect(pageIds(store)).toEqual(['page-1', second.id, third.id])
  expect(store.content.value.get(second.id)!.strokes.map((s) => s.id)).toEqual(['s1'])
  expect(store.content.value.get(second.id)!.texts.map((x) => x.id)).toEqual([t.id])
})

test('deletePage leaves the only live page in place', () => {
  const { store, persist } = make()
  const second = store.addPage()
  store.deletePage(second.id)
  persist.mockClear()

  store.deletePage('page-1')
  expect(pageIds(store)).toEqual(['page-1'])
  expect(persist).not.toHaveBeenCalled()
  store.undo()
  expect(pageIds(store)).toEqual(['page-1', second.id])
})

test('movePage reorders pages by order key', () => {
  const { store } = make()
  const b = store.addPage()
  const c = store.addPage()
  store.movePage(c.id, null)
  expect(pageIds(store)).toEqual([c.id, 'page-1', b.id])
  store.movePage(c.id, 'page-1')
  expect(pageIds(store)).toEqual(['page-1', c.id, b.id])
  store.movePage('page-1', b.id)
  expect(pageIds(store)).toEqual([c.id, b.id, 'page-1'])
  store.undo()
  expect(pageIds(store)).toEqual(['page-1', c.id, b.id])
})

test('setPageStyle changes one page or every page in one undo step', () => {
  const { store, persist } = make()
  const b = store.addPage()
  const c = store.addPage()
  store.setPageStyle(b.id, { template: 'dots' }, false)
  expect(store.pages.value.map((p) => p.template)).toEqual(['blank', 'dots', 'blank'])

  persist.mockClear()
  store.setPageStyle(c.id, { color: 'dark', size: { w: 215.9, h: 279.4 } }, true)
  expect(persist).toHaveBeenCalledTimes(1)
  expect(store.pages.value.map((p) => [p.template, p.color, p.size.w])).toEqual([
    ['blank', 'dark', 215.9], ['dots', 'dark', 215.9], ['blank', 'dark', 215.9],
  ])
  store.undo()
  expect(store.pages.value.map((p) => [p.template, p.color, p.size.w])).toEqual([
    ['blank', 'white', 210], ['dots', 'white', 210], ['blank', 'white', 210],
  ])
})

test('the first stroke on the last page adds a page after it in the same undo step', () => {
  const { store, persist } = make()
  store.setPageStyle('page-1', { template: 'ruled-wide' }, false)
  persist.mockClear()

  store.addStroke(stroke('s1'))
  expect(persist).toHaveBeenCalledTimes(1)
  expect(store.pages.value).toHaveLength(2)
  expect(store.pages.value[1].template).toBe('ruled-wide')
  store.addStroke(stroke('s2'))
  expect(store.pages.value).toHaveLength(2)

  store.undo()
  store.undo()
  expect(pageIds(store)).toEqual(['page-1'])
  expect(store.content.value.get('page-1')!.strokes).toEqual([])

  store.addText({ page: 'page-1', box, text: 'a', size: 'm', color: '#000' })
  expect(store.pages.value).toHaveLength(2)
})

test('new items get a z above everything on their page', () => {
  const { store } = make()
  const s1 = store.addStroke(stroke('s1'))
  const t = store.addText({ page: 'page-1', box, text: 'a', size: 'm', color: '#000' })
  const img = store.addImage({ page: 'page-1', src: 'x', aspect: 1 })
  const s2 = store.addStroke(stroke('s2'))
  expect(s1.z < t.z && t.z < img.z && img.z < s2.z).toBe(true)
  const other = store.addStroke(stroke('s3', store.pages.value[1].id))
  expect(other.z).toBe(s1.z)
  store.removeStroke('s2')
  expect(store.addStroke(stroke('s4')).z > img.z).toBe(true)
})

test('replaceStroke tombstones the original and adds the pieces in one undo step', () => {
  const { store, persist } = make()
  const original = store.addStroke(stroke('s1'))
  persist.mockClear()

  store.replaceStroke('s1', [stroke('a'), stroke('b')])
  expect(persist).toHaveBeenCalledTimes(1)
  const live = store.content.value.get('page-1')!.strokes
  expect(live.map((s) => s.id).sort()).toEqual(['a', 'b'])
  expect(live.every((s) => s.z === original.z)).toBe(true)
  expect(store.doc.value.strokes.find((s) => s.id === 's1')?.deleted).toBe(true)

  store.undo()
  expect(store.content.value.get('page-1')!.strokes.map((s) => s.id)).toEqual(['s1'])
  store.redo()
  expect(store.content.value.get('page-1')!.strokes.map((s) => s.id).sort()).toEqual(['a', 'b'])
})

test('addImage defaults to half the page width centred on the page', () => {
  const { store } = make()
  const img = store.addImage({ page: 'page-1', src: 'x', aspect: 0.5, pdfPage: 4 })
  expect(img.box.x).toBe(0.25)
  expect(img.box.w).toBe(0.5)
  expect(img.box.y).toBeCloseTo((297 / 210 - 0.25) / 2)
  expect(img).toMatchObject({ src: 'x', aspect: 0.5, pdfPage: 4, page: 'page-1' })
  expect('pdfPage' in store.addImage({ page: 'page-1', src: 'y', aspect: 1, box })).toBe(false)
  store.updateImage(img.id, { box: { x: 0, y: 0, w: 1 } })
  expect(store.doc.value.images.find((i) => i.id === img.id)!.box).toEqual({ x: 0, y: 0, w: 1 })
  store.removeObject('images', img.id)
  expect(store.content.value.get('page-1')!.images.map((i) => i.id)).not.toContain(img.id)
})

test('consecutive updateText calls with text only on one box undo as one step', () => {
  const { store, persist } = make()
  const t = store.addText({ page: 'page-1', box, text: '', size: 'm', color: '#000' })
  const u = store.addText({ page: 'page-1', box, text: 'other', size: 'm', color: '#000' })
  persist.mockClear()
  store.updateText(t.id, { text: 'H' })
  store.updateText(t.id, { text: 'He' })
  store.updateText(t.id, { text: 'Hey' })
  expect(persist).toHaveBeenCalledTimes(3)
  const text = (id: string) => store.doc.value.texts.find((x) => x.id === id)!

  store.undo()
  expect(text(t.id).text).toBe('')
  store.redo()
  expect(text(t.id).text).toBe('Hey')

  store.updateText(t.id, { text: 'Hey!' })
  store.updateText(t.id, { size: 'l' })
  store.updateText(t.id, { text: 'Hey!!' })
  store.updateText(u.id, { text: 'other!' })
  store.undo()
  expect(text(u.id).text).toBe('other')
  store.undo()
  expect(text(t.id)).toMatchObject({ text: 'Hey!', size: 'l' })
  store.undo()
  expect(text(t.id)).toMatchObject({ text: 'Hey!', size: 'm' })
  store.undo()
  expect(text(t.id).text).toBe('Hey')
})

test('duplicatePage copies the style and the live items with new ids right after it', () => {
  const { store } = make()
  store.setPageStyle('page-1', { template: 'grid' }, false)
  const s = store.addStroke(stroke('s1'))
  store.addStroke(stroke('gone'))
  store.removeStroke('gone')
  const t = store.addText({ page: 'page-1', box, text: 'hi', size: 's', color: '#f00' })
  const img = store.addImage({ page: 'page-1', src: 'x', aspect: 1, pdfPage: 2 })
  const tail = store.pages.value[1]

  const copy = store.duplicatePage('page-1')
  expect(pageIds(store)).toEqual(['page-1', copy.id, tail.id])
  expect(copy).toMatchObject({ template: 'grid', color: 'white', size: { w: 210, h: 297 } })
  const c = store.content.value.get(copy.id)!
  expect(c.strokes).toHaveLength(1)
  expect(c.strokes[0]).toMatchObject({ points: s.points, z: s.z, page: copy.id })
  expect(c.strokes[0].id).not.toBe(s.id)
  expect(c.texts.map((x) => [x.text, x.size, x.color, x.z])).toEqual([[t.text, t.size, t.color, t.z]])
  expect(c.texts[0].id).not.toBe(t.id)
  expect(c.images[0]).toMatchObject({ src: 'x', pdfPage: 2, z: img.z })
  expect(c.images[0].id).not.toBe(img.id)

  store.undo()
  expect(pageIds(store)).toEqual(['page-1', tail.id])
})

test('content groups live items by live page and sorts each kind by z', () => {
  const doc = emptyNotebook('pdf', 'a.pdf', 1)
  const item = { createdAt: 1, updatedAt: 1, page: 'page-1' }
  const ink = (id: string, z: string, extra = {}) => ({ ...item, id, z, tool: 'pen' as const, pen: 'ball' as const, color: '#000', width: 0.004, points: [], ...extra })
  doc.pages.push({ ...doc.pages[0], id: 'empty', order: 'W' }, { ...doc.pages[0], id: 'dead', order: 'X', deleted: true })
  doc.strokes = [ink('b', 'c'), ink('a', 'b'), ink('x', 'a', { deleted: true }), ink('d', 'a', { page: 'dead' })]
  doc.texts = [{ ...item, id: 't', z: 'z', box, text: 'hi', size: 'm', color: '#000' }]
  const { store } = make(doc)

  expect([...store.content.value.keys()]).toEqual(['page-1', 'empty'])
  expect(store.content.value.get('page-1')!.strokes.map((s) => s.id)).toEqual(['a', 'b'])
  expect(store.content.value.get('page-1')!.texts.map((s) => s.id)).toEqual(['t'])
  expect(store.content.value.get('empty')).toEqual({ strokes: [], texts: [], images: [] })
})

test('replaceFromRemote swaps the doc and clears history', () => {
  const { store, persist } = make()
  store.addStroke(stroke('s1'))
  expect(store.canUndo.value).toBe(true)
  persist.mockClear()

  const remote = emptyNotebook('pdf', 'renamed.pdf', 5)
  store.replaceFromRemote(remote)
  expect(store.doc.value).toBe(remote)
  expect(store.canUndo.value).toBe(false)
  expect(store.canRedo.value).toBe(false)
  expect(persist).not.toHaveBeenCalled()
  store.undo()
  expect(store.doc.value).toBe(remote)
})
