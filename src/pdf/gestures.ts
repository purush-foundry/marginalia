import type { RefObject } from 'preact'
import { useEffect, useMemo } from 'preact/hooks'
import { highlightAt } from '../annot/HighlightLayer.tsx'
import { selectionToBoxes } from '../annot/selection.ts'
import type { Box } from '../types.ts'
import { type Anchor, type Crop, PAD_X, clampScale } from './layout.ts'
import { columnAt, joinLines, linesIntersecting } from './text.ts'
import type { PendingSelection, ViewerProps } from './Viewer.tsx'

export type Zoom = 'fit-width' | number

/** Latest render-time values, read by long-lived event handlers. */
export interface Live {
  props: ViewerProps
  crop: Crop
  sizes: { w: number; h: number }[]
  viewport: { w: number; h: number }
  zoom: Zoom
  scale: number
}

/** Scroll and zoom operations the gesture hooks drive. */
export interface ViewerApi {
  requestZoom(mode: Zoom, anchor: Anchor | null): void
  anchorAtViewport(vx: number, vy: number): Anchor | null
}

/** Flags one gesture hook sets and the others read. */
export interface GestureFlags {
  pinching: boolean
  areaDragging: boolean
  /** Pointer that started the latest area drag; reset on every pointerdown. */
  areaPointer: number | null
  columnZoomed: boolean
  wheelScale: number | null
}

/** De-duplicating sink for `onSelection` shared by text and area selection. */
export interface SelectionSink {
  emit(sel: PendingSelection | null): void
  clear(kind: 'text' | 'area'): void
}

type ScrollerRef = RefObject<HTMLDivElement | null>
type LiveRef = { current: Live }

const SELECTION_DEBOUNCE_MS = 80
const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP_PX = 8
const TAP_SLOP_PX = 8
const DOUBLE_TAP_SLOP_PX = 30
const TAP_MS = 300
const HIGHLIGHT_TAP_MS = 400
const DOUBLE_TAP_MS = 300
const MIN_AREA = 0.01
const WHEEL_PIXEL_STEP = 0.002
const WHEEL_LINE_STEP = 0.05

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

type SafariTouch = Touch & { touchType?: string }

function penIgnored(live: LiveRef, e: PointerEvent): boolean {
  return e.pointerType === 'pen' && live.current.props.penDrawing?.peek() === true
}

function stylusIgnored(live: LiveRef, touches: TouchList): boolean {
  if (live.current.props.penDrawing?.peek() !== true) return false
  for (let i = 0; i < touches.length; i++) if ((touches[i] as SafariTouch).touchType === 'stylus') return true
  return false
}

export function pageFraction(inner: Element, clientX: number, clientY: number): { fx: number; fy: number } {
  const r = inner.getBoundingClientRect()
  return { fx: clamp01((clientX - r.left) / r.width), fy: clamp01((clientY - r.top) / r.height) }
}

export function boxToClient(inner: Element, b: Box): DOMRect {
  const r = inner.getBoundingClientRect()
  return new DOMRect(r.left + b.x * r.width, r.top + b.y * r.height, b.w * r.width, b.h * r.height)
}

function touchDistance(t: TouchList): number {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
}

function touchMid(t: TouchList): { x: number; y: number } {
  return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 }
}

export function useSelectionSink(live: LiveRef): SelectionSink {
  return useMemo(() => {
    let last: { key: string; kind: 'text' | 'area' } | null = null
    const sink: SelectionSink = {
      emit(sel) {
        if (!sel) {
          if (!last) return
          last = null
          live.current.props.onSelection(null)
          return
        }
        const key = JSON.stringify([sel.kind, sel.page, sel.boxes, sel.text])
        if (last?.key === key) return
        last = { key, kind: sel.kind }
        live.current.props.onSelection(sel)
      },
      clear(kind) {
        if (last?.kind === kind) sink.emit(null)
      },
    }
    return sink
  }, [])
}

/** Native text selection in the text layers → `kind: 'text'` selections. */
export function useTextSelection(scrollerRef: ScrollerRef, live: LiveRef, sink: SelectionSink, flags: GestureFlags) {
  useEffect(() => {
    const el = scrollerRef.current!
    let mouseDown = false
    let timer = 0
    let seq = 0

    const check = async () => {
      const mine = ++seq
      if (mouseDown || flags.areaDragging) return
      const sel = document.getSelection()
      if (!sel || sel.rangeCount === 0) return sink.clear('text')
      const range = sel.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) return
      if (sel.isCollapsed) return sink.clear('text')
      const start = range.startContainer
      const startEl = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement
      const pageEl =
        startEl?.closest<HTMLElement>('.mg-page') ??
        [...el.querySelectorAll<HTMLElement>('.mg-page')].find((p) => {
          const layer = p.querySelector('.textLayer')
          return layer !== null && range.intersectsNode(layer)
        })
      const layer = pageEl?.querySelector<HTMLElement>('.textLayer')
      if (!pageEl || !layer) return sink.clear('text')
      const page = Number(pageEl.dataset.page)
      const pageText = await live.current.props.doc.getPageText(page)
      if (mine !== seq) return
      const res = selectionToBoxes(range, layer, pageText)
      if (!res) return sink.clear('text')
      const last = res.boxes[res.boxes.length - 1]
      sink.emit({ page, boxes: res.boxes, text: res.text, endRect: boxToClient(layer, last), kind: 'text' })
    }

    const schedule = (ms: number) => {
      clearTimeout(timer)
      timer = window.setTimeout(() => void check().catch(console.error), ms)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0 || flags.pinching || penIgnored(live, e)) return
      if (live.current.props.areaSelectArmed.peek()) return
      const target = e.target as Element
      const pageEl = target.closest<HTMLElement>('.mg-page')
      if (!pageEl || target.closest('.mg-link')) return
      mouseDown = true
      if (!target.closest('.textLayer span')) document.getSelection()?.removeAllRanges()
      pageEl.querySelector('.textLayer')?.classList.add('selecting')
    }

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || !mouseDown) return
      mouseDown = false
      el.querySelectorAll('.textLayer.selecting').forEach((l) => l.classList.remove('selecting'))
      schedule(0)
    }

    const onSelectionChange = () => schedule(SELECTION_DEBOUNCE_MS)

    el.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerUp)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [])
}

/** Rectangle drag when armed or after a touch long-press on non-text → `kind: 'area'` selections. */
export function useAreaSelect(
  scrollerRef: ScrollerRef,
  live: LiveRef,
  sink: SelectionSink,
  flags: GestureFlags,
  setArea: (a: { page: number; box: Box } | null) => void,
  areaShown: { current: { page: number; box: Box } | null },
) {
  const armed = live.current.props.areaSelectArmed.value
  const state = useMemo(
    () => ({
      drag: null as null | { page: number; pointerId: number; inner: HTMLElement; x0: number; y0: number; x1: number; y1: number },
      pointerType: 'mouse',
    }),
    [],
  )

  useEffect(() => {
    const el = scrollerRef.current!
    let longPress: { timer: number; x: number; y: number; pointerId: number } | null = null

    const cancelLongPress = () => {
      if (longPress) clearTimeout(longPress.timer)
      longPress = null
    }

    const boxOf = (d: NonNullable<typeof state.drag>): Box => ({
      x: Math.min(d.x0, d.x1),
      y: Math.min(d.y0, d.y1),
      w: Math.abs(d.x1 - d.x0),
      h: Math.abs(d.y1 - d.y0),
    })

    const start = (pointerId: number, clientX: number, clientY: number, pageEl: HTMLElement) => {
      const inner = pageEl.querySelector<HTMLElement>('.mg-page-inner')
      if (!inner) return
      const page = Number(pageEl.dataset.page)
      const { fx, fy } = pageFraction(inner, clientX, clientY)
      state.drag = { page, pointerId, inner, x0: fx, y0: fy, x1: fx, y1: fy }
      flags.areaDragging = true
      flags.areaPointer = pointerId
      el.classList.add('mg-dragging')
      try {
        el.setPointerCapture(pointerId)
      } catch {
        // pointer already released
      }
      document.getSelection()?.removeAllRanges()
      sink.clear('text')
      setArea({ page, box: { x: fx, y: fy, w: 0, h: 0 } })
    }

    const finish = async (cancelled: boolean) => {
      const d = state.drag
      if (!d) return
      state.drag = null
      flags.areaDragging = false
      el.classList.remove('mg-dragging')
      const box = boxOf(d)
      if (cancelled || box.w < MIN_AREA || box.h < MIN_AREA) {
        setArea(null)
        return
      }
      setArea({ page: d.page, box })
      const endRect = boxToClient(d.inner, box)
      const pageText = await live.current.props.doc.getPageText(d.page).catch(() => null)
      const text = pageText ? linesIntersecting(pageText, box).reduce((t, l) => joinLines(t, l.text), '') : ''
      sink.emit({ page: d.page, boxes: [box], text, endRect, kind: 'area' })
    }

    const onPointerDown = (e: PointerEvent) => {
      flags.areaPointer = null
      if (penIgnored(live, e)) return
      state.pointerType = e.pointerType
      const target = e.target as Element
      if (areaShown.current) setArea(null)
      sink.clear('area')
      if (target.closest('.mg-link')) return
      const pageEl = target.closest<HTMLElement>('.mg-page')
      if (!pageEl || flags.pinching) return
      if (live.current.props.areaSelectArmed.peek() && e.button === 0) {
        e.preventDefault()
        start(e.pointerId, e.clientX, e.clientY, pageEl)
        return
      }
      if (e.pointerType !== 'touch' || !e.isPrimary || target.closest('.textLayer span')) return
      const { clientX, clientY, pointerId } = e
      longPress = {
        x: clientX,
        y: clientY,
        pointerId,
        timer: window.setTimeout(() => {
          longPress = null
          if (flags.pinching) return
          start(pointerId, clientX, clientY, pageEl)
          navigator.vibrate?.(10)
        }, LONG_PRESS_MS),
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (longPress && e.pointerId === longPress.pointerId) {
        if (Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > LONG_PRESS_SLOP_PX) cancelLongPress()
      }
      const d = state.drag
      if (d && e.pointerId === d.pointerId) {
        const { fx, fy } = pageFraction(d.inner, e.clientX, e.clientY)
        d.x1 = fx
        d.y1 = fy
        setArea({ page: d.page, box: boxOf(d) })
      }
    }

    const onPointerEnd = (e: PointerEvent) => {
      if (longPress?.pointerId === e.pointerId) cancelLongPress()
      if (state.drag?.pointerId === e.pointerId) void finish(e.type === 'pointercancel')
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) cancelLongPress()
    }

    const onTouchMove = (e: TouchEvent) => {
      if (state.drag) e.preventDefault()
    }

    const onContextMenu = (e: Event) => {
      if (state.pointerType !== 'touch') return
      const target = e.target as Element
      if (target.closest('.mg-page') && !target.closest('.textLayer span')) e.preventDefault()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerEnd)
    document.addEventListener('pointercancel', onPointerEnd)
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('contextmenu', onContextMenu)
    return () => {
      cancelLongPress()
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerEnd)
      document.removeEventListener('pointercancel', onPointerEnd)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  useEffect(() => {
    if (armed || !state.drag) return
    state.drag = null
    flags.areaDragging = false
    scrollerRef.current?.classList.remove('mg-dragging')
    setArea(null)
  }, [armed])
}

/** A tap (no selection, little movement) on a highlight → `onTapHighlight`. */
export function useHighlightTap(scrollerRef: ScrollerRef, live: LiveRef, sink: SelectionSink, flags: GestureFlags) {
  useEffect(() => {
    const el = scrollerRef.current!
    let down: { pointerId: number; x: number; y: number; t: number; pageEl: HTMLElement } | null = null

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element
      const pageEl = target.closest<HTMLElement>('.mg-page')
      const tappable = e.isPrimary && pageEl && !target.closest('.mg-link') && !penIgnored(live, e)
      down = tappable ? { pointerId: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), pageEl } : null
    }

    const onPointerUp = (e: PointerEvent) => {
      const d = down
      down = null
      if (!d || d.pointerId !== e.pointerId || flags.pinching || flags.areaPointer === e.pointerId) return
      if (Date.now() - d.t > HIGHLIGHT_TAP_MS) return
      if (live.current.props.areaSelectArmed.peek()) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= TAP_SLOP_PX) return
      const sel = document.getSelection()
      if (sel && !sel.isCollapsed && sel.anchorNode && el.contains(sel.anchorNode)) return
      const inner = d.pageEl.querySelector('.mg-page-inner')
      if (!inner) return
      const page = Number(d.pageEl.dataset.page)
      const { fx, fy } = pageFraction(inner, e.clientX, e.clientY)
      const onPage = live.current.props.highlights.peek().filter((h) => h.page === page)
      const hit = highlightAt(onPage, fx, fy)
      if (!hit) return
      sink.clear('text')
      live.current.props.onTapHighlight(hit.id, boxToClient(inner, hit.box))
    }

    el.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerup', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerup', onPointerUp)
    }
  }, [])
}

/** Ctrl/⌘ + wheel zoom at the cursor and two-finger pinch (CSS transform while pinching, re-layout on release). */
export function usePinchWheelZoom(
  scrollerRef: ScrollerRef,
  pagesRef: RefObject<HTMLDivElement | null>,
  live: LiveRef,
  api: ViewerApi,
  flags: GestureFlags,
) {
  useEffect(() => {
    const el = scrollerRef.current!
    let pinch: { d0: number; s0: number; vx0: number; vy0: number; vx: number; vy: number; k: number; anchor: Anchor } | null =
      null

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const base = flags.wheelScale ?? live.current.scale
      const step = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_STEP : WHEEL_PIXEL_STEP
      const next = clampScale(base * Math.exp(-e.deltaY * step))
      flags.wheelScale = next
      flags.columnZoomed = false
      api.requestZoom(next, api.anchorAtViewport(e.clientX - r.left, e.clientY - r.top))
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || flags.areaDragging || !pagesRef.current) return
      const r = el.getBoundingClientRect()
      const mid = touchMid(e.touches)
      const vx = mid.x - r.left
      const vy = mid.y - r.top
      const anchor = api.anchorAtViewport(vx, vy)
      if (!anchor) return
      pinch = { d0: Math.max(1, touchDistance(e.touches)), s0: live.current.scale, vx0: vx, vy0: vy, vx, vy, k: 1, anchor }
      flags.pinching = true
      pagesRef.current.style.transformOrigin = `${el.scrollLeft + vx}px ${el.scrollTop + vy}px`
    }

    const onTouchMove = (e: TouchEvent) => {
      const pages = pagesRef.current
      if (!pinch || !pages) return
      e.preventDefault()
      if (e.touches.length < 2) return
      const r = el.getBoundingClientRect()
      const mid = touchMid(e.touches)
      pinch.vx = mid.x - r.left
      pinch.vy = mid.y - r.top
      pinch.k = clampScale(pinch.s0 * (touchDistance(e.touches) / pinch.d0)) / pinch.s0
      pages.style.transform = `translate(${pinch.vx - pinch.vx0}px, ${pinch.vy - pinch.vy0}px) scale(${pinch.k})`
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!pinch || e.touches.length >= 2) return
      const p = pinch
      pinch = null
      flags.pinching = false
      flags.columnZoomed = false
      api.requestZoom(clampScale(p.s0 * p.k), { ...p.anchor, vx: p.vx, vy: p.vy })
    }

    const onGesture = (e: Event) => e.preventDefault()

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    el.addEventListener('gesturestart', onGesture)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('gesturestart', onGesture)
    }
  }, [])
}

/** Touch double-tap: zoom to the column under the finger, again → fit-width. */
export function useDoubleTapZoom(scrollerRef: ScrollerRef, live: LiveRef, api: ViewerApi, flags: GestureFlags) {
  useEffect(() => {
    const el = scrollerRef.current!
    let tapStart: { t: number; x: number; y: number } | null = null
    let lastTap: { t: number; x: number; y: number } | null = null

    const zoomAt = async (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect()
      const vx = clientX - r.left
      const vy = clientY - r.top
      const pageEl = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.mg-page')
      const inner = pageEl?.querySelector<HTMLElement>('.mg-page-inner')
      if (flags.columnZoomed || !pageEl || !inner) {
        flags.columnZoomed = false
        api.requestZoom('fit-width', api.anchorAtViewport(vx, vy))
        return
      }
      const page = Number(pageEl.dataset.page)
      const { fx, fy } = pageFraction(inner, clientX, clientY)
      const { doc } = live.current.props
      const pageText = await doc.getPageText(page)
      const col = columnAt(pageText, { x: fx, y: fy, w: 0, h: 0 })
      const box = col > 0 ? pageText.columns[col] : undefined
      if (!box) {
        api.requestZoom('fit-width', api.anchorAtViewport(vx, vy))
        return
      }
      const target = (live.current.viewport.w - 2 * PAD_X) / (box.w * doc.pageSize(page).w)
      flags.columnZoomed = true
      api.requestZoom(clampScale(target), { page, fx: box.x, vx: PAD_X, fy, vy })
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || stylusIgnored(live, e.touches)) {
        tapStart = null
        return
      }
      const t = e.touches[0]
      tapStart = { t: Date.now(), x: t.clientX, y: t.clientY }
    }

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (tapStart && t && Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) > TAP_SLOP_PX) tapStart = null
    }

    const onTouchEnd = (e: TouchEvent) => {
      const s = tapStart
      tapStart = null
      if (!s || flags.pinching || flags.areaDragging || e.touches.length > 0 || e.changedTouches.length !== 1) return
      const now = Date.now()
      if (now - s.t > TAP_MS) return
      const t = e.changedTouches[0]
      const prev = lastTap
      if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(t.clientX - prev.x, t.clientY - prev.y) < DOUBLE_TAP_SLOP_PX) {
        lastTap = null
        e.preventDefault()
        void zoomAt(t.clientX, t.clientY).catch(console.error)
      } else lastTap = { t: now, x: t.clientX, y: t.clientY }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])
}
