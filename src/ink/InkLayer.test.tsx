import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnnotationStore } from '../annot/store.ts'
import { emptySidecar, type InkStroke } from '../types.ts'
import { highlighterPath, inkOutlinePath, polylineLength, strokeOutlinePath } from './geometry.ts'
import { INK_VIEWPORT_ATTR, InkLayer, StrokeSvg, type InkLayerProps } from './InkLayer.tsx'
import {
  DEFAULT_ERASER_SETTINGS,
  DEFAULT_HIGHLIGHTER_SETTINGS,
  DEFAULT_PALETTES,
  DEFAULT_PEN_SETTINGS,
  eraserSettings,
  fingerDraws,
  highlighterSettings,
  mmToFraction,
  nightInk,
  palettes,
  penActivity,
  penSettings,
  previousTool,
  setTool,
  tool,
  type EraserSettings,
} from './tools.ts'

// Default pen width: 0.35 mm on a 210 mm page.
const W = mmToFraction(0.35, 210)

// Puts one colour and one width in the pen palette and selects them.
function usePen(color: string, widthMm: number) {
  palettes.value = { ...DEFAULT_PALETTES, pen: { colors: [color], widthsMm: [widthMm], colorIndex: 0, widthIndex: 0 } }
}

function useEraser(patch: Partial<EraserSettings>) {
  eraserSettings.value = { ...DEFAULT_ERASER_SETTINGS, ...patch }
}

// happy-dom's PointerEvent honours pointerType, pressure, coalescedEvents and predictedEvents from the init dict.
interface P {
  x: number
  y: number
  type?: string
  id?: number
  pressure?: number
  coalesced?: { x: number; y: number; pressure?: number }[]
  predicted?: { x: number; y: number; pressure?: number }[]
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
    predictedEvents: p.predicted?.map((q) => new PointerEvent(name, init(q))),
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

function listenFor(name: 'marginalia:undo' | 'marginalia:redo') {
  const fn = vi.fn()
  document.addEventListener(name, fn)
  cleanups.push(() => document.removeEventListener(name, fn))
  return fn
}

const listenForUndo = () => listenFor('marginalia:undo')

function page(extra: Partial<InkLayerProps>) {
  const props: InkLayerProps = {
    page: 3,
    cssW: 200,
    cssH: 400,
    strokes: [],
    onAddStroke: (s) => added.push(s),
    onEraseStroke: (id) => erased.push(id),
    ...extra,
  }
  return (
    <div class="page">
      <div class="text-layer" />
      <InkLayer {...props} />
    </div>
  )
}

async function mount(extra: Partial<InkLayerProps> = {}): Promise<HTMLElement> {
  await act(() => {
    render(page(extra), host)
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
  tool.value = 'pen'
  previousTool.value = 'pen'
  palettes.value = DEFAULT_PALETTES
  penSettings.value = DEFAULT_PEN_SETTINGS
  highlighterSettings.value = DEFAULT_HIGHLIGHTER_SETTINGS
  eraserSettings.value = DEFAULT_ERASER_SETTINGS
  fingerDraws.value = false
  nightInk.value = false
  penActivity.down = false
  penActivity.downOn = null
  penActivity.lastUp = -Infinity
})

afterEach(() => {
  for (const off of cleanups.splice(0)) off()
  render(null, host)
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('InkLayer pen', () => {
  it('commits a stroke with normalised points on pen down/move/up', async () => {
    usePen('#123456', 2.1)
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40, pressure: 0.3 }))
    text.dispatchEvent(pointer('pointermove', { x: 100, y: 200, pressure: 0.6 }))
    expect(added).toHaveLength(0)
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 200, pressure: 0 }))

    expect(added).toHaveLength(1)
    const s = added[0]
    expect(s).toMatchObject({ kind: 'ink', page: 3, color: '#123456', width: mmToFraction(2.1, 210), tool: 'pen', pen: 'fountain' })
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

  it('ignores the pen and marks the layer pass-through while the tool is lasso', async () => {
    const text = await mount()
    await act(() => {
      setTool('lasso')
    })
    expect(layer.dataset.tool).toBe('lasso')
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

describe('InkLayer live render', () => {
  let paths: string[]
  let frames: FrameRequestCallback[]
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  }
  const flush = () => frames.splice(0).forEach((cb) => cb(0))

  beforeEach(() => {
    paths = []
    frames = []
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(d: string) {
          paths.push(d)
        }
      },
    )
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    ctx.fill.mockClear()
    ctx.stroke.mockClear()
    ctx.setTransform.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fills the live Black stroke in the pale ink at night and stores Black', async () => {
    nightInk.value = true
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40, pressure: 0.3 }))
    text.dispatchEvent(pointer('pointermove', { x: 100, y: 200, pressure: 0.6 }))
    flush()
    expect(ctx.fillStyle).toBe('#e8e6e1')
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 200, pressure: 0 }))
    expect(added[0].color).toBe('#1c1c1a')
  })

  it('fills the live stroke once per frame with the outline the committed stroke gets', async () => {
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40, pressure: 0.3 }))
    text.dispatchEvent(pointer('pointermove', { x: 60, y: 120, pressure: 0.5 }))
    text.dispatchEvent(pointer('pointermove', { x: 100, y: 200, pressure: 0.6 }))
    expect(frames).toHaveLength(1)
    flush()
    expect(ctx.fill).toHaveBeenCalledTimes(1)
    const lastLive = paths.at(-1)!
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 200, pressure: 0 }))
    await mount({ strokes: added })
    expect(layer.querySelector('svg path')!.getAttribute('d')).toBe(lastLive)
  })

  it('draws predicted samples live but never stores them', async () => {
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40, pressure: 0.3 }))
    text.dispatchEvent(
      pointer('pointermove', { x: 100, y: 200, pressure: 0.6, predicted: [{ x: 180, y: 360, pressure: 0.6 }] }),
    )
    flush()
    const predictedFrame = paths.at(-1)!
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 200, pressure: 0 }))
    expect(added[0].points).toEqual([0.1, 0.1, 0.3, 0.5, 0.5, 0.6])
    await mount({ strokes: added })
    expect(layer.querySelector('svg path')!.getAttribute('d')).not.toBe(predictedFrame)
  })

  it("a pressure-0 sample takes the previous sample's pressure", async () => {
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, pressure: 0.3 }))
    text.dispatchEvent(
      pointer('pointermove', {
        x: 60,
        y: 0,
        coalesced: [
          { x: 20, y: 0, pressure: 0.6 },
          { x: 40, y: 0, pressure: 0 },
          { x: 60, y: 0, pressure: 0.4 },
        ],
      }),
    )
    text.dispatchEvent(pointer('pointerup', { x: 60, y: 0, pressure: 0 }))
    expect(added[0].points.filter((_, i) => i % 3 === 2)).toEqual([0.3, 0.6, 0.6, 0.4])
    text.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, pressure: 0 }))
    text.dispatchEvent(pointer('pointerup', { x: 0, y: 0, pressure: 0 }))
    expect(added[1].points).toEqual([0, 0, 0.5])
  })

  it('a 1,000-sample live stroke fills its frozen chunks and the tail, and commits the unchunked outline', async () => {
    const samples = Array.from({ length: 1000 }, (_, i) => ({ x: 5 + (i % 190), y: 10 + 20 * Math.floor(i / 190) }))
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', samples[0]))
    text.dispatchEvent(pointer('pointermove', { ...samples[999], coalesced: samples.slice(1) }))
    flush()
    expect(ctx.fill).toHaveBeenCalledTimes(4)
    text.dispatchEvent(pointer('pointerup', samples[999]))
    expect(added[0].points).toHaveLength(3000)
    await mount({ strokes: added })
    expect(layer.querySelector('svg path')!.getAttribute('d')).toBe(inkOutlinePath(added[0].points, W, 200, 400))
  })

  it('the last live frame tapers the tail with the whole stroke\'s length, as the committed outline does', async () => {
    // A pen wide enough that the tail's own length would cap its taper.
    usePen('#1c1c1a', 0.84)
    const w = mmToFraction(0.84, 210)
    const samples = Array.from({ length: 890 }, (_, i) => ({ x: 5 + (i % 190), y: 10 + 20 * Math.floor(i / 190) }))
    const text = await mount({ cssW: 256, cssH: 512 })
    text.dispatchEvent(pointer('pointerdown', samples[0]))
    text.dispatchEvent(pointer('pointermove', { ...samples[889], coalesced: samples.slice(1) }))
    flush()
    expect(ctx.fill).toHaveBeenCalledTimes(4)
    const tail = paths.at(-1)!
    text.dispatchEvent(pointer('pointerup', samples[889]))
    const stored = added[0].points
    const px = stored.map((v, i) => (i % 3 === 0 ? v * 256 : i % 3 === 1 ? v * 512 : v))
    const tailPx = px.slice(882 * 3)
    const ends = { start: false, end: true }
    expect(tail).toBe(strokeOutlinePath(tailPx, w * 256, false, 'fountain', ends, polylineLength(px)))
    expect(tail).not.toBe(strokeOutlinePath(tailPx, w * 256, false, 'fountain', ends))
    await mount({ cssW: 256, cssH: 512, strokes: added })
    expect(layer.querySelector('svg path')!.getAttribute('d')).toBe(inkOutlinePath(stored, w, 256, 512))
  })

  it('strokes a 1,000-sample live highlighter as one path per frame, the path the committed stroke gets', async () => {
    setTool('highlighter')
    const samples = Array.from({ length: 1000 }, (_, i) => ({ x: 5 + (i % 190), y: 10 + 20 * Math.floor(i / 190) }))
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', samples[0]))
    text.dispatchEvent(pointer('pointermove', { ...samples[999], coalesced: samples.slice(1) }))
    flush()
    expect(ctx.fill).not.toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
    expect(ctx).toMatchObject({ globalAlpha: 0.4, lineCap: 'square', lineJoin: 'round', strokeStyle: '#ffe066' })
    expect(ctx.lineWidth).toBeCloseTo((5 / 210) * 200)
    expect(layer.querySelector('canvas')!.classList.contains('mg-multiply')).toBe(true)
    const live = paths.at(-1)!
    text.dispatchEvent(pointer('pointerup', samples[999]))
    expect(live).toBe(highlighterPath(added[0].points, 200, 400))
    await mount({ strokes: added })
    expect(layer.querySelector('svg.ink-hl path')!.getAttribute('d')).toBe(live)
  })

  it('the live pen stroke on light paper does not multiply', async () => {
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    expect(layer.querySelector('canvas')!.classList.contains('mg-multiply')).toBe(false)
  })

  it('the live highlighter on dark paper does not multiply', async () => {
    setTool('highlighter')
    const text = await mount({ paperDark: true })
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    expect(layer.querySelector('canvas')!.classList.contains('mg-multiply')).toBe(false)
  })

  it('sizes the live canvas to the visible part of the page at the device pixel ratio', async () => {
    vi.stubGlobal('devicePixelRatio', 2)
    host.setAttribute(INK_VIEWPORT_ATTR, '')
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 200))
    const text = await mount({ cssW: 400, cssH: 800 })
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(-50, -100, 400, 800))
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    const canvas = layer.querySelector('canvas')!
    expect(canvas.style).toMatchObject({ left: '50px', top: '100px', width: '300px', height: '200px' })
    expect([canvas.width, canvas.height]).toEqual([600, 400])
    expect(ctx.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, -100, -200)
  })

  it('pressureVaries comes from the stored samples, not the predicted ones', async () => {
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40, pressure: 0.5 }))
    text.dispatchEvent(
      pointer('pointermove', { x: 100, y: 200, pressure: 0.5, predicted: [{ x: 180, y: 360, pressure: 0.9 }] }),
    )
    flush()
    const px = [(20 / 200) * 200, (40 / 400) * 400, 0.5, (100 / 200) * 200, (200 / 400) * 400, 0.5]
    const predictedPx = [(180 / 200) * 200, (360 / 400) * 400, 0.9]
    expect(paths.at(-1)).toBe(
      strokeOutlinePath([...px, ...predictedPx], W * 200, false, 'fountain', { start: true, end: true }),
    )
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

  it('dispatches marginalia:redo on a three-finger double tap', async () => {
    const text = await mount()
    const undo = listenForUndo()
    const redo = listenFor('marginalia:redo')
    const three = [
      { id: 1, x: 50, y: 50 },
      { id: 2, x: 120, y: 60 },
      { id: 3, x: 160, y: 70 },
    ]
    const tap = () => {
      text.dispatchEvent(touch('touchstart', three.slice(0, 2), three.slice(0, 2)))
      text.dispatchEvent(touch('touchstart', three.slice(2), three))
      clock += 80
      text.dispatchEvent(touch('touchend', three, []))
    }
    tap()
    expect(redo).not.toHaveBeenCalled()
    clock += 150
    tap()
    expect(redo).toHaveBeenCalledTimes(1)
    expect(undo).not.toHaveBeenCalled()
  })

  it('a two-finger tap then a three-finger tap neither undoes nor redoes', async () => {
    const text = await mount()
    const undo = listenForUndo()
    const redo = listenFor('marginalia:redo')
    const three = [
      { id: 1, x: 50, y: 50 },
      { id: 2, x: 120, y: 60 },
      { id: 3, x: 160, y: 70 },
    ]
    text.dispatchEvent(touch('touchstart', three.slice(0, 2)))
    text.dispatchEvent(touch('touchend', three.slice(0, 2), []))
    clock += 150
    text.dispatchEvent(touch('touchstart', three))
    text.dispatchEvent(touch('touchend', three, []))
    expect(undo).not.toHaveBeenCalled()
    expect(redo).not.toHaveBeenCalled()
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
  it('the mouse draws under pen, highlighter and eraser, and never under lasso', async () => {
    const base = { kind: 'ink', page: 3, color: '#000', width: 0.004, tool: 'pen', createdAt: 1, updatedAt: 1 } as const
    const fine = vi.fn((q: string) => ({ matches: q === '(pointer: fine)' }) as MediaQueryList)
    vi.stubGlobal('matchMedia', fine)
    const text = await mount({ strokes: [{ ...base, id: 'a', points: [0.1, 0.9, 0.5, 0.9, 0.9, 0.5] }] })
    expect(layer.dataset.mouseDraws).toBe('')
    stroke(text, 'mouse', [20, 40], [100, 200])
    await act(() => {
      setTool('highlighter')
    })
    expect(layer.dataset.mouseDraws).toBe('')
    stroke(text, 'mouse', [20, 40], [100, 200])
    expect(added.map((s) => s.tool)).toEqual(['pen', 'highlighter'])
    expect(added[0].points).toEqual([0.1, 0.1, 0.5, 0.5, 0.5, 0.5])

    await act(() => {
      setTool('eraser')
    })
    expect(layer.dataset.mouseDraws).toBe('')
    stroke(text, 'mouse', [20, 360], [180, 360])
    expect(erased).toEqual(['a'])

    await act(() => {
      setTool('lasso')
    })
    expect(layer.dataset.mouseDraws).toBeUndefined()
    const down = pointer('pointerdown', { type: 'mouse', x: 20, y: 40 })
    text.dispatchEvent(down)
    text.dispatchEvent(pointer('pointerup', { type: 'mouse', x: 20, y: 40 }))
    expect(down.defaultPrevented).toBe(false)
    expect(added).toHaveLength(2)
  })

  it('marks the layer for mouse drawing only on a fine pointer', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }) as MediaQueryList)
    await mount()
    expect(layer.dataset.mouseDraws).toBeUndefined()
  })
})

describe('InkLayer pen and highlighter strokes', () => {
  it('a pen stroke stores its pen style and its width in page millimetres', async () => {
    penSettings.value = { ...DEFAULT_PEN_SETTINGS, style: 'brush' }
    palettes.value = { ...DEFAULT_PALETTES, pen: { ...DEFAULT_PALETTES.pen, widthIndex: 2 } }
    const text = await mount({ pageWidthMm: 210 })
    stroke(text, 'pen', [20, 40], [100, 200])
    expect(added[0]).toMatchObject({ tool: 'pen', pen: 'brush', width: 0.5 / 210, color: '#1c1c1a' })
    await mount({ strokes: added })
    expect(layer.querySelector('svg.ink-pen path')!.getAttribute('d')).toBe(
      inkOutlinePath(added[0].points, 0.5 / 210, 200, 400, 'brush'),
    )
  })

  it('a pen stroke on a narrower page is wider as a fraction of it', async () => {
    const text = await mount({ pageWidthMm: 105 })
    stroke(text, 'pen', [20, 40], [100, 200])
    expect(added[0].width).toBe(0.35 / 105)
  })

  it('a stroke without a pen style renders as fountain', async () => {
    const plain: InkStroke = { kind: 'ink', id: 'p', page: 3, color: '#000', width: 0.004, points: [0.1, 0.1, 0.5, 0.5, 0.5, 0.5], createdAt: 1, updatedAt: 1 }
    await mount({ strokes: [plain] })
    expect(layer.querySelector('svg.ink-pen path')!.getAttribute('d')).toBe(inkOutlinePath(plain.points, 0.004, 200, 400, 'fountain'))
  })

  it('a highlighter stroke is flat, square-capped, 40 % and stores tool highlighter', async () => {
    setTool('highlighter')
    const text = await mount({ pageWidthMm: 210 })
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40, pressure: 0.2 }))
    text.dispatchEvent(pointer('pointermove', { x: 60, y: 40, pressure: 0.9 }))
    text.dispatchEvent(pointer('pointermove', { x: 100, y: 40, pressure: 0.4 }))
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 40, pressure: 0 }))
    const s = added[0]
    expect(s).toMatchObject({ kind: 'ink', tool: 'highlighter', color: '#ffe066', width: 5 / 210 })
    expect(s.pen).toBeUndefined()
    expect(s.points.filter((_, i) => i % 3 === 2)).toEqual([0.5, 0.5, 0.5])

    await mount({ strokes: added })
    expect(layer.querySelector('svg.ink-pen path')).toBeNull()
    const path = layer.querySelector('svg.ink-hl path')!
    expect(path.getAttribute('d')).toBe(highlighterPath(s.points, 200, 400))
    expect(path.getAttribute('stroke')).toBe('#ffe066')
    expect(Number(path.getAttribute('stroke-width'))).toBeCloseTo((5 / 210) * 200)
    expect(path.getAttribute('stroke-linecap')).toBe('square')
    expect(path.getAttribute('stroke-linejoin')).toBe('round')
    expect(path.getAttribute('stroke-opacity')).toBe('0.4')
    expect(path.getAttribute('fill')).toBe('none')
  })

  it('Draw straight line stores only the first and last samples', async () => {
    setTool('highlighter')
    highlighterSettings.value = { straight: true }
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    text.dispatchEvent(pointer('pointermove', { x: 100, y: 160, coalesced: [{ x: 60, y: 30 }, { x: 80, y: 90 }, { x: 100, y: 160 }] }))
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 160 }))
    expect(added[0].points).toEqual([0.1, 0.1, 0.5, 0.5, 0.4, 0.5])
  })

  it('on light paper the highlighter sits above the ink with multiply; on dark paper below it', async () => {
    const base = { kind: 'ink', page: 3, color: '#000', width: 0.004, createdAt: 1, updatedAt: 1 } as const
    const strokes: InkStroke[] = [
      { ...base, id: 'h', tool: 'highlighter', points: [0.1, 0.1, 0.5, 0.5, 0.1, 0.5] },
      { ...base, id: 'p', tool: 'pen', points: [0.1, 0.2, 0.5, 0.5, 0.2, 0.5] },
    ]
    const svgs = () => [...layer.querySelectorAll('svg')].map((e) => e.getAttribute('class'))
    await mount({ strokes, paperDark: false })
    expect(svgs()).toEqual(['ink-pen', 'ink-hl mg-multiply'])
    await mount({ strokes, paperDark: true })
    expect(svgs()).toEqual(['ink-hl', 'ink-pen'])
    expect(layer.querySelectorAll('svg.ink-hl path')).toHaveLength(1)
    expect(layer.querySelectorAll('svg.ink-pen path')).toHaveLength(1)
  })

  it('Black shows pale only on dark paper', async () => {
    const black: InkStroke = { kind: 'ink', id: 'k', createdAt: 1, updatedAt: 1, page: 3, tool: 'pen', color: '#1c1c1a', width: 0.004, points: [0.1, 0.1, 0.5, 0.5, 0.5, 0.5] }
    nightInk.value = true
    await mount({ strokes: [black], paperDark: false })
    expect(layer.querySelector('svg path')!.getAttribute('fill')).toBe('#1c1c1a')
    nightInk.value = false
    await mount({ strokes: [black], paperDark: true })
    expect(layer.querySelector('svg path')!.getAttribute('fill')).toBe('#e8e6e1')
  })

  it('showStrokes false renders no committed strokes; StrokeSvg renders them', async () => {
    const strokes: InkStroke[] = [
      { kind: 'ink', id: 'p', page: 3, color: '#00f', width: 0.004, tool: 'pen', points: [0.1, 0.1, 0.5, 0.5, 0.5, 0.5], createdAt: 1, updatedAt: 1 },
      { kind: 'ink', id: 'h', page: 3, color: '#ff0', width: 0.02, tool: 'highlighter', points: [0.1, 0.3, 0.5, 0.5, 0.3, 0.5], createdAt: 1, updatedAt: 1 },
      { kind: 'ink', id: 'd', page: 3, color: '#00f', width: 0.004, tool: 'pen', points: [0.2, 0.2, 0.5, 0.6, 0.6, 0.5], createdAt: 1, updatedAt: 1, deleted: true },
    ]
    await mount({ strokes, showStrokes: false })
    expect(layer.querySelector('svg')).toBeNull()
    expect(layer.querySelector('canvas')).not.toBeNull()

    const other = document.createElement('div')
    await act(() => {
      render(<StrokeSvg strokes={strokes} cssW={200} cssH={400} paperDark={false} />, other)
    })
    expect(other.querySelectorAll('svg.ink-pen path')).toHaveLength(1)
    expect(other.querySelectorAll('svg.ink-hl path')).toHaveLength(1)
    expect(other.querySelector('svg.ink-pen path')!.getAttribute('d')).toBe(inkOutlinePath(strokes[0].points, 0.004, 200, 400))
    render(null, other)
  })
})

describe('InkLayer eraser', () => {
  const base = { kind: 'ink', page: 3, color: '#000', width: 0.004, tool: 'pen', createdAt: 1, updatedAt: 1 } as const
  const strokes: InkStroke[] = [
    { ...base, id: 'near', points: [0.1, 0.1, 0.5, 0.9, 0.1, 0.5] },
    { ...base, id: 'far', points: [0.1, 0.9, 0.5, 0.9, 0.9, 0.5] },
  ]
  // A blue brush stroke along y = 0.5 from x = 0.1 to 0.9, 81 samples.
  const line: InkStroke = {
    ...base,
    id: 'line',
    color: '#2f6fed',
    pen: 'brush',
    points: Array.from({ length: 81 }, (_, i) => [0.1 + i / 100, 0.5, 0.5]).flat(),
  }
  let replaced: [string, InkStroke[]][]
  const onReplaceStroke = (id: string, pieces: InkStroke[]) => replaced.push([id, pieces])
  const xs = (s: InkStroke) => s.points.filter((_, i) => i % 3 === 0)

  beforeEach(() => {
    replaced = []
  })

  it('erases each stroke it touches once and adds nothing', async () => {
    setTool('eraser')
    const text = await mount({ strokes })
    text.dispatchEvent(pointer('pointerdown', { x: 40, y: 30 }))
    text.dispatchEvent(pointer('pointermove', { x: 60, y: 41 }))
    text.dispatchEvent(pointer('pointermove', { x: 80, y: 40 }))
    text.dispatchEvent(pointer('pointerup', { x: 80, y: 40 }))
    expect(erased).toEqual(['near'])
    expect(added).toHaveLength(0)
  })

  it('misses strokes farther than the eraser radius', async () => {
    setTool('eraser')
    const text = await mount({ strokes })
    stroke(text, 'pen', [40, 100], [80, 100])
    expect(erased).toEqual([])
  })

  it('a larger eraser reaches farther', async () => {
    setTool('eraser')
    useEraser({ sizeMm: 8 })
    const text = await mount({ strokes })
    stroke(text, 'pen', [40, 44], [40, 44])
    expect(erased).toEqual(['near'])
  })

  it('the segment eraser replaces a stroke by its pieces with new ids', async () => {
    setTool('eraser')
    useEraser({ style: 'segment' })
    const text = await mount({ strokes: [line], onReplaceStroke })
    stroke(text, 'pen', [100, 200], [100, 200])
    expect(erased).toEqual([])
    expect(replaced).toHaveLength(1)
    const [id, pieces] = replaced[0]
    expect(id).toBe('line')
    expect(pieces).toHaveLength(2)
    expect(new Set([...pieces.map((p) => p.id), 'line']).size).toBe(3)
    for (const p of pieces) {
      expect(p).toMatchObject({ kind: 'ink', page: 3, color: '#2f6fed', width: 0.004, tool: 'pen', pen: 'brush' })
      expect(p.points.filter((_, i) => i % 3 === 1).every((y) => y === 0.5)).toBe(true)
    }
    const r = mmToFraction(1, 210) + 0.002
    expect(xs(pieces[0])[0]).toBe(0.1)
    expect(xs(pieces[0]).at(-1)).toBeCloseTo(0.5 - r)
    expect(xs(pieces[1])[0]).toBeCloseTo(0.5 + r)
    expect(xs(pieces[1]).at(-1)).toBe(0.9)
  })

  // Thirty-one eraser samples 3 px apart along the line from x 30 to 120 px: a pointerdown and five moves of six coalesced samples.
  async function dragAlongLine(text: HTMLElement, beforeLift: () => void = () => {}) {
    await act(() => {
      text.dispatchEvent(pointer('pointerdown', { x: 30, y: 200 }))
      for (let move = 0; move < 5; move++) {
        const coalesced = Array.from({ length: 6 }, (_, k) => ({ x: 30 + 3 * (move * 6 + k + 1), y: 200 }))
        text.dispatchEvent(pointer('pointermove', { ...coalesced[5], coalesced }))
      }
    })
    beforeLift()
    await act(() => {
      text.dispatchEvent(pointer('pointerup', { x: 120, y: 200 }))
    })
  }

  it('dragging the segment eraser along a stroke keeps splitting the pieces it made', async () => {
    setTool('eraser')
    useEraser({ style: 'segment', sizeMm: 4 })
    const text = await mount({ strokes: [line], onReplaceStroke })
    const original = inkOutlinePath(line.points, 0.004, 200, 400, 'brush')
    let drawnMidDrag: string[] = []
    await dragAlongLine(text, () => {
      expect(replaced).toEqual([])
      drawnMidDrag = [...layer.querySelectorAll('svg.ink-pen path')].map((e) => e.getAttribute('d')!)
    })

    expect(drawnMidDrag).toHaveLength(2)
    expect(drawnMidDrag).not.toContain(original)
    expect(erased).toEqual([])
    expect(replaced).toHaveLength(1)
    const [id, pieces] = replaced[0]
    expect(id).toBe('line')
    for (const p of pieces) expect(p.points.length).toBeGreaterThanOrEqual(6)
    expect(pieces.map((p) => [xs(p)[0], xs(p).at(-1)])).toEqual([
      [0.1, expect.closeTo(0.15 - mmToFraction(2, 210) - 0.002)],
      [expect.closeTo(0.6 + mmToFraction(2, 210) + 0.002), 0.9],
    ])
  })

  it('after a drag the layer shows the page strokes again until the store replaces them', async () => {
    setTool('eraser')
    useEraser({ style: 'segment', sizeMm: 4 })
    const text = await mount({ strokes: [line], onReplaceStroke })
    await dragAlongLine(text)
    expect(layer.querySelectorAll('svg.ink-pen path')).toHaveLength(1)
  })

  it('undo once restores a stroke after a 31-sample drag', async () => {
    const store = createAnnotationStore(emptySidecar('pdf', 'a.pdf', 1), () => {}, { documentUndo: false })
    store.addStroke(line)
    setTool('eraser')
    useEraser({ style: 'segment', sizeMm: 4 })
    const text = await mount({ strokes: store.inks.value, onReplaceStroke: store.replaceStroke, onEraseStroke: store.removeStroke })
    await dragAlongLine(text)
    expect(store.inks.value).toHaveLength(2)
    store.undo()
    expect(store.inks.value.map((s) => s.id)).toEqual(['line'])
    expect(store.inks.value[0].points).toEqual(line.points)
  })

  it('a drag over two strokes yields one replace for each', async () => {
    const lower: InkStroke = { ...line, id: 'lower', points: line.points.map((v, i) => (i % 3 === 1 ? 0.52 : v)) }
    setTool('eraser')
    useEraser({ style: 'segment', sizeMm: 4 })
    const text = await mount({ strokes: [line, lower], onReplaceStroke })
    await act(() => {
      text.dispatchEvent(pointer('pointerdown', { x: 100, y: 180 }))
      text.dispatchEvent(pointer('pointermove', { x: 100, y: 220, coalesced: [{ x: 100, y: 200 }, { x: 100, y: 208 }, { x: 100, y: 220 }] }))
      text.dispatchEvent(pointer('pointerup', { x: 100, y: 220 }))
    })
    expect(replaced.map(([id, pieces]) => [id, pieces.length])).toEqual([
      ['line', 2],
      ['lower', 2],
    ])
  })

  it('a stroke the segment eraser removes completely is erased, not replaced', async () => {
    const dot: InkStroke = { ...line, id: 'dot', points: [0.5, 0.5, 0.5, 0.501, 0.5, 0.5] }
    setTool('eraser')
    useEraser({ style: 'segment', sizeMm: 8 })
    const text = await mount({ strokes: [dot], onReplaceStroke })
    await act(() => stroke(text, 'pen', [100, 200], [101, 200]))
    expect(replaced).toEqual([])
    expect(erased).toEqual(['dot'])
  })

  it('a cancelled segment drag still hands its pieces to the store', async () => {
    setTool('eraser')
    useEraser({ style: 'segment' })
    const text = await mount({ strokes: [line], onReplaceStroke })
    await act(() => {
      text.dispatchEvent(pointer('pointerdown', { x: 100, y: 200 }))
      text.dispatchEvent(pointer('pointercancel', { x: 100, y: 200 }))
    })
    expect(replaced.map(([id, pieces]) => [id, pieces.length])).toEqual([['line', 2]])
  })

  it('erases a stroke crossed between two samples 60 px apart', async () => {
    const thin: InkStroke = { ...base, id: 'thin', width: 0.001, points: [0.5, 0.25, 0.5, 0.5, 0.75, 0.5] }
    setTool('eraser')
    let text = await mount({ strokes: [thin], onReplaceStroke })
    stroke(text, 'mouse', [70, 200], [130, 200])
    expect(erased).toEqual(['thin'])

    clock += 1000
    useEraser({ style: 'segment' })
    text = await mount({ strokes: [{ ...thin }], onReplaceStroke })
    await act(() => stroke(text, 'mouse', [70, 200], [130, 200]))
    expect(replaced.map(([id, pieces]) => [id, pieces.length])).toEqual([['thin', 2]])
  })

  it('without onReplaceStroke the segment eraser removes whole strokes', async () => {
    setTool('eraser')
    useEraser({ style: 'segment' })
    const text = await mount({ strokes: [line] })
    stroke(text, 'pen', [100, 200], [100, 200])
    expect(erased).toEqual(['line'])
  })

  it('the eraser filter skips pen or highlighter strokes', async () => {
    const both: InkStroke[] = [
      { ...base, id: 'pen', points: [0.1, 0.5, 0.5, 0.9, 0.5, 0.5] },
      { ...base, id: 'plain', tool: undefined, points: [0.1, 0.5, 0.5, 0.9, 0.5, 0.5] },
      { ...base, id: 'hl', tool: 'highlighter', points: [0.1, 0.5, 0.5, 0.9, 0.5, 0.5] },
    ]
    setTool('eraser')
    useEraser({ erasePen: false })
    let text = await mount({ strokes: both })
    stroke(text, 'pen', [100, 200], [100, 200])
    expect(erased).toEqual(['hl'])

    erased = []
    clock += 1000
    useEraser({ eraseHighlighter: false })
    text = await mount({ strokes: [...both] })
    stroke(text, 'pen', [100, 200], [100, 200])
    expect(erased).toEqual(['pen', 'plain'])
  })

  it('Auto-deselect returns to the previous tool on lift', async () => {
    setTool('highlighter')
    setTool('eraser')
    useEraser({ autoDeselect: true })
    const text = await mount({ strokes })
    text.dispatchEvent(pointer('pointerdown', { x: 40, y: 40 }))
    text.dispatchEvent(pointer('pointermove', { x: 60, y: 40 }))
    expect(tool.value).toBe('eraser')
    await act(() => {
      text.dispatchEvent(pointer('pointerup', { x: 60, y: 40 }))
    })
    expect(tool.value).toBe('highlighter')
    expect(layer.dataset.tool).toBe('highlighter')
  })

  it('without Auto-deselect the eraser stays on lift', async () => {
    setTool('eraser')
    const text = await mount({ strokes })
    stroke(text, 'pen', [40, 40], [60, 40])
    expect(tool.value).toBe('eraser')
  })

  it('an eraser circle of the eraser size follows the pointer while erasing', async () => {
    setTool('eraser')
    useEraser({ sizeMm: 8 })
    const text = await mount({ pageWidthMm: 210 })
    const cursor = layer.querySelector('.ink-eraser-cursor') as HTMLElement
    expect(cursor.hidden).toBe(true)
    text.dispatchEvent(pointer('pointerdown', { x: 40, y: 100 }))
    expect(cursor.hidden).toBe(false)
    expect(parseFloat(cursor.style.width)).toBeCloseTo(7.62)
    expect(parseFloat(cursor.style.height)).toBeCloseTo(7.62)
    expect([cursor.style.left, cursor.style.top]).toEqual(['40px', '100px'])
    text.dispatchEvent(pointer('pointermove', { x: 60, y: 120 }))
    expect([cursor.style.left, cursor.style.top]).toEqual(['60px', '120px'])
    text.dispatchEvent(pointer('pointerup', { x: 60, y: 120 }))
    expect(cursor.hidden).toBe(true)
  })

  it('shows no eraser circle while the pen draws', async () => {
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 40, y: 100 }))
    expect((layer.querySelector('.ink-eraser-cursor') as HTMLElement).hidden).toBe(true)
  })
})

describe('InkLayer pen hover', () => {
  const hover = (x: number, y: number) =>
    new PointerEvent('pointermove', { bubbles: true, pointerType: 'pen', pointerId: 2, clientX: x, clientY: y, buttons: 0 })

  it('a hovering pen shows a dot of the current colour and size', async () => {
    const text = await mount({ pageWidthMm: 210 })
    const dot = layer.querySelector('.ink-hover-dot') as HTMLElement
    expect(dot.hidden).toBe(true)
    const move = hover(50, 60)
    text.dispatchEvent(move)
    expect(move.defaultPrevented).toBe(false)
    expect(dot.hidden).toBe(false)
    expect([dot.style.left, dot.style.top]).toEqual(['50px', '60px'])
    expect(parseFloat(dot.style.width)).toBeCloseTo((0.35 / 210) * 200)
    expect(dot.style.background).toBe('#1c1c1a')

    await act(() => {
      setTool('highlighter')
    })
    text.dispatchEvent(hover(70, 80))
    expect(parseFloat(dot.style.width)).toBeCloseTo((5 / 210) * 200)
    expect(dot.style.background).toBe('#ffe066')

    ;(text.parentElement as HTMLElement).dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'pen', pointerId: 2 }))
    expect(dot.hidden).toBe(true)
  })

  it('shows no dot under the eraser or lasso, or once the pen touches', async () => {
    const text = await mount()
    const dot = layer.querySelector('.ink-hover-dot') as HTMLElement
    text.dispatchEvent(hover(50, 60))
    text.dispatchEvent(pointer('pointerdown', { x: 50, y: 60 }))
    expect(dot.hidden).toBe(true)
    text.dispatchEvent(pointer('pointerup', { x: 50, y: 60 }))
    for (const t of ['eraser', 'lasso'] as const) {
      await act(() => {
        setTool(t)
      })
      text.dispatchEvent(hover(50, 60))
      expect(dot.hidden).toBe(true)
    }
  })
})

describe('InkLayer input routing on the page element', () => {
  function reached(target: HTMLElement, name: string) {
    const seen: string[] = []
    target.addEventListener(name, (e) => seen.push((e as PointerEvent).pointerType ?? e.type))
    return seen
  }

  it('lets the finger through to the layer underneath while the tool is pen', async () => {
    const text = await mount()
    const seen = reached(text, 'pointerdown')
    const finger = pointer('pointerdown', { type: 'touch', x: 20, y: 40 })
    text.dispatchEvent(finger)
    expect(seen).toEqual(['touch'])
    expect(finger.defaultPrevented).toBe(false)
    expect(layer.dataset.fingerDraws).toBeUndefined()
  })

  it('intercepts the pen for pen and eraser, and lets it through for lasso', async () => {
    const text = await mount()
    const seen = reached(text, 'pointerdown')
    const down = pointer('pointerdown', { x: 20, y: 40 })
    text.dispatchEvent(down)
    text.dispatchEvent(pointer('pointerup', { x: 20, y: 40 }))
    expect(down.defaultPrevented).toBe(true)

    await act(() => {
      setTool('eraser')
    })
    clock += 1000
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40 }))
    text.dispatchEvent(pointer('pointerup', { x: 20, y: 40 }))
    expect(seen).toEqual([])

    await act(() => {
      setTool('lasso')
    })
    clock += 1000
    const select = pointer('pointerdown', { x: 20, y: 40 })
    text.dispatchEvent(select)
    expect(seen).toEqual(['pen'])
    expect(select.defaultPrevented).toBe(false)
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

  it('leaves stylus touches alone in the lasso tool', async () => {
    const text = await mount()
    await act(() => {
      setTool('lasso')
    })
    const start = touch('touchstart', [{ id: 1, x: 10, y: 10, touchType: 'stylus' }])
    text.dispatchEvent(start)
    expect(start.defaultPrevented).toBe(false)
  })

  it('detects the two-finger double tap in the lasso tool', async () => {
    const text = await mount()
    await act(() => {
      setTool('lasso')
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


  it('swallows palm touches around a pen used in the lasso tool without touching the pen', async () => {
    const text = await mount()
    await act(() => {
      setTool('lasso')
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

describe('InkLayer night ink', () => {
  const black: InkStroke = { kind: 'ink', id: 'k', createdAt: 1, updatedAt: 1, page: 3, tool: 'pen', color: '#1c1c1a', width: 0.004, points: [0.1, 0.1, 0.5, 0.5, 0.5, 0.5] }
  const red: InkStroke = { ...black, id: 'r', color: '#d33a2c' }
  const fills = () => [...layer.querySelectorAll('svg path')].map((p) => p.getAttribute('fill'))

  it('draws a Black stroke in the pale ink at night without changing its stored colour; other colours stay', async () => {
    nightInk.value = true
    await mount({ strokes: [black, red] })
    expect(fills()).toEqual(['#e8e6e1', '#d33a2c'])
    expect(black.color).toBe('#1c1c1a')
  })

  it('draws a Black stroke in Black by day, and follows a switch to night', async () => {
    await mount({ strokes: [black] })
    expect(fills()).toEqual(['#1c1c1a'])
    await act(() => {
      nightInk.value = true
    })
    expect(fills()).toEqual(['#e8e6e1'])
  })
})
