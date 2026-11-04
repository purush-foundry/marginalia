import type { JSX } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { newId, now } from '../lib/ids.ts'
import type { InkStroke } from '../types.ts'
import { splitStrokeAt } from './erase.ts'
import {
  highlighterPath,
  inkOutlinePath,
  pressureVaries,
  simplifyPoints,
  strokeHitsPoint,
  strokeOutlinePath,
} from './geometry.ts'
import { createLiveOutline, type LiveOutline } from './liveOutline.ts'
import {
  A4_WIDTH_MM,
  activeColor,
  activeWidthMm,
  eraserSettings,
  fingerDraws,
  highlighterSettings,
  inkDisplayColor,
  isInkTool,
  mmToFraction,
  nightInk,
  penActivity,
  penSettings,
  previousTool,
  setTool,
  tool,
  type EraserSettings,
  type PenStyle,
} from './tools.ts'
import './ink.css'

export interface InkLayerProps {
  page: number
  cssW: number
  cssH: number
  strokes: InkStroke[]
  onAddStroke(stroke: InkStroke): void
  onEraseStroke(id: string): void
  /** Replaces a stroke by its pieces; absent, the segment eraser removes whole strokes. */
  onReplaceStroke?(id: string, pieces: InkStroke[]): void
  /** Page width in millimetres; default A4_WIDTH_MM. */
  pageWidthMm?: number
  /** Dark paper: Black shows pale and the highlighter goes below the ink; default nightInk. */
  paperDark?: boolean
  /** False leaves committed strokes to StrokeSvg; default true. */
  showStrokes?: boolean
  /** During a segment-eraser contact, the working pieces of each stroke it split, keyed by that stroke's id; null when the contact ends. */
  onLivePieces?(pieces: Map<string, InkStroke[]> | null): void
}

/** Attribute on the scroller whose rect bounds the live canvas. */
export const INK_VIEWPORT_ATTR = 'data-ink-viewport'

const PALM_WINDOW_MS = 500
const SIMPLIFY_PX = 0.5
const HIGHLIGHTER_ALPHA = 0.4
const TAP_MAX_MS = 250
const TAP_SLOP_PX = 12
const DOUBLE_TAP_GAP_MS = 300
// Most eraser circles tested along the path between two samples; a longer jump spaces them wider.
const MAX_ERASE_STEPS = 64

// Isotropic points of a stroke and their bounding box [minX, minY, maxX, maxY].
interface IsoStroke {
  points: number[]
  box: [number, number, number, number]
}

// One eraser contact: its last centre, strokes it removed or split, working pieces and their page strokes, isotropic copies.
interface EraseContact {
  settings: EraserSettings
  last: [number, number] | null
  gone: Set<string>
  made: Map<string, InkStroke>
  origin: Map<string, string>
  split: Set<string>
  iso: Map<string, IsoStroke>
}

interface LiveStroke {
  pointerId: number
  pointerType: string
  tool: 'pen' | 'highlighter' | 'eraser'
  pen: PenStyle
  color: string
  width: number
  points: number[]
  predicted: number[]
  left: number
  top: number
  w: number
  h: number
  erase: EraseContact
  ctx: CanvasRenderingContext2D | null
  outline: LiveOutline
  chunks: Path2D[]
  real: boolean
}

type SafariTouch = Touch & { touchType?: string }

function isStylus(list: TouchList | Touch[]): boolean {
  for (let i = 0; i < list.length; i++) if ((list[i] as SafariTouch).touchType === 'stylus') return true
  return false
}

function fingers(list: TouchList | Touch[]): Touch[] {
  const out: Touch[] = []
  for (let i = 0; i < list.length; i++) if ((list[i] as SafariTouch).touchType !== 'stylus') out.push(list[i])
  return out
}

function samplesOf(e: PointerEvent): PointerEvent[] {
  const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
  return coalesced.length > 0 ? coalesced : [e]
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// Normalised points scaled to CSS px.
function cssPx(points: number[], cssW: number, cssH: number): number[] {
  const out = points.slice()
  for (let i = 0; i + 1 < out.length; i += 3) {
    out[i] *= cssW
    out[i + 1] *= cssH
  }
  return out
}

// Normalised points with y rescaled to page-width units so distances are isotropic.
function widthUnits(points: number[], aspect: number): number[] {
  const out = points.slice()
  for (let i = 1; i < out.length; i += 3) out[i] *= aspect
  return out
}

function isoStroke(points: number[]): IsoStroke {
  const box: IsoStroke['box'] = [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 1 < points.length; i += 3) {
    box[0] = Math.min(box[0], points[i])
    box[1] = Math.min(box[1], points[i + 1])
    box[2] = Math.max(box[2], points[i])
    box[3] = Math.max(box[3], points[i + 1])
  }
  return { points, box }
}

// First and last samples only.
function ends(points: number[]): number[] {
  return points.length <= 6 ? points.slice() : [...points.slice(0, 3), ...points.slice(-3)]
}

const paperIsDark = (p: InkLayerProps) => p.paperDark ?? nightInk.peek()
const pageMm = (p: InkLayerProps) => p.pageWidthMm ?? A4_WIDTH_MM

function finePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches
}

interface PathProps {
  stroke: InkStroke
  cssW: number
  cssH: number
  dark: boolean
}

function PenPath({ stroke, cssW, cssH, dark }: PathProps) {
  const pen = stroke.pen ?? 'fountain'
  const d = useMemo(
    () => inkOutlinePath(stroke.points, stroke.width, cssW, cssH, pen),
    [stroke.points, stroke.width, cssW, cssH, pen],
  )
  return <path d={d} fill={inkDisplayColor(stroke.color, dark)} />
}

function HighlighterPath({ stroke, cssW, cssH, dark }: PathProps) {
  const d = useMemo(() => highlighterPath(stroke.points, cssW, cssH), [stroke.points, cssW, cssH])
  return (
    <path
      d={d}
      fill="none"
      stroke={inkDisplayColor(stroke.color, dark)}
      stroke-width={stroke.width * cssW}
      stroke-linecap="square"
      stroke-linejoin="round"
      stroke-opacity={HIGHLIGHTER_ALPHA}
    />
  )
}

/** Committed strokes: svg.ink-pen and svg.ink-hl (highlighter above with multiply on light paper, below without it on dark paper). */
export function StrokeSvg(props: { strokes: InkStroke[]; cssW: number; cssH: number; paperDark: boolean }): JSX.Element {
  const { strokes, cssW, cssH, paperDark } = props
  const box = { width: cssW, height: cssH, viewBox: `0 0 ${cssW} ${cssH}`, 'aria-hidden': true } as const
  const pen = (
    <svg key="pen" class="ink-pen" {...box}>
      {strokes.map((s) =>
        s.deleted || s.tool === 'highlighter' ? null : (
          <PenPath key={s.id} stroke={s} cssW={cssW} cssH={cssH} dark={paperDark} />
        ),
      )}
    </svg>
  )
  const hl = (
    <svg key="hl" class={paperDark ? 'ink-hl' : 'ink-hl mg-multiply'} {...box}>
      {strokes.map((s) =>
        s.deleted || s.tool !== 'highlighter' ? null : (
          <HighlighterPath key={s.id} stroke={s} cssW={cssW} cssH={cssH} dark={paperDark} />
        ),
      )}
    </svg>
  )
  return paperDark ? <>{hl}{pen}</> : <>{pen}{hl}</>
}

export function InkLayer(props: InkLayerProps) {
  const { cssW, cssH, strokes } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const pending = useRef<EraseContact | null>(null)
  const [, setDrawn] = useState(0)
  const propsRef = useRef(props)
  propsRef.current = props

  // Intercepts drawing input on the parent page element in the capture phase; everything else passes through.
  useEffect(() => {
    const root = rootRef.current
    const parent = root?.parentElement
    if (!root || !parent) return
    let live: LiveStroke | null = null
    let disposed = false
    let frameId = 0
    let tapStart = 0
    let tapValid = false
    let tapFingers = 0
    let tapOrigin = new Map<number, [number, number]>()
    let lastTapEnd = -Infinity
    let lastTapFingers = 0

    const clearCanvas = () => {
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
    }

    // Places the live canvas over the visible part of the layer at full device pixel ratio, drawing in layer CSS px.
    const openCanvas = (): CanvasRenderingContext2D | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const page = root.getBoundingClientRect()
      const viewport = root.closest(`[${INK_VIEWPORT_ATTR}]`)
      const view = viewport?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      const left = Math.max(page.left, view.left)
      const top = Math.max(page.top, view.top)
      const w = Math.max(0, Math.min(page.right, view.right) - left)
      const h = Math.max(0, Math.min(page.bottom, view.bottom) - top)
      const offX = left - page.left
      const offY = top - page.top
      const dpr = window.devicePixelRatio || 1
      Object.assign(canvas.style, { left: `${offX}px`, top: `${offY}px`, width: `${w}px`, height: `${h}px` })
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.setTransform(dpr, 0, 0, dpr, -offX * dpr, -offY * dpr)
      return ctx
    }

    // Samples a highlighter stroke stores: simplified, or only its ends for a straight line.
    const highlighterSamples = (s: LiveStroke): number[] => {
      const stored = simplifyPoints(s.points, SIMPLIFY_PX / propsRef.current.cssW)
      return highlighterSettings.peek().straight ? ends(stored) : stored
    }

    // Strokes the whole live highlighter as one path, so its translucent ink never overlaps itself.
    const highlighterFrame = (s: LiveStroke, ctx: CanvasRenderingContext2D) => {
      const { cssW, cssH } = propsRef.current
      const stored = highlighterSamples(s)
      const points = highlighterSettings.peek().straight ? stored : stored.concat(s.predicted)
      ctx.globalAlpha = HIGHLIGHTER_ALPHA
      ctx.strokeStyle = inkDisplayColor(s.color, paperIsDark(propsRef.current))
      ctx.lineWidth = s.width * cssW
      ctx.lineCap = 'square'
      ctx.lineJoin = 'round'
      ctx.stroke(new Path2D(highlighterPath(points, cssW, cssH)))
    }

    // Draws the live stroke on the live canvas: the highlighter as one path, the pen as frozen chunks plus the tail.
    const frame = () => {
      frameId = 0
      const s = live
      if (!s?.ctx) return
      const { cssW, cssH } = propsRef.current
      s.ctx.clearRect(0, 0, cssW, cssH)
      if (s.tool === 'highlighter') {
        highlighterFrame(s, s.ctx)
        return
      }
      const stored = simplifyPoints(s.points, SIMPLIFY_PX / cssW)
      s.real = pressureVaries(stored)
      const { frozen, tail } = s.outline.update(cssPx(stored, cssW, cssH), cssPx(s.predicted, cssW, cssH))
      for (let i = s.chunks.length; i < frozen.length; i++) s.chunks.push(new Path2D(frozen[i]))
      s.ctx.fillStyle = inkDisplayColor(s.color, paperIsDark(propsRef.current))
      for (const chunk of s.chunks) s.ctx.fill(chunk)
      s.ctx.fill(new Path2D(tail))
    }

    const schedule = () => {
      if (!frameId) frameId = requestAnimationFrame(frame)
    }

    const redraw = () => {
      if (!disposed) setDrawn((n) => n + 1)
    }

    // Working pieces of each page stroke the contact split, keyed by that stroke's id.
    const piecesBySource = (c: EraseContact): Map<string, InkStroke[]> =>
      new Map([...c.split].map((id) => [id, [...c.made.values()].filter((piece) => c.origin.get(piece.id) === id)]))

    // Hands each page stroke the segment eraser split during the contact to the store: its final pieces, or an erase.
    const finishErase = (c: EraseContact) => {
      if (pending.current !== c) return
      const { onReplaceStroke, onEraseStroke, onLivePieces } = propsRef.current
      for (const [id, pieces] of piecesBySource(c)) {
        if (pieces.length && onReplaceStroke) onReplaceStroke(id, pieces)
        else onEraseStroke(id)
      }
      pending.current = null
      onLivePieces?.(null)
      redraw()
    }

    const discard = () => {
      if (live?.tool === 'eraser') finishErase(live.erase)
      if (frameId) cancelAnimationFrame(frameId)
      frameId = 0
      live = null
      clearCanvas()
      if (cursorRef.current) cursorRef.current.hidden = true
    }

    // Centres an overlay element on a pointer, in layer CSS px.
    const placeAt = (el: HTMLElement, e: PointerEvent, diameter: number) => {
      const { cssW, cssH } = propsRef.current
      const rect = root.getBoundingClientRect()
      const x = ((e.clientX - rect.left) * cssW) / (rect.width || cssW)
      const y = ((e.clientY - rect.top) * cssH) / (rect.height || cssH)
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${diameter}px`, height: `${diameter}px` })
      el.hidden = false
    }

    const moveEraserCursor = (s: LiveStroke, e: PointerEvent) => {
      const cursor = cursorRef.current
      if (!cursor || s.tool !== 'eraser') return
      const p = propsRef.current
      placeAt(cursor, e, (s.erase.settings.sizeMm * p.cssW) / pageMm(p))
    }

    const hideDot = () => {
      if (dotRef.current) dotRef.current.hidden = true
    }

    // Shows a dot of the active colour and width under a hovering pen while the pen or highlighter is selected.
    const hoverDot = (e: PointerEvent) => {
      const dot = dotRef.current
      const t = tool.peek()
      if (!dot) return
      if (t !== 'pen' && t !== 'highlighter') {
        hideDot()
        return
      }
      const p = propsRef.current
      dot.style.background = inkDisplayColor(activeColor(t), paperIsDark(p))
      placeAt(dot, e, mmToFraction(activeWidthMm(t), pageMm(p)) * p.cssW)
    }

    const swallow = (e: Event) => {
      e.stopImmediatePropagation()
      e.preventDefault()
    }

    const penActive = (t: number) => penActivity.down || t - penActivity.lastUp < PALM_WINDOW_MS

    const draws = (e: PointerEvent): boolean => {
      if (!isInkTool(tool.peek())) return false
      if (e.pointerType === 'pen') return true
      if (e.pointerType === 'mouse') return e.button === 0
      if (e.pointerType === 'touch') return fingerDraws.peek()
      return false
    }

    // Live strokes this contact may still erase: the page's, with the ones it split swapped for their working pieces.
    const erasable = (c: EraseContact): InkStroke[] => {
      const fresh = propsRef.current.strokes.filter((st) => !st.deleted && !c.gone.has(st.id))
      return [...fresh, ...c.made.values()]
    }

    // Erases what one eraser circle at isotropic (cx, cy) touches; true when it split a stroke.
    const eraseCircle = (c: EraseContact, cx: number, cy: number, aspect: number, reach: number): boolean => {
      const p = propsRef.current
      const { style, erasePen, eraseHighlighter } = c.settings
      const segment = style === 'segment' && p.onReplaceStroke !== undefined
      let didSplit = false
      for (const stroke of erasable(c)) {
        if (!(stroke.tool === 'highlighter' ? eraseHighlighter : erasePen)) continue
        const radius = reach + stroke.width / 2
        let iso = c.iso.get(stroke.id)
        if (!iso) {
          iso = isoStroke(widthUnits(stroke.points, aspect))
          c.iso.set(stroke.id, iso)
        }
        const [x0, y0, x1, y1] = iso.box
        if (cx < x0 - radius || cx > x1 + radius || cy < y0 - radius || cy > y1 + radius) continue
        if (!segment) {
          if (!strokeHitsPoint(iso.points, cx, cy, radius)) continue
          c.gone.add(stroke.id)
          p.onEraseStroke(stroke.id)
          continue
        }
        const kept = splitStrokeAt(iso.points, cx, cy, radius)
        if (!kept) continue
        const source = c.origin.get(stroke.id) ?? stroke.id
        const t = now()
        for (const points of kept) {
          const back = widthUnits(points, 1 / aspect)
          const piece: InkStroke = { ...stroke, id: newId(), points: back, createdAt: t, updatedAt: t }
          c.iso.set(piece.id, isoStroke(points))
          c.made.set(piece.id, piece)
          c.origin.set(piece.id, source)
        }
        c.gone.add(stroke.id)
        c.made.delete(stroke.id)
        c.split.add(source)
        didSplit = true
      }
      return didSplit
    }

    // Erases along the path from the previous sample to normalised (x, y), in circles no farther apart than the eraser's reach.
    const eraseAt = (s: LiveStroke, x: number, y: number) => {
      const c = s.erase
      const p = propsRef.current
      const aspect = p.cssH / p.cssW
      const reach = mmToFraction(c.settings.sizeMm / 2, pageMm(p))
      const to: [number, number] = [x, y * aspect]
      const from = c.last ?? to
      c.last = to
      const gap = Math.hypot(to[0] - from[0], to[1] - from[1])
      const steps = Math.min(MAX_ERASE_STEPS, Math.max(1, Math.ceil(gap / reach)))
      let didSplit = false
      for (let k = 1; k <= steps; k++) {
        const cx = from[0] + ((to[0] - from[0]) * k) / steps
        const cy = from[1] + ((to[1] - from[1]) * k) / steps
        if (eraseCircle(c, cx, cy, aspect, reach)) didSplit = true
      }
      if (didSplit) {
        pending.current = c
        p.onLivePieces?.(piecesBySource(c))
        redraw()
      }
    }

    // Pen pressure, or the previous stored sample's when the pen reports 0; 0.5 for the highlighter and other pointers.
    const pressureOf = (s: LiveStroke, e: PointerEvent): number => {
      if (s.pointerType !== 'pen' || s.tool === 'highlighter') return 0.5
      if (e.pressure > 0) return e.pressure
      return s.points.length > 0 ? s.points[s.points.length - 1] : 0.5
    }

    // Normalised [x, y, pressure] of a sample on the live stroke's page.
    const sampleOf = (s: LiveStroke, e: PointerEvent): [number, number, number] => [
      clamp01((e.clientX - s.left) / s.w),
      clamp01((e.clientY - s.top) / s.h),
      pressureOf(s, e),
    ]

    const addSample = (s: LiveStroke, e: PointerEvent) => {
      const [x, y, pressure] = sampleOf(s, e)
      if (s.tool === 'eraser') {
        eraseAt(s, x, y)
        return
      }
      s.points.push(x, y, pressure)
      schedule()
    }

    const isLive = (e: PointerEvent) => live !== null && e.pointerId === live.pointerId

    const swallowed = new Set<number>()

    // Swallows the rest of a pointer whose pointerdown was swallowed but which no longer draws.
    const isSwallowed = (e: PointerEvent, ends: boolean) => {
      if (!swallowed.has(e.pointerId)) return false
      if (ends) swallowed.delete(e.pointerId)
      return true
    }

    const abandon = () => {
      if (live) swallowed.add(live.pointerId)
      discard()
    }

    const penLifted = (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      penActivity.down = false
      penActivity.downOn = null
      penActivity.lastUp = now()
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        penActivity.down = true
        penActivity.downOn = parent
        hideDot()
      }
      if (e.pointerType === 'touch' && penActive(now())) {
        swallowed.add(e.pointerId)
        swallow(e)
        return
      }
      if (live) {
        if (e.pointerType === 'pen' && live.pointerType !== 'pen') abandon()
        else {
          if (e.pointerType === 'touch' && live.pointerType === 'touch') abandon()
          return
        }
      }
      if (!draws(e)) return
      swallow(e)
      try {
        parent.setPointerCapture(e.pointerId)
      } catch {
        // Ignores pointers that can no longer be captured.
      }
      const kind = tool.peek() as LiveStroke['tool']
      const p = propsRef.current
      const { cssW, cssH } = p
      const rect = root.getBoundingClientRect()
      const ink = kind === 'eraser' ? null : kind
      const s: LiveStroke = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        tool: kind,
        pen: penSettings.peek().style,
        color: ink ? activeColor(ink) : '',
        width: ink ? mmToFraction(activeWidthMm(ink), pageMm(p)) : 0,
        points: [],
        predicted: [],
        left: rect.left,
        top: rect.top,
        w: rect.width || cssW,
        h: rect.height || cssH,
        erase: {
          settings: eraserSettings.peek(),
          last: null,
          gone: new Set(),
          made: new Map(),
          origin: new Map(),
          split: new Set(),
          iso: new Map(),
        },
        ctx: ink ? openCanvas() : null,
        outline: createLiveOutline((pts, ends, length) =>
          strokeOutlinePath(pts, s.width * propsRef.current.cssW, s.real, s.pen, ends, length),
        ),
        chunks: [],
        real: false,
      }
      canvasRef.current?.classList.toggle('mg-multiply', kind === 'highlighter' && !paperIsDark(p))
      live = s
      moveEraserCursor(s, e)
      addSample(s, e)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'pen' && e.buttons === 0) {
        if (penActivity.down) penLifted(e)
        if (!live) hoverDot(e)
      }
      if (isSwallowed(e, false)) {
        swallow(e)
        return
      }
      if (!live || !isLive(e)) return
      swallow(e)
      const s = live
      const predicted = typeof e.getPredictedEvents === 'function' ? e.getPredictedEvents() : []
      s.predicted = predicted.flatMap((p) => sampleOf(s, p))
      for (const sample of samplesOf(e)) addSample(s, sample)
      moveEraserCursor(s, e)
    }

    const onPointerUp = (e: PointerEvent) => {
      penLifted(e)
      if (isSwallowed(e, true)) {
        swallow(e)
        return
      }
      if (!live || !isLive(e)) return
      swallow(e)
      const s = live
      if (s.tool === 'eraser') {
        discard()
        if (s.erase.settings.autoDeselect) setTool(previousTool.peek())
        return
      }
      const { page, cssW, onAddStroke } = propsRef.current
      const points = s.tool === 'highlighter' ? highlighterSamples(s) : simplifyPoints(s.points, SIMPLIFY_PX / cssW)
      discard()
      if (points.length === 0) return
      const t = now()
      onAddStroke({
        kind: 'ink',
        id: newId(),
        page,
        color: s.color,
        width: s.width,
        tool: s.tool,
        ...(s.tool === 'pen' ? { pen: s.pen } : {}),
        points,
        createdAt: t,
        updatedAt: t,
      })
    }

    const onPointerCancel = (e: PointerEvent) => {
      penLifted(e)
      if (isSwallowed(e, true)) {
        swallow(e)
        return
      }
      if (!live || !isLive(e)) return
      swallow(e)
      discard()
    }

    const guardStylus = (e: TouchEvent) => {
      if (isInkTool(tool.peek()) && isStylus(e.changedTouches)) e.preventDefault()
    }

    const onTouchStart = (e: TouchEvent) => {
      guardStylus(e)
      const down = fingers(e.touches)
      if ((down.length === 2 || down.length === 3) && down.length === e.touches.length && !penActive(now())) {
        tapStart = now()
        tapValid = true
        tapFingers = down.length
        tapOrigin = new Map(down.map((t) => [t.identifier, [t.clientX, t.clientY]]))
      } else {
        tapValid = false
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      guardStylus(e)
      if (!tapValid) return
      for (const t of fingers(e.changedTouches)) {
        const origin = tapOrigin.get(t.identifier)
        if (origin && Math.hypot(t.clientX - origin[0], t.clientY - origin[1]) > TAP_SLOP_PX) tapValid = false
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!tapValid || e.touches.length > 0) return
      tapValid = false
      const t = now()
      if (t - tapStart > TAP_MAX_MS) return
      if (tapFingers === lastTapFingers && tapStart - lastTapEnd <= DOUBLE_TAP_GAP_MS) {
        lastTapEnd = -Infinity
        document.dispatchEvent(new CustomEvent(tapFingers === 3 ? 'marginalia:redo' : 'marginalia:undo'))
      } else {
        lastTapEnd = t
        lastTapFingers = tapFingers
      }
    }

    const onTouchCancel = () => {
      tapValid = false
    }

    const capture = { capture: true } as const
    const activeCapture = { capture: true, passive: false } as const
    parent.addEventListener('pointerdown', onPointerDown, capture)
    parent.addEventListener('pointermove', onPointerMove, capture)
    parent.addEventListener('pointerup', onPointerUp, capture)
    parent.addEventListener('pointercancel', onPointerCancel, capture)
    parent.addEventListener('touchstart', onTouchStart, activeCapture)
    parent.addEventListener('touchmove', onTouchMove, activeCapture)
    parent.addEventListener('touchend', onTouchEnd, capture)
    parent.addEventListener('touchcancel', onTouchCancel, capture)
    parent.addEventListener('pointerleave', hideDot)
    return () => {
      disposed = true
      if (penActivity.down && penActivity.downOn === parent) {
        penActivity.down = false
        penActivity.downOn = null
        penActivity.lastUp = now()
      }
      discard()
      parent.removeEventListener('pointerdown', onPointerDown, capture)
      parent.removeEventListener('pointermove', onPointerMove, capture)
      parent.removeEventListener('pointerup', onPointerUp, capture)
      parent.removeEventListener('pointercancel', onPointerCancel, capture)
      parent.removeEventListener('touchstart', onTouchStart, capture)
      parent.removeEventListener('touchmove', onTouchMove, capture)
      parent.removeEventListener('touchend', onTouchEnd, capture)
      parent.removeEventListener('touchcancel', onTouchCancel, capture)
      parent.removeEventListener('pointerleave', hideDot)
    }
  }, [])

  const current = tool.value
  const dark = props.paperDark ?? nightInk.value
  const erasing = pending.current
  const shown = erasing ? [...strokes.filter((st) => !erasing.gone.has(st.id)), ...erasing.made.values()] : strokes
  return (
    <div
      ref={rootRef}
      class="ink-layer"
      data-tool={current}
      data-mouse-draws={isInkTool(current) && finePointer() ? '' : undefined}
      data-finger-draws={fingerDraws.value ? '' : undefined}
      style={{ width: `${cssW}px`, height: `${cssH}px` }}
    >
      {props.showStrokes !== false && <StrokeSvg strokes={shown} cssW={cssW} cssH={cssH} paperDark={dark} />}
      <canvas ref={canvasRef} width={0} height={0} />
      <div ref={cursorRef} class="ink-eraser-cursor" hidden />
      <div ref={dotRef} class="ink-hover-dot" hidden />
    </div>
  )
}
