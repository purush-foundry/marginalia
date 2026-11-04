import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createAnnotationStore } from '../annot/store'
import { emptySidecar } from '../types'
import { Toolbar, type ToolbarProps } from './Toolbar'

const root = document.createElement('div')

afterEach(() => {
  act(() => render(null, root))
  root.remove()
})

function mount(overrides: Partial<ToolbarProps> = {}): ToolbarProps {
  const props: ToolbarProps = {
    title: 'attention',
    history: createAnnotationStore(emptySidecar('p1', 'a.pdf', 0), () => {}, { documentUndo: false }),
    areaArmed: signal(false),
    touchUi: false,
    finePointer: true,
    layout: 'paper',
    canLayoutBoth: true,
    onLayout: vi.fn(),
    nightMode: false,
    threadCount: 0,
    sidebarOpen: false,
    onBack: vi.fn(),
    onToggleNight: vi.fn(),
    onToggleSidebar: vi.fn(),
    onThreads: vi.fn(),
    onExport: vi.fn(),
    ...overrides,
  }
  document.body.append(root)
  act(() => render(<Toolbar {...props} />, root))
  return props
}

describe('Toolbar', () => {
  test('Snip arms and disarms, and the lead says "Drag a box" while armed', () => {
    const props = mount()
    const snip = root.querySelector<HTMLButtonElement>('button[aria-label="Snip"]')!
    expect(snip.title).toBe('Snip')
    expect(snip.getAttribute('aria-pressed')).toBe('false')
    expect(root.querySelector('.mg-snip-hint')).toBeNull()
    expect(root.querySelector('.mg-title')!.textContent).toBe('attention')

    act(() => snip.click())
    expect(props.areaArmed.value).toBe(true)
    expect(snip.getAttribute('aria-pressed')).toBe('true')
    const hint = root.querySelector('.mg-toolbar-lead .mg-snip-hint')!
    expect(hint.textContent).toBe('Drag a box')
    expect(hint.getAttribute('role')).toBe('status')
    expect(root.querySelector('.mg-title')).toBeNull()

    act(() => snip.click())
    expect(props.areaArmed.value).toBe(false)
    expect(root.querySelector('.mg-snip-hint')).toBeNull()
    expect(root.querySelector('.mg-title')!.textContent).toBe('attention')
  })

  test('the layout control offers Both only when allowed and reports the choice', () => {
    const radios = () => [...root.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Layout"] [role="radio"]')]
    const props = mount({ layout: 'both' })
    expect(radios().map((r) => r.textContent)).toEqual(['Paper', 'Both', 'Notes'])
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])

    act(() => radios()[2].click())
    expect(props.onLayout).toHaveBeenCalledWith('notes')

    act(() => render(null, root))
    mount({ layout: 'notes', canLayoutBoth: false })
    expect(radios().map((r) => r.textContent)).toEqual(['Paper', 'Notes'])
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true'])
  })

  test('touch devices get no pen strip; a laptop gets the Draw latch', () => {
    mount({ touchUi: true })
    expect(root.querySelector('button[aria-label="Draw"]')).toBeNull()
    expect(root.querySelector('button[aria-label="Pen"]')).toBeNull()
    act(() => render(null, root))
    mount()
    expect(root.querySelector('button[aria-label="Draw"]')).not.toBeNull()
  })

  test('Undo and Redo act on the history they are given', () => {
    const history = { canUndo: signal(true), canRedo: signal(false), undo: vi.fn(), redo: vi.fn() }
    mount({ history })
    const undo = root.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!
    const redo = root.querySelector<HTMLButtonElement>('button[aria-label="Redo"]')!
    expect(redo.disabled).toBe(true)
    act(() => undo.click())
    expect(history.undo).toHaveBeenCalledOnce()
    act(() => {
      history.canRedo.value = true
    })
    expect(redo.disabled).toBe(false)
  })
})
