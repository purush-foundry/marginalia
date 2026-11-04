import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { toast } from '../app/ui.ts'
import { fingerDraws, mouseDraws, nightInk, penTool, tool } from '../ink/tools.ts'
import { emptyNotes, type NotesDoc, type TextBlock } from '../types.ts'
import { ImageTooLargeError, prepareImage } from './images.ts'
import { NotesSheet, type NotesSheetHandle } from './NotesSheet.tsx'
import { createNotesStore, type NotesStore } from './notesStore.ts'

vi.mock('./images.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./images.ts')>()),
  prepareImage: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,AAAA', width: 800, height: 400, bytes: 3, mediaType: 'image/jpeg' })),
}))

let host: HTMLElement
let store: NotesStore
let jump: ReturnType<typeof vi.fn<(page: number) => void>>
let handle: NotesSheetHandle | undefined
const restores: (() => void)[] = []

beforeEach(() => {
  penTool.value = 'pen'
  tool.value = 'lasso'
  mouseDraws.value = false
  fingerDraws.value = false
  nightInk.value = false
  host = document.createElement('div')
  document.body.appendChild(host)
  store = createNotesStore(emptyNotes('pdf', 'a.pdf', 1), vi.fn<(d: NotesDoc) => void>())
  jump = vi.fn<(page: number) => void>()
  const original = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.matches('.mg-notes-sheet, .mg-notes') ? new DOMRect(0, 0, 400, 900) : original.call(this)
  })
})

afterEach(() => {
  render(null, host)
  host.remove()
  while (restores.length) restores.pop()!()
  vi.restoreAllMocks()
})

async function mount() {
  await act(() => {
    render(<NotesSheet store={store} onJumpToPage={jump} handle={(h) => (handle = h)} />, host)
  })
}

const flush = () => act(async () => {})
const $ = <E extends Element = HTMLElement>(sel: string) => host.querySelector<E & HTMLElement>(sel)!
const textEls = () => Array.from(host.querySelectorAll<HTMLElement>('.mg-note-text'))
const texts = () => store.blocks.value.map((b) => (b.kind === 'text' ? b.text : 'img'))

function caretAt(el: HTMLElement, offset: number) {
  el.focus()
  const node = el.firstChild ?? el
  document.getSelection()!.collapse(node, offset)
}

function key(el: Element, k: string, init: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
}

function pointer(el: Element, name: string, x: number, y: number, type = 'mouse') {
  el.dispatchEvent(
    new PointerEvent(name, {
      bubbles: true, cancelable: true, pointerType: type, pointerId: type === 'pen' ? 2 : 1,
      clientX: x, clientY: y, pressure: 0.5, button: 0, buttons: name === 'pointerup' ? 0 : 1,
    }),
  )
}

async function tap(el: Element) {
  await act(() => {
    pointer(el, 'pointerdown', 1, 1)
    pointer(el, 'pointerup', 1, 1)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function setViewport(vv: { height: number; offsetTop: number }) {
  const fake = Object.assign(new EventTarget(), vv)
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake })
  restores.push(() => delete (window as { visualViewport?: unknown }).visualViewport)
}

test('an empty sheet says "Write or type your notes"', async () => {
  await mount()
  expect(host.textContent).toContain('Write or type your notes')
  await tap($('.mg-notes-sheet'))
  expect(texts()).toEqual([''])
  expect(document.activeElement).toBe(textEls()[0])
  expect(host.textContent).toContain('Write or type your notes')
  await act(() => {
    textEls()[0].textContent = 'Hi'
    textEls()[0].dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(texts()).toEqual(['Hi'])
  expect(host.textContent).not.toContain('Write or type your notes')
})

test('Enter splits the block at the caret and focuses the new one', async () => {
  store.addTextBlock('Hello')
  await mount()
  await act(() => {
    caretAt(textEls()[0], 3)
    key(textEls()[0], 'Enter')
  })
  expect(texts()).toEqual(['Hel', 'lo'])
  expect(textEls().map((e) => e.textContent)).toEqual(['Hel', 'lo'])
  expect(document.activeElement).toBe(textEls()[1])
  expect(document.getSelection()!.focusOffset).toBe(0)
})

test('Enter that confirms an IME composition does not split', async () => {
  store.addTextBlock('Hello')
  await mount()
  await act(() => {
    caretAt(textEls()[0], 3)
    key(textEls()[0], 'Enter', { isComposing: true })
    key(textEls()[0], 'Enter', { keyCode: 229 })
  })
  expect(texts()).toEqual(['Hello'])
})

test('Backspace at the start joins the previous block', async () => {
  store.addTextBlock('ab')
  store.addTextBlock('cd')
  await mount()
  await act(() => {
    caretAt(textEls()[1], 0)
    key(textEls()[1], 'Backspace')
  })
  expect(texts()).toEqual(['abcd'])
  expect(textEls()).toHaveLength(1)
  expect(document.activeElement).toBe(textEls()[0])
  expect(textEls()[0].textContent).toBe('abcd')
  expect(document.getSelection()!.focusOffset).toBe(2)
})

test('the first text block is the title', async () => {
  store.addImageBlock({ src: 'data:x', aspect: 0.5 })
  store.addTextBlock('Title')
  store.addTextBlock('Body')
  await mount()
  expect(textEls()[0].classList.contains('mg-note-title')).toBe(true)
  expect(textEls()[1].classList.contains('mg-note-title')).toBe(false)
})

test('+ Image adds an image block from the picked file', async () => {
  await mount()
  const input = $<HTMLInputElement>('input[type="file"]')
  expect(input.accept).toBe('image/*')
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.png', { type: 'image/png' })] })
  await act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
  expect($<HTMLImageElement>('figure.mg-note-image img').getAttribute('src')).toBe('data:image/jpeg;base64,AAAA')
  expect(store.blocks.value[0]).toMatchObject({ kind: 'image', aspect: 0.5, w: 0.8 })
})

function fileEvent(name: string, prop: 'clipboardData' | 'dataTransfer', files: File[]) {
  const e = new Event(name, { bubbles: true, cancelable: true })
  Object.defineProperty(e, prop, { value: { files, types: ['Files'] } })
  return e
}

const png = () => new File(['x'], 'a.png', { type: 'image/png' })

test('pasting an image file adds it after the focused block', async () => {
  store.addTextBlock('a')
  store.addTextBlock('b')
  await mount()
  const e = fileEvent('paste', 'clipboardData', [png()])
  await act(() => {
    caretAt(textEls()[0], 1)
    textEls()[0].dispatchEvent(e)
  })
  await flush()
  expect(e.defaultPrevented).toBe(true)
  expect(texts()).toEqual(['a', 'img', 'b'])
})

test('a text paste is left to the browser', async () => {
  store.addTextBlock('a')
  await mount()
  const e = fileEvent('paste', 'clipboardData', [])
  await act(() => {
    textEls()[0].dispatchEvent(e)
  })
  expect(e.defaultPrevented).toBe(false)
  expect(texts()).toEqual(['a'])
})

test('dropping image files adds them at the end in order', async () => {
  store.addTextBlock('a')
  await mount()
  const over = fileEvent('dragover', 'dataTransfer', [])
  $('.mg-notes').dispatchEvent(over)
  expect(over.defaultPrevented).toBe(true)
  const drop = fileEvent('drop', 'dataTransfer', [png(), new File(['t'], 'a.txt', { type: 'text/plain' }), png()])
  await act(() => {
    $('.mg-notes-sheet').dispatchEvent(drop)
  })
  await flush()
  expect(drop.defaultPrevented).toBe(true)
  expect(texts()).toEqual(['a', 'img', 'img'])
})

test('an image too large to fit says so', async () => {
  vi.mocked(prepareImage).mockRejectedValueOnce(new ImageTooLargeError('Image too large'))
  await mount()
  await act(() => {
    $('.mg-notes').dispatchEvent(fileEvent('drop', 'dataTransfer', [png()]))
  })
  await flush()
  expect(toast.value).toBe('Image too large to add')
  expect(store.blocks.value).toHaveLength(0)
})

test('dragging the handle resizes the image in sheet units', async () => {
  const img = store.addImageBlock({ src: 'data:x', aspect: 0.5 })
  await mount()
  expect(host.querySelector('.mg-note-handle')).toBeNull()
  await tap($('figure.mg-note-image img'))
  expect($('figure.mg-note-image').dataset.selected).toBeDefined()
  const handle = $('.mg-note-handle')
  await act(() => {
    pointer(handle, 'pointerdown', 320, 100)
    pointer(handle, 'pointermove', 250, 100)
    pointer(handle, 'pointermove', 200, 100)
    pointer(handle, 'pointerup', 200, 100)
  })
  expect(store.blocks.value[0]).toMatchObject({ id: img.id, w: 0.5 })
  store.undo()
  expect(store.blocks.value[0]).toMatchObject({ w: 0.8 })
})

test('a selected image is removed by Delete in its bar and by Backspace', async () => {
  store.addImageBlock({ src: 'data:x', aspect: 0.5 })
  await mount()
  await tap($('figure.mg-note-image'))
  const del = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Delete')!
  await act(() => del.click())
  expect(store.blocks.value).toHaveLength(0)
  expect(host.querySelector('figure.mg-note-image')).toBeNull()
  await act(() => store.undo())
  await tap($('figure.mg-note-image'))
  await act(() => key(document.body, 'Backspace'))
  expect(store.blocks.value).toHaveLength(0)
})

test('a pointerdown outside the sheet drops the image selection, so Backspace there keeps the image', async () => {
  store.addImageBlock({ src: 'data:x', aspect: 0.5 })
  await mount()
  await tap($('figure.mg-note-image'))
  const outside = document.createElement('div')
  document.body.appendChild(outside)
  restores.push(() => outside.remove())
  await act(() => pointer(outside, 'pointerdown', 1, 1))
  await act(() => key(document.body, 'Backspace'))
  expect(store.blocks.value).toHaveLength(1)
})

test('Backspace in a text block does not remove a selected image', async () => {
  store.addImageBlock({ src: 'data:x', aspect: 0.5 })
  store.addTextBlock('ab')
  await mount()
  await tap($('figure.mg-note-image'))
  await act(() => {
    caretAt(textEls()[0], 1)
    key(textEls()[0], 'Backspace')
  })
  expect(texts()).toEqual(['img', 'ab'])
})

test('Backspace at the start of a block after an image selects the image', async () => {
  store.addImageBlock({ src: 'data:x', aspect: 0.5 })
  store.addTextBlock('ab')
  await mount()
  await act(() => {
    caretAt(textEls()[0], 0)
    key(textEls()[0], 'Backspace')
  })
  expect(texts()).toEqual(['img', 'ab'])
  expect($('figure.mg-note-image').dataset.selected).toBeDefined()
  expect(document.activeElement).not.toBe(textEls()[0])
})

test('the p.N chip jumps to the page', async () => {
  store.addImageBlock({ src: 'data:x', aspect: 0.5, page: 4 })
  await mount()
  const chip = $('button.mg-note-chip')
  expect(chip.textContent).toBe('p.4')
  await act(() => chip.click())
  expect(jump).toHaveBeenCalledWith(4)
})

test('the background menu stores the choice in the notes doc', async () => {
  await mount()
  expect($('.mg-notes').dataset.bg).toBe('blank')
  const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Background')!
  await act(() => button.click())
  const grid = Array.from(host.querySelectorAll('[role="menuitemradio"]')).find((b) => b.textContent === 'Grid') as HTMLElement
  await act(() => grid.click())
  expect(store.doc.value.background).toBe('grid')
  expect(host.querySelector('.mg-notes[data-bg="grid"]')).not.toBeNull()
  expect(host.querySelector('[role="menu"]')).toBeNull()
  expect($('.mg-notes-sheet').style.getPropertyValue('--sheet-w')).toBe('400px')
})

test('a pen stroke over the sheet is stored in sheet units', async () => {
  tool.value = 'pen'
  await mount()
  const sheet = $('.mg-notes-sheet')
  await act(() => {
    pointer(sheet, 'pointerdown', 40, 80, 'pen')
    pointer(sheet, 'pointermove', 200, 400, 'pen')
    pointer(sheet, 'pointerup', 200, 400, 'pen')
  })
  const s = store.strokes.value[0]
  expect(s).toBeDefined()
  expect(Object.keys(s)).not.toContain('page')
  expect(Object.keys(s)).not.toContain('tool')
  const expected = [0.1, 0.2, 0.5, 0.5, 1, 0.5]
  expect(s.points).toHaveLength(expected.length)
  s.points.forEach((v, i) => expect(v).toBeCloseTo(expected[i]))
  expect(host.querySelectorAll('.ink-layer path')).toHaveLength(1)
  expect(store.blocks.value).toHaveLength(0)
})

test('a finger never draws on the sheet', async () => {
  await mount()
  const sheet = $('.mg-notes-sheet')
  await act(() => {
    pointer(sheet, 'pointerdown', 40, 80, 'touch')
    pointer(sheet, 'pointermove', 200, 400, 'touch')
    pointer(sheet, 'pointerup', 200, 400, 'touch')
  })
  expect(store.strokes.value).toHaveLength(0)
})

test('the sheet grows to the lowest stroke plus one pane height', async () => {
  store.addStroke({ id: 's', kind: 'ink', color: '#000', width: 0.004, points: [0.1, 3, 0.5], createdAt: 1, updatedAt: 1 })
  await mount()
  expect($('.mg-notes-sheet').style.height).toBe(`${3 * 400 + 900}px`)
})

test('ink keeps its pixel positions when the sheet grows', async () => {
  store.addStroke({ id: 's1', kind: 'ink', color: '#000', width: 0.004, points: [0.1, 0.2, 0.5, 0.5, 1, 0.5], createdAt: 1, updatedAt: 1 })
  await mount()
  const sheet = $('.mg-notes-sheet')
  const pathOf = (id: number) => host.querySelectorAll('.ink-layer path')[id].getAttribute('d')
  const before = pathOf(0)
  expect(sheet.style.height).toBe('1300px')
  await act(() => store.addStroke({ id: 's2', kind: 'ink', color: '#000', width: 0.004, points: [0.1, 4, 0.5], createdAt: 2, updatedAt: 2 }))
  expect(sheet.style.height).toBe(`${4 * 400 + 900}px`)
  expect(host.querySelectorAll('.ink-layer path')).toHaveLength(2)
  expect(pathOf(0)).toBe(before)
})

test('Black ink on the sheet shows in the pale ink at night and stays Black in the doc', async () => {
  store.addStroke({ id: 's', kind: 'ink', color: '#1c1c1a', width: 0.004, points: [0.1, 0.2, 0.5, 0.5, 1, 0.5], createdAt: 1, updatedAt: 1 })
  await mount()
  const fill = () => host.querySelector('.ink-layer path')!.getAttribute('fill')
  expect(fill()).toBe('#1c1c1a')
  await act(() => {
    nightInk.value = true
  })
  expect(fill()).toBe('#e8e6e1')
  expect(store.strokes.value[0].color).toBe('#1c1c1a')
})

test('a drag-selection that ends outside a text block keeps the selection', async () => {
  store.addTextBlock('first block')
  store.addTextBlock('second block')
  await mount()
  const [first, second] = textEls()
  first.focus()
  const sel = document.getSelection()!
  sel.setBaseAndExtent(first.firstChild!, 2, second.firstChild!, 3)
  await act(() => {
    pointer(first, 'pointerdown', 10, 10)
    pointer($('.mg-notes-blocks'), 'pointerup', 10, 200)
    $('.mg-notes-blocks').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  expect(sel.isCollapsed).toBe(false)
  expect(sel.anchorOffset).toBe(2)
  expect(sel.focusOffset).toBe(3)
  expect(texts()).toEqual(['first block', 'second block'])
  expect(document.activeElement).toBe(first)
})

test('undo while a text block is focused shows at once and keeps focus', async () => {
  store.addTextBlock('Hello')
  await mount()
  const el = textEls()[0]
  await act(() => {
    caretAt(el, 5)
    el.textContent = 'Hello!'
    document.getSelection()!.collapse(el.firstChild, 6)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(texts()).toEqual(['Hello!'])
  expect(el.textContent).toBe('Hello!')
  await act(() => store.undo())
  expect(el.textContent).toBe('Hello')
  expect(document.activeElement).toBe(el)
  expect(document.getSelection()!.focusOffset).toBe(5)
  await act(() => store.redo())
  expect(el.textContent).toBe('Hello!')
  expect(document.activeElement).toBe(el)
})

test('typing after an undo while focused records a fresh step', async () => {
  store.addTextBlock('')
  await mount()
  const el = textEls()[0]
  const type = (text: string) =>
    act(() => {
      el.textContent = text
      document.getSelection()!.collapse(el.firstChild ?? el, text.length)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  await act(() => caretAt(el, 0))
  await type('H')
  await type('Hey')
  await act(() => store.undo())
  expect(el.textContent).toBe('')
  expect(store.canRedo.value).toBe(true)
  await type('x')
  expect(texts()).toEqual(['x'])
  expect(store.canRedo.value).toBe(false)
  await act(() => store.undo())
  expect(el.textContent).toBe('')
  expect(document.activeElement).toBe(el)
})

test('typing keeps the caret above the keyboard', async () => {
  store.addTextBlock('Hello')
  setViewport({ height: 400, offsetTop: 0 })
  await mount()
  const scroller = $('.mg-notes')
  scroller.scrollTop = 100
  await act(() => caretAt(textEls()[0], 5))
  expect(scroller.scrollTop).toBe(100)
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 580, 1, 20))
  await act(() => {
    textEls()[0].textContent = 'Hello!'
    document.getSelection()!.collapse(textEls()[0].firstChild, 6)
    textEls()[0].dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(scroller.scrollTop).toBe(316)
})

test('a keyboard resize pads the scroller by the keyboard height', async () => {
  setViewport({ height: 900, offsetTop: 0 })
  await mount()
  const vv = window.visualViewport as unknown as EventTarget & { height: number }
  vv.height = window.innerHeight - 300
  await act(() => {
    vv.dispatchEvent(new Event('resize'))
  })
  expect($('.mg-notes').style.getPropertyValue('--kb')).toBe('300px')
})

test('scrollToBlock scrolls the sheet to a block', async () => {
  const b = store.addTextBlock('far')
  await mount()
  const el = host.querySelector<HTMLElement>(`[data-id="${b.id}"]`)!
  el.getBoundingClientRect = () => new DOMRect(0, 700, 300, 30)
  handle!.scrollToBlock(b.id)
  expect($('.mg-notes').scrollTop).toBe(684)
})

test('undo and redo act on the sheet store', async () => {
  store.addTextBlock('Hello')
  await mount()
  await act(() => {
    caretAt(textEls()[0], 3)
    key(textEls()[0], 'Enter')
  })
  await act(() => (document.activeElement as HTMLElement).blur())
  await act(() => store.undo())
  expect(textEls().map((e) => e.textContent)).toEqual(['Hello'])
  await act(() => store.redo())
  expect(textEls().map((e) => e.textContent)).toEqual(['Hel', 'lo'])
  expect((store.blocks.value[0] as TextBlock).text).toBe('Hel')
})
