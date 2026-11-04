import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Highlight } from '../types.ts'
import { SelectionBar, type SelectionBarProps } from './SelectionBar.tsx'

const roots: HTMLElement[] = []

function mount(props: Partial<SelectionBarProps> & { anchorRect: DOMRect }) {
  const handlers = {
    onColor: vi.fn(),
    onAsk: vi.fn(),
    onNote: vi.fn(),
    onDismiss: vi.fn(),
  }
  const root = document.createElement('div')
  roots.push(root)
  document.body.append(root)
  act(() => render(<SelectionBar {...handlers} {...props} />, root))
  const bar = root.querySelector<HTMLElement>('[role="toolbar"]')!
  return { bar, ...handlers }
}

const button = (bar: HTMLElement, label: string) =>
  bar.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

afterEach(() => {
  for (const root of roots.splice(0)) act(() => render(null, root))
  document.body.innerHTML = ''
})

describe('SelectionBar', () => {
  it('shows four colours, Ask and Note, and Copy/Delete only when handled', () => {
    const { bar } = mount({ anchorRect: new DOMRect(300, 400, 100, 20) })
    for (const c of ['Yellow', 'Green', 'Blue', 'Pink']) expect(button(bar, c)).not.toBeNull()
    expect(button(bar, 'Ask')).not.toBeNull()
    expect(button(bar, 'Note')).not.toBeNull()
    expect(button(bar, 'Copy')).toBeNull()
    expect(button(bar, 'Delete')).toBeNull()

    const withAll = mount({ anchorRect: new DOMRect(300, 400, 100, 20), onCopy: vi.fn(), onDelete: vi.fn() })
    expect(button(withAll.bar, 'Copy')).not.toBeNull()
    expect(button(withAll.bar, 'Delete')).not.toBeNull()
  })

  it('calls the handlers', () => {
    const onCopy = vi.fn()
    const { bar, onColor, onAsk, onNote } = mount({ anchorRect: new DOMRect(300, 400, 100, 20), onCopy })
    button(bar, 'Green')!.click()
    button(bar, 'Ask')!.click()
    button(bar, 'Note')!.click()
    button(bar, 'Copy')!.click()
    expect(onColor).toHaveBeenCalledWith('green')
    expect(onAsk).toHaveBeenCalledOnce()
    expect(onNote).toHaveBeenCalledOnce()
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it('shows Copy image and To notes only when handled, and calls them', () => {
    const { bar } = mount({ anchorRect: new DOMRect(300, 400, 100, 20) })
    expect(button(bar, 'Copy image')).toBeNull()
    expect(button(bar, 'To notes')).toBeNull()

    const onCopyImage = vi.fn()
    const onToNotes = vi.fn()
    const withImage = mount({ anchorRect: new DOMRect(300, 400, 100, 20), onCopyImage, onToNotes })
    const labels = [...withImage.bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    expect(labels.slice(labels.indexOf('Note'))).toEqual(['Note', 'Copy image', 'To notes'])
    button(withImage.bar, 'Copy image')!.click()
    button(withImage.bar, 'To notes')!.click()
    expect(onCopyImage).toHaveBeenCalledOnce()
    expect(onToNotes).toHaveBeenCalledOnce()
  })

  it('sits above the anchor when there is room', () => {
    const { bar } = mount({ anchorRect: new DOMRect(300, 400, 100, 20) })
    expect(bar.dataset.placement).toBe('above')
    expect(parseFloat(bar.style.top)).toBeLessThan(400)
  })

  it('flips below the anchor near the top of the viewport', () => {
    const { bar } = mount({ anchorRect: new DOMRect(300, 10, 100, 20) })
    expect(bar.dataset.placement).toBe('below')
    expect(parseFloat(bar.style.top)).toBeGreaterThanOrEqual(30)
  })

  it('stays inside the viewport horizontally', () => {
    const { bar } = mount({ anchorRect: new DOMRect(window.innerWidth - 4, 400, 4, 20) })
    expect(parseFloat(bar.style.left)).toBeGreaterThanOrEqual(0)
    expect(parseFloat(bar.style.left) + bar.offsetWidth).toBeLessThanOrEqual(window.innerWidth)
    const left = mount({ anchorRect: new DOMRect(0, 400, 4, 20) })
    expect(parseFloat(left.bar.style.left)).toBeGreaterThan(0)
  })

  it('marks the current highlight colour', () => {
    const current: Highlight = {
      id: 'h1',
      kind: 'text',
      page: 1,
      color: 'blue',
      boxes: [],
      text: 'x',
      createdAt: 0,
      updatedAt: 0,
    }
    const { bar } = mount({ anchorRect: new DOMRect(300, 400, 100, 20), current })
    expect(button(bar, 'Blue')!.getAttribute('aria-pressed')).toBe('true')
    expect(button(bar, 'Yellow')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('dismisses on Escape and on a press outside, not on a press inside', () => {
    const { bar, onDismiss } = mount({ anchorRect: new DOMRect(300, 400, 100, 20) })
    bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(onDismiss).not.toHaveBeenCalled()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(onDismiss).toHaveBeenCalledOnce()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onDismiss).toHaveBeenCalledTimes(2)
  })
})
