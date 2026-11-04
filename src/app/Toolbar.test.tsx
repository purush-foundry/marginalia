import { readFileSync } from 'node:fs'
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
    wide: true,
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
    mount({ layout: 'notes', wide: false })
    expect(radios()).toEqual([])
  })

  test('below 700 px the lead is Back only and a Notes toggle switches between paper and notes', () => {
    const toggle = () => root.querySelector<HTMLButtonElement>('.mg-toolbar-tools button[aria-label="Notes"]')!
    let props = mount({ wide: false, touchUi: true, layout: 'paper' })
    expect(root.querySelector('[role="radiogroup"]')).toBeNull()
    expect([...root.querySelectorAll('.mg-toolbar-lead > *')].map((e) => e.getAttribute('aria-label'))).toEqual(['Library'])
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    act(() => toggle().click())
    expect(props.onLayout).toHaveBeenCalledWith('notes')

    act(() => render(null, root))
    props = mount({ wide: false, touchUi: true, layout: 'notes' })
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    act(() => toggle().click())
    expect(props.onLayout).toHaveBeenCalledWith('paper')

    act(() => {
      props.areaArmed.value = true
    })
    expect([...root.querySelectorAll('.mg-toolbar-lead > *')].map((e) => e.getAttribute('aria-label'))).toEqual(['Library'])
  })

  test('below 700 px eight 44 px controls come before Copy as Markdown and the lead takes only the Back button', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync('src/app/reader.css', 'utf8')
    document.head.append(style)
    mount({ wide: false, touchUi: true })
    const labels = [...root.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Library', 'Snip', 'Notes', 'Undo', 'Redo', 'Night mode', 'Sidebar', 'Ask threads', 'Copy as Markdown'])
    const lead = getComputedStyle(root.querySelector('.mg-toolbar-lead')!)
    const [minWidth, grow] = [parseFloat(lead.minWidth) || 0, lead.flexGrow]
    style.remove()
    expect(minWidth).toBeLessThanOrEqual(44)
    expect(grow).toBe('0')
  })

  test('from 700 px the lead shows the title and the layout control is the radiogroup', () => {
    mount({ wide: true })
    expect(root.querySelector('.mg-title')!.textContent).toBe('attention')
    expect(root.querySelector('[role="radiogroup"][aria-label="Layout"]')).not.toBeNull()
    expect(root.querySelector('.mg-toolbar-tools button[aria-label="Notes"]')).toBeNull()
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
