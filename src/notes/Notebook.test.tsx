import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { toast } from '../app/ui.ts'
import { eraserSettings, fingerDraws, penActivity, previousTool, setTool, tool, DEFAULT_ERASER_SETTINGS } from '../ink/tools.ts'
import { orderBetween } from '../lib/order.ts'
import { ImageTooLargeError, prepareImage } from './images.ts'
import { emptyNotebook, PAGE_SIZES, type NotesDocV2, type PageSize } from './model.ts'
import { Notebook, type NotebookHandle } from './Notebook.tsx'
import { createNotebookStore, type NotebookStore } from './notebookStore.ts'

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

vi.mock('./images.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./images.ts')>()),
  prepareImage: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,AAAA', width: 800, height: 400, bytes: 3, mediaType: 'image/jpeg' })),
}))

let host: HTMLElement
let store: NotebookStore
let jump: ReturnType<typeof vi.fn<(page: number) => void>>
let handle: NotebookHandle | undefined
let clock: number

// A notebook whose pages are 'page-1' … 'page-n' with the given sizes.
function notebook(sizes: PageSize[] = [PAGE_SIZES.a4]): NotesDocV2 {
  const doc = emptyNotebook('pdf', 'a.pdf', 1)
  const first = doc.pages[0]
  first.size = { ...sizes[0] }
  for (let i = 1, order = first.order; i < sizes.length; i++) {
    order = orderBetween(order, null)
    doc.pages.push({ ...first, id: `page-${i + 1}`, order, size: { ...sizes[i] } })
  }
  return doc
}

beforeEach(() => {
  tool.value = 'pen'
  previousTool.value = 'pen'
  eraserSettings.value = DEFAULT_ERASER_SETTINGS
  fingerDraws.value = false
  penActivity.down = false
  penActivity.downOn = null
  penActivity.lastUp = -Infinity
  clock = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  host = document.createElement('div')
  document.body.appendChild(host)
  jump = vi.fn<(page: number) => void>()
  handle = undefined
  const original = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.matches('.mg-nb-scroller')) return new DOMRect(0, 0, 872, 800)
    const page = this.closest<HTMLElement>('.mg-nb-page')
    if (!page) return original.call(this)
    const scroller = page.closest<HTMLElement>('.mg-nb-scroller')!
    const px = (v: string) => parseFloat(v)
    return new DOMRect(
      px(page.style.left) - scroller.scrollLeft,
      px(page.style.top) - scroller.scrollTop,
      px(page.style.width),
      px(page.style.height),
    )
  })
})

afterEach(() => {
  vi.useRealTimers()
  render(null, host)
  host.remove()
  vi.restoreAllMocks()
})

async function mount(doc: NotesDocV2 = notebook()) {
  store = createNotebookStore(doc, vi.fn())
  await act(() => {
    render(<Notebook store={store} onJumpToPage={jump} handle={(h) => (handle = h)} />, host)
  })
}

const flush = () => act(async () => {})
const $ = (sel: string) => host.querySelector<HTMLElement>(sel)!
const scroller = () => $('.mg-nb-scroller')
const page = (id: string) => $(`.mg-nb-page[data-page="${id}"]`)
const chips = (id: string) => $(`.mg-nb-chips[data-page="${id}"]`)
const box = (el: HTMLElement) => ['left', 'top', 'width', 'height'].map((k) => parseFloat(el.style.getPropertyValue(k)))
const ids = () => store.pages.value.map((p) => p.id)
const button = (name: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === name)!

async function scrollTo(top: number, left = 0) {
  await act(() => {
    scroller().scrollTop = top
    scroller().scrollLeft = left
    scroller().dispatchEvent(new Event('scroll'))
  })
}

async function click(el: HTMLElement) {
  await act(() => el.click())
}

function pen(el: Element, name: string, x: number, y: number) {
  el.dispatchEvent(
    new PointerEvent(name, {
      bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 2,
      clientX: x, clientY: y, pressure: 0.5, button: 0, buttons: name === 'pointerup' ? 0 : 1,
    }),
  )
}

type Finger = { id: number; x: number; y: number }

// happy-dom's Touch has no touchType, so tests pass plain touch-like objects.
function touch(el: Element, name: string, changed: Finger[], remaining: Finger[]) {
  const asTouch = (t: Finger) => ({ identifier: t.id, clientX: t.x, clientY: t.y, touchType: 'direct' }) as unknown as Touch
  const e = new TouchEvent(name, {
    bubbles: true, cancelable: true, changedTouches: changed.map(asTouch), touches: remaining.map(asTouch),
  })
  el.dispatchEvent(e)
  return e
}

// Two fingers on the x axis spreading from `from` to `to` px apart around (cx, cy), then lifting.
async function pinch(el: Element, cx: number, cy: number, from: number, to: number) {
  const at = (d: number): Finger[] => [{ id: 1, x: cx - d / 2, y: cy }, { id: 2, x: cx + d / 2, y: cy }]
  await act(() => {
    touch(el, 'touchstart', at(from), at(from))
    touch(el, 'touchmove', at(to), at(to))
  })
  const live = $('.mg-nb-pages').style.transform
  await act(() => {
    touch(el, 'touchend', at(to), [])
  })
  return live
}

async function tapAt(el: Element, x: number, y: number) {
  const f = [{ id: 7, x, y }]
  await act(() => {
    touch(el, 'touchstart', f, f)
    touch(el, 'touchend', f, [])
  })
}

test('pages stack on the grey canvas 16 px apart and narrower pages are centred', async () => {
  await mount(notebook([PAGE_SIZES.a4, PAGE_SIZES.standard, PAGE_SIZES.a4]))
  expect(Array.from(host.querySelectorAll<HTMLElement>('.mg-nb-page')).map((p) => p.dataset.page)).toEqual(['page-1', 'page-2', 'page-3'])
  expect(box(page('page-1'))).toEqual([16, 16, 840, 1188])
  expect(box(page('page-2'))).toEqual([115, 1220, 642, 830])
  expect(box(page('page-3'))).toEqual([16, 2066, 840, 1188])
  expect(box($('.mg-nb-pages')).slice(2)).toEqual([872, 3270])
})

test('each page shows its paper colour and template', async () => {
  await mount(notebook([PAGE_SIZES.a4, PAGE_SIZES.a4]))
  await act(() => {
    store.setPageStyle('page-1', { template: 'grid', color: 'yellow' }, false)
    store.setPageStyle('page-2', { template: 'ruled-wide', color: 'dark' }, false)
  })
  expect(page('page-1').dataset.color).toBe('yellow')
  expect(page('page-2').dataset.color).toBe('dark')
  expect(page('page-1').querySelector('pattern')!.getAttribute('width')).toBe('20')
  expect(Number(page('page-2').querySelector('pattern')!.getAttribute('height'))).toBeCloseTo(34.8)
  expect(page('page-2').querySelector('pattern > *')!.getAttribute('stroke')).toBe('rgba(255, 255, 255, 0.15)')
})

test('Add Page offers Before, After and Last', async () => {
  await mount(notebook([PAGE_SIZES.a4, PAGE_SIZES.a4]))
  await act(() => store.setPageStyle('page-2', { template: 'dots' }, false))
  await click(button('Add Page'))
  expect(Array.from(host.querySelectorAll('[role="menu"] button')).map((b) => b.textContent)).toEqual(['Before', 'After', 'Last'])

  await scrollTo(1220)
  await click(button('Before'))
  expect(host.querySelector('[role="menu"]')).toBeNull()
  const [, a] = ids()
  expect(ids()).toEqual(['page-1', a, 'page-2'])

  await click(button('Add Page'))
  await click(button('After'))
  const [, , b] = ids()
  expect(ids()).toEqual(['page-1', a, b, 'page-2'])

  await click(button('Add Page'))
  await click(button('Last'))
  const last = ids()[4]
  expect(ids()).toEqual(['page-1', a, b, 'page-2', last])
  expect(store.pages.value[4].template).toBe('dots')

  await scrollTo(0)
  await click(button('Add Page'))
  await click(button('Before'))
  expect(ids().slice(1)).toEqual(['page-1', a, b, 'page-2', last])
})

test('the Template sheet changes the current page, or every page with Apply to all', async () => {
  await mount(notebook([PAGE_SIZES.a4, PAGE_SIZES.a4]))
  await click(button('Template'))
  const dialog = () => host.querySelector<HTMLElement>('[role="dialog"][aria-label="Template"]')
  const option = (name: string) =>
    Array.from(dialog()!.querySelectorAll('label')).find((l) => l.textContent?.trim() === name)!.querySelector('input')!
  expect(Array.from(dialog()!.querySelectorAll('label')).map((l) => l.textContent?.trim())).toEqual([
    'Blank', 'Ruled narrow', 'Ruled college', 'Ruled wide', 'Grid', 'Dots',
    'White', 'Yellow', 'Dark', 'A4', 'Letter', 'Standard', 'Portrait', 'Landscape', 'Apply to all pages',
  ])
  expect(option('Blank').checked).toBe(true)
  expect(option('A4').checked).toBe(true)
  expect(option('Portrait').checked).toBe(true)
  await click(option('Grid'))
  await click(option('Yellow'))
  await click(option('Letter'))
  await click(option('Landscape'))
  await click(button('Done'))
  expect(dialog()).toBeNull()
  expect(store.pages.value.map((p) => [p.template, p.color, p.size])).toEqual([
    ['grid', 'yellow', { w: 279.4, h: 215.9 }],
    ['blank', 'white', { w: 210, h: 297 }],
  ])

  await click(button('Template'))
  expect(option('Grid').checked).toBe(true)
  expect(option('Letter').checked).toBe(true)
  expect(option('Landscape').checked).toBe(true)
  await click(option('Dots'))
  await click(option('Portrait'))
  await click(option('Apply to all pages'))
  await click(button('Done'))
  expect(store.pages.value.map((p) => [p.template, p.color, p.size])).toEqual([
    ['dots', 'yellow', { w: 215.9, h: 279.4 }],
    ['dots', 'yellow', { w: 215.9, h: 279.4 }],
  ])
})

test('a pen stroke on page 2 is stored on page 2 in page-width units', async () => {
  await mount(notebook([PAGE_SIZES.a4, PAGE_SIZES.a4]))
  const p2 = page('page-2')
  await act(() => {
    pen(p2, 'pointerdown', 16 + 40, 1220 + 84)
    pen(p2, 'pointermove', 16 + 440, 1220 + 504)
    pen(p2, 'pointerup', 16 + 440, 1220 + 504)
  })
  const [s] = store.doc.value.strokes
  expect(s).toMatchObject({ page: 'page-2', tool: 'pen', pen: 'fountain' })
  expect(s).not.toHaveProperty('kind')
  expect(s.points).toHaveLength(6)
  ;[40 / 840, 84 / 840, 0.5, 440 / 840, 504 / 840, 0.5].forEach((v, i) => expect(s.points[i]).toBeCloseTo(v))
  expect(page('page-2').querySelectorAll('svg.ink-pen path')).toHaveLength(1)

  setTool('eraser')
  await act(() => {
    pen(page('page-2'), 'pointerdown', 16 + 240, 1220 + 294)
    pen(page('page-2'), 'pointerup', 16 + 240, 1220 + 294)
  })
  expect(store.content.value.get('page-2')!.strokes).toHaveLength(0)
})

test('a stroke dragged past the page edge stays on its page, clamped', async () => {
  await mount(notebook([PAGE_SIZES.a4, PAGE_SIZES.a4]))
  const p1 = page('page-1')
  await act(() => {
    pen(p1, 'pointerdown', 16 + 40, 16 + 100)
    pen(p1, 'pointermove', 900, 16 + 1300)
    pen(p1, 'pointerup', 900, 16 + 1300)
  })
  expect(store.doc.value.strokes).toHaveLength(1)
  const [s] = store.doc.value.strokes
  expect(s.page).toBe('page-1')
  expect(s.points[3]).toBe(1)
  expect(s.points[4]).toBeCloseTo(297 / 210)
})

test('pulling past the last page adds a page with its template', async () => {
  await mount()
  await act(() => store.setPageStyle('page-1', { template: 'grid' }, false))
  const s = scroller()
  const send = (name: string, y: number, down = true) =>
    act(() => {
      touch(s, name, [{ id: 3, x: 400, y }], down ? [{ id: 3, x: 400, y }] : [])
    })
  const move = (y: number) => send('touchmove', y)
  const drag = async ([first, ...rest]: number[]) => {
    await send('touchstart', first)
    for (const y of rest) await move(y)
  }
  const lift = () => send('touchend', 0, false)
  const hint = () => host.textContent?.includes('Release to add a page')

  await drag([700, 600, 400])
  expect(hint()).toBe(false)
  await lift()
  expect(ids()).toHaveLength(1)

  await scrollTo(420)
  await drag([600, 560])
  expect(hint()).toBe(false)
  await move(510)
  expect(hint()).toBe(true)
  await lift()
  expect(hint()).toBe(false)
  expect(store.pages.value).toHaveLength(2)
  expect(store.pages.value[1].template).toBe('grid')
})

test('pinch zooms around the pinch centre between fit-width and 400 %', async () => {
  await mount()
  const s = scroller()
  expect(await pinch(s, 250, 300, 100, 300)).toBe('scale(3)')
  expect($('.mg-nb-pages').style.transform).toBe('')
  expect(box(page('page-1')).slice(2)).toEqual([2520, 3564])
  expect([s.scrollLeft, s.scrollTop]).toEqual([468, 568])

  await pinch(s, 250, 300, 100, 1000)
  expect(box(page('page-1'))[2]).toBe(3360)
  expect(s.scrollLeft).toBeCloseTo(702)
  expect(s.scrollTop).toBeCloseTo(852)

  await pinch(s, 250, 300, 300, 30)
  expect(box(page('page-1'))[2]).toBe(840)
  expect(s.scrollLeft).toBeCloseTo(0)
  expect(s.scrollTop).toBeCloseTo(0)
})

test('a pinch on a later page keeps the point under the fingers still', async () => {
  await mount(notebook([PAGE_SIZES.a4, PAGE_SIZES.a4, PAGE_SIZES.a4, PAGE_SIZES.a4]))
  await scrollTo(2424 + 500)
  const anchor = { x: 250, y: 300 }
  const before = page('page-3').getBoundingClientRect()
  const local = { x: anchor.x - before.left, y: anchor.y - before.top }
  await pinch(scroller(), anchor.x, anchor.y, 100, 250)
  const after = page('page-3').getBoundingClientRect()
  expect(after.width).toBe(2100)
  expect(Math.abs(after.left + local.x * 2.5 - anchor.x)).toBeLessThan(1)
  expect(Math.abs(after.top + local.y * 2.5 - anchor.y)).toBeLessThan(1)
})

test('a two-finger pinch while the pen is down neither zooms nor ends the stroke', async () => {
  await mount()
  const p1 = page('page-1')
  const at = (d: number): Finger[] => [{ id: 1, x: 250 - d / 2, y: 300 }, { id: 2, x: 250 + d / 2, y: 300 }]
  await act(() => {
    pen(p1, 'pointerdown', 56, 116)
    touch(p1, 'touchstart', at(100), at(100))
    pen(p1, 'pointermove', 256, 136)
    touch(p1, 'touchmove', at(300), at(300))
    touch(p1, 'touchend', at(300), [])
    pen(p1, 'pointermove', 156, 416)
    pen(p1, 'pointerup', 156, 416)
  })
  expect(box(page('page-1'))[2]).toBe(840)
  expect($('.mg-nb-pages').style.transform).toBe('')
  expect([scroller().scrollLeft, scroller().scrollTop]).toEqual([0, 0])
  expect(store.doc.value.strokes).toHaveLength(1)
  expect(store.doc.value.strokes[0].points).toHaveLength(9)
})

test('a finger double-tap toggles fit-width and 200 % at the tap', async () => {
  await mount()
  const s = scroller()
  await tapAt(s, 300, 400)
  clock += 400
  await tapAt(s, 300, 400)
  expect(box(page('page-1'))[2]).toBe(840)
  clock += 100
  await tapAt(s, 340, 400)
  expect(box(page('page-1'))[2]).toBe(840)

  clock += 400
  await tapAt(s, 300, 400)
  clock += 200
  await tapAt(s, 310, 410)
  expect(box(page('page-1'))[2]).toBe(1680)
  expect([s.scrollLeft, s.scrollTop]).toEqual([294, 394])

  clock += 400
  await tapAt(s, 310, 410)
  clock += 200
  await tapAt(s, 310, 410)
  expect(box(page('page-1'))[2]).toBe(840)
  expect([s.scrollLeft, s.scrollTop]).toEqual([0, 0])
})

const wait = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms)
})

// A wheel event at (300, 400) on the scroller; happy-dom's WheelEvent is a UIEvent, so the mouse fields are defined on the event.
function wheelAt(el: Element, { deltaY = -100, ...mouse }: { deltaY?: number; ctrlKey?: boolean; metaKey?: boolean }) {
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY })
  for (const [k, v] of Object.entries({ clientX: 300, clientY: 400, ctrlKey: false, metaKey: false, ...mouse })) {
    Object.defineProperty(e, k, { value: v })
  }
  el.dispatchEvent(e)
  return e
}

test('Ctrl-wheel zooms at the cursor once the wheel stops; a plain wheel does not zoom', async () => {
  await mount()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const s = scroller()
  let plain!: WheelEvent
  await act(() => {
    plain = wheelAt(s, {})
  })
  expect(plain.defaultPrevented).toBe(false)
  expect(box(page('page-1'))[2]).toBe(840)

  let zoom!: WheelEvent
  await act(() => {
    zoom = wheelAt(s, { ctrlKey: true })
  })
  expect(zoom.defaultPrevented).toBe(true)
  await wait(120)
  expect(box(page('page-1'))[2]).toBeCloseTo(840 * Math.E)
  expect(s.scrollLeft).toBeCloseTo(16 + 284 * Math.E - 300)
  expect(s.scrollTop).toBeCloseTo(16 + 384 * Math.E - 400)

  await act(() => {
    wheelAt(s, { metaKey: true, deltaY: 1000 })
  })
  await wait(120)
  expect(box(page('page-1'))[2]).toBe(840)
})

test('ten quick Ctrl-wheel events scale the pages live and commit one zoom with the cursor point still', async () => {
  await mount()
  const p1 = page('page-1')
  await act(() => {
    pen(p1, 'pointerdown', 116, 116)
    pen(p1, 'pointermove', 216, 216)
    pen(p1, 'pointerup', 216, 216)
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const s = scroller()
  const before = outlines.count
  for (let i = 0; i < 10; i++) {
    await act(() => {
      wheelAt(s, { ctrlKey: true, deltaY: -10 })
    })
    await wait(16)
  }
  expect(box(page('page-1'))[2]).toBe(840)
  expect(parseFloat($('.mg-nb-pages').style.transform.slice('scale('.length))).toBeCloseTo(Math.E)
  expect(outlines.count - before).toBe(0)

  await wait(120)
  expect($('.mg-nb-pages').style.transform).toBe('')
  expect(box(page('page-1'))[2]).toBeCloseTo(840 * Math.E)
  expect(s.scrollLeft).toBeCloseTo(16 + 284 * Math.E - 300)
  expect(s.scrollTop).toBeCloseTo(16 + 384 * Math.E - 400)
  expect(outlines.count - before).toBe(1)
})

test('converted text and images show on their pages; the p.N chip jumps to the paper page', async () => {
  await mount(notebook([PAGE_SIZES.a4, PAGE_SIZES.a4]))
  await act(() => {
    store.addText({ page: 'page-1', box: { x: 0.1, y: 0.2, w: 0.6 }, text: 'Attention', size: 'm', color: '#1c1c1a' })
    store.addImage({ page: 'page-2', src: 'data:snip', aspect: 0.5, pdfPage: 3, box: { x: 0.1, y: 0.1, w: 0.5 } })
    store.addImage({ page: 'page-2', src: 'data:photo', aspect: 1, box: { x: 0.2, y: 0.8, w: 0.25 } })
  })
  const text = page('page-1').querySelector<HTMLElement>('.mg-nb-text')!
  expect(text.textContent).toBe('Attention')
  expect(text.isContentEditable).toBe(false)
  expect(box(text).slice(0, 3)).toEqual([84, 168, 504])
  expect(parseFloat(text.style.fontSize)).toBeCloseTo((13 * 840) / (210 / 0.3528))
  expect(text.style.color).toBe('#1c1c1a')

  const imgs = page('page-2').querySelectorAll<HTMLImageElement>('img.mg-nb-image')
  expect(Array.from(imgs).map((i) => i.getAttribute('src'))).toEqual(['data:snip', 'data:photo'])
  expect(box(imgs[0].parentElement!)).toEqual([84, 84, 420, 210])
  expect(chips('page-2').querySelectorAll('button.mg-nb-chip')).toHaveLength(1)
  const chip = chips('page-2').querySelector<HTMLElement>('button.mg-nb-chip')!
  expect(chip.textContent).toBe('p.3')
  await click(chip)
  expect(jump).toHaveBeenCalledWith(3)

  handle!.scrollToItem(store.doc.value.images[0].id)
  expect(scroller().scrollTop).toBe(1220 + 84 - 16)
})

test('Image adds the picked image centred on the current page at half its width', async () => {
  await mount(notebook([PAGE_SIZES.a4, PAGE_SIZES.a4]))
  await scrollTo(1220)
  expect(handle!.currentPage()).toBe('page-2')
  const input = $('input[type="file"]') as HTMLInputElement
  expect(input.accept).toBe('image/*')
  const clicked = vi.spyOn(input, 'click').mockImplementation(() => {})
  await click(button('Image'))
  expect(clicked).toHaveBeenCalled()
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.png', { type: 'image/png' })] })
  await act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
  const [img] = store.doc.value.images
  expect(img).toMatchObject({ page: 'page-2', src: 'data:image/jpeg;base64,AAAA', aspect: 0.5 })
  expect(img.box.x).toBeCloseTo(0.25)
  expect(img.box.w).toBeCloseTo(0.5)
  expect(img.box.y).toBeCloseTo((297 / 210 - 0.25) / 2)
  expect(page('page-2').querySelectorAll('img.mg-nb-image')).toHaveLength(1)
})

function fileEvent(name: string, prop: 'clipboardData' | 'dataTransfer', files: File[]) {
  const e = new Event(name, { bubbles: true, cancelable: true })
  Object.defineProperty(e, prop, { value: { files, types: ['Files'] } })
  return e
}

test('pasted and dropped images land on the current page; one too large says so', async () => {
  await mount(notebook([PAGE_SIZES.a4, PAGE_SIZES.a4]))
  const png = () => new File(['x'], 'a.png', { type: 'image/png' })
  const paste = fileEvent('paste', 'clipboardData', [png()])
  await act(() => {
    scroller().dispatchEvent(paste)
  })
  await flush()
  expect(paste.defaultPrevented).toBe(true)
  await scrollTo(1220)
  const over = fileEvent('dragover', 'dataTransfer', [])
  scroller().dispatchEvent(over)
  expect(over.defaultPrevented).toBe(true)
  await act(() => {
    scroller().dispatchEvent(fileEvent('drop', 'dataTransfer', [png()]))
  })
  await flush()
  expect(store.doc.value.images.map((m) => m.page)).toEqual(['page-1', 'page-2'])

  vi.mocked(prepareImage).mockRejectedValueOnce(new ImageTooLargeError('Image too large'))
  await act(() => {
    scroller().dispatchEvent(fileEvent('drop', 'dataTransfer', [png()]))
  })
  await flush()
  expect(toast.value).toBe('Image too large to add')
  expect(store.doc.value.images).toHaveLength(2)
})

test('the scroller is the ink viewport', async () => {
  await mount()
  expect(scroller().hasAttribute('data-ink-viewport')).toBe(true)
  expect(scroller().querySelector('.mg-nb-pages .mg-nb-page')).not.toBeNull()
})

test('a notebook with no pages renders empty and Add Page adds one', async () => {
  await mount({ ...notebook(), pages: [] })
  expect(host.querySelectorAll('.mg-nb-page')).toHaveLength(0)
  expect(handle!.currentPage()).toBeNull()
  await click(button('Add Page'))
  await click(button('After'))
  expect(host.querySelectorAll('.mg-nb-page')).toHaveLength(1)
  expect(handle!.currentPage()).toBe(ids()[0])
})

test('a pen tap on a p.N chip jumps without drawing', async () => {
  await mount()
  await act(() => {
    store.addImage({ page: 'page-1', src: 'data:snip', aspect: 0.5, pdfPage: 3, box: { x: 0.1, y: 0.1, w: 0.5 } })
  })
  const chip = chips('page-1').querySelector<HTMLElement>('button.mg-nb-chip')!
  await act(() => {
    pen(chip, 'pointerdown', 100, 300)
    pen(chip, 'pointerup', 100, 300)
    chip.click()
  })
  expect(jump).toHaveBeenCalledWith(3)
  expect(store.doc.value.strokes).toHaveLength(0)
})

test('a stroke drawn after an image renders above it, an earlier one below', async () => {
  const doc = notebook()
  const stroke = (id: string, color: string, z: string) => ({
    id, page: 'page-1', tool: 'pen' as const, pen: 'fountain' as const, color, width: 0.004,
    points: [0.1, 0.1, 0.5, 0.4, 0.2, 0.5], z, createdAt: 1, updatedAt: 1,
  })
  doc.strokes = [stroke('s2', '#2f6fed', 'c'), stroke('s1', '#d33a2c', 'a')]
  doc.images = [{ id: 'i1', page: 'page-1', box: { x: 0.1, y: 0.1, w: 0.5 }, src: 'data:snip', aspect: 0.5, z: 'b', createdAt: 1, updatedAt: 1 }]
  await mount(doc)
  const order = Array.from(page('page-1').querySelectorAll('svg.ink-pen, img.mg-nb-image, .ink-layer')).map((el) =>
    el.matches('svg') ? el.querySelector('path')!.getAttribute('fill') : el.className,
  )
  expect(order).toEqual(['#d33a2c', 'mg-nb-image', '#2f6fed', 'ink-layer'])
  expect(page('page-1').querySelector('.ink-layer svg')).toBeNull()
})

test('the tool row picks Lasso, Pen, Highlighter and Eraser', async () => {
  await mount()
  const row = Array.from(host.querySelectorAll<HTMLButtonElement>('.mg-nb-bar button[aria-pressed]'))
  expect(row.map((b) => b.getAttribute('aria-label'))).toEqual(['Lasso', 'Pen', 'Highlighter', 'Eraser'])
  const bar = Array.from(host.querySelectorAll('.mg-nb-bar button')).map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())
  expect(bar.slice(0, 5)).toEqual(['Lasso', 'Pen', 'Highlighter', 'Eraser', 'Add Page'])
  for (const [label, t] of [['Lasso', 'lasso'], ['Highlighter', 'highlighter'], ['Eraser', 'eraser'], ['Pen', 'pen']] as const) {
    await click(row.find((b) => b.getAttribute('aria-label') === label)!)
    expect(tool.value).toBe(t)
    expect(row.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'))).toEqual([label])
  }
})

test('ink on a notebook page uses the page width in mm and dark paper puts the highlighter below the ink', async () => {
  await mount(notebook([PAGE_SIZES.standard]))
  await act(() => store.setPageStyle('page-1', { color: 'dark' }, false))
  const p1 = page('page-1')
  await act(() => {
    pen(p1, 'pointerdown', 116, 116)
    pen(p1, 'pointermove', 216, 216)
    pen(p1, 'pointerup', 216, 216)
  })
  expect(store.doc.value.strokes[0].width).toBeCloseTo(0.35 / 160.5)
  setTool('highlighter')
  await act(() => {
    pen(p1, 'pointerdown', 116, 316)
    pen(p1, 'pointermove', 216, 316)
    pen(p1, 'pointerup', 216, 316)
  })
  expect(Array.from(page('page-1').querySelectorAll('svg.ink-pen, svg.ink-hl')).map((el) => el.getAttribute('class'))).toEqual(['ink-hl', 'ink-pen'])
})

test('the segment eraser shows the split pieces during the drag', async () => {
  eraserSettings.value = { ...DEFAULT_ERASER_SETTINGS, style: 'segment' }
  await mount()
  const p1 = page('page-1')
  await act(() => {
    pen(p1, 'pointerdown', 16 + 100, 16 + 400)
    pen(p1, 'pointermove', 16 + 700, 16 + 400)
    pen(p1, 'pointerup', 16 + 700, 16 + 400)
  })
  expect(p1.querySelectorAll('svg.ink-pen path')).toHaveLength(1)
  setTool('eraser')
  await act(() => {
    pen(p1, 'pointerdown', 16 + 400, 16 + 300)
    pen(p1, 'pointermove', 16 + 400, 16 + 500)
  })
  expect(p1.querySelectorAll('svg.ink-pen path')).toHaveLength(2)
  expect(store.doc.value.strokes.filter((s) => !s.deleted)).toHaveLength(1)
  await act(() => {
    pen(p1, 'pointerup', 16 + 400, 16 + 500)
  })
  expect(store.doc.value.strokes.filter((s) => !s.deleted)).toHaveLength(2)
  expect(p1.querySelectorAll('svg.ink-pen path')).toHaveLength(2)
})

test('a stroke on one page does not re-outline the ink of another', async () => {
  await mount(notebook([PAGE_SIZES.a4, PAGE_SIZES.a4]))
  await act(() => {
    pen(page('page-1'), 'pointerdown', 116, 116)
    pen(page('page-1'), 'pointermove', 216, 216)
    pen(page('page-1'), 'pointerup', 216, 216)
  })
  const before = outlines.count
  await act(() => {
    pen(page('page-2'), 'pointerdown', 116, 1320)
    pen(page('page-2'), 'pointermove', 216, 1420)
    pen(page('page-2'), 'pointerup', 216, 1420)
  })
  expect(outlines.count - before).toBe(1)
})
