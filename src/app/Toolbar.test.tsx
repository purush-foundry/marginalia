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

function mount(): ToolbarProps {
  const props: ToolbarProps = {
    title: 'attention',
    store: createAnnotationStore(emptySidecar('p1', 'a.pdf', 0), () => {}),
    areaArmed: signal(false),
    penCapable: false,
    finePointer: true,
    nightMode: false,
    threadCount: 0,
    sidebarOpen: false,
    onBack: vi.fn(),
    onToggleNight: vi.fn(),
    onToggleSidebar: vi.fn(),
    onThreads: vi.fn(),
    onExport: vi.fn(),
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
})
