import { signal, type ReadonlySignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Box, Highlight } from '../types.ts'
import type { PageLink, PdfDoc } from './document.ts'
import {
  type GestureFlags,
  type Live,
  type ViewerApi,
  type Zoom,
  useAreaSelect,
  useDoubleTapZoom,
  useHighlightTap,
  usePinchWheelZoom,
  useSelectionSink,
  useTextSelection,
} from './gestures.ts'
import {
  type Anchor,
  type Crop,
  type Layout,
  anchorAt,
  clampScale,
  fitWidthScale,
  layoutPages,
  positionAt,
  scrollFor,
} from './layout.ts'
import { PageView } from './PageView.tsx'
import './viewer.css'

export interface ViewerHandle {
  scrollTo(page: number, box?: Box, behavior?: 'smooth' | 'auto'): void
  currentPage: ReadonlySignal<number>
  scale: ReadonlySignal<number>
  setZoom(mode: 'fit-width' | number): void
  pageElement(page: number): HTMLElement | null
  getReadingPosition(): { page: number; offset: number }
  /** Removes the area box and any text selection in the viewer, then reports `onSelection(null)`. */
  clearSelection(): void
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
  /** True while the pen tool draws; pen pointers then skip selection, area select, highlight taps and double-tap zoom. */
  penDrawing?: ReadonlySignal<boolean>
  pageOverlay?: (page: number, cssW: number, cssH: number) => ComponentChildren
  onSelection(sel: PendingSelection | null): void
  onTapHighlight(id: string, rect: DOMRect): void
  onLink(link: PageLink): void
  onReadingPosition(pos: { page: number; offset: number; zoom: number }): void
  handle: (h: ViewerHandle) => void
}

const NO_HIGHLIGHTS: Highlight[] = []
const POSITION_THROTTLE_MS = 500
const RENDER_SETTLE_MS = 150
const SCROLL_TO_MARGIN = 0.25

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
  const live = useRef<Live>({ props, crop, sizes, viewport, zoom, scale })
  live.current = { props, crop, sizes, viewport, zoom, scale }
  const flags = useRef<GestureFlags>({
    pinching: false,
    areaDragging: false,
    areaPointer: null,
    columnZoomed: false,
    wheelScale: null,
  }).current
  const timers = useRef({ position: 0, lastPosition: 0 }).current
  const lastPosition = useRef<{ page: number; offset: number } | null>(null)

  const sink = useSelectionSink(live)

  const api = useMemo(() => {
    const scroller = () => scrollerRef.current

    const readingPosition = () => {
      const el = scroller()
      const L = layoutRef.current
      if (!el || !L) return lastPosition.current ?? { page: currentPage.peek(), offset: 0 }
      return positionAt(L, el.scrollTop)
    }

    const emitPosition = () => {
      timers.position = 0
      timers.lastPosition = Date.now()
      const pos = lastPosition.current
      if (!pos) return
      const { zoom: z, props: p } = live.current
      p.onReadingPosition({ ...pos, zoom: z === 'fit-width' ? 0 : z })
    }

    const schedulePosition = () => {
      if (timers.position) return
      const wait = Math.max(0, timers.lastPosition + POSITION_THROTTLE_MS - Date.now())
      timers.position = window.setTimeout(emitPosition, wait)
    }

    const flushPosition = () => {
      if (!timers.position) return
      clearTimeout(timers.position)
      emitPosition()
    }

    const syncFromScroll = () => {
      const el = scroller()
      const L = layoutRef.current
      if (!el || !L) return
      scrollAnchor.current = anchorAt(L, live.current.crop, el.scrollLeft, el.scrollTop, 0, 0)
      lastPosition.current = positionAt(L, el.scrollTop)
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

    const zoomApi: ViewerApi = {
      requestZoom(mode, anchor) {
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
      },
      anchorAtViewport(vx, vy) {
        const el = scroller()
        const L = layoutRef.current
        return el && L ? anchorAt(L, live.current.crop, el.scrollLeft, el.scrollTop, vx, vy) : null
      },
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
        flags.columnZoomed = false
        const anchor = el ? zoomApi.anchorAtViewport(el.clientWidth / 2, el.clientHeight / 2) : null
        zoomApi.requestZoom(mode === 'fit-width' || mode <= 0 ? 'fit-width' : mode, anchor)
      },
      pageElement(page) {
        return scroller()?.querySelector<HTMLElement>(`.mg-page[data-page="${page}"]`) ?? null
      },
      getReadingPosition: readingPosition,
      clearSelection() {
        const sel = document.getSelection()
        const el = scroller()
        if (sel && el && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
          sel.removeAllRanges()
        }
        setArea(null)
        sink.emit(null)
      },
    }

    return { handle, zoomApi, syncFromScroll, applyAnchor, schedulePosition, flushPosition }
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
    flags.wheelScale = null
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
    const onScroll = () => {
      if (!flags.pinching) api.syncFromScroll()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      api.flushPosition()
    }
  }, [])

  useTextSelection(scrollerRef, live, sink, flags)
  useAreaSelect(scrollerRef, live, sink, flags, setArea, areaShown)
  useHighlightTap(scrollerRef, live, sink, flags)
  usePinchWheelZoom(scrollerRef, pagesRef, live, api.zoomApi, flags)
  useDoubleTapZoom(scrollerRef, live, api.zoomApi, flags)

  const onLink = useMemo(() => (link: PageLink) => live.current.props.onLink(link), [])
  const keepImages = props.nightMode && !props.invertImages

  return (
    <div
      ref={scrollerRef}
      class={`mg-scroller${props.nightMode ? ' mg-night' : ''}${armed ? ' mg-armed' : ''}`}
      data-ink-viewport=""
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
                onLink={onLink}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
