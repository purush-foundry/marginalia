import { effect } from '@preact/signals'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Icon } from '../app/icons.tsx'
import { showToast } from '../app/ui.ts'
import { PRESET_COLORS } from '../ink/color.ts'
import { InkLayer, StrokeSvg } from '../ink/InkLayer.tsx'
import type { ItemRef, LassoItem } from '../ink/lasso.ts'
import {
  activeColor, fingerDraws, inkDisplayColor, lassoSettings, MM_PER_PT, penActivity, setTool, textSize, tool, type Tool,
} from '../ink/tools.ts'
import { now } from '../lib/ids.ts'
import type { InkStroke } from '../types.ts'
import { clipboard, copyItems, type Clip } from './clipboard.ts'
import { ImageObjectView } from './ImageObject.tsx'
import { ImageTooLargeError, prepareImage } from './images.ts'
import { LassoLayer, type ObjectMenuProps } from './Lasso.tsx'
import { pageLayers, type ImageObject, type NotebookStroke, type NotePage, type PageContent } from './model.ts'
import type { NewStroke, NotebookStore } from './notebookStore.ts'
import { PaperBackground } from './paper.tsx'
import { TemplateSheet } from './TemplateSheet.tsx'
import { TEXT_SIZE_PT, TextBox, textBoxAt } from './TextBox.tsx'
import { Thumbnails } from './Thumbnails.tsx'
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
const WHEEL_COMMIT_MS = 120
const TEXT_TAP_PX = 8
const TEXT_LINE_HEIGHT = 1.35
const DUPLICATE_OFFSET = 0.02
const WIDE = '(min-width: 700px)'
const NO_CONTENT: PageContent = { strokes: [], texts: [], images: [] }
const NO_REFS: ItemRef[] = []
const NO_HEIGHTS: ReadonlyMap<string, number> = new Map()
const BAR_TOOLS: readonly { tool: Tool; label: string }[] = [
  { tool: 'lasso', label: 'Lasso' },
  { tool: 'pen', label: 'Pen' },
  { tool: 'highlighter', label: 'Highlighter' },
  { tool: 'eraser', label: 'Eraser' },
  { tool: 'text', label: 'Text' },
]

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
type Selection = { page: string; refs: ItemRef[] }

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

// The page whose box is nearest the content offset y.
function pageNear(layout: Layout, y: number): PageBox | undefined {
  const away = (b: PageBox) => Math.max(b.top - y, y - b.top - b.h, 0)
  return layout.pages.reduce<PageBox | undefined>((best, b) => (!best || away(b) < away(best) ? b : best), undefined)
}

// Scroll that keeps the page point under `anchor` still when the layout goes from `before` (zoom `from`) to `after` (zoom `to`).
function anchoredScroll(scroll: Scroll, anchor: Point, before: Layout, after: Layout, from: number, to: number): Scroll {
  const box = pageNear(before, scroll.top + anchor.y)
  const next = box && after.pages.find((b) => b.page.id === box.page.id)
  if (!box || !next) return zoomScroll(scroll, anchor, from, to)
  const local = zoomScroll({ left: scroll.left - box.left, top: scroll.top - box.top }, anchor, from, to)
  return { left: next.left + local.left, top: next.top + local.top }
}

// The clip's top-left moved so the whole clip stays on a page of the given height / width.
function clampPaste(clip: Clip, at: Point, aspect: number): Point {
  return { x: Math.max(0, Math.min(at.x, 1 - clip.w)), y: Math.max(0, Math.min(at.y, aspect - clip.h)) }
}

// Copy of flat [x, y, pressure] points with every y multiplied by k.
function scaleY(points: number[], k: number): number[] {
  const out = points.slice()
  for (let i = 1; i < out.length; i += 3) out[i] *= k
  return out
}

const inkViews = new WeakMap<NotebookStroke, { k: number; ink: InkStroke }>()

// The ink-layer view of a notebook stroke (y in page-height units), reused while the stroke and the page shape are unchanged.
function inkOf(s: NotebookStroke, k: number): InkStroke {
  const hit = inkViews.get(s)
  if (hit && hit.k === k) return hit.ink
  const { z: _z, page: _page, ...rest } = s
  const ink: InkStroke = { ...rest, kind: 'ink', page: 0, points: scaleY(s.points, k) }
  inkViews.set(s, { k, ink })
  return ink
}

// The notebook stroke for an ink-layer stroke on `page`, y back in page-width units.
function toNotebook({ kind: _kind, page: _page, ...s }: InkStroke, page: string, toPage: number): NewStroke {
  return { ...s, page, tool: s.tool ?? 'pen', pen: s.pen ?? 'fountain', points: scaleY(s.points, toPage) }
}

const px = (v: number) => `${v}px`

// An image's box on a page `w` CSS px wide.
function figureBox(m: ImageObject, w: number) {
  return { left: px(m.box.x * w), top: px(m.box.y * w), width: px(m.box.w * w), height: px(m.box.w * m.aspect * w) }
}

// The page's items as the lasso sees them, bottom to top; a text box uses its measured height, else an estimate from size and line count.
function lassoItems(content: PageContent, widthMm: number, heights: ReadonlyMap<string, number>): LassoItem[] {
  return pageLayers(content).flatMap((layer): LassoItem[] => {
    if (layer.kind === 'ink') return layer.strokes.map((s) => ({ kind: 'stroke', id: s.id, points: s.points }))
    const { id, box } = layer.item
    if (layer.kind === 'image') return [{ kind: 'image', id, box: { ...box, h: box.w * layer.item.aspect } }]
    const lines = layer.item.text.split('\n').length
    const h = heights.get(id) ?? (lines * TEXT_SIZE_PT[layer.item.size] * MM_PER_PT * TEXT_LINE_HEIGHT) / widthMm
    return [{ kind: 'text', id, box: { ...box, h } }]
  })
}

// A lone selected text box, one being edited and the resize handles keep the pointer from the lasso.
function lassoSkips(target: Element): boolean {
  return target.closest('.mg-nb-text-handle, .mg-nb-text[data-selected], .mg-nb-text[contenteditable]') !== null
}

// True when every ref names a live item in the page's content.
function allOn(content: PageContent | undefined, refs: ItemRef[]): boolean {
  const lists = { stroke: content?.strokes, text: content?.texts, image: content?.images }
  return refs.every((r) => lists[r.kind]?.some((i) => i.id === r.id))
}

// True when both maps hold the same keys and values.
function sameHeights(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v)
}

// True when the event target is a text field.
function inTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null
}

// Live result of a media query.
function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const list = matchMedia(query)
    const update = () => setOn(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return on
}

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
  /** This page's lasso selection. */
  selection: ItemRef[]
  editing: string | null
  menu: ObjectMenuProps
  onSelect(refs: ItemRef[]): void
  onMoved(dx: number, dy: number, client: Point): void
  onEdit(id: string): void
  onDoneEditing(id: string): void
  onJumpToPage(page: number): void
  onPasteAt?(at: Point): void
  scroller(): HTMLElement | null
}

/** One sheet of paper with its z-ordered ink, images and text boxes under one ink layer and the lasso; p.N chips sit above the page. */
function PageView(props: PageViewProps) {
  const { box, content, store, selection, editing, onSelect } = props
  const { page, index, left, top, w, h } = box
  const toPage = page.size.h / page.size.w
  const [live, setLive] = useState<Map<string, InkStroke[]> | null>(null)
  const inks = useMemo(() => content.strokes.map((s) => inkOf(s, 1 / toPage)), [content.strokes, toPage])
  const layers = useMemo(() => pageLayers(content), [content])
  const pageRef = useRef<HTMLDivElement>(null)
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(NO_HEIGHTS)
  const items = useMemo(() => lassoItems(content, page.size.w, heights), [content, page.size.w, heights])

  // Measures each text box's rendered height in page-width units after every render.
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el || w <= 0) return
    const next = new Map<string, number>()
    for (const t of el.querySelectorAll<HTMLElement>(':scope > .mg-nb-text[data-id]')) {
      if (t.offsetHeight > 0) next.set(t.dataset.id!, t.offsetHeight / w)
    }
    setHeights((prev) => (sameHeights(prev, next) ? prev : next))
  })
  const dark = page.color === 'dark'
  const pos = { left: px(left), top: px(top), width: px(w), height: px(h) }
  const figures = content.images.filter((m) => m.pdfPage !== undefined)
  const soleText = selection.length === 1 && selection[0].kind === 'text' ? selection[0].id : null
  return (
    <>
      <div ref={pageRef} class="mg-nb-page" data-page={page.id} data-color={page.color} style={pos}>
        <PaperBackground template={page.template} color={page.color} cssW={w} widthMm={page.size.w} />
        {layers.map((layer) => {
          if (layer.kind === 'image') {
            const m = layer.item
            return (
              <ImageObjectView
                key={m.id}
                item={m}
                cssW={w}
                selected={false}
                onSelect={() => {
                  if (tool.peek() === 'lasso') onSelect([{ kind: 'image', id: m.id }])
                }}
                onChange={(b) => store.updateImage(m.id, { box: b })}
              />
            )
          }
          if (layer.kind === 'text') {
            const t = layer.item
            return (
              <TextBox
                key={t.id}
                item={{ ...t, color: inkDisplayColor(t.color, dark) }}
                cssW={w}
                widthMm={page.size.w}
                editing={editing === t.id}
                selected={soleText === t.id}
                onEdit={() => props.onEdit(t.id)}
                onChange={(patch) => store.updateText(t.id, patch)}
                onDone={() => props.onDoneEditing(t.id)}
                scroller={props.scroller}
              />
            )
          }
          const strokes = layer.strokes.flatMap((s) => live?.get(s.id) ?? [inkOf(s, 1 / toPage)])
          return <StrokeSvg key={`ink-${layer.strokes[0].id}`} strokes={strokes} cssW={w} cssH={h} paperDark={dark} />
        })}
        {w > 0 && (
          <InkLayer
            page={index + 1}
            cssW={w}
            cssH={h}
            strokes={inks}
            pageWidthMm={page.size.w}
            paperDark={dark}
            showStrokes={false}
            onAddStroke={(s) => store.addStroke(toNotebook(s, page.id, toPage))}
            onEraseStroke={store.removeStroke}
            onReplaceStroke={(id, pieces) => store.replaceStroke(id, pieces.map((s) => toNotebook(s, page.id, toPage)))}
            onLivePieces={setLive}
          />
        )}
        {w > 0 && (
          <LassoLayer
            items={items}
            cssW={w}
            aspect={toPage}
            rect={lassoSettings.value.rect}
            objects={true}
            selection={selection}
            skip={lassoSkips}
            onSelect={onSelect}
            onMove={(dx, dy, client, done) => done && props.onMoved(dx, dy, client)}
            onScale={(origin, k, done) => done && store.scaleItems(selection, origin, k)}
            menu={props.menu}
            onPasteAt={props.onPasteAt}
          />
        )}
      </div>
      {figures.length > 0 && (
        <div class="mg-nb-chips" data-page={page.id} style={pos}>
          {figures.map((m) => (
            <div key={m.id} class="mg-nb-chip-slot" style={figureBox(m, w)}>
              <button type="button" class="mg-nb-chip" aria-label={`Go to page ${m.pdfPage}`} onClick={() => props.onJumpToPage(m.pdfPage!)}>
                <span>p.{m.pdfPage}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** Lasso · Pen · Highlighter · Eraser · Text buttons for the active tool. */
function ToolRow() {
  const current = tool.value
  return (
    <div class="mg-nb-tools" role="group" aria-label="Tools">
      {BAR_TOOLS.map((b) => (
        <button
          key={b.tool}
          type="button"
          class="btn mg-nb-pick"
          aria-label={b.label}
          title={b.label}
          aria-pressed={current === b.tool}
          onClick={() => setTool(b.tool)}
        >
          <Icon name={b.tool} />
        </button>
      ))}
    </div>
  )
}

/** The notebook pane: fixed pages on a grey canvas with pinch, double-tap and Ctrl-wheel zoom, pull-to-add, the lasso, text boxes and thumbnails. */
export function Notebook({ store, onJumpToPage, handle }: NotebookProps) {
  const rootRef = useRef<HTMLDivElement>(null)
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
  const [selection, setSelection] = useState<Selection | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState(false)
  const [shownPage, setShownPage] = useState<string | null>(null)
  const wide = useMedia(WIDE)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const lastPointer = useRef<{ page: string; x: number; y: number } | null>(null)
  const textTap = useRef<{ id: number; x: number; y: number; page: HTMLElement; editing: string | null } | null>(null)

  const pages = store.pages.value
  const content = store.content.value
  const layout = useMemo(() => layoutPages(pages, pane.w, zoom), [pages, pane.w, zoom])
  const selected = selection && allOn(content.get(selection.page), selection.refs) ? selection : null

  // Drops a selection whose items left its page, as an undo of a cross-page move does.
  useEffect(() => {
    if (selection && !selected) setSelection((cur) => (cur === selection ? null : cur))
  })
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
    let wheel: { anchor: Point; scroll: Scroll; scale: number } | null = null
    let wheelTimer: ReturnType<typeof setTimeout> | undefined
    let finger: { id: number; x: number; y: number; t: number; moved: boolean; endY: number | null; onText: boolean } | null = null
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
      const pages = store.pages.value
      const paneW = paneRef.current.w
      pendingScroll.current = anchoredScroll(scroll, anchor, layoutPages(pages, paneW, from), layoutPages(pages, paneW, to), from, to)
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

    const endWheel = () => {
      const w = wheel
      if (!w) return
      wheel = null
      clearTimeout(wheelTimer)
      pagesEl.style.transform = ''
      pagesEl.style.transformOrigin = ''
      zoomTo(zoomRef.current * w.scale, w.anchor, w.scroll)
    }

    const onStart = (e: TouchEvent) => {
      endWheel()
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
        const onText = e.target instanceof Element && e.target.closest('.mg-nb-text') !== null
        finger = { id: t.identifier, x: t.clientX, y: t.clientY, t: now(), moved: false, endY: atEnd() ? t.clientY : null, onText }
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
      if (f.moved || f.onText) {
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
      if (pinch) return
      if (!wheel) {
        const scroll = { left: scroller.scrollLeft, top: scroller.scrollTop }
        const anchor = anchorOf(e.clientX, e.clientY)
        wheel = { anchor, scroll, scale: 1 }
        pagesEl.style.transformOrigin = `${scroll.left + anchor.x}px ${scroll.top + anchor.y}px`
      }
      const from = zoomRef.current
      wheel.scale = clampZoom(from * wheel.scale * Math.exp(-e.deltaY * WHEEL_ZOOM_RATE)) / from
      pagesEl.style.transform = `scale(${wheel.scale})`
      clearTimeout(wheelTimer)
      wheelTimer = setTimeout(endWheel, WHEEL_COMMIT_MS)
    }

    const active = { passive: false } as const
    scroller.addEventListener('touchstart', onStart)
    scroller.addEventListener('touchmove', onMove, active)
    scroller.addEventListener('touchend', onEnd)
    scroller.addEventListener('touchcancel', onCancel)
    scroller.addEventListener('wheel', onWheel, active)
    return () => {
      clearTimeout(wheelTimer)
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

  // Clears the lasso selection when the tool leaves Lasso.
  useEffect(
    () =>
      effect(() => {
        if (tool.value !== 'lasso') setSelection(null)
      }),
    [],
  )

  const contentOf = (page: string) => store.content.peek().get(page) ?? NO_CONTENT

  // Where a paste lands: the clip's top-left at the last pointer on a page, else the clip centred on the current page.
  const pasteTarget = (clip: Clip): { page: string; at: Point } | null => {
    const last = lastPointer.current
    const el = last && Array.from(pagesRef.current?.querySelectorAll<HTMLElement>('.mg-nb-page') ?? []).find((p) => p.dataset.page === last.page)
    if (last && el) {
      const r = el.getBoundingClientRect()
      return { page: last.page, at: { x: (last.x - r.left) / r.width, y: (last.y - r.top) / r.width } }
    }
    const box = layoutRef.current.pages.find((b) => b.page.id === currentPage())
    if (!box) return null
    return { page: box.page.id, at: { x: 0.5 - clip.w / 2, y: box.h / box.w / 2 - clip.h / 2 } }
  }

  // Inserts the clip with its top-left at a page point, kept on the page, and selects it under the Lasso.
  const pasteAt = (page: string, at: Point) => {
    const clip = clipboard.peek()
    const size = store.pages.peek().find((p) => p.id === page)?.size
    if (!clip || !size) return
    const refs = store.insertClip(clip, page, clampPaste(clip, at, size.h / size.w))
    if (tool.peek() === 'lasso') setSelection({ page, refs })
  }

  const paste = () => {
    const clip = clipboard.peek()
    const target = clip && pasteTarget(clip)
    if (target) pasteAt(target.page, target.at)
  }
  // A system paste adds its image files, else, outside text fields, the in-app clip.
  const onPaste = (e: ClipboardEvent) => {
    const files = imageFiles(e.clipboardData?.files)
    if (files.length > 0) {
      e.preventDefault()
      void addImages(files)
    } else if (clipboard.peek() && !inTextField(e.target)) {
      e.preventDefault()
      paste()
    }
  }
  const onPasteRef = useRef(onPaste)
  onPasteRef.current = onPaste

  // Pastes go to the notebook while the last press was in it; a press outside hands pastes and the selection to the other pane.
  useEffect(() => {
    let inside = true
    const onDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null
      inside = !!target && !!rootRef.current?.contains(target)
      if (!inside && !target?.closest('.mg-toolmenu')) setSelection(null)
    }
    const onDocPaste = (e: ClipboardEvent) => {
      if (inside) onPasteRef.current(e)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('paste', onDocPaste)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('paste', onDocPaste)
    }
  }, [])

  // Remembers the last pointer over a page, outside the object menu, as the paste point.
  const trackPointer = (e: PointerEvent) => {
    const target = e.target instanceof Element ? e.target : null
    const pageEl = target?.closest<HTMLElement>('.mg-nb-page')
    if (pageEl?.dataset.page && !target?.closest('.mg-lasso-menu')) lastPointer.current = { page: pageEl.dataset.page, x: e.clientX, y: e.clientY }
  }

  // Moves a page's selection; a drop over another page re-parents it there with dy carried across the page tops.
  const moveSelection = (from: string, refs: ItemRef[], dx: number, dy: number, client: Point) => {
    const scroller = scrollerRef.current
    const layout = layoutRef.current
    const src = layout.pages.find((b) => b.page.id === from)
    if (!scroller || !src) return
    const dst = pageNear(layout, client.y - scroller.getBoundingClientRect().top + scroller.scrollTop) ?? src
    if (dst === src) {
      store.moveItems(refs, dx, dy)
      return
    }
    store.moveItems(refs, dx, dy - (dst.top - src.top) / src.w, dst.page.id)
    setSelection({ page: dst.page.id, refs })
  }

  const menuFor = (page: string, refs: ItemRef[]): ObjectMenuProps => ({
    colors: PRESET_COLORS,
    onCut() {
      copyItems(contentOf(page), refs)
      store.removeItems(refs)
      setSelection(null)
    },
    onCopy: () => void copyItems(contentOf(page), refs),
    onDuplicate: () => setSelection({ page, refs: store.duplicateItems(refs, DUPLICATE_OFFSET) }),
    onDelete() {
      store.removeItems(refs)
      setSelection(null)
    },
    onRecolor: (color) => store.recolorItems(refs, color),
    onFront: () => store.bringToFront(refs),
    onBack: () => store.sendToBack(refs),
    onPaste: clipboard.value ? paste : undefined,
  })

  // Ends editing a text box; a box left empty is removed.
  const finishEditing = (id: string) => {
    setEditing((cur) => (cur === id ? null : cur))
    const t = store.doc.peek().texts.find((x) => x.id === id && !x.deleted)
    if (t && !t.text.trim()) store.removeObject('texts', id)
  }

  // A tap with the Text tool off any text box drops a new box there and edits it; a tap while editing only finishes the edit.
  const onPagesDown = (e: PointerEvent) => {
    const target = e.target instanceof Element ? e.target : null
    const page = target?.closest<HTMLElement>('.mg-nb-page')
    const primary = e.pointerType === 'touch' ? e.isPrimary : e.button === 0
    const onText = target?.closest('.mg-nb-text, .mg-nb-text-frame')
    textTap.current = tool.peek() === 'text' && primary && page && !onText ? { id: e.pointerId, x: e.clientX, y: e.clientY, page, editing: editingRef.current } : null
    // Keeps the compatibility mouse events from moving focus off the box this tap creates.
    if (textTap.current) e.preventDefault()
  }

  const onPagesUp = (e: PointerEvent) => {
    const t = textTap.current
    textTap.current = null
    if (!t || t.id !== e.pointerId || Math.hypot(e.clientX - t.x, e.clientY - t.y) > TEXT_TAP_PX || !t.page.dataset.page) return
    if (t.editing) {
      finishEditing(t.editing)
      return
    }
    const r = t.page.getBoundingClientRect()
    const box = textBoxAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width)
    const item = store.addText({ page: t.page.dataset.page, box, text: '', size: textSize.peek(), color: activeColor('text') })
    setEditing(item.id)
  }

  // Keeps the strip's current page in step with scrolling while it is open.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!thumbs || !scroller) return
    const update = () => setShownPage(currentPage())
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    return () => scroller.removeEventListener('scroll', update)
  }, [thumbs])

  // Scrolls a page to the top; the bottom sheet closes after the jump.
  const jumpTo = (id: string) => {
    const scroller = scrollerRef.current
    const box = layoutRef.current.pages.find((b) => b.page.id === id)
    if (!scroller || !box) return
    scroller.scrollTop = box.top - NOTEBOOK_GAP_PX
    setShownPage(id)
    if (!wide) setThumbs(false)
  }

  const strip = (layout: 'column' | 'sheet') => (
    <Thumbnails store={store} current={shownPage} layout={layout} onJump={jumpTo} onClose={() => setThumbs(false)} />
  )

  const sheetPage = pages.find((p) => p.id === sheetFor)

  return (
    <div ref={rootRef} class="mg-notebook" onDragOver={(e) => carriesFiles(e) && e.preventDefault()} onDrop={onDrop}>
      <div class="mg-nb-bar">
        <ToolRow />
        <button type="button" class="btn mg-nb-tool" onClick={() => inputRef.current?.click()}>
          Image
        </button>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPicked} />
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
        <button type="button" class="btn mg-nb-tool" aria-expanded={thumbs} onClick={() => setThumbs((open) => !open)}>
          Thumbnails
        </button>
        <button type="button" class="btn mg-nb-tool" disabled={pages.length === 0} onClick={() => setSheetFor(currentPage())}>
          Template
        </button>
      </div>
      <div class="mg-nb-body">
        {thumbs && wide && strip('column')}
        <div ref={scrollerRef} class="mg-nb-scroller" data-ink-viewport="" tabIndex={0}>
          <div
            ref={pagesRef}
            class="mg-nb-pages"
            style={{ width: px(layout.width), height: px(layout.height) }}
            onPointerDownCapture={trackPointer}
            onPointerMoveCapture={trackPointer}
            onPointerDown={onPagesDown}
            onPointerUp={onPagesUp}
          >
            {layout.pages.map((b) => {
              const id = b.page.id
              const refs = selected?.page === id ? selected.refs : NO_REFS
              return (
                <PageView
                  key={id}
                  box={b}
                  content={content.get(id) ?? NO_CONTENT}
                  store={store}
                  selection={refs}
                  editing={editing}
                  menu={menuFor(id, refs)}
                  onSelect={(next) => setSelection(next.length ? { page: id, refs: next } : null)}
                  onMoved={(dx, dy, client) => moveSelection(id, refs, dx, dy, client)}
                  onEdit={(id) => {
                    setEditing(id)
                    setSelection(null)
                  }}
                  onDoneEditing={finishEditing}
                  onJumpToPage={onJumpToPage}
                  onPasteAt={clipboard.value ? (at) => pasteAt(id, at) : undefined}
                  scroller={() => scrollerRef.current}
                />
              )
            })}
          </div>
        </div>
      </div>
      {thumbs && !wide && strip('sheet')}
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
