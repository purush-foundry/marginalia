import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySidecar, type LibraryIndex, type Sidecar } from '../types'

const lib = vi.hoisted(() => ({ sidecars: {} as Record<string, Sidecar> }))
vi.mock('../drive/library', async () => {
  const { signal } = await import('@preact/signals')
  const { emptySidecar: empty } = await import('../types')
  return {
    library: signal(null),
    sidecarRevision: signal(0),
    loadSidecar: async (id: string) => lib.sidecars[id] ?? empty(id, `${id}.pdf`, 1),
    saveSidecar: vi.fn((id: string, s: Sidecar) => {
      lib.sidecars[id] = s
    }),
  }
})
vi.mock('./layout', async (importOriginal) => {
  const real = await importOriginal<typeof import('./layout')>()
  return {
    ...real,
    layout: (g: { nodes: { pdfId: string }[] }) =>
      Object.fromEntries(
        g.nodes
          .map((n) => n.pdfId)
          .sort()
          .map((id, i) => [id, { x: 100 + 200 * i, y: 300 }]),
      ),
  }
})

import { library, saveSidecar } from '../drive/library'
import { MapView } from './MapView'

const TITLES: Record<string, string> = {
  a: 'Attention Is All You Need',
  b: 'Diffusion Policy Visuomotor Learning',
  c: 'Flow Matching For Generative Modeling',
}

function seed(topics: Record<string, string[]> = {}) {
  const papers: LibraryIndex['papers'] = {}
  for (const id of Object.keys(TITLES)) {
    papers[id] = { id, name: `${TITLES[id]}.pdf`, mimeType: 'application/pdf', parents: [], modifiedTime: '', version: '1' }
    lib.sidecars[id] = { ...emptySidecar(id, `${id}.pdf`, 1), ...(topics[id] ? { topics: { ids: topics[id], updatedAt: 1 } } : {}) }
  }
  ;(library as unknown as { value: LibraryIndex | null }).value = { rootId: 'r', rootName: 'r', folders: {}, papers, sidecars: {}, syncedAt: 0 }
}

let root: HTMLElement

beforeEach(() => {
  lib.sidecars = {}
  vi.mocked(saveSidecar).mockClear()
  root = document.createElement('div')
  document.body.append(root)
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
})

const dot = (id: string) => root.querySelector<SVGCircleElement>(`circle.mg-map-dot[data-id="${id}"]`)!
const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!

function pointer(target: Element, type: string, x = 0, y = 0, pointerType = 'mouse') {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType, pointerId: 1, clientX: x, clientY: y, button: 0 }))
}

async function tap(id: string) {
  await act(async () => {
    pointer(dot(id), 'pointerdown')
    pointer(dot(id), 'pointerup')
  })
}

async function click(label: string) {
  await act(async () => button(label).click())
}

async function mount(topics?: Record<string, string[]>) {
  seed(topics)
  await act(async () => render(<MapView />, root))
  await vi.waitFor(() => expect(root.querySelectorAll('circle.mg-map-dot')).toHaveLength(3))
}

const lastSave = (id: string) => vi.mocked(saveSidecar).mock.calls.filter(([p]) => p === id).at(-1)?.[1]

describe('MapView', () => {
  it('renders one node per paper', async () => {
    await mount()
    expect(['a', 'b', 'c'].map((id) => dot(id).getAttribute('cx'))).toEqual(['100', '300', '500'])
  })

  it('opens the card with the title when a node is tapped', async () => {
    await mount()
    await tap('b')
    expect(root.querySelector('.mg-map-card h2')!.textContent).toBe(TITLES.b)
  })

  it('saves the gist to the sidecar on blur', async () => {
    await mount()
    await tap('a')
    const area = root.querySelector<HTMLTextAreaElement>('.mg-map-card textarea')!
    await act(async () => {
      area.focus()
      area.value = 'the transformer'
      area.dispatchEvent(new Event('input', { bubbles: true }))
      area.blur()
    })
    await vi.waitFor(() => expect(lastSave('a')?.gist).toEqual({ text: 'the transformer', updatedAt: expect.any(Number) }))
  })

  it('stores a directed link on the first paper', async () => {
    await mount()
    await tap('c')
    await click('Link')
    expect(root.querySelector('.mg-map-hint')).not.toBeNull()
    await tap('a')
    await click('builds on')
    await act(async () => {
      const note = root.querySelector<HTMLInputElement>('.mg-map-linksheet input')!
      note.value = 'swaps the head'
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Save')
    await vi.waitFor(() =>
      expect(lastSave('c')?.links).toEqual([expect.objectContaining({ kind: 'link', to: 'a', rel: 'builds-on', note: 'swaps the head' })]),
    )
    expect(lastSave('a')).toBeUndefined()
  })

  it('stores a symmetric link on the smaller id', async () => {
    await mount()
    await tap('c')
    await click('Link')
    await tap('a')
    await click('related')
    await click('Save')
    await vi.waitFor(() => expect(lastSave('a')?.links).toEqual([expect.objectContaining({ to: 'c', rel: 'related' })]))
    expect(lastSave('c')).toBeUndefined()
  })

  it('a topic chip dims non-matching nodes without moving them', async () => {
    await mount({ a: ['vision'], b: ['language'], c: ['vision'] })
    const before = ['a', 'b', 'c'].map((id) => dot(id).getAttribute('cx'))
    await click('language')
    const opacity = (id: string) => dot(id).closest('g.mg-map-node')!.getAttribute('opacity')
    expect(opacity('a')).toBe('0.15')
    expect(opacity('c')).toBe('0.15')
    expect(opacity('b')).toBe('1')
    expect(['a', 'b', 'c'].map((id) => dot(id).getAttribute('cx'))).toEqual(before)
  })

  it('a mouse drag on a node moves it and pins it where it is dropped', async () => {
    await mount()
    const canvas = root.querySelector('svg.mg-map-canvas')!
    const cx = Number(dot('b').getAttribute('cx'))
    await act(async () => {
      pointer(dot('b'), 'pointerdown', 10, 10)
      pointer(canvas, 'pointermove', 60, 10)
    })
    const moved = Number(dot('b').getAttribute('cx'))
    expect(moved).toBeGreaterThan(cx)
    await act(async () => pointer(canvas, 'pointerup', 60, 10))
    await vi.waitFor(() => expect(lastSave('b')?.pin).toEqual({ x: moved, y: 300, updatedAt: expect.any(Number) }))
  })

  it('a quick touch drag on a node pans instead of pinning', async () => {
    await mount()
    const canvas = root.querySelector('svg.mg-map-canvas')!
    const g = canvas.querySelector(':scope > g')!
    const before = g.getAttribute('transform')
    await act(async () => {
      pointer(dot('b'), 'pointerdown', 10, 10, 'touch')
      pointer(canvas, 'pointermove', 60, 10, 'touch')
      pointer(canvas, 'pointerup', 60, 10, 'touch')
    })
    expect(g.getAttribute('transform')).not.toBe(before)
    expect(lastSave('b')).toBeUndefined()
  })

  it('search dims the papers that do not match', async () => {
    await mount()
    await act(async () => {
      const input = root.querySelector<HTMLInputElement>('input[type="search"]')!
      input.value = 'flow'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const opacity = (id: string) => dot(id).closest('g.mg-map-node')!.getAttribute('opacity')
    expect(['a', 'b', 'c'].map(opacity)).toEqual(['0.15', '0.15', '1'])
  })

  it('Esc leaves link mode and brings the card back', async () => {
    await mount()
    await tap('a')
    await click('Link')
    expect(root.querySelector('.mg-map-card')).toBeNull()
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(root.querySelector('.mg-map-hint')).toBeNull()
    expect(root.querySelector('.mg-map-card h2')!.textContent).toBe(TITLES.a)
  })
})
