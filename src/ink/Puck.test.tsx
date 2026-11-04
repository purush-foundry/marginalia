import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, settings } from '../app/settings.ts'
import { Puck } from './Puck.tsx'
import { DEFAULT_PEN_COLOR, penColor, penTool } from './tools.ts'

const host = document.createElement('div')
host.style.position = 'relative'
host.getBoundingClientRect = () => new DOMRect(0, 0, 400, 1000)

const puck = () => host.querySelector<HTMLButtonElement>('button.mg-puck')!
const palette = () => host.querySelector('[aria-label="Pen palette"]')

function fire(target: Element, type: string, init: { y?: number; pointerType?: string } = {}) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: init.pointerType ?? 'pen', clientX: 390, clientY: init.y ?? 600 }),
    )
  })
}
const tap = (pointerType = 'pen') => {
  fire(puck(), 'pointerdown', { pointerType })
  fire(puck(), 'pointerup', { pointerType })
}

beforeEach(() => {
  document.body.append(host)
  penTool.value = 'pen'
  penColor.value = DEFAULT_PEN_COLOR
  settings.value = { ...DEFAULT_SETTINGS }
  act(() => render(<Puck visible />, host))
})

afterEach(() => {
  vi.useRealTimers()
  act(() => render(null, host))
  host.remove()
})

describe('Puck', () => {
  it('a tap toggles pen and eraser, and from select goes to pen', () => {
    tap()
    expect(penTool.value).toBe('eraser')
    tap()
    expect(penTool.value).toBe('pen')
    penTool.value = 'select'
    tap()
    expect(penTool.value).toBe('pen')
  })

  it('a finger tap toggles too', () => {
    tap('touch')
    expect(penTool.value).toBe('eraser')
  })

  it('a 350 ms press opens the palette without toggling; a tap elsewhere closes it', () => {
    vi.useFakeTimers()
    fire(puck(), 'pointerdown')
    act(() => void vi.advanceTimersByTime(349))
    expect(palette()).toBeNull()
    act(() => void vi.advanceTimersByTime(1))
    expect(palette()).not.toBeNull()
    fire(puck(), 'pointerup')
    expect(penTool.value).toBe('pen')
    expect(palette()).not.toBeNull()
    fire(document.body, 'pointerdown')
    expect(palette()).toBeNull()
  })

  it('choosing in the palette keeps it open', () => {
    vi.useFakeTimers()
    fire(puck(), 'pointerdown')
    act(() => void vi.advanceTimersByTime(350))
    fire(puck(), 'pointerup')
    const blue = palette()!.querySelector<HTMLButtonElement>('button[aria-label="Blue"]')!
    fire(blue, 'pointerdown')
    act(() => blue.click())
    expect(palette()).not.toBeNull()
    expect(penColor.value).toBe('#2f6fed')
  })

  it('dragging along the edge moves the puck and remembers the position', () => {
    fire(puck(), 'pointerdown', { y: 600 })
    fire(puck(), 'pointermove', { y: 300 })
    fire(puck(), 'pointerup', { y: 300 })
    expect(settings.value.puckY).toBe(0.3)
    expect(penTool.value).toBe('pen')
    expect(puck().style.top).toBe(`${300 - 22}px`)
  })

  it('a drag that outlasts the long-press time does not open the palette', () => {
    vi.useFakeTimers()
    fire(puck(), 'pointerdown', { y: 600 })
    fire(puck(), 'pointermove', { y: 500 })
    act(() => void vi.advanceTimersByTime(500))
    expect(palette()).toBeNull()
  })

  it('a cancelled drag puts the puck back and changes nothing', () => {
    fire(puck(), 'pointerdown', { y: 600 })
    fire(puck(), 'pointermove', { y: 300 })
    fire(puck(), 'pointercancel', { y: 300 })
    expect(settings.value.puckY).toBe(0.6)
    expect(puck().style.top).toBe(`${600 - 22}px`)
    expect(penTool.value).toBe('pen')
  })

  it('keeps the puck inside the host', () => {
    fire(puck(), 'pointerdown', { y: 600 })
    fire(puck(), 'pointermove', { y: -500 })
    fire(puck(), 'pointerup', { y: -500 })
    expect(settings.value.puckY).toBe(0)
    expect(puck().style.top).toBe('8px')
  })

  it('shows the active tool and colour', () => {
    expect(puck().dataset.tool).toBe('pen')
    act(() => {
      penTool.value = 'eraser'
      penColor.value = '#2f6fed'
    })
    expect(puck().dataset.tool).toBe('eraser')
    expect(puck().style.getPropertyValue('--puck-color')).toBe('#2f6fed')
  })

  it('removes its listeners and timer when unmounted with the palette open', () => {
    vi.useFakeTimers()
    fire(puck(), 'pointerdown')
    act(() => void vi.advanceTimersByTime(350))
    act(() => render(null, host))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renders nothing when not visible', () => {
    act(() => render(<Puck visible={false} />, host))
    expect(puck()).toBeNull()
  })
})
