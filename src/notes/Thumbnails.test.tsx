import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { inkOutlinePath } from '../ink/geometry.ts'
import { inkDisplayColor } from '../ink/tools.ts'
import { orderBetween } from '../lib/order.ts'
import { emptyNotebook, PAGE_SIZES, type NotesDocV2 } from './model.ts'
import { createNotebookStore, type NotebookStore } from './notebookStore.ts'
import { THUMB_LONG_PRESS_MS, THUMB_W, Thumbnails } from './Thumbnails.tsx'

const outlines = vi.hoisted(() => ({ count: 0 }))

vi.mock('../ink/geometry.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ink/geometry.ts')>()
  return {
    ...real,
    inkOutlinePath: (...args: Parameters<typeof real.inkOutlinePath>) => {
      outlines.count++
      return real.inkOutlinePath(...args)
    },
  }
})

let host: HTMLElement
let store: NotebookStore
const onJump = vi.fn<(id: string) => void>()
const onClose = vi.fn()

// A notebook of pages 'page-1' … 'page-n'.
function notebook(n: number): NotesDocV2 {
  const doc = emptyNotebook('pdf', 'a.pdf', 1)
  const first = doc.pages[0]
  first.size = { ...PAGE_SIZES.a4 }
  for (let i = 1, order = first.order; i < n; i++) {
    order = orderBetween(order, null)
    doc.pages.push({ ...first, id: `page-${i + 1}`, order })
  }
  return doc
}

beforeEach(() => {
  vi.useFakeTimers()
  onJump.mockClear()
  outlines.count = 0
  onClose.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  // Thumbnails stack vertically, 100 px apart.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const i = Array.from(host.querySelectorAll('.mg-thumb')).indexOf(this)
    return new DOMRect(0, i * 100, 100, 90)
  })
  HTMLElement.prototype.setPointerCapture = vi.fn()
})

afterEach(() => {
  render(null, host)
  host.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function mount(n = 3, layout: 'column' | 'sheet' = 'column', current: string | null = 'page-2') {
  store = createNotebookStore(notebook(n), vi.fn())
  await act(() => {
    render(<Thumbnails store={store} current={current} layout={layout} onJump={onJump} onClose={onClose} />, host)
  })
}

const $ = (sel: string) => host.querySelector<HTMLElement>(sel)!
const thumb = (id: string) => $(`.mg-thumb[data-page="${id}"]`)
const ids = () => store.pages.value.map((p) => p.id)
const ptr = (type: string, el: Element, y = 0) =>
  el.dispatchEvent(new PointerEvent(type, { pointerId: 1, isPrimary: true, button: 0, clientX: 50, clientY: y, bubbles: true }))
const hold = () => act(() => { vi.advanceTimersByTime(THUMB_LONG_PRESS_MS) })

test('one thumbnail per live page with its paper colour, ink paths and object boxes', async () => {
  await mount(2)
  store.setPageStyle('page-2', { color: 'yellow' }, false)
  const points = [0.1, 0.1, 0.5, 0.4, 0.3, 0.5]
  const stroke = store.addStroke({ id: 's1', page: 'page-1', tool: 'pen', pen: 'fountain', color: '#112233', width: 0.004, points, createdAt: 1, updatedAt: 1 })
  store.addText({ page: 'page-1', box: { x: 0.1, y: 0.5, w: 0.4 }, text: 'hi', size: 'm', color: '#000000' })
  store.addImage({ page: 'page-1', src: 'data:image/png;base64,AAAA', aspect: 1 })
  await act(() => {})
  expect(host.querySelectorAll('.mg-thumb')).toHaveLength(2)
  expect($('nav.mg-thumbs').getAttribute('aria-label')).toBe('Pages')
  expect(thumb('page-1').getAttribute('aria-label')).toBe('Page 1')
  expect(thumb('page-2').getAttribute('aria-current')).toBe('page')
  expect(thumb('page-1').hasAttribute('aria-current')).toBe(false)
  expect(thumb('page-2').querySelector('rect')!.getAttribute('fill')).toBe('#fbf3d0')
  const svg = thumb('page-1').querySelector('svg')!
  expect(svg.getAttribute('width')).toBe(String(THUMB_W))
  expect(parseFloat(svg.getAttribute('height')!)).toBeCloseTo((THUMB_W * 297) / 210)
  expect(svg.querySelector('path')!.getAttribute('d')).toBe(inkOutlinePath(stroke.points, 0.004, THUMB_W, THUMB_W, 'fountain'))
  expect(svg.querySelectorAll('rect.mg-thumb-box')).toHaveLength(2)
  expect(svg.querySelector('image')).toBeNull()
})

test('a tap jumps to the page', async () => {
  await mount()
  await act(() => { thumb('page-3').click() })
  expect(onJump).toHaveBeenCalledWith('page-3')
})

test('a long-press opens Delete and Duplicate', async () => {
  await mount()
  await act(() => { ptr('pointerdown', thumb('page-2'), 100) })
  await hold()
  const items = Array.from(host.querySelectorAll('[role="menu"] [role="menuitem"]'))
  expect(items.map((b) => b.textContent)).toEqual(['Delete', 'Duplicate'])
  await act(() => { ptr('pointerup', thumb('page-2'), 100) })
  await act(() => { thumb('page-2').click() })
  expect(onJump).not.toHaveBeenCalled()
  await act(() => { (items[1] as HTMLElement).click() })
  expect(ids()).toHaveLength(4)
  expect(ids().slice(0, 2)).toEqual(['page-1', 'page-2'])
  await act(() => { ptr('pointerdown', thumb('page-1'), 0) })
  await hold()
  await act(() => { ptr('pointerup', thumb('page-1'), 0) })
  await act(() => { (host.querySelector('[role="menu"] [role="menuitem"]') as HTMLElement).click() })
  expect(ids()).not.toContain('page-1')
})

test('long-press-drag reorders pages', async () => {
  await mount()
  await act(() => { ptr('pointerdown', thumb('page-1'), 0) })
  await hold()
  await act(() => { ptr('pointermove', thumb('page-1'), 260) })
  expect(host.querySelector('[role="menu"]')).toBeNull()
  await act(() => { ptr('pointerup', thumb('page-1'), 260) })
  expect(ids()).toEqual(['page-2', 'page-3', 'page-1'])
  expect(onJump).not.toHaveBeenCalled()
})

test('during a long-press drag the list neither scrolls nor pans; after release it does again', async () => {
  await mount(3)
  const list = $('.mg-thumbs-list')
  const touchMove = () => {
    const e = new TouchEvent('touchmove', { bubbles: true, cancelable: true })
    thumb('page-1').dispatchEvent(e)
    return e
  }
  ptr('pointerdown', thumb('page-1'), 10)
  expect(touchMove().defaultPrevented).toBe(false)
  await hold()
  expect(list.style.touchAction).toBe('none')
  expect(touchMove().defaultPrevented).toBe(true)
  await act(() => { ptr('pointermove', thumb('page-1'), 150) })
  expect(touchMove().defaultPrevented).toBe(true)
  await act(() => { ptr('pointerup', thumb('page-1'), 150) })
  expect(ids()).toEqual(['page-2', 'page-1', 'page-3'])
  expect(list.style.touchAction).toBe('')
  expect(touchMove().defaultPrevented).toBe(false)

  ptr('pointerdown', thumb('page-2'), 10)
  await hold()
  expect(list.style.touchAction).toBe('none')
  await act(() => { ptr('pointercancel', thumb('page-2'), 10) })
  expect(list.style.touchAction).toBe('')
  expect(touchMove().defaultPrevented).toBe(false)
})

test('moving before the long-press fires cancels it', async () => {
  await mount()
  await act(() => { ptr('pointerdown', thumb('page-1'), 0) })
  await act(() => { ptr('pointermove', thumb('page-1'), 40) })
  await hold()
  expect(host.querySelector('[role="menu"]')).toBeNull()
})

test('the sheet layout is a bottom sheet with a close button', async () => {
  await mount(2, 'sheet')
  expect($('nav.mg-thumbs').dataset.layout).toBe('sheet')
  await act(() => { $('.mg-thumbs-close').click() })
  expect(onClose).toHaveBeenCalledOnce()
})

test('the column layout has no close button', async () => {
  await mount(2, 'column')
  expect(host.querySelector('.mg-thumbs-close')).toBeNull()
})

test('a page dropped above the first thumbnail becomes first', async () => {
  await mount()
  await act(() => { ptr('pointerdown', thumb('page-3'), 200) })
  await hold()
  await act(() => { ptr('pointermove', thumb('page-3'), 10) })
  await act(() => { ptr('pointerup', thumb('page-3'), 10) })
  expect(ids()).toEqual(['page-3', 'page-1', 'page-2'])
})

test('dropping on the upper half of a thumbnail places the page before it', async () => {
  await mount()
  await act(() => { ptr('pointerdown', thumb('page-3'), 200) })
  await hold()
  await act(() => { ptr('pointermove', thumb('page-3'), 110) })
  await act(() => { ptr('pointerup', thumb('page-3'), 110) })
  expect(ids()).toEqual(['page-1', 'page-3', 'page-2'])
})

test('ink on a dark page keeps its colour except black, which turns pale', async () => {
  await mount(1, 'column', 'page-1')
  store.setPageStyle('page-1', { color: 'dark' }, false)
  const pts = [0.1, 0.1, 0.5, 0.4, 0.3, 0.5]
  store.addStroke({ id: 'k', page: 'page-1', tool: 'pen', pen: 'fountain', color: '#1c1c1a', width: 0.004, points: pts, createdAt: 1, updatedAt: 1 })
  store.addStroke({ id: 'r', page: 'page-1', tool: 'pen', pen: 'fountain', color: '#d32f2f', width: 0.004, points: pts, createdAt: 1, updatedAt: 1 })
  await act(() => {})
  const fills = Array.from(thumb('page-1').querySelectorAll('path')).map((p) => p.getAttribute('fill'))
  expect(fills).toEqual(['#e8e6e1', '#d32f2f'])
  expect(fills[0]).toBe(inkDisplayColor('#1c1c1a', true))
})

test('a drag over one thumbnail outlines each stroke once', async () => {
  await mount()
  store.addStroke({ id: 's1', page: 'page-1', tool: 'pen', pen: 'fountain', color: '#112233', width: 0.004, points: [0.1, 0.1, 0.5, 0.4, 0.3, 0.5], createdAt: 1, updatedAt: 1 })
  await act(() => {})
  const before = outlines.count
  await act(() => { ptr('pointerdown', thumb('page-1'), 0) })
  await hold()
  for (let i = 0; i < 10; i++) await act(() => { ptr('pointermove', thumb('page-1'), 120 + i) })
  expect(outlines.count).toBe(before)
  expect(before).toBe(1)
})
