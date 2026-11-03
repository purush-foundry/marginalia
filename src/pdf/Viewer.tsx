import { signal, type ReadonlySignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { selectionToBoxes } from '../annot/selection.ts'
import type { Box, Highlight } from '../types.ts'
import type { PageLink, PdfDoc } from './document.ts'
import {
  type Anchor,
  type Crop,
  type Layout,
  PAD_X,
  anchorAt,
  clampScale,
  fitWidthScale,
  layoutPages,
  positionAt,
  scrollFor,
} from './layout.ts'
import { PageView } from './PageView.tsx'
import { columnAt, joinLines, linesIntersecting } from './text.ts'
import './viewer.css'

export interface ViewerHandle {
  scrollTo(page: number, box?: Box, behavior?: 'smooth' | 'auto'): void
  currentPage: ReadonlySignal<number>
  scale: ReadonlySignal<number>
  setZoom(mode: 'fit-width' | number): void
  pageElement(page: number): HTMLElement | null
  getReadingPosition(): { page: number; offset: number }
}
export interface PendingSelection {
  page: number
  boxes: Box[]
  text: string
  endRect: DOMRect
  kind: 'text' | 'area'
}
export interface ViewerProps {
  doc: PdfDoc
  highlights: ReadonlySignal<Highlight[]>
  crop?: { left: number; right: number }
  nightMode: boolean
  invertImages: boolean
  initial?: { page: number; offset: number; zoom: number }
  areaSelectArmed: ReadonlySignal<boolean>
  pageOverlay?: (page: number, cssW: number, cssH: number) => ComponentChildren
  onSelection(sel: PendingSelection | null): void
  onTapHighlight(id: string, rect: DOMRect): void
  onLink(link: PageLink): void
  onReadingPosition(pos: { page: number; offset: number; zoom: number }): void
  handle: (h: ViewerHandle) => void
}

type Zoom = 'fit-width' | number

const NO_HIGHLIGHTS: Highlight[] = []
const SELECTION_DEBOUNCE_MS = 80
const POSITION_THROTTLE_MS = 500
const RENDER_SETTLE_MS = 150
const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP_PX = 8
const TAP_SLOP_PX = 10
const TAP_MS = 300
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP_PX = 30
const MIN_AREA = 0.01
const SCROLL_TO_MARGIN = 0.25

interface AreaDrag {
  page: number
  pointerId: number
  inner: HTMLElement
  x0: number
  y0: number
  x1: number
  y1: number
}

interface Pinch {
  d0: number
  s0: number
  vx0: number
  vy0: number
  vx: number
  vy: number
  k: number
  anchor: Anchor
}

interface Gestures {
  mouseDown: boolean
  pointerType: string
  longPress: { timer: number; x: number; y: number; pointerId: number } | null
  area: AreaDrag | null
  pinch: Pinch | null
  tapStart: { t: number; x: number; y: number } | null
  lastTap: { t: number; x: number; y: number } | null
  columnZoomed: boolean
  wheelScale: number | null
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function groupByPage(highlights: Highlight[]): Map<number, Highlight[]> {
  const out = new Map<number, Highlight[]>()
  for (const h of highlights) {
    if (h.deleted) continue
    const list = out.get(h.page)
    if (list) list.push(h)
    else out.set(h.page, [h])
  }
  return out
}

function touchDistance(t: TouchList): number {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
}

function touchMid(t: TouchList): { x: number; y: number } {
  return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 }
}

function pageFraction(inner: HTMLElement, clientX: number, clientY: number): { fx: number; fy: number } {
  const r = inner.getBoundingClientRect()
  return { fx: clamp01((clientX - r.left) / r.width), fy: clamp01((clientY - r.top) / r.height) }
}

function boxToClient(inner: HTMLElement, b: Box): DOMRect {
  const r = inner.getBoundingClientRect()
  return new DOMRect(r.left + b.x * r.width, r.top + b.y * r.height, b.w * r.width, b.h * r.height)
}

/** Continuous, virtualised vertical scroll of every page with selection, area select, links and zoom. */
export function Viewer(props: ViewerProps) {
  const { doc } = props
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [zoom, setZoomState] = useState<Zoom>(() =>
    props.initial && props.initial.zoom > 0 ? clampScale(props.initial.zoom) : 'fit-width',
  )
  const startPage = Math.min(doc.numPages, Math.max(1, props.initial?.page ?? 1))
  const [range, setRange] = useState<[number, number]>([Math.max(1, startPage - 1), startPage + 1])
  const [renderScale, setRenderScale] = useState(0)
  const [area, setArea] = useState<{ page: number; box: Box } | null>(null)
  const areaShown = useRef(area)
  areaShown.current = area

  const cropLeft = props.crop?.left ?? 0
  const cropRight = props.crop?.right ?? 0
  const crop = useMemo<Crop>(() => ({ left: cropLeft, right: cropRight }), [cropLeft, cropRight])
  const sizes = useMemo(
    () => Array.from({ length: doc.numPages }, (_, i) => doc.pageSize(i + 1)),
    [doc],
  )
  const scale =
    viewport.w > 0 ? (zoom === 'fit-width' ? fitWidthScale(sizes, crop, viewport.w) : clampScale(zoom)) : 0
  const layout = useMemo(
    () => layoutPages(sizes, scale || 1, crop, viewport.w),
    [sizes, scale, crop, viewport.w],
  )
  const highlights = props.highlights.value
  const byPage = useMemo(() => groupByPage(highlights), [highlights])
  const armed = props.areaSelectArmed.value

  const currentPage = useMemo(() => signal(startPage), [])
  const scaleSignal = useMemo(() => signal(0), [])
  const pendingAnchor = useRef<Anchor | null>({
    page: startPage,
    fy: props.initial?.offset ?? 0,
    vy: 0,
  })
  const scrollAnchor = useRef<Anchor | null>(null)
  const layoutRef = useRef<Layout | null>(null)
  const live = useRef({ props, crop, sizes, viewport, zoom, scale })
  live.current = { props, crop, sizes, viewport, zoom, scale }
  const g = useRef<Gestures>({
    mouseDown: false,
    pointerType: 'mouse',
    longPress: null,
    area: null,
    pinch: null,
    tapStart: null,
    lastTap: null,
    columnZoomed: false,
    wheelScale: null,
  }).current
  const lastEmitted = useRef<{ key: string; kind: 'text' | 'area' } | null>(null)
  const timers = useRef({ selection: 0, position: 0, lastPosition: 0, selectionSeq: 0 }).current

  const api = useMemo(() => {
    const scroller = () => scrollerRef.current

    const readingPosition = () => {
      const el = scroller()
      const L = layoutRef.current
      if (!el || !L) return { page: currentPage.peek(), offset: 0 }
      return positionAt(L, el.scrollTop)
    }

    const emitPosition = () => {
      timers.position = 0
      timers.lastPosition = Date.now()
      const { zoom: z, props: p } = live.current
      p.onReadingPosition({ ...readingPosition(), zoom: z === 'fit-width' ? 0 : z })
    }

    const schedulePosition = () => {
      if (timers.position) return
      const wait = Math.max(0, timers.lastPosition + POSITION_THROTTLE_MS - Date.now())
      timers.position = window.setTimeout(emitPosition, wait)
    }

    const syncFromScroll = () => {
      const el = scroller()
      const L = layoutRef.current
      if (!el || !L) return
      scrollAnchor.current = anchorAt(L, live.current.crop, el.scrollLeft, el.scrollTop, 0, 0)
      const page = positionAt(L, el.scrollTop + el.clientHeight / 3).page
      if (currentPage.peek() !== page) currentPage.value = page
      schedulePosition()
    }

    const applyAnchor = (a: Anchor) => {
      const el = scroller()
      const L = layoutRef.current
      if (!el || !L) return
      const s = scrollFor(L, live.current.crop, a)
      el.scrollTop = Math.max(0, s.top)
      if (s.left !== null) el.scrollLeft = Math.max(0, s.left)
    }

    const requestZoom = (mode: Zoom, anchor: Anchor | null) => {
      const { sizes: sz, crop: c, viewport: v, scale: s } = live.current
      const next = mode === 'fit-width' ? fitWidthScale(sz, c, v.w) : clampScale(mode)
      setZoomState(mode === 'fit-width' ? mode : next)
      if (!v.w || Math.abs(next - s) < 1e-6) {
        if (pagesRef.current) pagesRef.current.style.transform = ''
        if (anchor && v.w) applyAnchor(anchor)
        else if (anchor) pendingAnchor.current = anchor
        return
      }
      pendingAnchor.current = anchor
    }

    const anchorAtViewport = (vx: number, vy: number): Anchor | null => {
      const el = scroller()
      const L = layoutRef.current
      return el && L ? anchorAt(L, live.current.crop, el.scrollLeft, el.scrollTop, vx, vy) : null
    }

    const handle: ViewerHandle = {
      currentPage,
      scale: scaleSignal,
      scrollTo(page, box, behavior = 'auto') {
        const el = scroller()
        const L = layoutRef.current
        const n = Math.min(live.current.props.doc.numPages, Math.max(1, page))
        if (!el || !L) {
          pendingAnchor.current = { page: n, fy: box?.y ?? 0, vy: 0 }
          return
        }
        const i = n - 1
        let top = L.tops[i]
        let left = el.scrollLeft
        if (box) {
          top += box.y * L.heights[i] - el.clientHeight * SCROLL_TO_MARGIN
          if (L.contentW > el.clientWidth) {
            const cx = (box.x + box.w / 2 - live.current.crop.left) * L.fullWidths[i]
            left = L.lefts[i] + cx - el.clientWidth / 2
          }
        }
        el.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior })
      },
      setZoom(mode) {
        const el = scroller()
        g.columnZoomed = false
        const anchor = el ? anchorAtViewport(el.clientWidth / 2, el.clientHeight / 2) : null
        requestZoom(mode === 'fit-width' || mode <= 0 ? 'fit-width' : mode, anchor)
      },
      pageElement(page) {
        return scroller()?.querySelector<HTMLElement>(`.mg-page[data-page="${page}"]`) ?? null
      },
      getReadingPosition: readingPosition,
    }

    return { handle, syncFromScroll, applyAnchor, requestZoom, anchorAtViewport, schedulePosition }
  }, [])

  useEffect(() => {
    props.handle(api.handle)
  }, [])

  useLayoutEffect(() => {
    const el = scrollerRef.current!
    const measure = () =>
      setViewport((v) =>
        v.w === el.clientWidth && v.h === el.clientHeight ? v : { w: el.clientWidth, h: el.clientHeight },
      )
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (!scale) return
    layoutRef.current = layout
    scaleSignal.value = scale
    g.wheelScale = null
    if (pagesRef.current) pagesRef.current.style.transform = ''
    const anchor = pendingAnchor.current ?? scrollAnchor.current
    pendingAnchor.current = null
    if (anchor) api.applyAnchor(anchor)
    api.syncFromScroll()
  }, [layout])

  useEffect(() => {
    if (!scale) return
    if (!renderScale) {
      setRenderScale(scale)
      return
    }
    const t = setTimeout(() => setRenderScale(scale), RENDER_SETTLE_MS)
    return () => clearTimeout(t)
  }, [scale])

  useEffect(() => {
    api.schedulePosition()
  }, [zoom])

  const hasPages = scale > 0
  useEffect(() => {
    const root = scrollerRef.current
    if (!root || !hasPages) return
    const visible = new Set<number>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page)
          if (e.isIntersecting) visible.add(n)
          else visible.delete(n)
        }
        if (!visible.size) return
        const lo = Math.max(1, Math.min(...visible) - 1)
        const hi = Math.min(doc.numPages, Math.max(...visible) + 1)
        setRange((r) => (r[0] === lo && r[1] === hi ? r : [lo, hi]))
      },
      { root },
    )
    root.querySelectorAll('.mg-page').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [doc, hasPages])

  useEffect(() => {
    const el = scrollerRef.current!

    const emit = (sel: PendingSelection | null) => {
      const p = live.current.props
      if (!sel) {
        if (!lastEmitted.current) return
        lastEmitted.current = null
        p.onSelection(null)
        return
      }
      const key = JSON.stringify([sel.kind, sel.page, sel.boxes, sel.text])
      if (lastEmitted.current?.key === key) return
      lastEmitted.current = { key, kind: sel.kind }
      p.onSelection(sel)
    }

    const clearText = () => {
      if (lastEmitted.current?.kind === 'text') emit(null)
    }

    const checkSelection = async () => {
      const seq = ++timers.selectionSeq
      if (g.mouseDown || g.area) return
      const sel = document.getSelection()
      if (!sel || sel.rangeCount === 0) return clearText()
      const range = sel.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) return
      if (sel.isCollapsed) return clearText()
      const start = range.startContainer
      const startEl = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement
      const pages = [...el.querySelectorAll<HTMLElement>('.mg-page')]
      const pageEl =
        startEl?.closest<HTMLElement>('.mg-page') ??
        pages.find((p) => {
          const layer = p.querySelector('.textLayer')
          return layer !== null && range.intersectsNode(layer)
        })
      const layer = pageEl?.querySelector<HTMLElement>('.textLayer')
      if (!pageEl || !layer) return clearText()
      const page = Number(pageEl.dataset.page)
      const pageText = await live.current.props.doc.getPageText(page)
      if (seq !== timers.selectionSeq) return
      const res = selectionToBoxes(range, layer, pageText)
      if (!res) return clearText()
      const last = res.boxes[res.boxes.length - 1]
      const lr = layer.getBoundingClientRect()
      const endRect = new DOMRect(
        lr.left + last.x * lr.width,
        lr.top + last.y * lr.height,
        last.w * lr.width,
        last.h * lr.height,
      )
      emit({ page, boxes: res.boxes, text: res.text, endRect, kind: 'text' })
    }

    const scheduleCheck = (ms: number) => {
      clearTimeout(timers.selection)
      timers.selection = window.setTimeout(() => void checkSelection().catch(console.error), ms)
    }

    const cancelLongPress = () => {
      if (g.longPress) clearTimeout(g.longPress.timer)
      g.longPress = null
    }

    const dropArea = () => {
      setArea(null)
      if (lastEmitted.current?.kind === 'area') emit(null)
    }

    const startArea = (pointerId: number, clientX: number, clientY: number, pageEl: HTMLElement) => {
      const inner = pageEl.querySelector<HTMLElement>('.mg-page-inner')
      if (!inner) return
      const page = Number(pageEl.dataset.page)
      const { fx, fy } = pageFraction(inner, clientX, clientY)
      g.area = { page, pointerId, inner, x0: fx, y0: fy, x1: fx, y1: fy }
      el.classList.add('mg-dragging')
      try {
        el.setPointerCapture(pointerId)
      } catch {
        // pointer already released
      }
      document.getSelection()?.removeAllRanges()
      clearText()
      setArea({ page, box: { x: fx, y: fy, w: 0, h: 0 } })
    }

    const areaBox = (a: AreaDrag): Box => ({
      x: Math.min(a.x0, a.x1),
      y: Math.min(a.y0, a.y1),
      w: Math.abs(a.x1 - a.x0),
      h: Math.abs(a.y1 - a.y0),
    })

    const finishArea = async (cancelled: boolean) => {
      const a = g.area
      if (!a) return
      g.area = null
      el.classList.remove('mg-dragging')
      const box = areaBox(a)
      if (cancelled || box.w < MIN_AREA || box.h < MIN_AREA) {
        setArea(null)
        return
      }
      setArea({ page: a.page, box })
      const endRect = boxToClient(a.inner, box)
      const pageText = await live.current.props.doc.getPageText(a.page).catch(() => null)
      const text = pageText ? linesIntersecting(pageText, box).reduce((t, l) => joinLines(t, l.text), '') : ''
      emit({ page: a.page, boxes: [box], text, endRect, kind: 'area' })
    }

    const onPointerDown = (e: PointerEvent) => {
      g.pointerType = e.pointerType
      const target = e.target as Element
      if (areaShown.current || lastEmitted.current?.kind === 'area') dropArea()
      if (target.closest('.mg-link, .mg-hl rect')) return
      const pageEl = target.closest<HTMLElement>('.mg-page')
      if (!pageEl || g.pinch) return
      if (live.current.props.areaSelectArmed.peek() && e.button === 0) {
        e.preventDefault()
        startArea(e.pointerId, e.clientX, e.clientY, pageEl)
        return
      }
      if (e.pointerType === 'touch') {
        if (!e.isPrimary || target.closest('.textLayer span')) return
        const { clientX, clientY, pointerId } = e
        g.longPress = {
          x: clientX,
          y: clientY,
          pointerId,
          timer: window.setTimeout(() => {
            g.longPress = null
            startArea(pointerId, clientX, clientY, pageEl)
            navigator.vibrate?.(10)
          }, LONG_PRESS_MS),
        }
      } else if (e.button === 0) {
        g.mouseDown = true
        if (!target.closest('.textLayer span')) document.getSelection()?.removeAllRanges()
        pageEl.querySelector('.textLayer')?.classList.add('selecting')
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const lp = g.longPress
      if (lp && e.pointerId === lp.pointerId) {
        if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_SLOP_PX) cancelLongPress()
      }
      const a = g.area
      if (a && e.pointerId === a.pointerId) {
        const { fx, fy } = pageFraction(a.inner, e.clientX, e.clientY)
        a.x1 = fx
        a.y1 = fy
        setArea({ page: a.page, box: areaBox(a) })
      }
    }

    const onPointerEnd = (e: PointerEvent) => {
      if (g.longPress?.pointerId === e.pointerId) cancelLongPress()
      if (g.area?.pointerId === e.pointerId) void finishArea(e.type === 'pointercancel')
      if (e.pointerType !== 'touch' && g.mouseDown) {
        g.mouseDown = false
        el.querySelectorAll('.textLayer.selecting').forEach((l) => l.classList.remove('selecting'))
        scheduleCheck(0)
      }
    }

    const onSelectionChange = () => scheduleCheck(SELECTION_DEBOUNCE_MS)

    const onContextMenu = (e: Event) => {
      if (g.pointerType !== 'touch') return
      const target = e.target as Element
      if (target.closest('.mg-page') && !target.closest('.textLayer span')) e.preventDefault()
    }

    const onScroll = () => {
      if (!g.pinch) api.syncFromScroll()
    }

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const base = g.wheelScale ?? live.current.scale
      const step = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 0.05 : 0.002
      const next = clampScale(base * Math.exp(-e.deltaY * step))
      g.wheelScale = next
      g.columnZoomed = false
      api.requestZoom(next, api.anchorAtViewport(e.clientX - r.left, e.clientY - r.top))
    }

    const startPinch = (t: TouchList) => {
      const r = el.getBoundingClientRect()
      const mid = touchMid(t)
      const vx = mid.x - r.left
      const vy = mid.y - r.top
      const anchor = api.anchorAtViewport(vx, vy)
      if (!anchor || !pagesRef.current) return
      cancelLongPress()
      g.pinch = { d0: Math.max(1, touchDistance(t)), s0: live.current.scale, vx0: vx, vy0: vy, vx, vy, k: 1, anchor }
      pagesRef.current.style.transformOrigin = `${el.scrollLeft + vx}px ${el.scrollTop + vy}px`
    }

    const movePinch = (t: TouchList) => {
      const p = g.pinch
      const pages = pagesRef.current
      if (!p || !pages) return
      const r = el.getBoundingClientRect()
      const mid = touchMid(t)
      p.vx = mid.x - r.left
      p.vy = mid.y - r.top
      p.k = clampScale(p.s0 * (touchDistance(t) / p.d0)) / p.s0
      pages.style.transform = `translate(${p.vx - p.vx0}px, ${p.vy - p.vy0}px) scale(${p.k})`
    }

    const endPinch = () => {
      const p = g.pinch
      if (!p) return
      g.pinch = null
      g.columnZoomed = false
      api.requestZoom(clampScale(p.s0 * p.k), { ...p.anchor, vx: p.vx, vy: p.vy })
    }

    const doubleTap = async (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect()
      const vx = clientX - r.left
      const vy = clientY - r.top
      const pageEl = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.mg-page')
      const inner = pageEl?.querySelector<HTMLElement>('.mg-page-inner')
      if (g.columnZoomed || !pageEl || !inner) {
        g.columnZoomed = false
        api.requestZoom('fit-width', api.anchorAtViewport(vx, vy))
        return
      }
      const page = Number(pageEl.dataset.page)
      const { fx, fy } = pageFraction(inner, clientX, clientY)
      const { doc: d } = live.current.props
      const pageText = await d.getPageText(page)
      const col = columnAt(pageText, { x: fx, y: fy, w: 0, h: 0 })
      const box = col > 0 ? pageText.columns[col] : undefined
      if (!box) {
        api.requestZoom('fit-width', api.anchorAtViewport(vx, vy))
        return
      }
      const target = (live.current.viewport.w - 2 * PAD_X) / (box.w * d.pageSize(page).w)
      g.columnZoomed = true
      api.requestZoom(clampScale(target), { page, fx: box.x, vx: PAD_X, fy, vy })
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && !g.area) {
        g.tapStart = null
        startPinch(e.touches)
      } else if (e.touches.length === 1) {
        const t = e.touches[0]
        g.tapStart = { t: Date.now(), x: t.clientX, y: t.clientY }
      } else g.tapStart = null
    }

    const onTouchMove = (e: TouchEvent) => {
      if (g.pinch) {
        e.preventDefault()
        if (e.touches.length >= 2) movePinch(e.touches)
        return
      }
      if (g.area) {
        e.preventDefault()
        return
      }
      const s = g.tapStart
      const t = e.touches[0]
      if (s && t && Math.hypot(t.clientX - s.x, t.clientY - s.y) > TAP_SLOP_PX) g.tapStart = null
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (g.pinch) {
        if (e.touches.length < 2) endPinch()
        return
      }
      const s = g.tapStart
      g.tapStart = null
      if (!s || e.touches.length > 0 || e.changedTouches.length !== 1) return
      const now = Date.now()
      if (now - s.t > TAP_MS) return
      const t = e.changedTouches[0]
      const last = g.lastTap
      if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(t.clientX - last.x, t.clientY - last.y) < DOUBLE_TAP_SLOP_PX) {
        g.lastTap = null
        e.preventDefault()
        void doubleTap(t.clientX, t.clientY).catch(console.error)
      } else g.lastTap = { t: now, x: t.clientX, y: t.clientY }
    }

    const onGesture = (e: Event) => e.preventDefault()

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerEnd)
    document.addEventListener('pointercancel', onPointerEnd)
    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: false })
    el.addEventListener('touchcancel', onTouchEnd, { passive: false })
    el.addEventListener('gesturestart', onGesture)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      cancelLongPress()
      clearTimeout(timers.selection)
      clearTimeout(timers.position)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerEnd)
      document.removeEventListener('pointercancel', onPointerEnd)
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('gesturestart', onGesture)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [])

  useEffect(() => {
    if (!armed && g.area) {
      g.area = null
      scrollerRef.current?.classList.remove('mg-dragging')
      setArea(null)
    }
  }, [armed])

  const onTapHighlight = useMemo(
    () => (id: string, rect: DOMRect) => live.current.props.onTapHighlight(id, rect),
    [],
  )
  const onLink = useMemo(() => (link: PageLink) => live.current.props.onLink(link), [])
  const keepImages = props.nightMode && !props.invertImages

  return (
    <div
      ref={scrollerRef}
      class={`mg-scroller${props.nightMode ? ' mg-night' : ''}${armed ? ' mg-armed' : ''}`}
    >
      {hasPages && (
        <div
          ref={pagesRef}
          class="mg-pages"
          style={{ width: `${layout.contentW}px`, height: `${layout.contentH}px` }}
        >
          {sizes.map((size, i) => {
            const n = i + 1
            const active = n >= range[0] && n <= range[1]
            return (
              <PageView
                key={n}
                doc={doc}
                page={n}
                scale={scale}
                renderScale={renderScale || scale}
                top={layout.tops[i]}
                left={layout.lefts[i]}
                crop={crop}
                active={active}
                keepImages={keepImages}
                highlights={byPage.get(n) ?? NO_HIGHLIGHTS}
                area={area?.page === n ? area.box : null}
                overlay={active ? props.pageOverlay?.(n, size.w * scale, size.h * scale) : undefined}
                onTapHighlight={onTapHighlight}
                onLink={onLink}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
