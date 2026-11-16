// Pointer gestures on the map canvas: tap, pan, pinch, node drag in map units (mouse drag or touch press-and-hold) and hull double-tap.
import { useEffect, useRef } from 'preact/hooks'
import { panBy, zoomAt, type Viewport } from './viewport'

const MOVE_SLOP = 4
const HOLD_MS = 300
const DOUBLE_TAP_MS = 350
const WHEEL_BASE = 1.1

type Pt = { x: number; y: number }

export interface GestureHandlers {
  view(): Viewport | null
  setView(v: Viewport): void
  tapNode(id: string): void
  tapEdge(id: string): void
  tapEmpty(): void
  doubleTapHull(topic: string): void
  dragNode(id: string, by: Pt): void
  dropNode(id: string, by: Pt): void
  cancelDrag(): void
}

interface Gesture {
  kind: 'node' | 'canvas' | 'pan' | 'drag' | 'pinch'
  start: Pt
  v0: Viewport
  node?: string
  hull?: string
  edge?: string
  touch: boolean
  held: boolean
  moved: boolean
  d0?: number
  m0?: Pt
  last?: Pt
}

const attr = (t: EventTarget | null, name: string): string | undefined =>
  (t instanceof Element ? t.closest(`[${name}]`)?.getAttribute(name) : null) ?? undefined

// Wires pointer and wheel gestures on the svg; handlers are read fresh on every event.
export function useGestures(svg: { current: SVGSVGElement | null }, handlers: GestureHandlers) {
  const h = useRef(handlers)
  h.current = handlers
  const pointers = useRef(new Map<number, Pt>())
  const gesture = useRef<Gesture | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastTap = useRef<{ hull: string; t: number } | null>(null)

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }

  useEffect(() => {
    const el = svg.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = h.current.view()
      if (!v) return
      const p = local(e)
      h.current.setView(zoomAt(v, Math.pow(WHEEL_BASE, -e.deltaY / 100), p.x, p.y))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const startPinch = (v0: Viewport) => {
    const [a, b] = [...pointers.current.values()]
    gesture.current = { kind: 'pinch', start: a, v0, touch: true, held: false, moved: true, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
    h.current.cancelDrag()
  }

  const onPointerDown = (e: PointerEvent) => {
    const v0 = h.current.view()
    if (!v0) return
    pointers.current.set(e.pointerId, local(e))
    try {
      svg.current?.setPointerCapture(e.pointerId)
    } catch {
      // Leaves uncapturable pointers uncaptured.
    }
    clearTimeout(timer.current)
    if (pointers.current.size === 2) return startPinch(v0)
    if (pointers.current.size > 2) return
    const node = attr(e.target, 'data-node')
    const g: Gesture = {
      kind: node ? 'node' : 'canvas',
      start: local(e),
      v0,
      node,
      hull: attr(e.target, 'data-hull'),
      edge: attr(e.target, 'data-edge'),
      touch: e.pointerType === 'touch',
      held: false,
      moved: false,
    }
    gesture.current = g
    if (node && g.touch) timer.current = setTimeout(() => (g.held = !g.moved), HOLD_MS)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (!a || !b) return
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / g.d0!
      h.current.setView(zoomAt(panBy(g.v0, m.x - g.m0!.x, m.y - g.m0!.y), ratio, m.x, m.y))
      return
    }
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < MOVE_SLOP) return
    if (!g.moved) {
      g.moved = true
      clearTimeout(timer.current)
      g.kind = g.kind === 'node' && (!g.touch || g.held) ? 'drag' : 'pan'
    }
    if (g.kind === 'pan') h.current.setView(panBy(g.v0, p.x - g.start.x, p.y - g.start.y))
    else if (g.kind === 'drag') {
      g.last = { x: (p.x - g.start.x) / g.v0.k, y: (p.y - g.start.y) / g.v0.k }
      h.current.dragNode(g.node!, g.last)
    }
  }

  const finish = (e: PointerEvent, cancelled: boolean) => {
    pointers.current.delete(e.pointerId)
    clearTimeout(timer.current)
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null
      return
    }
    gesture.current = null
    if (g.kind === 'drag') return cancelled || !g.last ? h.current.cancelDrag() : h.current.dropNode(g.node!, g.last)
    if (cancelled || g.moved) return
    if (g.node) return h.current.tapNode(g.node)
    if (g.edge) return h.current.tapEdge(g.edge)
    const t = Date.now()
    if (g.hull && lastTap.current?.hull === g.hull && t - lastTap.current.t < DOUBLE_TAP_MS) {
      lastTap.current = null
      return h.current.doubleTapHull(g.hull)
    }
    lastTap.current = g.hull ? { hull: g.hull, t } : null
    h.current.tapEmpty()
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: PointerEvent) => finish(e, false),
    onPointerCancel: (e: PointerEvent) => finish(e, true),
  }
}
