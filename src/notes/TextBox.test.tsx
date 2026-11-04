import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { placeCaret } from './caret.ts'
import type { TextObject } from './model.ts'
import { TEXT_BOX_DEFAULT_W, TEXT_BOX_MIN_W, TextBox, textBoxAt, type TextBoxProps } from './TextBox.tsx'

let host: HTMLElement
let scroller: HTMLElement
let clock: number

beforeEach(() => {
  clock = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  scroller = document.createElement('div')
  host = document.createElement('div')
  scroller.appendChild(host)
  document.body.appendChild(scroller)
})

afterEach(() => {
  act(() => render(null, host))
  scroller.remove()
  vi.restoreAllMocks()
})

function item(patch: Partial<TextObject> = {}): TextObject {
  return { id: 't1', page: 'page-1', box: { x: 0.1, y: 0.2, w: 0.6 }, text: 'Attention', size: 'm', color: '#1c1c1a', z: 'a0', createdAt: 1, updatedAt: 1, ...patch }
}

type Props = TextBoxProps & {
  onEdit: ReturnType<typeof vi.fn>
  onChange: ReturnType<typeof vi.fn>
  onDone: ReturnType<typeof vi.fn>
}

function mount(patch: Partial<TextBoxProps> = {}): Props {
  const props = {
    item: item(),
    cssW: 840,
    widthMm: 210,
    editing: false,
    selected: false,
    onEdit: vi.fn(),
    onChange: vi.fn(),
    onDone: vi.fn(),
    scroller: () => scroller,
    ...patch,
  } as Props
  act(() => render(<TextBox {...props} />, host))
  return props
}

const box = () => host.querySelector<HTMLElement>('.mg-nb-text')!
const handle = (side: 'left' | 'right') => host.querySelector<HTMLElement>(`.mg-nb-text-handle[data-side="${side}"]`)!

function pointer(target: Element, name: string, x: number, y: number, type = 'touch'): PointerEvent {
  const e = new PointerEvent(name, { bubbles: true, cancelable: true, pointerType: type, pointerId: 7, clientX: x, clientY: y, button: 0, buttons: name === 'pointerup' ? 0 : 1 })
  act(() => {
    target.dispatchEvent(e)
  })
  return e
}

function tap(target: Element, x: number, y: number, type = 'touch') {
  pointer(target, 'pointerdown', x, y, type)
  pointer(target, 'pointerup', x, y, type)
}

test('textBoxAt drops a 60 % wide box at the tap, kept on the page', () => {
  expect(TEXT_BOX_DEFAULT_W).toBe(0.6)
  expect(textBoxAt(0.2, 0.3)).toEqual({ x: 0.2, y: 0.3, w: 0.6 })
  expect(textBoxAt(0.7, 0.3)).toEqual({ x: 0.4, y: 0.3, w: 0.6 })
})

test('text renders at its point size on the page', () => {
  mount()
  const el = box()
  expect(el.dataset.id).toBe('t1')
  expect(el.textContent).toBe('Attention')
  expect([el.style.left, el.style.top, el.style.width]).toEqual(['84px', '168px', '504px'])
  expect(parseFloat(el.style.fontSize)).toBeCloseTo(18.35, 2)
  expect(el.style.color).toBe('#1c1c1a')
  expect(el.getAttribute('contenteditable')).toBeNull()
})

test('typing reports the text and keeps the caret above the keyboard', () => {
  const props = mount({ editing: true })
  const el = box()
  expect(el.getAttribute('contenteditable')).toBe('plaintext-only')
  expect(document.activeElement).toBe(el)
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600)
  el.getBoundingClientRect = () => ({ top: 880, bottom: 900, left: 0, right: 0, width: 0, height: 20, x: 0, y: 880 }) as DOMRect
  el.textContent = 'Attention is all'
  placeCaret(el, 16)
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(props.onChange).toHaveBeenLastCalledWith({ text: 'Attention is all' })
  expect(scroller.scrollTop).toBeGreaterThan(0)

  act(() => render(<TextBox {...props} item={item({ text: 'Attention is all' })} />, host))
  expect(box().textContent).toBe('Attention is all')
})

test('Enter types a newline and Esc or a blur finishes editing', () => {
  const props = mount({ editing: true })
  const el = box()
  placeCaret(el, 9)
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  expect(props.onChange).toHaveBeenLastCalledWith({ text: 'Attention\n' })

  const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => {
    el.dispatchEvent(esc)
  })
  expect(esc.defaultPrevented).toBe(true)
  expect(props.onDone).toHaveBeenCalledTimes(1)

  act(() => render(<TextBox {...props} />, host))
  act(() => box().focus())
  act(() => box().blur())
  expect(props.onDone).toHaveBeenCalledTimes(2)
})

test('a side handle changes the width and the text reflows', () => {
  const props = mount({ selected: true })
  pointer(handle('right'), 'pointerdown', 588, 200)
  pointer(handle('right'), 'pointermove', 504, 200)
  expect(box().style.width).toBe('420px')
  expect(props.onChange).not.toHaveBeenCalled()
  pointer(handle('right'), 'pointerup', 504, 200)
  expect(props.onChange).toHaveBeenCalledTimes(1)
  expect(props.onChange.mock.calls[0][0].box.x).toBeCloseTo(0.1)
  expect(props.onChange.mock.calls[0][0].box.w).toBeCloseTo(0.5)

  props.onChange.mockClear()
  pointer(handle('left'), 'pointerdown', 84, 200)
  pointer(handle('left'), 'pointermove', 800, 200)
  pointer(handle('left'), 'pointerup', 800, 200)
  const next = props.onChange.mock.calls[0][0].box
  expect(next.w).toBeCloseTo(TEXT_BOX_MIN_W)
  expect(next.x + next.w).toBeCloseTo(0.7)
})

test('dragging a selected box moves it; double-tap edits it', () => {
  const props = mount()
  expect(host.querySelector('.mg-nb-text-handle')).toBeNull()
  const down = pointer(box(), 'pointerdown', 200, 200, 'pen')
  expect(down.defaultPrevented).toBe(false)
  pointer(box(), 'pointermove', 300, 300, 'pen')
  pointer(box(), 'pointerup', 300, 300, 'pen')
  expect(props.onChange).not.toHaveBeenCalled()

  act(() => render(<TextBox {...props} selected />, host))
  expect(pointer(box(), 'pointerdown', 200, 200).defaultPrevented).toBe(true)
  pointer(box(), 'pointermove', 242, 284)
  expect(box().style.left).toBe('126px')
  pointer(box(), 'pointerup', 242, 284)
  const moved = props.onChange.mock.calls[0][0].box
  expect([moved.x, moved.y, moved.w].map((v: number) => +v.toFixed(3))).toEqual([0.15, 0.3, 0.6])

  props.onChange.mockClear()
  pointer(box(), 'pointerdown', 200, 200)
  pointer(box(), 'pointermove', 2000, 200)
  pointer(box(), 'pointerup', 2000, 200)
  expect(props.onChange.mock.calls[0][0].box.x).toBeCloseTo(1 - 0.6)

  act(() => render(<TextBox {...props} selected={false} />, host))
  tap(box(), 200, 200)
  clock += 400
  tap(box(), 200, 200)
  expect(props.onEdit).not.toHaveBeenCalled()
  clock += 100
  tap(box(), 205, 203)
  expect(props.onEdit).toHaveBeenCalledTimes(1)
  expect(box().getAttribute('contenteditable')).toBe('plaintext-only')
  expect(document.activeElement).toBe(box())
})
