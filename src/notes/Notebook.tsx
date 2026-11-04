import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { showToast } from '../app/ui.ts'
import { InkLayer } from '../ink/InkLayer.tsx'
import { fingerDraws, MM_PER_PT, penActivity } from '../ink/tools.ts'
import { now } from '../lib/ids.ts'
import type { InkStroke } from '../types.ts'
import { ImageTooLargeError, prepareImage } from './images.ts'
import type { NotePage, PageContent } from './model.ts'
import type { NotebookStore } from './notebookStore.ts'
import { PaperBackground } from './paper.tsx'
import { TemplateSheet } from './TemplateSheet.tsx'
import { clampZoom, NOTEBOOK_GAP_PX, pageCssWidth, PULL_ADD_PX, zoomScroll } from './viewport.ts'
import './notebook.css'

export interface NotebookHandle {
  currentPage(): string | null
  scrollToItem(id: string): void
}

export interface NotebookProps {
  store: NotebookStore
  onJumpToPage(page: number): void
  handle?: (h: NotebookHandle) => void
}

const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
const WHEEL_ZOOM_RATE = 0.01
const TEXT_PT: Record<'s' | 'm' | 'l', number> = { s: 10, m: 13, l: 18 }
const NO_CONTENT: PageContent = { strokes: [], texts: [], images: [] }

interface PageBox {
  page: NotePage
  index: number
  left: number
  top: number
  w: number
  h: number
}

interface Layout {
  pages: PageBox[]
  width: number
  height: number
}

type Point = { x: number; y: number }
type Scroll = { left: number; top: number }

// Pages stacked a gap apart from the top and centred across the content width.
function layoutPages(pages: NotePage[], paneW: number, zoom: number): Layout {
  const widest = Math.max(...pages.map((p) => p.size.w))
  const boxes: PageBox[] = []
  let top = NOTEBOOK_GAP_PX
  for (const [index, page] of pages.entries()) {
    const w = Math.max(0, pageCssWidth(page.size.w, widest, paneW, zoom))
    const h = (w * page.size.h) / page.size.w
    boxes.push({ page, index, left: 0, top, w, h })
    top += h + NOTEBOOK_GAP_PX
  }
  const width = Math.max(paneW, ...boxes.map((b) => b.w + 2 * NOTEBOOK_GAP_PX))
  for (const b of boxes) b.left = (width - b.w) / 2
  return { pages: boxes, width, height: boxes.length ? top : 0 }
}

// Copy of flat [x, y, pressure] points with every y multiplied by k.
function scaleY(points: number[], k: number): number[] {
  const out = points.slice()
  for (let i = 1; i < out.length; i += 3) out[i] *= k
  return out
}

const px = (v: number) => `${v}px`

function imageFiles(list: ArrayLike<File> | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
}

// Touches that are fingers, not the stylus.
function fingers(list: TouchList): Touch[] {
  return Array.from(list).filter((t) => (t as Touch & { touchType?: string }).touchType !== 'stylus')
}

function touchById(list: TouchList, id: number): Touch | undefined {
  return Array.from(list).find((t) => t.identifier === id)
}

interface PageViewProps {
  box: PageBox
  content: PageContent
  store: NotebookStore
  onJumpToPage(page: number): void
}

/** One sheet of paper with its images, text and ink; objects are positioned in page-width units. */
function PageView({ box, content, store, onJumpToPage }: PageViewProps) {
  const { page, index, left, top, w, h } = box
  const toPage = page.size.h / page.size.w
  const inks = useMemo<InkStroke[]>(
    () => content.strokes.map((s) => ({ ...s, kind: 'ink' as const, page: index + 1, points: scaleY(s.points, 1 / toPage) })),
    [content.strokes, index, toPage],
  )
  const ptPx = w / (page.size.w / MM_PER_PT)
  return (
    <div class="mg-nb-page" data-page={page.id} data-color={page.color} style={{ left: px(left), top: px(top), width: px(w), height: px(h) }}>
      <PaperBackground template={page.template} color={page.color} cssW={w} widthMm={page.size.w} />
      {content.images.map((m) => (
        <div key={m.id} class="mg-nb-figure" style={{ left: px(m.box.x * w), top: px(m.box.y * w), width: px(m.box.w * w), height: px(m.box.w * m.aspect * w) }}>
          <img class="mg-nb-image" src={m.src} alt="" draggable={false} />
          {m.pdfPage !== undefined && (
            <button type="button" class="mg-nb-chip" aria-label={`Go to page ${m.pdfPage}`} onClick={() => onJumpToPage(m.pdfPage!)}>
              <span>p.{m.pdfPage}</span>
            </button>
          )}
        </div>
      ))}
      {content.texts.map((t) => (
        <div
          key={t.id}
          class="mg-nb-text"
          style={{ left: px(t.box.x * w), top: px(t.box.y * w), width: px(t.box.w * w), fontSize: px(TEXT_PT[t.size] * ptPx), color: t.color }}
        >
          {t.text}
        </div>
      ))}
      {w > 0 && (
        <InkLayer
          page={index + 1}
          cssW={w}
          cssH={h}
          strokes={inks}
          onAddStroke={({ kind: _kind, page: _page, ...s }) =>
            store.addStroke({ ...s, page: page.id, tool: s.tool ?? 'pen', pen: s.pen ?? 'fountain', points: scaleY(s.points, toPage) })
          }
          onEraseStroke={store.removeStroke}
        />
      )}
    </div>
  )
}

/** The notebook pane: fixed pages on a grey canvas with pinch, double-tap and Ctrl-wheel zoom and pull-to-add. */
export function Notebook({ store, onJumpToPage, handle }: NotebookProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(1)
  const pendingScroll = useRef<Scroll | null>(null)
  const [pane, setPane] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const [menuOpen, setMenuOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const [sheetFor, setSheetFor] = useState<string | null>(null)

  const pages = store.pages.value
  const content = store.content.value
  const layout = useMemo(() => layoutPages(pages, pane.w, zoom), [pages, pane.w, zoom])
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const paneRef = useRef(pane)
  paneRef.current = pane

  // The page with the most visible height, or null when there are no pages.
  const currentPage = (): string | null => {
    const scroller = scrollerRef.current
    if (!scroller) return null
    const top = scroller.scrollTop
    const bottom = top + paneRef.current.h
    let best: string | null = null
    let bestSeen = -Infinity
    for (const b of layoutRef.current.pages) {
      const seen = Math.min(bottom, b.top + b.h) - Math.max(top, b.top)
      if (seen > bestSeen) {
        best = b.page.id
        bestSeen = seen
      }
    }
    return best
  }

  const measure = () => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const w = rect.width - (scroller.offsetWidth - scroller.clientWidth)
    setPane((prev) => (prev.w === w && prev.h === rect.height ? prev : { w, h: rect.height }))
  }

  useLayoutEffect(() => {
    measure()
    const scroller = scrollerRef.current
    if (!scroller || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  // Applies the scroll offset a zoom change asked for once the pages have their new size.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const next = pendingScroll.current
    if (!scroller || !next) return
    pendingScroll.current = null
    scroller.scrollLeft = next.left
    scroller.scrollTop = next.top
  }, [zoom])

  // Finger, pinch and wheel gestures on the scroller.
  useEffect(() => {
    const scroller = scrollerRef.current
    const pagesEl = pagesRef.current
    if (!scroller || !pagesEl) return
    let pinch: { ids: [number, number]; d0: number; anchor: Point; scroll: Scroll; scale: number } | null = null
    let finger: { id: number; x: number; y: number; t: number; moved: boolean; endY: number | null } | null = null
    let lastTap: { x: number; y: number; t: number } | null = null
    let pulled = false

    const anchorOf = (x: number, y: number): Point => {
      const rect = scroller.getBoundingClientRect()
      return { x: x - rect.left, y: y - rect.top }
    }

    const zoomTo = (target: number, anchor: Point, base?: Scroll) => {
      const from = zoomRef.current
      const to = clampZoom(target)
      if (to === from) return
      const scroll = base ?? pendingScroll.current ?? { left: scroller.scrollLeft, top: scroller.scrollTop }
      pendingScroll.current = zoomScroll(scroll, anchor, from, to)
      zoomRef.current = to
      setZoom(to)
    }

    const pull = (on: boolean) => {
      pulled = on
      setArmed(on)
    }

    const atEnd = () => scroller.scrollTop + paneRef.current.h >= layoutRef.current.height - 1

    const endPinch = (commit: boolean) => {
      const p = pinch
      if (!p) return
      pinch = null
      pagesEl.style.transform = ''
      pagesEl.style.transformOrigin = ''
      if (commit) zoomTo(zoomRef.current * p.scale, p.anchor, p.scroll)
    }

    const onStart = (e: TouchEvent) => {
      const down = fingers(e.touches)
      if (penActivity.down || down.length !== 1) {
        finger = null
        pull(false)
      }
      if (penActivity.down) {
        endPinch(false)
      } else if (down.length === 2 && !pinch) {
        const [a, b] = down
        const scroll = { left: scroller.scrollLeft, top: scroller.scrollTop }
        const anchor = anchorOf((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2)
        pinch = { ids: [a.identifier, b.identifier], d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, anchor, scroll, scale: 1 }
        pagesEl.style.transformOrigin = `${scroll.left + anchor.x}px ${scroll.top + anchor.y}px`
      } else if (down.length === 1 && !pinch && !fingerDraws.value) {
        const t = down[0]
        finger = { id: t.identifier, x: t.clientX, y: t.clientY, t: now(), moved: false, endY: atEnd() ? t.clientY : null }
      }
    }

    const onMove = (e: TouchEvent) => {
      if (pinch) {
        if (penActivity.down) {
          endPinch(false)
          return
        }
        const a = touchById(e.touches, pinch.ids[0])
        const b = touchById(e.touches, pinch.ids[1])
        if (!a || !b) return
        e.preventDefault()
        const from = zoomRef.current
        pinch.scale = clampZoom((from * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) / pinch.d0) / from
        pagesEl.style.transform = `scale(${pinch.scale})`
        return
      }
      const t = finger && touchById(e.touches, finger.id)
      if (!finger || !t) return
      if (Math.hypot(t.clientX - finger.x, t.clientY - finger.y) > DOUBLE_TAP_PX) finger.moved = true
      if (finger.endY === null && atEnd()) finger.endY = t.clientY
      pull(finger.endY !== null && finger.endY - t.clientY >= PULL_ADD_PX)
    }

    const onEnd = (e: TouchEvent) => {
      if (pinch) {
        if (fingers(e.touches).length < 2) endPinch(!penActivity.down)
        return
      }
      const f = finger
      if (!f || !touchById(e.changedTouches, f.id)) return
      finger = null
      if (pulled) {
        pull(false)
        store.addPage()
        return
      }
      if (f.moved) {
        lastTap = null
        return
      }
      const t = now()
      if (lastTap && f.t - lastTap.t <= DOUBLE_TAP_MS && Math.hypot(f.x - lastTap.x, f.y - lastTap.y) <= DOUBLE_TAP_PX) {
        lastTap = null
        zoomTo(zoomRef.current > 1 ? 1 : 2, anchorOf(f.x, f.y))
      } else {
        lastTap = { x: f.x, y: f.y, t }
      }
    }

    const onCancel = () => {
      endPinch(false)
      finger = null
      pull(false)
    }

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * WHEEL_ZOOM_RATE), anchorOf(e.clientX, e.clientY))
    }

    const active = { passive: false } as const
    scroller.addEventListener('touchstart', onStart)
    scroller.addEventListener('touchmove', onMove, active)
    scroller.addEventListener('touchend', onEnd)
    scroller.addEventListener('touchcancel', onCancel)
    scroller.addEventListener('wheel', onWheel, active)
    return () => {
      scroller.removeEventListener('touchstart', onStart)
      scroller.removeEventListener('touchmove', onMove)
      scroller.removeEventListener('touchend', onEnd)
      scroller.removeEventListener('touchcancel', onCancel)
      scroller.removeEventListener('wheel', onWheel)
    }
  }, [store])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  useEffect(() => {
    handle?.({
      currentPage,
      scrollToItem(id) {
        const { strokes, texts, images } = store.doc.value
        const item = [...texts, ...images, ...strokes].find((i) => i.id === id && !i.deleted)
        const box = item && layoutRef.current.pages.find((b) => b.page.id === item.page)
        const scroller = scrollerRef.current
        if (!item || !box || !scroller) return
        const y = 'box' in item ? item.box.y : Math.min(...item.points.filter((_, i) => i % 3 === 1))
        scroller.scrollTop = box.top + y * box.w - NOTEBOOK_GAP_PX
      },
    })
  }, [handle, store])

  const addImages = async (files: File[]) => {
    for (const file of files) {
      try {
        const img = await prepareImage(file)
        store.addImage({ page: currentPage() ?? store.addPage().id, src: img.dataUrl, aspect: img.height / img.width })
      } catch (err) {
        showToast(err instanceof ImageTooLargeError ? 'Image too large to add' : 'Could not add that image')
      }
    }
  }

  const onPaste = (e: ClipboardEvent) => {
    const files = imageFiles(e.clipboardData?.files)
    if (files.length === 0) return
    e.preventDefault()
    void addImages(files)
  }

  const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  const onDrop = (e: DragEvent) => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    const files = imageFiles(e.dataTransfer?.files)
    if (files.length > 0) void addImages(files)
  }

  const onPicked = () => {
    const input = inputRef.current
    const files = imageFiles(input?.files)
    if (input) input.value = ''
    if (files.length > 0) void addImages(files)
  }

  const addPageAt = (where: 'before' | 'after' | 'last') => {
    setMenuOpen(false)
    const current = currentPage()
    if (where === 'last') store.addPage()
    else if (where === 'after') store.addPage(current)
    else store.addPage(pages[pages.findIndex((p) => p.id === current) - 1]?.id ?? null)
  }

  const sheetPage = pages.find((p) => p.id === sheetFor)

  return (
    <div class="mg-notebook" onPaste={onPaste} onDragOver={(e) => carriesFiles(e) && e.preventDefault()} onDrop={onDrop}>
      <div class="mg-nb-bar">
        <div class="mg-nb-menu-anchor" ref={menuRef}>
          <button type="button" class="btn mg-nb-tool" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            Add Page
          </button>
          {menuOpen && (
            <div class="mg-nb-menu" role="menu">
              <button type="button" role="menuitem" class="mg-nb-menu-item" onClick={() => addPageAt('before')}>Before</button>
              <button type="button" role="menuitem" class="mg-nb-menu-item" onClick={() => addPageAt('after')}>After</button>
              <button type="button" role="menuitem" class="mg-nb-menu-item" onClick={() => addPageAt('last')}>Last</button>
            </div>
          )}
        </div>
        <button type="button" class="btn mg-nb-tool" disabled={pages.length === 0} onClick={() => setSheetFor(currentPage())}>
          Template
        </button>
        <button type="button" class="btn mg-nb-tool" onClick={() => inputRef.current?.click()}>
          Image
        </button>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPicked} />
      </div>
      <div ref={scrollerRef} class="mg-nb-scroller" data-ink-viewport="" tabIndex={0}>
        <div ref={pagesRef} class="mg-nb-pages" style={{ width: px(layout.width), height: px(layout.height) }}>
          {layout.pages.map((b) => (
            <PageView key={b.page.id} box={b} content={content.get(b.page.id) ?? NO_CONTENT} store={store} onJumpToPage={onJumpToPage} />
          ))}
        </div>
      </div>
      {armed && (
        <div class="mg-nb-pull" role="status">
          Release to add a page
        </div>
      )}
      {sheetPage && (
        <TemplateSheet
          page={sheetPage}
          onApply={(patch, applyToAll) => store.setPageStyle(sheetPage.id, patch, applyToAll)}
          onClose={() => setSheetFor(null)}
        />
      )}
    </div>
  )
}
