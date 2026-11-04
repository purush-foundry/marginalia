import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PRESET_COLORS } from '../ink/color.ts'
import type { ItemRef, LassoItem } from '../ink/lasso.ts'
import { DEFAULT_LASSO_SETTINGS, fingerDraws, lassoSettings, penActivity, tool } from '../ink/tools.ts'
import { clipboard, copyItems } from './clipboard.ts'
import { LassoLayer } from './Lasso.tsx'
import { emptyNotebook, type PageContent } from './model.ts'
import { createNotebookStore, type NotebookStore } from './notebookStore.ts'

// The page is 200 CSS px wide, so one page-width unit is 200 px; happy-dom lays the page out at (0, 0).
const CSS_W = 200
const ASPECT = 1.5
const TEXT_H = 0.05

interface P {
  x: number
  y: number
  type?: string
  id?: number
}

function pointer(name: string, p: P): PointerEvent {
  const type = p.type ?? 'pen'
  return new PointerEvent(name, {
    bubbles: true,
    cancelable: true,
    pointerType: type,
    pointerId: p.id ?? (type === 'pen' ? 2 : type === 'mouse' ? 1 : 10),
    isPrimary: p.id === undefined,
    clientX: p.x,
    clientY: p.y,
    pressure: 0.5,
    button: 0,
    buttons: name === 'pointerup' ? 0 : 1,
  })
}

let host: HTMLElement
let store: NotebookStore
let moves: [number, number, boolean][]
let scales: [{ x: number; y: number }, number, boolean][]
let selected: ItemRef[][]
let textId: string
let imageId: string

// The lasso view of a page: strokes by their points, text boxes TEXT_H tall, images by their aspect.
function lassoItems(c: PageContent): LassoItem[] {
  return [
    ...c.strokes.map((s) => ({ kind: 'stroke' as const, id: s.id, points: s.points })),
    ...c.texts.map((t) => ({ kind: 'text' as const, id: t.id, box: { ...t.box, h: TEXT_H } })),
    ...c.images.map((m) => ({ kind: 'image' as const, id: m.id, box: { ...m.box, h: m.box.w * m.aspect } })),
  ]
}

function Harness({ objects, skip }: { objects: boolean; skip?: (t: Element) => boolean }) {
  const [selection, setSelection] = useState<ItemRef[]>([])
  const content = store.content.value.get('page-1')!
  const select = (refs: ItemRef[]) => {
    selected.push(refs)
    setSelection(refs)
  }
  const remove = () => {
    store.removeItems(selection)
    select([])
  }
  return (
    <div class="page">
      <div class="paper" />
      <span class="text-span">PDF text</span>
      <LassoLayer
        items={lassoItems(content)}
        cssW={CSS_W}
        aspect={ASPECT}
        rect={lassoSettings.value.rect}
        objects={objects}
        selection={selection}
        skip={skip}
        onSelect={select}
        onMove={(dx, dy, _client, done) => {
          moves.push([dx, dy, done])
          if (done) store.moveItems(selection, dx, dy)
        }}
        onScale={(origin, k, done) => {
          scales.push([origin, k, done])
          if (done) store.scaleItems(selection, origin, k)
        }}
        menu={{
          colors: PRESET_COLORS,
          onCut: () => {
            copyItems(content, selection)
            remove()
          },
          onCopy: () => copyItems(content, selection),
          onDuplicate: () => select(store.duplicateItems(selection, 0.02)),
          onDelete: remove,
          onRecolor: (color) => store.recolorItems(selection, color),
          onFront: () => store.bringToFront(selection),
          onBack: () => store.sendToBack(selection),
        }}
      />
    </div>
  )
}

async function mount(objects = true, skip?: (t: Element) => boolean) {
  await act(() => {
    render(<Harness objects={objects} skip={skip} />, host)
  })
}

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector(sel) as T | null
const paper = () => q('.paper')!
const last = () => selected[selected.length - 1] ?? []
const ids = (refs: ItemRef[]) => refs.map((r) => r.id)

// Sends a pointer down, moves and up to `target` inside act.
async function drag(target: Element, points: [number, number][], type = 'pen') {
  const [first, ...rest] = points
  const end = rest.length ? rest[rest.length - 1] : first
  const down = pointer('pointerdown', { x: first[0], y: first[1], type })
  await act(() => {
    target.dispatchEvent(down)
  })
  for (const [x, y] of rest) {
    await act(() => {
      target.dispatchEvent(pointer('pointermove', { x, y, type }))
    })
  }
  await act(() => {
    target.dispatchEvent(pointer('pointerup', { x: end[0], y: end[1], type }))
  })
  return down
}

async function key(init: KeyboardEventInit, target: EventTarget = document) {
  await act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

// A loop in CSS px around stroke 'a' and the text box.
const LOOP: [number, number][] = [[30, 30], [150, 30], [150, 120], [30, 120], [30, 32]]

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  tool.value = 'lasso'
  lassoSettings.value = DEFAULT_LASSO_SETTINGS
  fingerDraws.value = false
  penActivity.down = false
  penActivity.downOn = null
  penActivity.lastUp = -Infinity
  clipboard.value = null
  moves = []
  scales = []
  selected = []
  store = createNotebookStore(emptyNotebook('pdf', 'a.pdf', 1), vi.fn())
  store.addStroke({ id: 'a', page: 'page-1', tool: 'pen', pen: 'ball', color: '#000', width: 0.004, points: [0.2, 0.2, 0.5, 0.3, 0.3, 0.5], createdAt: 1, updatedAt: 1 })
  store.addStroke({ id: 'far', page: 'page-1', tool: 'pen', pen: 'ball', color: '#000', width: 0.004, points: [0.9, 1.2, 0.5, 0.95, 1.3, 0.5], createdAt: 1, updatedAt: 1 })
  textId = store.addText({ page: 'page-1', box: { x: 0.5, y: 0.5, w: 0.2 }, text: 'hi', size: 'm', color: '#000' }).id
  imageId = store.addImage({ page: 'page-1', src: 'data:x', aspect: 0.5, box: { x: 0.1, y: 0.8, w: 0.2 } }).id
})

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  render(null, host)
  host.remove()
  vi.restoreAllMocks()
})

test('a pen loop selects strokes and objects and opens the menu above the selection', async () => {
  // Stroke 'a' and the text box sit 50 px lower here, leaving room for the menu above them.
  store.moveItems([{ kind: 'stroke', id: 'a' }, { kind: 'text', id: textId }], 0, 0.25)
  const loop: [number, number][] = [[30, 80], [150, 80], [150, 165], [30, 165], [30, 82]]
  await mount()
  const down = pointer('pointerdown', { x: 30, y: 80 })
  await act(() => {
    paper().dispatchEvent(down)
  })
  expect(down.defaultPrevented).toBe(true)
  for (const [x, y] of loop.slice(1)) {
    await act(() => {
      paper().dispatchEvent(pointer('pointermove', { x, y }))
    })
  }
  expect(q('path.mg-lasso-loop')).not.toBeNull()
  expect(q('.mg-lasso-frame')).toBeNull()
  await act(() => {
    paper().dispatchEvent(pointer('pointerup', { x: 30, y: 82 }))
  })

  expect(q('path.mg-lasso-loop')).toBeNull()
  expect(ids(last())).toEqual(['a', textId])
  const frame = q('.mg-lasso-frame')!
  expect(parseFloat(frame.style.left)).toBeLessThanOrEqual(40)
  expect(parseFloat(frame.style.left) + parseFloat(frame.style.width)).toBeGreaterThanOrEqual(140)
  expect(parseFloat(frame.style.top)).toBeLessThanOrEqual(90)
  expect(parseFloat(frame.style.top) + parseFloat(frame.style.height)).toBeGreaterThanOrEqual(160)
  expect(host.querySelectorAll('.mg-lasso-handle[data-corner]')).toHaveLength(4)

  const menu = q('[role="menu"][aria-label="Selection"]')!
  const slot = menu.parentElement!
  expect(slot.classList.contains('mg-lasso-menu')).toBe(true)
  expect(slot.dataset.side).toBe('above')
  expect(parseFloat(slot.style.top)).toBe(parseFloat(frame.style.top))
  expect([...menu.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Cut', 'Copy', 'Duplicate', 'Delete', 'Recolor', 'Front', 'Back'])

  // Pressing a menu button with the pen leaves the selection alone.
  const recolor = [...menu.querySelectorAll('button')].find((b) => b.textContent === 'Recolor')!
  await drag(recolor, [[100, 0]])
  await act(() => {
    recolor.click()
  })
  expect(ids(last())).toEqual(['a', textId])
  const red = menu.querySelector<HTMLButtonElement>('button[aria-label="#d33a2c"]')!
  await act(() => {
    red.click()
  })
  const c = store.content.value.get('page-1')!
  expect(c.strokes.find((s) => s.id === 'a')!.color).toBe('#d33a2c')
  expect(c.texts[0].color).toBe('#d33a2c')
  expect(c.strokes.find((s) => s.id === 'far')!.color).toBe('#000')

  // Under another tool the layer draws nothing and leaves the pen alone.
  tool.value = 'pen'
  await act(() => {})
  expect(q('.mg-lasso-frame')).toBeNull()
  const penDown = await drag(paper(), LOOP)
  expect(penDown.defaultPrevented).toBe(false)
  expect(ids(last())).toEqual(['a', textId])
})

test('a selection near the top of the page opens the menu below it', async () => {
  store.addStroke({ id: 'top', page: 'page-1', tool: 'pen', pen: 'ball', color: '#000', width: 0.004, points: [0.5, 0.09, 0.5, 0.6, 0.1, 0.5], createdAt: 1, updatedAt: 1 })
  await mount()
  await drag(paper(), [[90, 2], [130, 2], [130, 30], [90, 30]])
  expect(ids(last())).toEqual(['top'])
  const frame = q('.mg-lasso-frame')!
  expect(parseFloat(frame.style.top)).toBeCloseTo(10)
  const slot = q('.mg-lasso-menu')!
  expect(slot.dataset.side).toBe('below')
  expect(parseFloat(slot.style.top)).toBeCloseTo(parseFloat(frame.style.top) + parseFloat(frame.style.height))
})

test('a tap on an object with the Lasso selects it', async () => {
  await mount()
  await drag(paper(), [[40, 170]])
  expect(selected).toEqual([[{ kind: 'image', id: imageId }]])
  expect(q('.mg-lasso-frame')).not.toBeNull()

  await drag(paper(), [[120, 105]], 'mouse')
  expect(last()).toEqual([{ kind: 'text', id: textId }])

  await drag(paper(), [[30, 165]], 'touch')
  expect(last()).toEqual([{ kind: 'image', id: imageId }])
})

test('dragging inside the selection moves it and reports done once', async () => {
  await mount()
  await drag(paper(), [[40, 170]])
  const frame = q('.mg-lasso-frame')!
  await drag(frame, [[40, 170], [42, 171]])
  expect(moves).toEqual([])

  await act(() => {
    frame.dispatchEvent(pointer('pointerdown', { x: 40, y: 170 }))
  })
  await act(() => {
    frame.dispatchEvent(pointer('pointermove', { x: 60, y: 190 }))
  })
  await act(() => {
    frame.dispatchEvent(pointer('pointermove', { x: 80, y: 210 }))
  })
  expect(q('.mg-lasso-frame')!.style.transform).toBe('translate(40px, 40px)')
  expect(q('[role="menu"]')).toBeNull()
  await act(() => {
    frame.dispatchEvent(pointer('pointerup', { x: 80, y: 210 }))
  })

  expect(moves.map(([, , done]) => done)).toEqual([false, false, true])
  expect(moves[0][0]).toBeCloseTo(0.1)
  expect(moves[0][1]).toBeCloseTo(0.1)
  expect(moves[2][0]).toBeCloseTo(0.2)
  expect(moves[2][1]).toBeCloseTo(0.2)
  const box = store.content.value.get('page-1')!.images[0].box
  expect(box.x).toBeCloseTo(0.3)
  expect(box.y).toBeCloseTo(1)
  expect(q('.mg-lasso-frame')!.style.transform).toBe('')
  expect(q('[role="menu"]')).not.toBeNull()
  expect(last()).toEqual([{ kind: 'image', id: imageId }])
})

test('a finger moves the selection only past the slop and still scrolls outside it', async () => {
  await mount()
  await drag(paper(), [[40, 170]], 'touch')
  const frame = q('.mg-lasso-frame')!
  const before = store.doc.value

  await drag(frame, [[40, 170], [44, 170], [40, 170]], 'touch')
  expect(moves).toEqual([])
  expect(store.doc.value).toBe(before)
  const box = () => store.content.value.get('page-1')!.images[0].box
  expect(box().x).toBeCloseTo(0.1)

  await drag(frame, [[40, 170], [60, 170]], 'touch')
  expect(moves.map(([, , done]) => done)).toEqual([false, true])
  expect(box().x).toBeCloseTo(0.2)

  const outside = await drag(paper(), [[150, 20], [150, 120]], 'touch')
  expect(outside.defaultPrevented).toBe(false)
  expect(moves).toHaveLength(2)
  expect(q('path.mg-lasso-loop')).toBeNull()
})

test('a corner handle scales about the opposite corner', async () => {
  await mount()
  await drag(paper(), [[40, 170]])
  const handle = q('.mg-lasso-handle[data-corner="se"]')!

  await drag(handle, [[60, 180], [100, 200]])
  expect(scales.map(([, , done]) => done)).toEqual([false, true])
  const [origin, k] = scales[1]
  expect(origin.x).toBeCloseTo(0.1)
  expect(origin.y).toBeCloseTo(0.8)
  expect(k).toBeCloseTo(2)
  const box = store.content.value.get('page-1')!.images[0].box
  expect(box.x).toBeCloseTo(0.1)
  expect(box.y).toBeCloseTo(0.8)
  expect(box.w).toBeCloseTo(0.4)
  expect(moves).toEqual([])

  await drag(q('.mg-lasso-handle[data-corner="nw"]')!, [[20, 160], [60, 180]])
  const [nwOrigin, nwK] = scales[3]
  expect(nwOrigin.x).toBeCloseTo(0.5)
  expect(nwOrigin.y).toBeCloseTo(1)
  expect(nwK).toBeCloseTo(0.5)
})

test('rectangular mode selects by a dragged box', async () => {
  lassoSettings.value = { rect: true }
  await mount()
  await act(() => {
    paper().dispatchEvent(pointer('pointerdown', { x: 30, y: 30 }))
  })
  await act(() => {
    paper().dispatchEvent(pointer('pointermove', { x: 50, y: 90 }))
  })
  await act(() => {
    paper().dispatchEvent(pointer('pointermove', { x: 70, y: 70 }))
  })
  expect(q('path.mg-lasso-loop')!.getAttribute('d')).toBe('M30 30L70 30L70 70L30 70Z')
  await act(() => {
    paper().dispatchEvent(pointer('pointerup', { x: 70, y: 70 }))
  })
  expect(last()).toEqual([{ kind: 'stroke', id: 'a' }])
})

test('Esc or a tap outside clears the selection', async () => {
  await mount()
  await drag(paper(), LOOP)
  expect(ids(last())).toEqual(['a', textId])
  await key({ key: 'Escape' })
  expect(last()).toEqual([])
  expect(q('.mg-lasso-frame')).toBeNull()

  await drag(paper(), LOOP)
  await drag(paper(), [[180, 280]])
  expect(last()).toEqual([])

  await drag(paper(), LOOP)
  await drag(paper(), [[180, 280]], 'touch')
  expect(last()).toEqual([])
})

test('⌘C copies, ⌘X cuts and Delete removes the selection', async () => {
  await mount()
  await drag(paper(), LOOP)

  // A native text selection keeps its own copy and delete keys.
  const range = document.createRange()
  range.selectNodeContents(q('.text-span')!)
  document.getSelection()!.addRange(range)
  const nativeCopy = new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true })
  await act(() => {
    document.dispatchEvent(nativeCopy)
  })
  await key({ key: 'Backspace' })
  expect(nativeCopy.defaultPrevented).toBe(false)
  expect(clipboard.value).toBeNull()
  expect(store.content.value.get('page-1')!.strokes).toHaveLength(2)
  document.getSelection()!.removeAllRanges()

  await key({ key: 'c', metaKey: true })
  expect(clipboard.value!.strokes).toHaveLength(1)
  expect(clipboard.value!.texts.map((t) => t.text)).toEqual(['hi'])

  // Keys typed into a text field are left to it.
  const input = document.createElement('input')
  host.appendChild(input)
  await key({ key: 'Delete' }, input)
  await key({ key: 'Escape' }, input)
  expect(ids(last())).toEqual(['a', textId])
  input.remove()

  clipboard.value = null
  await key({ key: 'x', ctrlKey: true })
  expect(clipboard.value!.strokes).toHaveLength(1)
  const c = store.content.value.get('page-1')!
  expect(c.strokes.map((s) => s.id)).toEqual(['far'])
  expect(c.texts).toEqual([])
  expect(last()).toEqual([])

  await drag(paper(), [[40, 170]])
  await key({ key: 'Delete' })
  expect(store.content.value.get('page-1')!.images).toEqual([])
  await drag(paper(), [[20, 230], [199, 230], [199, 299], [20, 299]])
  expect(ids(last())).toEqual(['far'])
  await key({ key: 'Backspace' })
  expect(store.content.value.get('page-1')!.strokes).toEqual([])
})

test('with objects false and skip on text spans, only ink is selected and text drags pass through', async () => {
  for (const draws of [false, true]) {
    fingerDraws.value = draws
    selected = []
    await act(() => {
      render(null, host)
    })
    await mount(false, (t) => t.closest('.text-span') !== null)
    await drag(paper(), [[40, 170]])
    expect(selected).toEqual([])
    await drag(paper(), [[5, 5], [198, 5], [198, 298], [5, 298]])
    expect(selected.map(ids)).toEqual([['a', 'far']])

    const span = q('.text-span')!
    const reached = vi.fn()
    span.addEventListener('pointerdown', reached)
    const down = await drag(span, [[100, 100], [150, 150]], 'mouse')
    expect(down.defaultPrevented).toBe(false)
    expect(reached).toHaveBeenCalledTimes(1)
    expect(q('path.mg-lasso-loop')).toBeNull()
    expect(moves).toEqual([])
    expect(selected).toHaveLength(1)
  }
  // With Draw with finger on, the page stops panning under the Lasso and the layer stays out of hit testing.
  expect(q('.page')!.style.touchAction).toBe('none')
  expect(q('.mg-lasso')!.getAttributeNames().sort()).toEqual(['class', 'style'])
  await act(() => {
    tool.value = 'pen'
  })
  expect(q('.page')!.style.touchAction).toBe('')
})

test('a finger never draws a loop', async () => {
  await mount()
  const down = pointer('pointerdown', { x: 30, y: 30, type: 'touch' })
  await act(() => {
    paper().dispatchEvent(down)
  })
  for (const [x, y] of LOOP.slice(1)) {
    await act(() => {
      paper().dispatchEvent(pointer('pointermove', { x, y, type: 'touch' }))
    })
  }
  expect(down.defaultPrevented).toBe(false)
  expect(q('path.mg-lasso-loop')).toBeNull()
  await act(() => {
    paper().dispatchEvent(pointer('pointerup', { x: 30, y: 32, type: 'touch' }))
  })
  expect(selected).toEqual([])

  // A palm on the page while the pen is down neither taps nor clears.
  penActivity.down = true
  await drag(paper(), [[40, 170]], 'touch')
  expect(selected).toEqual([])
  penActivity.down = false

  // A two-finger tap is not a tap on an object.
  await act(() => {
    paper().dispatchEvent(pointer('pointerdown', { x: 40, y: 170, type: 'touch' }))
    paper().dispatchEvent(pointer('pointerdown', { x: 120, y: 105, type: 'touch', id: 11 }))
    paper().dispatchEvent(pointer('pointerup', { x: 40, y: 170, type: 'touch' }))
    paper().dispatchEvent(pointer('pointerup', { x: 120, y: 105, type: 'touch', id: 11 }))
  })
  expect(selected).toEqual([])

  // With Draw with finger on, the finger loops like the pen.
  fingerDraws.value = true
  await drag(paper(), LOOP, 'touch')
  expect(ids(last())).toEqual(['a', textId])
})
