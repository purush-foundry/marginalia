import { useEffect, useMemo, useRef } from 'preact/hooks'
import { newId, now } from '../lib/ids.ts'
import type { InkStroke } from '../types.ts'
import { simplifyPoints, strokeHitsPoint, strokeOutlinePath } from './geometry.ts'
import { fingerDraws, mouseDraws, penColor, penTool, penWidth } from './tools.ts'
import './ink.css'

export interface InkLayerProps {
  page: number
  cssW: number
  cssH: number
  strokes: InkStroke[]
  onAddStroke(stroke: InkStroke): void
  onEraseStroke(id: string): void
}

const PALM_WINDOW_MS = 500
const ERASER_MIN_PX = 12
const SIMPLIFY_PX = 0.5
const LIVE_CANVAS_MAX_PIXELS = 4_000_000
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
  left: number
  top: number
  w: number
  h: number
  erased: Set<string>
  ctx: CanvasRenderingContext2D | null
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

// True when the stroke's recorded pressure varies, i.e. it came from a pressure-sensing pen.
function pressureVaries(points: number[]): boolean {
  for (let i = 5; i < points.length; i += 3) if (points[i] !== points[2]) return true
  return false
}

// Normalised points with y rescaled to page-width units so distances are isotropic.
function widthUnits(points: number[], aspect: number): number[] {
  const out = points.slice()
  for (let i = 1; i < out.length; i += 3) out[i] *= aspect
  return out
}

function StrokePath({ stroke, cssW, cssH }: { stroke: InkStroke; cssW: number; cssH: number }) {
  const d = useMemo(() => {
    const px = stroke.points.slice()
    for (let i = 0; i + 1 < px.length; i += 3) {
      px[i] *= cssW
      px[i + 1] *= cssH
    }
    return strokeOutlinePath(px, stroke.width * cssW, pressureVaries(stroke.points))
  }, [stroke.points, stroke.width, cssW, cssH])
  return <path d={d} fill={stroke.color} />
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
    let lastPenUp = -Infinity
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

    const openCanvas = (color: string, widthPx: number): CanvasRenderingContext2D | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const { cssW, cssH } = propsRef.current
      const scale = Math.min(window.devicePixelRatio || 1, Math.sqrt(LIVE_CANVAS_MAX_PIXELS / (cssW * cssH)))
      canvas.width = Math.max(1, Math.round(cssW * scale))
      canvas.height = Math.max(1, Math.round(cssH * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.strokeStyle = color
      ctx.lineWidth = widthPx
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      return ctx
    }

    const discard = () => {
      live = null
      clearCanvas()
    }

    const swallow = (e: Event) => {
      e.stopPropagation()
      e.preventDefault()
    }

    const penActive = (t: number) => (live !== null && live.pointerType === 'pen') || t - lastPenUp < PALM_WINDOW_MS

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

    const addSample = (s: LiveStroke, e: PointerEvent) => {
      const x = clamp01((e.clientX - s.left) / s.w)
      const y = clamp01((e.clientY - s.top) / s.h)
      if (s.tool === 'eraser') {
        eraseAt(s, x, y)
        return
      }
      const pressure = s.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5
      const n = s.points.length
      s.points.push(x, y, pressure)
      if (s.ctx && n >= 3) {
        const { cssW, cssH } = propsRef.current
        s.ctx.beginPath()
        s.ctx.moveTo(s.points[n - 3] * cssW, s.points[n - 2] * cssH)
        s.ctx.lineTo(x * cssW, y * cssH)
        s.ctx.stroke()
      }
    }

    const isLive = (e: PointerEvent) => live !== null && e.pointerId === live.pointerId

    const palms = new Set<number>()

    // Swallows the rest of a touch pointer whose pointerdown was rejected as a palm.
    const isPalm = (e: PointerEvent, ends: boolean) => {
      if (!palms.has(e.pointerId)) return false
      if (ends) palms.delete(e.pointerId)
      return true
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && penActive(now())) {
        palms.add(e.pointerId)
        swallow(e)
        return
      }
      if (live) {
        if (e.pointerType === 'pen' && live.pointerType !== 'pen') discard()
        else {
          if (e.pointerType === 'touch' && live.pointerType === 'touch') discard()
          return
        }
      }
      if (!draws(e)) return
      swallow(e)
      try {
        parent.setPointerCapture(e.pointerId)
      } catch {
        // Capture is best-effort; synthetic or already-released pointers cannot be captured.
      }
      const tool = penTool.value === 'eraser' ? 'eraser' : 'pen'
      const { cssW, cssH } = propsRef.current
      const rect = root.getBoundingClientRect()
      const width = penWidth.value
      const color = penColor.value
      live = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        tool,
        color,
        width,
        points: [],
        left: rect.left,
        top: rect.top,
        w: rect.width || cssW,
        h: rect.height || cssH,
        erased: new Set(),
        ctx: tool === 'pen' ? openCanvas(color, width * cssW) : null,
      }
      addSample(live, e)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (isPalm(e, false)) {
        swallow(e)
        return
      }
      if (!live || !isLive(e)) return
      swallow(e)
      for (const sample of samplesOf(e)) addSample(live, sample)
    }

    const onPointerUp = (e: PointerEvent) => {
      if (isPalm(e, true)) {
        swallow(e)
        return
      }
      if (!live || !isLive(e)) return
      swallow(e)
      const s = live
      discard()
      if (s.pointerType === 'pen') lastPenUp = now()
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
      if (isPalm(e, true)) {
        swallow(e)
        return
      }
      if (!live || !isLive(e)) return
      swallow(e)
      if (live.pointerType === 'pen') lastPenUp = now()
      discard()
    }

    const guardStylus = (e: TouchEvent) => {
      if (penTool.value !== 'select' && isStylus(e.changedTouches)) e.preventDefault()
    }

    const onTouchStart = (e: TouchEvent) => {
      guardStylus(e)
      const down = fingers(e.touches)
      if (down.length === 2 && down.length === e.touches.length && !(live && live.pointerType === 'pen')) {
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
