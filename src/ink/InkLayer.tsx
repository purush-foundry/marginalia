import { useEffect, useMemo, useRef } from 'preact/hooks'
import { newId, now } from '../lib/ids.ts'
import type { InkStroke } from '../types.ts'
import { inkOutlinePath, pressureVaries, simplifyPoints, strokeHitsPoint, strokeOutlinePath } from './geometry.ts'
import { createLiveOutline, type LiveOutline } from './liveOutline.ts'
import { fingerDraws, inkDisplayColor, mouseDraws, penActivity, penColor, penTool, penWidth } from './tools.ts'
import './ink.css'

export interface InkLayerProps {
  page: number
  cssW: number
  cssH: number
  strokes: InkStroke[]
  onAddStroke(stroke: InkStroke): void
  onEraseStroke(id: string): void
}

/** Attribute on the scroller whose rect bounds the live canvas. */
export const INK_VIEWPORT_ATTR = 'data-ink-viewport'

const PALM_WINDOW_MS = 500
const ERASER_MIN_PX = 12
const SIMPLIFY_PX = 0.5
const TAP_MAX_MS = 250
const TAP_SLOP_PX = 12
const DOUBLE_TAP_GAP_MS = 300

interface LiveStroke {
  pointerId: number
  pointerType: string
  tool: 'pen' | 'eraser'
  color: string
  width: number
  points: number[]
  predicted: number[]
  left: number
  top: number
  w: number
  h: number
  erased: Set<string>
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

function StrokePath({ stroke, cssW, cssH }: { stroke: InkStroke; cssW: number; cssH: number }) {
  const d = useMemo(
    () => inkOutlinePath(stroke.points, stroke.width, cssW, cssH),
    [stroke.points, stroke.width, cssW, cssH],
  )
  return <path d={d} fill={inkDisplayColor(stroke.color)} />
}

export function InkLayer(props: InkLayerProps) {
  const { cssW, cssH, strokes } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  // Intercepts drawing input on the parent page element in the capture phase; everything else passes through.
  useEffect(() => {
    const root = rootRef.current
    const parent = root?.parentElement
    if (!root || !parent) return
    let live: LiveStroke | null = null
    let frameId = 0
    let tapStart = 0
    let tapValid = false
    let tapOrigin = new Map<number, [number, number]>()
    let lastTapEnd = -Infinity

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

    // Fills the live stroke's frozen chunks and its tail, predicted samples included, on the live canvas.
    const frame = () => {
      frameId = 0
      const s = live
      if (!s?.ctx) return
      const { cssW, cssH } = propsRef.current
      const stored = simplifyPoints(s.points, SIMPLIFY_PX / cssW)
      s.real = pressureVaries(stored)
      const { frozen, tail } = s.outline.update(cssPx(stored, cssW, cssH), cssPx(s.predicted, cssW, cssH))
      for (let i = s.chunks.length; i < frozen.length; i++) s.chunks.push(new Path2D(frozen[i]))
      s.ctx.clearRect(0, 0, cssW, cssH)
      s.ctx.fillStyle = inkDisplayColor(s.color)
      for (const chunk of s.chunks) s.ctx.fill(chunk)
      s.ctx.fill(new Path2D(tail))
    }

    const schedule = () => {
      if (!frameId) frameId = requestAnimationFrame(frame)
    }

    const discard = () => {
      if (frameId) cancelAnimationFrame(frameId)
      frameId = 0
      live = null
      clearCanvas()
    }

    const swallow = (e: Event) => {
      e.stopImmediatePropagation()
      e.preventDefault()
    }

    const penActive = (t: number) => penActivity.down || t - penActivity.lastUp < PALM_WINDOW_MS

    const draws = (e: PointerEvent): boolean => {
      if (penTool.value === 'select') return false
      if (e.pointerType === 'pen') return true
      if (e.pointerType === 'mouse') return mouseDraws.value && e.button === 0
      if (e.pointerType === 'touch') return fingerDraws.value
      return false
    }

    const eraseAt = (s: LiveStroke, x: number, y: number) => {
      const { cssW, cssH, strokes, onEraseStroke } = propsRef.current
      const aspect = cssH / cssW
      const radius = Math.max(penWidth.value * 3, ERASER_MIN_PX / cssW)
      for (const stroke of strokes) {
        if (stroke.deleted || s.erased.has(stroke.id)) continue
        if (strokeHitsPoint(widthUnits(stroke.points, aspect), x, y * aspect, radius)) {
          s.erased.add(stroke.id)
          onEraseStroke(stroke.id)
        }
      }
    }

    // Pen pressure, or the previous stored sample's when the pen reports 0; 0.5 for other pointers.
    const pressureOf = (s: LiveStroke, e: PointerEvent): number => {
      if (s.pointerType !== 'pen') return 0.5
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
      const tool = penTool.value === 'eraser' ? 'eraser' : 'pen'
      const { cssW, cssH } = propsRef.current
      const rect = root.getBoundingClientRect()
      const width = penWidth.value
      const color = penColor.value
      const s: LiveStroke = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        tool,
        color,
        width,
        points: [],
        predicted: [],
        left: rect.left,
        top: rect.top,
        w: rect.width || cssW,
        h: rect.height || cssH,
        erased: new Set(),
        ctx: tool === 'pen' ? openCanvas() : null,
        outline: createLiveOutline((pts, ends) =>
          strokeOutlinePath(pts, s.width * propsRef.current.cssW, s.real, 'fountain', ends),
        ),
        chunks: [],
        real: false,
      }
      live = s
      addSample(s, e)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'pen' && e.buttons === 0 && penActivity.down) penLifted(e)
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
      discard()
      if (s.tool !== 'pen' || s.points.length === 0) return
      const { page, cssW, onAddStroke } = propsRef.current
      const t = now()
      onAddStroke({
        kind: 'ink',
        id: newId(),
        page,
        color: s.color,
        width: s.width,
        tool: 'pen',
        points: simplifyPoints(s.points, SIMPLIFY_PX / cssW),
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
      if (penTool.value !== 'select' && isStylus(e.changedTouches)) e.preventDefault()
    }

    const onTouchStart = (e: TouchEvent) => {
      guardStylus(e)
      const down = fingers(e.touches)
      if (down.length === 2 && down.length === e.touches.length && !penActive(now())) {
        tapStart = now()
        tapValid = true
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
      if (tapStart - lastTapEnd <= DOUBLE_TAP_GAP_MS) {
        lastTapEnd = -Infinity
        document.dispatchEvent(new CustomEvent('marginalia:undo'))
      } else {
        lastTapEnd = t
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
    return () => {
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
    }
  }, [])

  return (
    <div
      ref={rootRef}
      class="ink-layer"
      data-tool={penTool.value}
      data-mouse-draws={mouseDraws.value ? '' : undefined}
      data-finger-draws={fingerDraws.value ? '' : undefined}
      style={{ width: `${cssW}px`, height: `${cssH}px` }}
    >
      <svg width={cssW} height={cssH} viewBox={`0 0 ${cssW} ${cssH}`} aria-hidden="true">
        {strokes.map((s) => (s.deleted ? null : <StrokePath key={s.id} stroke={s} cssW={cssW} cssH={cssH} />))}
      </svg>
      <canvas ref={canvasRef} width={0} height={0} />
    </div>
  )
}
