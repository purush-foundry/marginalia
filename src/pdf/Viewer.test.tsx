import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InkLayer } from '../ink/InkLayer.tsx'
import { penTool } from '../ink/tools.ts'
import type { Highlight, InkStroke } from '../types.ts'
import type { PdfDoc } from './document.ts'
import { Viewer, type ViewerHandle, type ViewerProps } from './Viewer.tsx'

// A two-page document whose pages never finish loading, so nothing touches a canvas.
const doc: PdfDoc = {
  numPages: 2,
  title: null,
  pageSize: () => ({ w: 600, h: 800 }),
  getPage: () => new Promise(() => {}),
  getOutline: async () => [],
  getPageText: async (page) => ({ page, lines: [], columns: [], text: '' }),
  getLinks: async () => [],
  renderCrop: () => Promise.reject(new Error('no canvas')),
  destroy() {},
}

const highlight: Highlight = {
  id: 'h1',
  kind: 'text',
  page: 1,
  color: 'yellow',
  text: 'x',
  boxes: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.05 }],
  createdAt: 0,
  updatedAt: 0,
}

let root: HTMLElement
const restore: (() => void)[] = []

function stub<T extends object>(proto: T, key: string, get: (this: Element) => unknown) {
  const original = Object.getOwnPropertyDescriptor(proto, key)
  Object.defineProperty(proto, key, { configurable: true, get })
  restore.push(() => (original ? Object.defineProperty(proto, key, original) : delete (proto as Record<string, unknown>)[key]))
}

function mount(extra: Partial<ViewerProps> = {}) {
  const props: ViewerProps = {
    doc,
    highlights: signal<Highlight[]>([]),
    nightMode: false,
    invertImages: true,
    areaSelectArmed: signal(false),
    onSelection: vi.fn(),
    onTapHighlight: vi.fn(),
    onLink: vi.fn(),
    onReadingPosition: vi.fn(),
    handle: vi.fn(),
    ...extra,
  }
  act(() => render(<Viewer {...props} />, root))
  return props
}

function pointer(name: string, target: Element, init: PointerEventInit) {
  target.dispatchEvent(
    new PointerEvent(name, { bubbles: true, cancelable: true, isPrimary: true, button: 0, ...init }),
  )
}

function textSpan(): HTMLSpanElement {
  const span = document.createElement('span')
  span.textContent = 'text'
  root.querySelector('.mg-page[data-page="1"] .textLayer')!.append(span)
  return span
}

beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  stub(HTMLElement.prototype, 'clientWidth', () => 616)
  stub(HTMLElement.prototype, 'clientHeight', () => 900)
  const rect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.classList.contains('mg-page-inner') ? new DOMRect(0, 0, 600, 800) : rect.call(this)
  }
  restore.push(() => (Element.prototype.getBoundingClientRect = rect))
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
  for (const undo of restore.splice(0).reverse()) undo()
  penTool.value = 'pen'
})

describe('Viewer', () => {
  it('mounts pageOverlay inside the page so a pen stroke over the text layer reaches the ink layer', () => {
    const onAddStroke = vi.fn<(s: InkStroke) => void>()
    penTool.value = 'pen'
    mount({
      pageOverlay: (page, cssW, cssH) => (
        <InkLayer page={page} cssW={cssW} cssH={cssH} strokes={[]} onAddStroke={onAddStroke} onEraseStroke={() => {}} />
      ),
    })
    const inner = root.querySelector('.mg-page[data-page="1"] .mg-page-inner')!
    const ink = inner.querySelector('.ink-layer')!
    expect(ink.parentElement).toBe(inner)
    const span = document.createElement('span')
    span.textContent = 'text'
    inner.querySelector('.textLayer')!.append(span)

    pointer('pointerdown', span, { pointerType: 'pen', pointerId: 7, clientX: 100, clientY: 100, buttons: 1 })
    pointer('pointermove', span, { pointerType: 'pen', pointerId: 7, clientX: 150, clientY: 120, buttons: 1 })
    pointer('pointerup', span, { pointerType: 'pen', pointerId: 7, clientX: 200, clientY: 140, buttons: 0 })

    expect(onAddStroke).toHaveBeenCalledOnce()
    expect(onAddStroke.mock.calls[0][0].page).toBe(1)
  })

  it('reports a tap on a highlight with the tapped box in client coordinates', () => {
    const props = mount({ highlights: signal([highlight]) })
    const layer = root.querySelector('.mg-page[data-page="1"] .textLayer')!
    pointer('pointerdown', layer, { pointerType: 'mouse', pointerId: 1, clientX: 120, clientY: 100 })
    pointer('pointerup', layer, { pointerType: 'mouse', pointerId: 1, clientX: 121, clientY: 101 })
    expect(props.onTapHighlight).toHaveBeenCalledOnce()
    const [id, rect] = (props.onTapHighlight as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(id).toBe('h1')
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([60, 80, 300, 40])
  })

  it('does not report a highlight tap after a drag', () => {
    const props = mount({ highlights: signal([highlight]) })
    const layer = root.querySelector('.mg-page[data-page="1"] .textLayer')!
    pointer('pointerdown', layer, { pointerType: 'mouse', pointerId: 1, clientX: 120, clientY: 100 })
    pointer('pointerup', layer, { pointerType: 'mouse', pointerId: 1, clientX: 200, clientY: 100 })
    expect(props.onTapHighlight).not.toHaveBeenCalled()
  })

  it('does not treat a press-and-hold as a highlight tap', () => {
    vi.useFakeTimers()
    try {
      const props = mount({ highlights: signal([highlight]) })
      const layer = root.querySelector('.mg-page[data-page="1"] .textLayer')!
      pointer('pointerdown', layer, { pointerType: 'mouse', pointerId: 1, clientX: 120, clientY: 100 })
      vi.advanceTimersByTime(450)
      pointer('pointerup', layer, { pointerType: 'mouse', pointerId: 1, clientX: 120, clientY: 100 })
      expect(props.onTapHighlight).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not report a highlight tap when the pointer started an area drag', () => {
    const armed = signal(true)
    const props = mount({ highlights: signal([highlight]), areaSelectArmed: armed })
    const layer = root.querySelector('.mg-page[data-page="1"] .textLayer')!
    pointer('pointerdown', layer, { pointerType: 'mouse', pointerId: 1, clientX: 120, clientY: 100 })
    act(() => {
      armed.value = false
    })
    pointer('pointerup', layer, { pointerType: 'mouse', pointerId: 1, clientX: 121, clientY: 100 })
    expect(props.onTapHighlight).not.toHaveBeenCalled()
  })

  it('ignores pen taps on highlights while the pen draws', () => {
    const props = mount({ highlights: signal([highlight]), penDrawing: signal(true) })
    const layer = root.querySelector('.mg-page[data-page="1"] .textLayer')!
    pointer('pointerdown', layer, { pointerType: 'pen', pointerId: 2, clientX: 120, clientY: 100 })
    pointer('pointerup', layer, { pointerType: 'pen', pointerId: 2, clientX: 121, clientY: 100 })
    expect(props.onTapHighlight).not.toHaveBeenCalled()
    pointer('pointerdown', layer, { pointerType: 'mouse', pointerId: 1, clientX: 120, clientY: 100 })
    pointer('pointerup', layer, { pointerType: 'mouse', pointerId: 1, clientX: 121, clientY: 100 })
    expect(props.onTapHighlight).toHaveBeenCalledOnce()
  })

  it('clearSelection removes the area box and the text selection and reports no selection', async () => {
    const armed = signal(true)
    let handle: ViewerHandle | null = null
    const props = mount({ areaSelectArmed: armed, handle: (h) => (handle = h) })
    const layer = root.querySelector('.mg-page[data-page="1"] .textLayer')!
    pointer('pointerdown', layer, { pointerType: 'mouse', pointerId: 1, clientX: 100, clientY: 100 })
    act(() => pointer('pointermove', layer, { pointerType: 'mouse', pointerId: 1, clientX: 300, clientY: 300 }))
    await act(async () => pointer('pointerup', layer, { pointerType: 'mouse', pointerId: 1, clientX: 300, clientY: 300 }))
    await vi.waitFor(() => expect(props.onSelection).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'area' })))
    expect(root.querySelector('.mg-area')).not.toBeNull()
    const span = document.createElement('span')
    span.textContent = 'selected words'
    layer.append(span)
    const range = document.createRange()
    range.selectNodeContents(span)
    document.getSelection()!.addRange(range)

    act(() => handle!.clearSelection())

    expect(root.querySelector('.mg-area')).toBeNull()
    expect(document.getSelection()!.rangeCount).toBe(0)
    expect(props.onSelection).toHaveBeenLastCalledWith(null)
  })

  it('an armed Snip takes the next pen stroke as a box even in the Pen tool', async () => {
    const onAddStroke = vi.fn()
    const props = mount({
      areaSelectArmed: signal(true),
      penDrawing: signal(true),
      pageOverlay: (page, w, h) => (
        <InkLayer page={page} cssW={w} cssH={h} strokes={[]} onAddStroke={onAddStroke} onEraseStroke={() => {}} />
      ),
    })
    const span = textSpan()
    pointer('pointerdown', span, { pointerType: 'pen', pointerId: 7, clientX: 60, clientY: 80, buttons: 1 })
    act(() => pointer('pointermove', span, { pointerType: 'pen', pointerId: 7, clientX: 300, clientY: 400, buttons: 1 }))
    await act(async () => pointer('pointerup', span, { pointerType: 'pen', pointerId: 7, clientX: 300, clientY: 400, buttons: 0 }))
    await vi.waitFor(() =>
      expect(props.onSelection).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'area', boxes: [{ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }] }),
      ),
    )
    expect(onAddStroke).not.toHaveBeenCalled()
  })

  it('an armed Snip takes a finger drag', async () => {
    const props = mount({ areaSelectArmed: signal(true) })
    const span = textSpan()
    pointer('pointerdown', span, { pointerType: 'touch', pointerId: 3, clientX: 60, clientY: 80, buttons: 1 })
    act(() => pointer('pointermove', span, { pointerType: 'touch', pointerId: 3, clientX: 300, clientY: 400, buttons: 1 }))
    await act(async () => pointer('pointerup', span, { pointerType: 'touch', pointerId: 3, clientX: 300, clientY: 400, buttons: 0 }))
    await vi.waitFor(() =>
      expect(props.onSelection).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'area', boxes: [{ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }] }),
      ),
    )
  })

  it('a pen landing during a touch-started snip takes the box over', async () => {
    const props = mount({ areaSelectArmed: signal(true), penDrawing: signal(true) })
    const span = textSpan()
    pointer('pointerdown', span, { pointerType: 'touch', pointerId: 3, clientX: 10, clientY: 10, buttons: 1 })
    act(() => pointer('pointermove', span, { pointerType: 'touch', pointerId: 3, clientX: 500, clientY: 700, buttons: 1 }))
    pointer('pointerdown', span, { pointerType: 'pen', pointerId: 7, clientX: 60, clientY: 80, buttons: 1 })
    act(() => pointer('pointermove', span, { pointerType: 'pen', pointerId: 7, clientX: 300, clientY: 400, buttons: 1 }))
    await act(async () => pointer('pointerup', span, { pointerType: 'pen', pointerId: 7, clientX: 300, clientY: 400, buttons: 0 }))
    await vi.waitFor(() =>
      expect(props.onSelection).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'area', boxes: [{ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }] }),
      ),
    )
  })

  it('flushes a pending reading position on unmount', () => {
    const props = mount()
    act(() => render(null, root))
    expect(props.onReadingPosition).toHaveBeenCalledWith({ page: 1, offset: 0, zoom: 0 })
  })
})
