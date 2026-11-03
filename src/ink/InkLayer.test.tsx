import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InkStroke } from '../types.ts'
import { InkLayer, type InkLayerProps } from './InkLayer.tsx'
import { fingerDraws, mouseDraws, penColor, penTool, penWidth } from './tools.ts'

// happy-dom's PointerEvent honours pointerType, pressure and coalescedEvents from the init dict.
interface P {
  x: number
  y: number
  type?: string
  id?: number
  pressure?: number
  coalesced?: { x: number; y: number; pressure?: number }[]
}

function pointer(name: string, p: P): PointerEvent {
  const type = p.type ?? 'pen'
  const id = p.id ?? (type === 'pen' ? 2 : type === 'mouse' ? 1 : 10)
  const init = (q: { x: number; y: number; pressure?: number }): PointerEventInit => ({
    bubbles: true,
    cancelable: true,
    pointerType: type,
    pointerId: id,
    clientX: q.x,
    clientY: q.y,
    pressure: q.pressure ?? 0.5,
    button: 0,
    buttons: name === 'pointerup' ? 0 : 1,
  })
  return new PointerEvent(name, {
    ...init(p),
    coalescedEvents: p.coalesced?.map((q) => new PointerEvent(name, init(q))),
  })
}

// happy-dom's Touch has no touchType, so tests pass plain touch-like objects.
function touch(name: string, touches: { id: number; x: number; y: number; touchType?: string }[], remaining = touches) {
  const asTouch = (t: { id: number; x: number; y: number; touchType?: string }) =>
    ({ identifier: t.id, clientX: t.x, clientY: t.y, touchType: t.touchType ?? 'direct' }) as unknown as Touch
  return new TouchEvent(name, {
    bubbles: true,
    cancelable: true,
    changedTouches: touches.map(asTouch),
    touches: remaining.map(asTouch),
  })
}

let host: HTMLElement
let added: InkStroke[]
let erased: string[]
let clock: number

async function mount(extra: Partial<InkLayerProps> = {}): Promise<HTMLElement> {
  const props: InkLayerProps = {
    page: 3,
    cssW: 200,
    cssH: 400,
    strokes: [],
    onAddStroke: (s) => added.push(s),
    onEraseStroke: (id) => erased.push(id),
    ...extra,
  }
  await act(() => {
    render(<InkLayer {...props} />, host)
  })
  return host.firstElementChild as HTMLElement
}

function stroke(root: HTMLElement, type: string, from: [number, number], to: [number, number]) {
  root.dispatchEvent(pointer('pointerdown', { type, x: from[0], y: from[1] }))
  root.dispatchEvent(pointer('pointermove', { type, x: to[0], y: to[1] }))
  root.dispatchEvent(pointer('pointerup', { type, x: to[0], y: to[1] }))
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  added = []
  erased = []
  clock = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  penTool.value = 'pen'
  penColor.value = '#d33a2c'
  penWidth.value = 0.004
  mouseDraws.value = false
  fingerDraws.value = false
})

afterEach(() => {
  render(null, host)
  host.remove()
  vi.restoreAllMocks()
})

describe('InkLayer pen', () => {
  it('commits a stroke with normalised points on pen down/move/up', async () => {
    penColor.value = '#123456'
    penWidth.value = 0.01
    const root = await mount()
    root.dispatchEvent(pointer('pointerdown', { x: 20, y: 40, pressure: 0.3 }))
    root.dispatchEvent(pointer('pointermove', { x: 100, y: 200, pressure: 0.6 }))
    expect(added).toHaveLength(0)
    root.dispatchEvent(pointer('pointerup', { x: 100, y: 200, pressure: 0 }))

    expect(added).toHaveLength(1)
    const s = added[0]
    expect(s).toMatchObject({ kind: 'ink', page: 3, color: '#123456', width: 0.01, tool: 'pen' })
    expect(s.points).toEqual([0.1, 0.1, 0.3, 0.5, 0.5, 0.6])
    expect(s.id).toBeTruthy()
    expect(s.createdAt).toBe(clock)
    expect(s.updatedAt).toBe(clock)
  })

  it('records every coalesced sample of a move', async () => {
    const root = await mount()
    root.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, pressure: 0.2 }))
    root.dispatchEvent(
      pointer('pointermove', {
        x: 100,
        y: 200,
        coalesced: [
          { x: 50, y: 100, pressure: 0.4 },
          { x: 100, y: 200, pressure: 0.6 },
        ],
      }),
    )
    root.dispatchEvent(pointer('pointerup', { x: 100, y: 200 }))
    expect(added[0].points).toEqual([0, 0, 0.2, 0.25, 0.25, 0.4, 0.5, 0.5, 0.6])
  })

  it('discards the live stroke on pointercancel', async () => {
    const root = await mount()
    root.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    root.dispatchEvent(pointer('pointermove', { x: 100, y: 200 }))
    root.dispatchEvent(pointer('pointercancel', { x: 100, y: 200 }))
    root.dispatchEvent(pointer('pointerup', { x: 100, y: 200 }))
    expect(added).toHaveLength(0)
  })

  it('ignores the pen and marks the layer pass-through while the tool is select', async () => {
    const root = await mount()
    await act(() => {
      penTool.value = 'select'
    })
    expect(root.dataset.tool).toBe('select')
    stroke(root, 'pen', [20, 40], [100, 200])
    expect(added).toHaveLength(0)
  })

  it('renders committed strokes as SVG paths and skips deleted ones', async () => {
    const base = { kind: 'ink', page: 3, color: '#00f', width: 0.01, tool: 'pen', createdAt: 1, updatedAt: 1 } as const
    const root = await mount({
      strokes: [
        { ...base, id: 'a', points: [0.1, 0.1, 0.5, 0.5, 0.5, 0.5] },
        { ...base, id: 'b', points: [0.2, 0.2, 0.5, 0.6, 0.6, 0.5], deleted: true },
      ],
    })
    const paths = root.querySelectorAll('svg path')
    expect(paths).toHaveLength(1)
    expect(paths[0].getAttribute('fill')).toBe('#00f')
    expect(paths[0].getAttribute('d')).toMatch(/^M/)
  })
})

describe('InkLayer touch', () => {
  it('ignores touch by default', async () => {
    const root = await mount()
    stroke(root, 'touch', [20, 40], [100, 200])
    expect(added).toHaveLength(0)
  })

  it('draws with a finger when fingerDraws is on', async () => {
    fingerDraws.value = true
    const root = await mount()
    stroke(root, 'touch', [20, 40], [100, 200])
    expect(added).toHaveLength(1)
    expect(added[0].points).toEqual([0.1, 0.1, 0.5, 0.5, 0.5, 0.5])
  })

  it('ignores touch while a pen is down and for 500 ms after it lifts', async () => {
    fingerDraws.value = true
    const root = await mount()
    root.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    stroke(root, 'touch', [150, 300], [180, 350])
    root.dispatchEvent(pointer('pointermove', { x: 100, y: 200 }))
    root.dispatchEvent(pointer('pointerup', { x: 100, y: 200 }))
    expect(added).toHaveLength(1)

    clock += 499
    stroke(root, 'touch', [150, 300], [180, 350])
    expect(added).toHaveLength(1)

    clock += 2
    stroke(root, 'touch', [150, 300], [180, 350])
    expect(added).toHaveLength(2)
  })

  it('drops a finger stroke when the pen lands and draws the pen stroke instead', async () => {
    fingerDraws.value = true
    const root = await mount()
    root.dispatchEvent(pointer('pointerdown', { type: 'touch', x: 150, y: 300 }))
    root.dispatchEvent(pointer('pointermove', { type: 'touch', x: 160, y: 320 }))
    stroke(root, 'pen', [20, 40], [100, 200])
    root.dispatchEvent(pointer('pointerup', { type: 'touch', x: 160, y: 320 }))
    expect(added).toHaveLength(1)
    expect(added[0].points).toEqual([0.1, 0.1, 0.5, 0.5, 0.5, 0.5])
  })

  it('drops a finger stroke when a second finger lands', async () => {
    fingerDraws.value = true
    const root = await mount()
    root.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 10, x: 20, y: 40 }))
    root.dispatchEvent(pointer('pointermove', { type: 'touch', id: 10, x: 60, y: 80 }))
    root.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 11, x: 120, y: 80 }))
    root.dispatchEvent(pointer('pointerup', { type: 'touch', id: 10, x: 60, y: 80 }))
    root.dispatchEvent(pointer('pointerup', { type: 'touch', id: 11, x: 120, y: 80 }))
    expect(added).toHaveLength(0)
  })

  it('prevents default only for stylus touches', async () => {
    const root = await mount()
    const stylusStart = touch('touchstart', [{ id: 1, x: 10, y: 10, touchType: 'stylus' }])
    const stylusMove = touch('touchmove', [{ id: 1, x: 20, y: 20, touchType: 'stylus' }])
    const fingerStart = touch('touchstart', [{ id: 2, x: 10, y: 10 }])
    const fingerMove = touch('touchmove', [{ id: 2, x: 10, y: 60 }])
    for (const e of [stylusStart, stylusMove, fingerStart, fingerMove]) root.dispatchEvent(e)
    expect(stylusStart.defaultPrevented).toBe(true)
    expect(stylusMove.defaultPrevented).toBe(true)
    expect(fingerStart.defaultPrevented).toBe(false)
    expect(fingerMove.defaultPrevented).toBe(false)
  })

  it('dispatches marginalia:undo on a two-finger double tap', async () => {
    const root = await mount()
    const undo = vi.fn()
    document.addEventListener('marginalia:undo', undo)
    const two = [
      { id: 1, x: 50, y: 50 },
      { id: 2, x: 120, y: 60 },
    ]
    const tap = () => {
      root.dispatchEvent(touch('touchstart', two))
      clock += 80
      root.dispatchEvent(touch('touchend', two, []))
    }
    tap()
    expect(undo).not.toHaveBeenCalled()
    clock += 150
    tap()
    expect(undo).toHaveBeenCalledTimes(1)
    document.removeEventListener('marginalia:undo', undo)
  })

  it('does not undo on a two-finger pan or a single two-finger tap', async () => {
    const root = await mount()
    const undo = vi.fn()
    document.addEventListener('marginalia:undo', undo)
    const two = [
      { id: 1, x: 50, y: 50 },
      { id: 2, x: 120, y: 60 },
    ]
    const moved = [
      { id: 1, x: 50, y: 150 },
      { id: 2, x: 120, y: 160 },
    ]
    root.dispatchEvent(touch('touchstart', two))
    root.dispatchEvent(touch('touchmove', moved))
    root.dispatchEvent(touch('touchend', moved, []))
    clock += 150
    root.dispatchEvent(touch('touchstart', two))
    root.dispatchEvent(touch('touchend', two, []))
    clock += 1000
    root.dispatchEvent(touch('touchstart', two))
    root.dispatchEvent(touch('touchend', two, []))
    expect(undo).not.toHaveBeenCalled()
    document.removeEventListener('marginalia:undo', undo)
  })
})

describe('InkLayer mouse', () => {
  it('draws only when mouseDraws is latched', async () => {
    const root = await mount()
    stroke(root, 'mouse', [20, 40], [100, 200])
    expect(added).toHaveLength(0)
    expect(root.dataset.mouseDraws).toBeUndefined()

    await act(() => {
      mouseDraws.value = true
    })
    expect(root.dataset.mouseDraws).toBe('')
    stroke(root, 'mouse', [20, 40], [100, 200])
    expect(added).toHaveLength(1)
    expect(added[0].points).toEqual([0.1, 0.1, 0.5, 0.5, 0.5, 0.5])
  })
})

describe('InkLayer eraser', () => {
  const base = { kind: 'ink', page: 3, color: '#000', width: 0.004, tool: 'pen', createdAt: 1, updatedAt: 1 } as const
  const strokes: InkStroke[] = [
    { ...base, id: 'near', points: [0.1, 0.1, 0.5, 0.9, 0.1, 0.5] },
    { ...base, id: 'far', points: [0.1, 0.9, 0.5, 0.9, 0.9, 0.5] },
  ]

  it('erases each stroke it touches once and adds nothing', async () => {
    penTool.value = 'eraser'
    const root = await mount({ strokes })
    root.dispatchEvent(pointer('pointerdown', { x: 40, y: 30 }))
    root.dispatchEvent(pointer('pointermove', { x: 60, y: 41 }))
    root.dispatchEvent(pointer('pointermove', { x: 80, y: 40 }))
    root.dispatchEvent(pointer('pointerup', { x: 80, y: 40 }))
    expect(erased).toEqual(['near'])
    expect(added).toHaveLength(0)
  })

  it('misses strokes farther than the eraser radius', async () => {
    penTool.value = 'eraser'
    const root = await mount({ strokes })
    stroke(root, 'pen', [40, 100], [80, 100])
    expect(erased).toEqual([])
  })
})
