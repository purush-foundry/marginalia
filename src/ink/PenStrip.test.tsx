import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PenStrip } from './PenStrip.tsx'
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_WIDTH, nightInk, penColor, penTool, penWidth } from './tools.ts'

const root = document.createElement('div')
const button = (label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

beforeEach(() => {
  document.body.append(root)
  penTool.value = 'pen'
  penColor.value = DEFAULT_PEN_COLOR
  penWidth.value = DEFAULT_PEN_WIDTH
  nightInk.value = false
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
})

describe('PenStrip', () => {
  it('offers three widths and six colours and marks the active ones', () => {
    act(() => render(<PenStrip withSelect />, root))
    expect(root.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Pen tools')
    for (const label of ['Pen', 'Eraser', 'Select', 'Fine', 'Medium', 'Thick', 'Red', 'Black', 'Blue', 'Green', 'Orange', 'Purple']) {
      expect(button(label), label).not.toBeNull()
    }
    const pressed = [...root.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.getAttribute('aria-label'))
    expect(pressed.sort()).toEqual(['Medium', 'Pen', 'Red'])
  })

  it('a width or colour pick sets the signal and returns from the eraser to the pen', () => {
    act(() => render(<PenStrip withSelect />, root))
    penTool.value = 'eraser'
    act(() => button('Thick')!.click())
    expect(penWidth.value).toBe(0.007)
    expect(penTool.value).toBe('pen')
    penTool.value = 'select'
    act(() => button('Orange')!.click())
    expect(penColor.value).toBe('#e8710a')
    expect(penTool.value).toBe('pen')
  })

  it('switches tools from the tool buttons', () => {
    act(() => render(<PenStrip withSelect />, root))
    act(() => button('Eraser')!.click())
    expect(penTool.value).toBe('eraser')
    expect(button('Eraser')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows the Black swatch in the pale ink at night and still picks Black', () => {
    nightInk.value = true
    act(() => render(<PenStrip withSelect />, root))
    expect(button('Black')!.style.getPropertyValue('--swatch')).toBe('#e8e6e1')
    expect(button('Red')!.style.getPropertyValue('--swatch')).toBe('#d33a2c')
    act(() => button('Black')!.click())
    expect(penColor.value).toBe('#1c1c1a')
  })

  it('leaves Select out without withSelect', () => {
    act(() => render(<PenStrip withSelect={false} />, root))
    expect(button('Select')).toBeNull()
    expect(button('Eraser')).not.toBeNull()
  })

  it('lays tools, widths and colours on three rows in the stack layout', () => {
    act(() => render(<PenStrip withSelect layout="stack" />, root))
    const rows = root.querySelectorAll('.mg-penstrip-stack > .mg-penstrip-row')
    expect(rows).toHaveLength(3)
    expect(rows[1].querySelectorAll('button')).toHaveLength(3)
    expect(rows[2].querySelectorAll('button')).toHaveLength(6)
  })
})
