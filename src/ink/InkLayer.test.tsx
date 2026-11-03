import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InkStroke } from '../types.ts'
import { InkLayer, type InkLayerProps } from './InkLayer.tsx'
import { fingerDraws, mouseDraws, penActivity, penColor, penTool, penWidth } from './tools.ts'

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
let layer: HTMLElement
let added: InkStroke[]
let erased: string[]
let clock: number
const cleanups: (() => void)[] = []

function listenForUndo() {
  const undo = vi.fn()
  document.addEventListener('marginalia:undo', undo)
  cleanups.push(() => document.removeEventListener('marginalia:undo', undo))
  return undo
}

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
    render(
      <div class="page">
        <div class="text-layer" />
        <InkLayer {...props} />
      </div>,
      host,
    )
  })
  layer = host.querySelector('.ink-layer') as HTMLElement
  return host.querySelector('.text-layer') as HTMLElement
}

function stroke(target: HTMLElement, type: string, from: [number, number], to: [number, number]) {
  target.dispatchEvent(pointer('pointerdown', { type, x: from[0], y: from[1] }))
  target.dispatchEvent(pointer('pointermove', { type, x: to[0], y: to[1] }))
  target.dispatchEvent(pointer('pointerup', { type, x: to[0], y: to[1] }))
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
  penActivity.down = false
  penActivity.downOn = null
  penActivity.lastUp = -Infinity
})

afterEach(() => {
  for (const off of cleanups.splice(0)) off()
  render(null, host)
  host.remove()
  vi.restoreAllMocks()
})

describe('InkLayer pen', () => {
  it('commits a stroke with normalised points on pen down/move/up', async () => {
    penColor.value = '#123456'
    penWidth.value = 0.01
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40, pressure: 0.3 }))
    text.dispatchEvent(pointer('pointermove', { x: 100, y: 200, pressure: 0.6 }))
    expect(added).toHaveLength(0)
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 200, pressure: 0 }))

    expect(added).toHaveLength(1)
    const s = added[0]
    expect(s).toMatchObject({ kind: 'ink', page: 3, color: '#123456', width: 0.01, tool: 'pen' })
    expect(s.points).toEqual([0.1, 0.1, 0.3, 0.5, 0.5, 0.6])
    expect(s.id).toBeTruthy()
    expect(s.createdAt).toBe(clock)
    expect(s.updatedAt).toBe(clock)
  })

  it('records every coalesced sample of a move', async () => {
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, pressure: 0.2 }))
    text.dispatchEvent(
      pointer('pointermove', {
        x: 100,
        y: 200,
        coalesced: [
          { x: 50, y: 100, pressure: 0.4 },
          { x: 100, y: 200, pressure: 0.6 },
        ],
      }),
    )
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 200 }))
    expect(added[0].points).toEqual([0, 0, 0.2, 0.25, 0.25, 0.4, 0.5, 0.5, 0.6])
  })

  it('discards the live stroke on pointercancel', async () => {
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    text.dispatchEvent(pointer('pointermove', { x: 100, y: 200 }))
    text.dispatchEvent(pointer('pointercancel', { x: 100, y: 200 }))
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 200 }))
    expect(added).toHaveLength(0)
  })

  it('ignores the pen and marks the layer pass-through while the tool is select', async () => {
    const text = await mount()
    await act(() => {
      penTool.value = 'select'
    })
    expect(layer.dataset.tool).toBe('select')
    stroke(text, 'pen', [20, 40], [100, 200])
    expect(added).toHaveLength(0)
  })

  it('renders committed strokes as SVG paths and skips deleted ones', async () => {
    const base = { kind: 'ink', page: 3, color: '#00f', width: 0.01, tool: 'pen', createdAt: 1, updatedAt: 1 } as const
    await mount({
      strokes: [
        { ...base, id: 'a', points: [0.1, 0.1, 0.5, 0.5, 0.5, 0.5] },
        { ...base, id: 'b', points: [0.2, 0.2, 0.5, 0.6, 0.6, 0.5], deleted: true },
      ],
    })
    const paths = layer.querySelectorAll('svg path')
    expect(paths).toHaveLength(1)
    expect(paths[0].getAttribute('fill')).toBe('#00f')
    expect(paths[0].getAttribute('d')).toMatch(/^M/)
  })
})

describe('InkLayer touch', () => {
  it('ignores touch by default', async () => {
    const text = await mount()
    stroke(text, 'touch', [20, 40], [100, 200])
    expect(added).toHaveLength(0)
  })

  it('draws with a finger when fingerDraws is on', async () => {
    fingerDraws.value = true
    const text = await mount()
    stroke(text, 'touch', [20, 40], [100, 200])
    expect(added).toHaveLength(1)
    expect(added[0].points).toEqual([0.1, 0.1, 0.5, 0.5, 0.5, 0.5])
  })

  it('ignores touch while a pen is down and for 500 ms after it lifts', async () => {
    fingerDraws.value = true
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    stroke(text, 'touch', [150, 300], [180, 350])
    text.dispatchEvent(pointer('pointermove', { x: 100, y: 200 }))
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 200 }))
    expect(added).toHaveLength(1)

    clock += 499
    stroke(text, 'touch', [150, 300], [180, 350])
    expect(added).toHaveLength(1)

    clock += 2
    stroke(text, 'touch', [150, 300], [180, 350])
    expect(added).toHaveLength(2)
  })

  it('drops a finger stroke when the pen lands and draws the pen stroke instead', async () => {
    fingerDraws.value = true
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', x: 150, y: 300 }))
    text.dispatchEvent(pointer('pointermove', { type: 'touch', x: 160, y: 320 }))
    stroke(text, 'pen', [20, 40], [100, 200])
    text.dispatchEvent(pointer('pointerup', { type: 'touch', x: 160, y: 320 }))
    expect(added).toHaveLength(1)
    expect(added[0].points).toEqual([0.1, 0.1, 0.5, 0.5, 0.5, 0.5])
  })

  it('drops a finger stroke when a second finger lands', async () => {
    fingerDraws.value = true
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 10, x: 20, y: 40 }))
    text.dispatchEvent(pointer('pointermove', { type: 'touch', id: 10, x: 60, y: 80 }))
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 11, x: 120, y: 80 }))
    text.dispatchEvent(pointer('pointerup', { type: 'touch', id: 10, x: 60, y: 80 }))
    text.dispatchEvent(pointer('pointerup', { type: 'touch', id: 11, x: 120, y: 80 }))
    expect(added).toHaveLength(0)
  })

  it('prevents default only for stylus touches', async () => {
    const text = await mount()
    const stylusStart = touch('touchstart', [{ id: 1, x: 10, y: 10, touchType: 'stylus' }])
    const stylusMove = touch('touchmove', [{ id: 1, x: 20, y: 20, touchType: 'stylus' }])
    const fingerStart = touch('touchstart', [{ id: 2, x: 10, y: 10 }])
    const fingerMove = touch('touchmove', [{ id: 2, x: 10, y: 60 }])
    for (const e of [stylusStart, stylusMove, fingerStart, fingerMove]) text.dispatchEvent(e)
    expect(stylusStart.defaultPrevented).toBe(true)
    expect(stylusMove.defaultPrevented).toBe(true)
    expect(fingerStart.defaultPrevented).toBe(false)
    expect(fingerMove.defaultPrevented).toBe(false)
  })

  it('dispatches marginalia:undo on a two-finger double tap', async () => {
    const text = await mount()
    const undo = listenForUndo()
    const two = [
      { id: 1, x: 50, y: 50 },
      { id: 2, x: 120, y: 60 },
    ]
    const tap = () => {
      text.dispatchEvent(touch('touchstart', two))
      clock += 80
      text.dispatchEvent(touch('touchend', two, []))
    }
    tap()
    expect(undo).not.toHaveBeenCalled()
    clock += 150
    tap()
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('does not undo on a two-finger pan or a single two-finger tap', async () => {
    const text = await mount()
    const undo = listenForUndo()
    const two = [
      { id: 1, x: 50, y: 50 },
      { id: 2, x: 120, y: 60 },
    ]
    const moved = [
      { id: 1, x: 50, y: 150 },
      { id: 2, x: 120, y: 160 },
    ]
    text.dispatchEvent(touch('touchstart', two))
    text.dispatchEvent(touch('touchmove', moved))
    text.dispatchEvent(touch('touchend', moved, []))
    clock += 150
    text.dispatchEvent(touch('touchstart', two))
    text.dispatchEvent(touch('touchend', two, []))
    clock += 1000
    text.dispatchEvent(touch('touchstart', two))
    text.dispatchEvent(touch('touchend', two, []))
    expect(undo).not.toHaveBeenCalled()
  })
})

describe('InkLayer mouse', () => {
  it('draws only when mouseDraws is latched', async () => {
    const text = await mount()
    stroke(text, 'mouse', [20, 40], [100, 200])
    expect(added).toHaveLength(0)
    expect(layer.dataset.mouseDraws).toBeUndefined()

    await act(() => {
      mouseDraws.value = true
    })
    expect(layer.dataset.mouseDraws).toBe('')
    stroke(text, 'mouse', [20, 40], [100, 200])
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
    const text = await mount({ strokes })
    text.dispatchEvent(pointer('pointerdown', { x: 40, y: 30 }))
    text.dispatchEvent(pointer('pointermove', { x: 60, y: 41 }))
    text.dispatchEvent(pointer('pointermove', { x: 80, y: 40 }))
    text.dispatchEvent(pointer('pointerup', { x: 80, y: 40 }))
    expect(erased).toEqual(['near'])
    expect(added).toHaveLength(0)
  })

  it('misses strokes farther than the eraser radius', async () => {
    penTool.value = 'eraser'
    const text = await mount({ strokes })
    stroke(text, 'pen', [40, 100], [80, 100])
    expect(erased).toEqual([])
  })
})

describe('InkLayer input routing on the page element', () => {
  function reached(target: HTMLElement, name: string) {
    const seen: string[] = []
    target.addEventListener(name, (e) => seen.push((e as PointerEvent).pointerType ?? e.type))
    return seen
  }

  it('lets finger and mouse through to the layer underneath while the tool is pen', async () => {
    const text = await mount()
    const seen = reached(text, 'pointerdown')
    const finger = pointer('pointerdown', { type: 'touch', x: 20, y: 40 })
    const mouse = pointer('pointerdown', { type: 'mouse', x: 20, y: 40 })
    text.dispatchEvent(finger)
    text.dispatchEvent(mouse)
    expect(seen).toEqual(['touch', 'mouse'])
    expect(finger.defaultPrevented).toBe(false)
    expect(mouse.defaultPrevented).toBe(false)
    expect(layer.dataset.mouseDraws).toBeUndefined()
    expect(layer.dataset.fingerDraws).toBeUndefined()
  })

  it('intercepts the pen for pen and eraser, and lets it through for select', async () => {
    const text = await mount()
    const seen = reached(text, 'pointerdown')
    const down = pointer('pointerdown', { x: 20, y: 40 })
    text.dispatchEvent(down)
    text.dispatchEvent(pointer('pointerup', { x: 20, y: 40 }))
    expect(down.defaultPrevented).toBe(true)

    await act(() => {
      penTool.value = 'eraser'
    })
    clock += 1000
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    text.dispatchEvent(pointer('pointerup', { x: 20, y: 40 }))
    expect(seen).toEqual([])

    await act(() => {
      penTool.value = 'select'
    })
    clock += 1000
    const select = pointer('pointerdown', { x: 20, y: 40 })
    text.dispatchEvent(select)
    expect(seen).toEqual(['pen'])
    expect(select.defaultPrevented).toBe(false)
  })

  it('intercepts the mouse only while the draw latch is on', async () => {
    const text = await mount()
    const seen = reached(text, 'pointerdown')
    await act(() => {
      mouseDraws.value = true
    })
    text.dispatchEvent(pointer('pointerdown', { type: 'mouse', x: 20, y: 40 }))
    text.dispatchEvent(pointer('pointerup', { type: 'mouse', x: 20, y: 40 }))
    expect(seen).toEqual([])
    expect(added).toHaveLength(1)

    await act(() => {
      mouseDraws.value = false
    })
    text.dispatchEvent(pointer('pointerdown', { type: 'mouse', x: 20, y: 40 }))
    expect(seen).toEqual(['mouse'])
  })

  it('swallows palm touches while the pen draws and for 500 ms after, then lets fingers through', async () => {
    const text = await mount()
    const downs = reached(text, 'pointerdown')
    const ups = reached(text, 'pointerup')
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    const palm = pointer('pointerdown', { type: 'touch', x: 150, y: 300 })
    text.dispatchEvent(palm)
    text.dispatchEvent(pointer('pointerup', { x: 20, y: 40 }))
    text.dispatchEvent(pointer('pointerup', { type: 'touch', x: 150, y: 300 }))
    expect(palm.defaultPrevented).toBe(true)
    expect(downs).toEqual([])
    expect(ups).toEqual([])

    clock += 499
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 11, x: 150, y: 300 }))
    expect(downs).toEqual([])
    clock += 2
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 12, x: 150, y: 300 }))
    text.dispatchEvent(pointer('pointerup', { type: 'touch', id: 12, x: 150, y: 300 }))
    expect(downs).toEqual(['touch'])
    expect(ups).toEqual(['touch'])
  })

  it('leaves stylus touches alone in the select tool', async () => {
    const text = await mount()
    await act(() => {
      penTool.value = 'select'
    })
    const start = touch('touchstart', [{ id: 1, x: 10, y: 10, touchType: 'stylus' }])
    text.dispatchEvent(start)
    expect(start.defaultPrevented).toBe(false)
  })

  it('detects the two-finger double tap in the select tool', async () => {
    const text = await mount()
    await act(() => {
      penTool.value = 'select'
    })
    const undo = listenForUndo()
    const two = [
      { id: 1, x: 50, y: 50 },
      { id: 2, x: 120, y: 60 },
    ]
    text.dispatchEvent(touch('touchstart', two))
    text.dispatchEvent(touch('touchend', two, []))
    clock += 100
    text.dispatchEvent(touch('touchstart', two))
    text.dispatchEvent(touch('touchend', two, []))
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('intercepts finger input when finger drawing is on', async () => {
    fingerDraws.value = true
    const text = await mount()
    const seen = reached(text, 'pointerdown')
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', x: 20, y: 40 }))
    expect(seen).toEqual([])
    expect(layer.dataset.fingerDraws).toBe('')
  })


  it('swallows palm touches around a pen used in the select tool without touching the pen', async () => {
    const text = await mount()
    await act(() => {
      penTool.value = 'select'
    })
    const downs = reached(text, 'pointerdown')
    const pen = pointer('pointerdown', { x: 20, y: 40 })
    text.dispatchEvent(pen)
    const palm = pointer('pointerdown', { type: 'touch', id: 10, x: 150, y: 300 })
    text.dispatchEvent(palm)
    text.dispatchEvent(pointer('pointerup', { x: 20, y: 40 }))
    expect(pen.defaultPrevented).toBe(false)
    expect(palm.defaultPrevented).toBe(true)
    expect(downs).toEqual(['pen'])

    clock += 400
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 11, x: 150, y: 300 }))
    expect(downs).toEqual(['pen'])
    clock += 101
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 12, x: 150, y: 300 }))
    expect(downs).toEqual(['pen', 'touch'])
  })

  it('stops capture listeners registered later on the page element itself', async () => {
    const text = await mount()
    const page = text.parentElement as HTMLElement
    const seen = vi.fn()
    page.addEventListener('pointerdown', seen, { capture: true })
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    expect(seen).not.toHaveBeenCalled()
  })

  it('ignores a two-finger double tap within the palm window', async () => {
    const text = await mount()
    const undo = listenForUndo()
    const two = [
      { id: 1, x: 50, y: 50 },
      { id: 2, x: 120, y: 60 },
    ]
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    text.dispatchEvent(pointer('pointerup', { x: 20, y: 40 }))
    for (let i = 0; i < 2; i++) {
      clock += 100
      text.dispatchEvent(touch('touchstart', two))
      text.dispatchEvent(touch('touchend', two, []))
    }
    expect(undo).not.toHaveBeenCalled()
  })

  it('keeps swallowing a finger stroke dropped for a second finger', async () => {
    fingerDraws.value = true
    const text = await mount()
    const moves = reached(text, 'pointermove')
    const ups = reached(text, 'pointerup')
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 10, x: 20, y: 40 }))
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 11, x: 120, y: 80 }))
    text.dispatchEvent(pointer('pointermove', { type: 'touch', id: 10, x: 30, y: 50 }))
    text.dispatchEvent(pointer('pointerup', { type: 'touch', id: 10, x: 30, y: 50 }))
    expect(moves).toEqual([])
    expect(ups).toEqual([])
    text.dispatchEvent(pointer('pointerup', { type: 'touch', id: 11, x: 120, y: 80 }))
    expect(ups).toEqual(['touch'])
  })

  it('keeps swallowing a finger stroke dropped for the pen', async () => {
    fingerDraws.value = true
    const text = await mount()
    const ups = reached(text, 'pointerup')
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 10, x: 20, y: 40 }))
    text.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }))
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 100 }))
    clock += 1000
    text.dispatchEvent(pointer('pointerup', { type: 'touch', id: 10, x: 20, y: 40 }))
    expect(ups).toEqual([])
    expect(added).toHaveLength(1)
  })

  it('shares the palm window across pages', async () => {
    const props = (page: number): InkLayerProps => ({
      page,
      cssW: 200,
      cssH: 400,
      strokes: [],
      onAddStroke: (s) => added.push(s),
      onEraseStroke: (id) => erased.push(id),
    })
    await act(() => {
      render(
        <div>
          <div class="page" id="a">
            <div class="text-layer" />
            <InkLayer {...props(1)} />
          </div>
          <div class="page" id="b">
            <div class="text-layer" />
            <InkLayer {...props(2)} />
          </div>
        </div>,
        host,
      )
    })
    const textA = host.querySelector('#a .text-layer') as HTMLElement
    const textB = host.querySelector('#b .text-layer') as HTMLElement
    const downsB = reached(textB, 'pointerdown')

    textA.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    const palm = pointer('pointerdown', { type: 'touch', id: 10, x: 50, y: 50 })
    textB.dispatchEvent(palm)
    expect(palm.defaultPrevented).toBe(true)
    expect(downsB).toEqual([])

    textA.dispatchEvent(pointer('pointerup', { x: 20, y: 40 }))
    clock += 499
    textB.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 11, x: 50, y: 50 }))
    expect(downsB).toEqual([])
    clock += 2
    textB.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 12, x: 50, y: 50 }))
    expect(downsB).toEqual(['touch'])
    expect(added.map((s) => s.page)).toEqual([1])
  })

  it('treats a hovering pen as lifted', async () => {
    const text = await mount()
    const downs = reached(text, 'pointerdown')
    penActivity.down = true
    const hover = new PointerEvent('pointermove', { bubbles: true, pointerType: 'pen', pointerId: 2, buttons: 0 })
    text.dispatchEvent(hover)
    clock += 501
    text.dispatchEvent(pointer('pointerdown', { type: 'touch', x: 50, y: 50 }))
    expect(downs).toEqual(['touch'])
  })

  it('releases the shared pen-down state when a layer unmounts mid-stroke', async () => {
    const props = (page: number): InkLayerProps => ({
      page,
      cssW: 200,
      cssH: 400,
      strokes: [],
      onAddStroke: (s) => added.push(s),
      onEraseStroke: (id) => erased.push(id),
    })
    const pages = (withA: boolean) => (
      <div>
        {withA && (
          <div class="page" id="a">
            <div class="text-layer" />
            <InkLayer {...props(1)} />
          </div>
        )}
        <div class="page" id="b">
          <div class="text-layer" />
          <InkLayer {...props(2)} />
        </div>
      </div>
    )
    await act(() => {
      render(pages(true), host)
    })
    const textA = host.querySelector('#a .text-layer') as HTMLElement
    const textB = host.querySelector('#b .text-layer') as HTMLElement
    const downsB = reached(textB, 'pointerdown')
    textA.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    textA.dispatchEvent(pointer('pointermove', { x: 60, y: 80 }))

    await act(() => {
      render(pages(false), host)
    })
    expect(penActivity.down).toBe(false)
    textB.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 10, x: 50, y: 50 }))
    expect(downsB).toEqual([])
    clock += 501
    textB.dispatchEvent(pointer('pointerdown', { type: 'touch', id: 11, x: 50, y: 50 }))
    expect(downsB).toEqual(['touch'])
    expect(added).toEqual([])
  })

  it('keeps the pen-down state when a page the pen is not on unmounts', async () => {
    const text = await mount()
    const other = document.createElement('div')
    penActivity.down = true
    penActivity.downOn = other
    await act(() => {
      render(null, host)
    })
    expect(penActivity.down).toBe(true)
    expect(text.isConnected).toBe(false)
  })
})
