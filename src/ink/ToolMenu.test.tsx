import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, settings } from '../app/settings.ts'
import { hslToHex } from './color.ts'
import { TOOL_MENU_LONG_PRESS_MS, ToolMenu } from './ToolMenu.tsx'
import {
  DEFAULT_ERASER_SETTINGS,
  DEFAULT_HIGHLIGHTER_SETTINGS,
  DEFAULT_PALETTES,
  DEFAULT_PEN_SETTINGS,
  eraserSettings,
  highlighterSettings,
  nightInk,
  palettes,
  penSettings,
  previousTool,
  selectColor,
  setTool,
  tool,
  type Tool,
} from './tools.ts'

const host = document.createElement('div')
host.style.position = 'relative'
host.getBoundingClientRect = () => new DOMRect(0, 0, 400, 1000)

const root = () => host.querySelector<HTMLElement>('.mg-toolmenu')!
const main = () => host.querySelector<HTMLButtonElement>('button.mg-toolmenu-main')!
const panel = () => host.querySelector<HTMLElement>('[role="dialog"][aria-label="Tools"]')
const byLabel = <T extends Element = HTMLButtonElement>(label: string) => host.querySelector<T & Element>(`[aria-label="${label}"]`)!
const byText = (role: string, text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(`[role="${role}"]`)].find((b) => b.textContent === text)!
const colorSlots = () => [...host.querySelectorAll<HTMLButtonElement>('button.mg-slot-color')]
const widthSlots = () => [...host.querySelectorAll<HTMLButtonElement>('button.mg-slot-width')]

interface Init {
  x?: number
  y?: number
  pointerType?: string
  pointerId?: number
  button?: number
  isPrimary?: boolean
}

function fire(target: Element, type: string, init: Init = {}) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: init.pointerId ?? 1,
        isPrimary: init.isPrimary ?? true,
        button: init.button ?? 0,
        pointerType: init.pointerType ?? 'pen',
        clientX: init.x ?? 380,
        clientY: init.y ?? 600,
      }),
    )
  })
}
const tap = (pointerType = 'pen') => {
  fire(main(), 'pointerdown', { pointerType })
  fire(main(), 'pointerup', { pointerType })
}
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
const click = (el: Element) => act(() => (el as HTMLElement).click())
const expand = () => {
  fire(main(), 'pointerdown')
  advance(TOOL_MENU_LONG_PRESS_MS)
  fire(main(), 'pointerup')
}
const select = (t: Tool) => act(() => setTool(t))

beforeEach(() => {
  vi.useFakeTimers()
  document.body.append(host)
  tool.value = 'pen'
  previousTool.value = 'pen'
  palettes.value = DEFAULT_PALETTES
  penSettings.value = DEFAULT_PEN_SETTINGS
  highlighterSettings.value = DEFAULT_HIGHLIGHTER_SETTINGS
  eraserSettings.value = DEFAULT_ERASER_SETTINGS
  nightInk.value = false
  settings.value = { ...DEFAULT_SETTINGS }
  act(() => render(<ToolMenu tools={['lasso', 'pen', 'highlighter', 'eraser']} />, host))
})

afterEach(() => {
  act(() => render(null, host))
  vi.useRealTimers()
  host.remove()
})

describe('ToolMenu', () => {
  it('a tap flips pen and eraser, and lasso goes to pen', () => {
    tap()
    expect(tool.value).toBe('eraser')
    tap()
    expect(tool.value).toBe('pen')
    select('lasso')
    tap()
    expect(tool.value).toBe('pen')
    select('text')
    tap()
    expect(tool.value).toBe('pen')
  })

  it('a tap from the highlighter goes to the eraser and back to the highlighter', () => {
    select('highlighter')
    tap()
    expect(tool.value).toBe('eraser')
    tap()
    expect(tool.value).toBe('highlighter')
    select('lasso')
    select('eraser')
    tap()
    expect(tool.value).toBe('pen')
  })

  it('a finger tap flips too', () => {
    tap('touch')
    expect(tool.value).toBe('eraser')
  })

  it('a 350 ms press expands the menu without flipping; a tap elsewhere collapses it', () => {
    fire(main(), 'pointerdown')
    advance(TOOL_MENU_LONG_PRESS_MS - 1)
    expect(panel()).toBeNull()
    advance(1)
    expect(panel()).not.toBeNull()
    fire(main(), 'pointerup')
    expect(tool.value).toBe('pen')
    expect(panel()).not.toBeNull()
    fire(document.body, 'pointerdown')
    expect(panel()).toBeNull()
  })

  it('a tap on the button while expanded collapses it without flipping; a long-press keeps it open', () => {
    expand()
    expand()
    expect(panel()).not.toBeNull()
    tap()
    expect(panel()).toBeNull()
    expect(tool.value).toBe('pen')
    tap()
    expect(tool.value).toBe('eraser')
  })

  it('the tool buttons switch tools and keep the menu open', () => {
    expand()
    const labels = [...panel()!.querySelectorAll('.mg-toolmenu-tool')].map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Lasso', 'Pen', 'Highlighter', 'Eraser'])
    expect(byLabel('Pen').getAttribute('aria-pressed')).toBe('true')
    click(byLabel('Highlighter'))
    expect(tool.value).toBe('highlighter')
    expect(byLabel('Highlighter').getAttribute('aria-pressed')).toBe('true')
    expect(panel()).not.toBeNull()
  })

  it("the expanded menu shows the active tool's three colour slots and three thickness slots", () => {
    expand()
    expect(colorSlots().map((b) => b.getAttribute('aria-label'))).toEqual(['Colour 1', 'Colour 2', 'Colour 3'])
    expect(colorSlots().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    expect(colorSlots()[0].style.getPropertyValue('--swatch')).toBe('#1c1c1a')
    expect(widthSlots().map((b) => b.getAttribute('aria-label'))).toEqual(['Thickness 1', 'Thickness 2', 'Thickness 3'])
    expect(widthSlots().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    click(byLabel('Highlighter'))
    expect(colorSlots()[0].style.getPropertyValue('--swatch')).toBe('#ffe066')
    expect(widthSlots()).toHaveLength(3)
  })

  it('the pen shows its pen types and the highlighter its straight-line switch', () => {
    expand()
    expect([...host.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual(['Ball', 'Fountain', 'Brush'])
    expect(byText('radio', 'Fountain').getAttribute('aria-checked')).toBe('true')
    click(byText('radio', 'Brush'))
    expect(penSettings.value.style).toBe('brush')
    click(byLabel('Highlighter'))
    expect(host.querySelector('[role="radio"]')).toBeNull()
    const straight = byText('switch', 'Draw straight line')
    expect(straight.getAttribute('aria-checked')).toBe('false')
    click(straight)
    expect(highlighterSettings.value.straight).toBe(true)
  })

  it('tapping the selected colour slot opens the colour editor; a preset, the wheel and a HEX value set the slot', () => {
    expand()
    click(byLabel('Colour 2'))
    expect(palettes.value.pen.colorIndex).toBe(1)
    expect(byLabel('Edit colour')).toBeNull()
    click(byLabel('Colour 1'))
    expect(palettes.value.pen.colorIndex).toBe(0)
    expect(byLabel('Edit colour')).toBeNull()
    click(byLabel('Colour 1'))
    const editor = byLabel<HTMLElement>('Edit colour')
    expect(editor.getAttribute('role')).toBe('dialog')
    expect(editor.querySelectorAll('.mg-preset')).toHaveLength(12)
    click(byLabel('#2f9e9e'))
    expect(palettes.value.pen.colors[0]).toBe('#2f9e9e')

    const hex = byLabel<HTMLInputElement>('HEX')
    act(() => {
      hex.value = 'ABC'
      hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(palettes.value.pen.colors[0]).toBe('#aabbcc')
    act(() => {
      hex.value = 'nope'
      hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(palettes.value.pen.colors[0]).toBe('#aabbcc')

    const wheel = editor.querySelector<HTMLCanvasElement>('canvas.mg-wheel')!
    wheel.getBoundingClientRect = () => new DOMRect(0, 0, 160, 160)
    fire(wheel, 'pointerdown', { x: 160, y: 80 })
    expect(palettes.value.pen.colors[0]).toBe(hslToHex(0, 90, 25))
    expect(palettes.value.pen.colors.slice(1)).toEqual(['#2f6fed', '#d33a2c'])
    expect(panel()).not.toBeNull()
    click(byLabel('Highlighter'))
    click(byLabel('Pen'))
    expect(byLabel('Edit colour')).toBeNull()
  })

  it('"Add colour" adds a slot up to 12', () => {
    expand()
    for (let i = 3; i < 12; i++) click(byLabel('Add colour'))
    expect(colorSlots()).toHaveLength(12)
    expect(palettes.value.pen.colors).toHaveLength(12)
    expect(palettes.value.pen.colorIndex).toBe(11)
    expect(byLabel('Add colour')).toBeNull()
  })

  it('tapping the selected thickness slot opens a 0.1–2.0 mm slider in 0.05 mm steps for the pen', () => {
    expand()
    click(byLabel('Thickness 2'))
    const editor = byLabel<HTMLElement>('Edit thickness')
    expect(editor.getAttribute('role')).toBe('dialog')
    const range = editor.querySelector<HTMLInputElement>('input[type="range"]')!
    expect([range.min, range.max, range.step]).toEqual(['0.1', '2', '0.05'])
    act(() => {
      range.value = '0.7'
      range.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(palettes.value.pen.widthsMm[1]).toBe(0.7)
    expect(editor.textContent).toContain('0.7 mm')
  })

  it('long-press-drag moves a colour slot', () => {
    expand()
    colorSlots().forEach((b, i) => (b.getBoundingClientRect = () => new DOMRect(300, 100 + 48 * i, 44, 44)))
    const first = colorSlots()[0]
    fire(first, 'pointerdown', { x: 322, y: 122 })
    advance(TOOL_MENU_LONG_PRESS_MS)
    fire(first, 'pointermove', { x: 322, y: 218 })
    fire(first, 'pointerup', { x: 322, y: 218 })
    click(first)
    expect(palettes.value.pen.colors).toEqual(['#2f6fed', '#d33a2c', '#1c1c1a'])
    expect(palettes.value.pen.colorIndex).toBe(2)
    expect(byLabel('Edit colour')).toBeNull()
  })

  it('the eraser shows its styles, sizes 2 / 4 / 8 mm, filters and Auto-deselect', () => {
    select('eraser')
    expand()
    expect(colorSlots()).toHaveLength(0)
    expect([...host.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual(['Stroke', 'Segment'])
    click(byText('radio', 'Segment'))
    expect(eraserSettings.value.style).toBe('segment')
    expect(byText('radio', 'Segment').getAttribute('aria-checked')).toBe('true')
    const sizes = [...host.querySelectorAll<HTMLButtonElement>('.mg-toolmenu-size')]
    expect(sizes.map((b) => b.textContent)).toEqual(['2 mm', '4 mm', '8 mm'])
    click(sizes[2])
    expect(eraserSettings.value.sizeMm).toBe(8)
    expect(sizes[2].getAttribute('aria-pressed')).toBe('true')
    expect(byText('checkbox', 'Pen').getAttribute('aria-checked')).toBe('true')
    click(byText('checkbox', 'Highlighter'))
    expect(eraserSettings.value.eraseHighlighter).toBe(false)
    expect(eraserSettings.value.erasePen).toBe(true)
    click(byText('switch', 'Auto-deselect'))
    expect(eraserSettings.value.autoDeselect).toBe(true)
    expect(tool.value).toBe('eraser')
  })

  it('dragging docks to the nearest edge and remembers it', () => {
    fire(main(), 'pointerdown', { x: 380, y: 600 })
    fire(main(), 'pointermove', { x: 20, y: 300 })
    fire(main(), 'pointerup', { x: 20, y: 300 })
    expect(settings.value.toolDock).toEqual({ edge: 'left', at: 0.3 })
    expect(root().dataset.edge).toBe('left')
    expect(root().style.left).toBe('8px')
    expect(root().style.top).toBe('278px')
    expect(tool.value).toBe('pen')
    fire(main(), 'pointerdown', { x: 30, y: 300 })
    fire(main(), 'pointermove', { x: 200, y: 980 })
    fire(main(), 'pointerup', { x: 200, y: 980 })
    expect(settings.value.toolDock).toEqual({ edge: 'bottom', at: 0.5 })
    expect(root().style.bottom).toBe('8px')
    expect(root().style.left).toBe('178px')
  })

  it('stays inside the host', () => {
    fire(main(), 'pointerdown', { x: 390, y: 600 })
    fire(main(), 'pointermove', { x: 390, y: -500 })
    fire(main(), 'pointerup', { x: 390, y: -500 })
    expect(settings.value.toolDock).toEqual({ edge: 'right', at: 0 })
    expect(root().style.top).toBe('8px')
  })

  it('a cancelled drag puts the pill back and changes nothing', () => {
    fire(main(), 'pointerdown', { y: 600 })
    fire(main(), 'pointermove', { y: 300 })
    expect(root().style.top).toBe('278px')
    fire(main(), 'pointercancel', { y: 300 })
    expect(settings.value.toolDock).toEqual({ edge: 'right', at: 0.6 })
    expect(root().style.top).toBe('578px')
    expect(tool.value).toBe('pen')
  })

  it('a drag that outlasts the long-press time does not expand the menu', () => {
    fire(main(), 'pointerdown', { y: 600 })
    fire(main(), 'pointermove', { y: 500 })
    advance(500)
    expect(panel()).toBeNull()
  })

  it('ignores a right-button press and a second pointer landing mid-drag', () => {
    fire(main(), 'pointerdown', { button: 2 })
    advance(500)
    fire(main(), 'pointerup', { button: 2 })
    expect(panel()).toBeNull()
    expect(tool.value).toBe('pen')
    fire(main(), 'pointerdown', { y: 600 })
    fire(main(), 'pointermove', { y: 300 })
    fire(main(), 'pointerdown', { pointerId: 2, isPrimary: false, y: 100 })
    fire(main(), 'pointerup', { pointerId: 2, isPrimary: false, y: 100 })
    fire(main(), 'pointerup', { y: 300 })
    expect(settings.value.toolDock).toEqual({ edge: 'right', at: 0.3 })
    expect(tool.value).toBe('pen')
  })

  it('pointer and click events never reach the page under the pill', () => {
    const seen = vi.fn()
    const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'touchstart', 'touchmove', 'touchend']
    for (const type of types) host.addEventListener(type, seen)
    tap()
    tap()
    expand()
    click(byLabel('Colour 2'))
    click(byLabel('Colour 2'))
    fire(byLabel('#2f9e9e'), 'pointerdown')
    click(byLabel('Highlighter'))
    fire(main(), 'pointermove')
    fire(main(), 'pointercancel')
    for (const type of ['touchstart', 'touchmove', 'touchend']) {
      act(() => void main().dispatchEvent(new Event(type, { bubbles: true })))
    }
    expect(seen).not.toHaveBeenCalled()
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => void main().dispatchEvent(menu))
    expect(menu.defaultPrevented).toBe(true)
    for (const type of types) host.removeEventListener(type, seen)
  })

  it('a new press resets a gesture whose pointerup never came', () => {
    fire(main(), 'pointerdown', { pointerId: 1 })
    fire(main(), 'pointerdown', { pointerId: 2 })
    fire(main(), 'pointerup', { pointerId: 2 })
    expect(tool.value).toBe('eraser')
    advance(1000)
    expect(panel()).toBeNull()
    select('pen')
    expand()
    const first = colorSlots()[0]
    fire(first, 'pointerdown', { pointerId: 3 })
    fire(first, 'pointerdown', { pointerId: 4 })
    advance(TOOL_MENU_LONG_PRESS_MS - 1)
    fire(first, 'pointerup', { pointerId: 4 })
    advance(1000)
    expect(first.dataset.lifted).toBeUndefined()
  })

  it('removes its listeners and timers when unmounted mid-press', () => {
    expand()
    fire(main(), 'pointerdown')
    act(() => render(null, host))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows the active tool and colour; Black rings pale at night', () => {
    expect(main().getAttribute('aria-label')).toBe('Tool menu')
    expect(main().dataset.tool).toBe('pen')
    expect(main().style.getPropertyValue('--tool-color')).toBe('#1c1c1a')
    act(() => void (nightInk.value = true))
    expect(main().style.getPropertyValue('--tool-color')).toBe('#e8e6e1')
    expect(palettes.value.pen.colors[0]).toBe('#1c1c1a')
    act(() => selectColor('pen', 1))
    expect(main().style.getPropertyValue('--tool-color')).toBe('#2f6fed')
    select('highlighter')
    expect(main().dataset.tool).toBe('highlighter')
    expect(main().style.getPropertyValue('--tool-color')).toBe('#ffe066')
  })
})
