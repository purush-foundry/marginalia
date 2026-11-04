import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ImageObjectView, type ImageObjectProps } from './ImageObject.tsx'
import type { ImageObject } from './model.ts'

let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  act(() => render(null, host))
  host.remove()
})

function image(patch: Partial<ImageObject> = {}): ImageObject {
  return { id: 'i1', page: 'page-1', box: { x: 0.1, y: 0.1, w: 0.5 }, src: 'data:snip', aspect: 0.5, z: 'a0', createdAt: 1, updatedAt: 1, ...patch }
}

type Props = ImageObjectProps & {
  onSelect: ReturnType<typeof vi.fn>
  onChange: ReturnType<typeof vi.fn>
  onJumpToPage: ReturnType<typeof vi.fn>
}

function mount(patch: Partial<ImageObjectProps> = {}): Props {
  const props = { item: image(), cssW: 840, selected: false, onSelect: vi.fn(), onChange: vi.fn(), onJumpToPage: vi.fn(), ...patch } as Props
  act(() => render(<ImageObjectView {...props} />, host))
  return props
}

const figure = () => host.querySelector<HTMLElement>('img.mg-nb-image')!.parentElement!
const corner = (c: string) => host.querySelector<HTMLElement>(`.mg-nb-image-handle[data-corner="${c}"]`)!
const rect = (el: HTMLElement) => [el.style.left, el.style.top, el.style.width, el.style.height].map((v) => Math.round(parseFloat(v)))
const rounded = (b: { x: number; y: number; w: number }) => [b.x, b.y, b.w].map((v) => +v.toFixed(3))

function pointer(target: Element, name: string, x: number, y: number, type = 'touch'): PointerEvent {
  const e = new PointerEvent(name, { bubbles: true, cancelable: true, pointerType: type, pointerId: 7, clientX: x, clientY: y, button: 0, buttons: name === 'pointerup' ? 0 : 1 })
  act(() => {
    target.dispatchEvent(e)
  })
  return e
}

function drag(target: Element, from: [number, number], to: [number, number]) {
  pointer(target, 'pointerdown', ...from)
  pointer(target, 'pointermove', ...to)
  pointer(target, 'pointerup', ...to)
}

test('an image corner scales it proportionally and a drag moves it', () => {
  const props = mount()
  expect(host.querySelector('img.mg-nb-image')!.getAttribute('src')).toBe('data:snip')
  expect(rect(figure())).toEqual([84, 84, 420, 210])
  expect(host.querySelector('.mg-nb-image-handle')).toBeNull()
  expect(pointer(figure(), 'pointerdown', 200, 200, 'pen').defaultPrevented).toBe(false)
  pointer(figure(), 'pointerup', 200, 200, 'pen')
  act(() => figure().click())
  expect(props.onSelect).toHaveBeenCalledTimes(1)

  act(() => render(<ImageObjectView {...props} selected />, host))
  expect(host.querySelectorAll('.mg-nb-image-handle')).toHaveLength(4)
  pointer(corner('se'), 'pointerdown', 504, 294)
  pointer(corner('se'), 'pointermove', 588, 336)
  expect(rect(figure())).toEqual([84, 84, 504, 252])
  pointer(corner('se'), 'pointerup', 588, 336)
  expect(rounded(props.onChange.mock.calls[0][0])).toEqual([0.1, 0.1, 0.6])

  drag(corner('nw'), [84, 84], [168, 126])
  expect(rounded(props.onChange.mock.calls[1][0])).toEqual([0.2, 0.15, 0.4])

  drag(corner('nw'), [84, 84], [1084, 584])
  expect(rounded(props.onChange.mock.calls[2][0])).toEqual([0.5, 0.3, 0.1])

  drag(figure(), [200, 200], [242, 284])
  expect(rounded(props.onChange.mock.calls[3][0])).toEqual([0.15, 0.2, 0.5])
  expect(props.onSelect).toHaveBeenCalledTimes(1)
})

test('the p.N chip jumps to the paper page', () => {
  const props = mount({ item: image({ pdfPage: 3 }) })
  const chip = host.querySelector<HTMLElement>('button.mg-nb-chip')!
  expect(chip.textContent).toBe('p.3')
  act(() => chip.click())
  expect(props.onJumpToPage).toHaveBeenCalledWith(3)
  expect(props.onSelect).not.toHaveBeenCalled()

  act(() => render(<ImageObjectView {...props} item={image()} />, host))
  expect(host.querySelector('button.mg-nb-chip')).toBeNull()
})
