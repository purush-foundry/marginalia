import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { INK_VIEWPORT_ATTR } from '../ink/InkLayer.tsx'
import { itemsBounds, rectLoop, selectInLoop, type ItemRef, type LassoItem } from '../ink/lasso.ts'
import { fingerDraws, penActivity, tool } from '../ink/tools.ts'
import { now } from '../lib/ids.ts'
import './lasso.css'

export interface ObjectMenuProps {
  colors: readonly string[]
  onCut(): void
  onCopy(): void
  onPaste?(): void
  onDuplicate(): void
  onDelete(): void
  onRecolor(color: string): void
  onFront?(): void
  onBack?(): void
  /** Called after every render of the menu, so its holder can place it. */
  onLayout?(): void
}

/** Actions on a lasso selection; Recolor opens a row of colours. */
export function ObjectMenu(props: ObjectMenuProps): JSX.Element {
  const [colorsOpen, setColorsOpen] = useState(false)
  useLayoutEffect(() => props.onLayout?.())
  const item = (label: string, onClick: () => void) => (
    <button type="button" role="menuitem" class="mg-object-menu-item" onClick={onClick}>
      {label}
    </button>
  )
  return (
    <div class="mg-object-menu" role="menu" aria-label="Selection">
      <div class="mg-object-menu-row">
        {item('Cut', props.onCut)}
        {item('Copy', props.onCopy)}
        {props.onPaste && item('Paste', props.onPaste)}
        {item('Duplicate', props.onDuplicate)}
        {item('Delete', props.onDelete)}
        <button
          type="button"
          role="menuitem"
          class="mg-object-menu-item"
          aria-haspopup="true"
          aria-expanded={colorsOpen ? 'true' : 'false'}
          onClick={() => setColorsOpen((open) => !open)}
        >
          Recolor
        </button>
        {props.onFront && item('Front', props.onFront)}
        {props.onBack && item('Back', props.onBack)}
      </div>
      {colorsOpen && (
        <div class="mg-object-menu-colors" role="group" aria-label="Colours">
          {props.colors.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitem"
              class="mg-object-menu-color"
              aria-label={c}
              style={{ '--dot': c }}
              onClick={() => {
                setColorsOpen(false)
                props.onRecolor(c)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export interface LassoLayerProps {
  /** The page's items, bottom to top; aspect is the page's height / width. */
  items: LassoItem[]
  cssW: number
  aspect: number
  /** Rectangular mode; objects is false on PDF pages. */
  rect: boolean
  objects: boolean
  selection: ItemRef[]
  /** Pointerdowns this returns true for are left alone. */
  skip?(target: Element, e: PointerEvent): boolean
  onSelect(refs: ItemRef[]): void
  onMove(dx: number, dy: number, client: { x: number; y: number }, done: boolean): void
  onScale(origin: { x: number; y: number }, k: number, done: boolean): void
  menu: ObjectMenuProps
  /** Set while there is something to paste: a tap on empty space offers Paste at that point, in page-width units. */
  onPasteAt?(at: { x: number; y: number }): void
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'
type Point = { x: number; y: number }
type Bounds = { x: number; y: number; w: number; h: number }

type Gesture =
  | { kind: 'loop'; id: number; start: Point; points: number[]; far: boolean }
  | { kind: 'tap'; id: number; start: Point }
  | { kind: 'move'; id: number; start: Point; dx: number; dy: number; client: Point; moved: boolean }
  | { kind: 'scale'; id: number; start: Point; origin: Point; k: number; moved: boolean }

type Preview = { kind: 'move'; dx: number; dy: number } | { kind: 'scale'; k: number; origin: Point }

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']
const PALM_WINDOW_MS = 500
const TAP_SLOP_PX = 8
const FRAME_PAD_PX = 8
const MIN_SCALE = 0.05
const MENU_GAP_PX = 8
const MENU_EDGE_PX = 8

const fmt = (v: number) => String(Math.round(v * 100) / 100)
const px = (v: number) => `${fmt(v)}px`

// The corner of the bounds opposite `corner`.
function opposite(b: Bounds, corner: Corner): Point {
  return { x: corner.includes('w') ? b.x + b.w : b.x, y: corner.includes('n') ? b.y + b.h : b.y }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Top-left of a w×h menu centred on cx beside the span [top, bottom] inside a pageW×pageH page: above when there is room, else below, else overlapping.
function placeMenu(a: { cx: number; top: number; bottom: number }, w: number, h: number, pageW: number, pageH: number) {
  const left = clamp(a.cx - w / 2, MENU_EDGE_PX, pageW - w - MENU_EDGE_PX)
  const above = a.top - MENU_GAP_PX - h
  if (above >= MENU_EDGE_PX) return { left, top: above, side: 'above' }
  const below = a.bottom + MENU_GAP_PX
  if (below + h <= pageH - MENU_EDGE_PX) return { left, top: below, side: 'below' }
  return { left, top: clamp(below, MENU_EDGE_PX, pageH - h - MENU_EDGE_PX), side: 'inside' }
}

// True when the event happened inside a text field.
function inTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null
}

// SVG path through flat [x, y, …] page-width points, scaled to CSS px.
function loopPath(points: number[], cssW: number, closed: boolean): string {
  let d = ''
  for (let i = 0; i + 1 < points.length; i += 2) d += `${i ? 'L' : 'M'}${fmt(points[i] * cssW)} ${fmt(points[i + 1] * cssW)}`
  return closed ? `${d}Z` : d
}

/** Lasso input over a page: draws the selection loop, shows the selection frame and its object menu, and moves or scales the selection. */
export function LassoLayer(props: LassoLayerProps): JSX.Element {
  const { cssW, aspect } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const [loop, setLoop] = useState<{ points: number[]; rect: boolean } | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pasteAt, setPasteAt] = useState<Point | null>(null)
  const pasteRef = useRef<Point | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuAnchor = useRef<{ cx: number; top: number; bottom: number } | null>(null)
  const active = tool.value === 'lasso'
  const frame = active && props.selection.length ? itemsBounds(props.items, props.selection) : null
  const live = useRef({ props, frame })
  live.current = { props, frame }

  const fingerLoops = active && fingerDraws.value

  const showPaste = (p: Point | null) => {
    pasteRef.current = p
    setPasteAt(p)
  }

  // Drops the Paste offer when the Lasso, the clip or the empty selection goes away.
  const offering = active && !!props.onPasteAt && !props.selection.length
  useEffect(() => {
    if (!offering) showPaste(null)
  }, [offering])

  // Closes the Paste offer on a press outside this page.
  useEffect(() => {
    if (!pasteAt) return
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node && rootRef.current?.parentElement?.contains(e.target))) showPaste(null)
    }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [pasteAt])

  // Stops the page from panning under a finger while the finger draws the loop.
  useEffect(() => {
    const parent = rootRef.current?.parentElement
    if (!fingerLoops || !parent) return
    const before = parent.style.touchAction
    parent.style.touchAction = 'none'
    return () => {
      parent.style.touchAction = before
    }
  }, [fingerLoops])

  // Intercepts lasso input on the parent element in the capture phase while the Lasso is the tool.
  useEffect(() => {
    const root = rootRef.current
    const parent = root?.parentElement
    if (!root || !parent) return
    let g: Gesture | null = null
    let dismissed = false

    const scaleOf = () => root.getBoundingClientRect().width || live.current.props.cssW
    const pagePoint = (e: PointerEvent): Point => {
      const r = root.getBoundingClientRect()
      const s = r.width || live.current.props.cssW
      return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s }
    }
    const swallow = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    // Does what the cancelled mousedown would have: collapses the text selection and moves focus to the pane.
    const takeFocus = () => {
      const sel = document.getSelection()
      if (sel && sel.rangeCount > 0) sel.removeAllRanges()
      const pane = root.closest<HTMLElement>(`[${INK_VIEWPORT_ATTR}]`)
      if (pane && pane.tabIndex >= 0) pane.focus({ preventScroll: true })
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }
    const capture = (e: PointerEvent) => {
      try {
        parent.setPointerCapture(e.pointerId)
      } catch {
        // Ignores pointers that can no longer be captured.
      }
    }
    const items = () => {
      const p = live.current.props
      return p.objects ? p.items : p.items.filter((i) => i.kind === 'stroke')
    }
    const inFrame = (p: Point, b: Bounds) => {
      const pad = FRAME_PAD_PX / live.current.props.cssW
      return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad
    }

    // Selects the topmost object under the point, else clears the selection, else offers Paste there unless the press closed an offer.
    const tap = (p: Point) => {
      const { onSelect, selection, onPasteAt } = live.current.props
      const hit = items().findLast((i) => i.box && p.x >= i.box.x && p.x <= i.box.x + i.box.w && p.y >= i.box.y && p.y <= i.box.y + i.box.h)
      if (hit) onSelect([{ kind: hit.kind, id: hit.id }])
      else if (selection.length) onSelect([])
      else if (onPasteAt && !dismissed) showPaste(p)
    }

    const finish = (e: PointerEvent, cancelled: boolean) => {
      const done = g
      g = null
      setLoop(null)
      setPreview(null)
      if (!done) return
      const { onMove, onScale, onSelect, rect } = live.current.props
      if (done.kind === 'move') {
        if (done.moved) onMove(done.dx, done.dy, done.client, true)
      } else if (done.kind === 'scale') {
        if (done.moved) onScale(done.origin, done.k, true)
      } else if (cancelled) {
        return
      } else if (done.kind === 'loop' && done.far) {
        const p = pagePoint(e)
        onSelect(selectInLoop(items(), rect ? rectLoop(done.start.x, done.start.y, p.x, p.y) : done.points))
      } else {
        tap(pagePoint(e))
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const touch = e.pointerType === 'touch'
      if (touch && !e.isPrimary && g?.kind === 'tap') g = null
      if (tool.peek() !== 'lasso' || g || (touch && !e.isPrimary)) return
      if (touch && (penActivity.down || now() - penActivity.lastUp < PALM_WINDOW_MS)) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('.mg-object-menu')) return
      dismissed = pasteRef.current !== null
      if (dismissed) showPaste(null)
      if (target && live.current.props.skip?.(target, e)) return
      const p = pagePoint(e)
      const b = live.current.frame
      const corner = target?.closest<HTMLElement>('.mg-lasso-handle')?.dataset.corner as Corner | undefined
      if (b && corner) {
        g = { kind: 'scale', id: e.pointerId, start: p, origin: opposite(b, corner), k: 1, moved: false }
      } else if (b && inFrame(p, b)) {
        g = { kind: 'move', id: e.pointerId, start: p, dx: 0, dy: 0, client: { x: e.clientX, y: e.clientY }, moved: false }
      } else if (touch && !fingerDraws.peek()) {
        g = { kind: 'tap', id: e.pointerId, start: p }
        return
      } else {
        g = { kind: 'loop', id: e.pointerId, start: p, points: [p.x, p.y], far: false }
      }
      swallow(e)
      capture(e)
      takeFocus()
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return
      const p = pagePoint(e)
      const far = Math.hypot(p.x - g.start.x, p.y - g.start.y) * scaleOf() > TAP_SLOP_PX
      if (g.kind === 'tap') {
        if (far) g = null
        return
      }
      swallow(e)
      const { onMove, onScale, rect } = live.current.props
      if (g.kind !== 'loop') g.moved ||= far
      if (g.kind === 'loop') {
        g.points.push(p.x, p.y)
        g.far ||= far
        setLoop({ points: rect ? rectLoop(g.start.x, g.start.y, p.x, p.y) : g.points.slice(), rect })
      } else if (!g.moved) {
        return
      } else if (g.kind === 'move') {
        Object.assign(g, { dx: p.x - g.start.x, dy: p.y - g.start.y, client: { x: e.clientX, y: e.clientY } })
        setPreview({ kind: 'move', dx: g.dx, dy: g.dy })
        onMove(g.dx, g.dy, g.client, false)
      } else {
        const { origin, start } = g
        const from = Math.hypot(start.x - origin.x, start.y - origin.y)
        g.k = from > 0 ? Math.max(MIN_SCALE, Math.hypot(p.x - origin.x, p.y - origin.y) / from) : 1
        setPreview({ kind: 'scale', k: g.k, origin })
        onScale(origin, g.k, false)
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return
      if (g.kind !== 'tap') swallow(e)
      finish(e, false)
    }

    const onPointerCancel = (e: PointerEvent) => {
      if (g && e.pointerId === g.id) finish(e, true)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const { selection, onSelect, menu } = live.current.props
      if (tool.peek() !== 'lasso' || !selection.length || inTextField(e.target)) return
      if (document.getSelection()?.isCollapsed === false) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'c') menu.onCopy()
      else if (mod && k === 'x') menu.onCut()
      else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) menu.onDelete()
      else if (e.key === 'Escape') onSelect([])
      else return
      e.preventDefault()
    }

    const opts = { capture: true } as const
    parent.addEventListener('pointerdown', onPointerDown, opts)
    parent.addEventListener('pointermove', onPointerMove, opts)
    parent.addEventListener('pointerup', onPointerUp, opts)
    parent.addEventListener('pointercancel', onPointerCancel, opts)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      parent.removeEventListener('pointerdown', onPointerDown, opts)
      parent.removeEventListener('pointermove', onPointerMove, opts)
      parent.removeEventListener('pointerup', onPointerUp, opts)
      parent.removeEventListener('pointercancel', onPointerCancel, opts)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const h = cssW * aspect
  // Places the open menu inside the page from its measured size.
  const placeOpenMenu = () => {
    const el = menuRef.current
    const a = menuAnchor.current
    if (!el || !a) return
    const at = placeMenu(a, el.offsetWidth, el.offsetHeight, cssW, h)
    el.style.left = px(at.left)
    el.style.top = px(at.top)
    el.dataset.side = at.side
  }
  useLayoutEffect(placeOpenMenu)
  const menuSlot = (children: JSX.Element) => (
    <div ref={menuRef} class="mg-lasso-menu" style={{ maxWidth: px(cssW - 2 * MENU_EDGE_PX) }}>
      {children}
    </div>
  )
  menuAnchor.current = null
  let frameView: JSX.Element | null = null
  if (frame) {
    const left = frame.x * cssW - FRAME_PAD_PX
    const top = frame.y * cssW - FRAME_PAD_PX
    const height = frame.h * cssW + 2 * FRAME_PAD_PX
    if (!preview) menuAnchor.current = { cx: (frame.x + frame.w / 2) * cssW, top, bottom: top + height }
    const style: Record<string, string> = { left: px(left), top: px(top), width: px(frame.w * cssW + 2 * FRAME_PAD_PX), height: px(height) }
    if (preview?.kind === 'move') style.transform = `translate(${px(preview.dx * cssW)}, ${px(preview.dy * cssW)})`
    if (preview?.kind === 'scale') {
      style.transformOrigin = `${px(preview.origin.x * cssW - left)} ${px(preview.origin.y * cssW - top)}`
      style.transform = `scale(${preview.k})`
    }
    frameView = (
      <>
        <div class="mg-lasso-frame" style={style}>
          {CORNERS.map((c) => (
            <div key={c} class="mg-lasso-handle" data-corner={c} />
          ))}
        </div>
        {!preview && menuSlot(<ObjectMenu {...props.menu} onLayout={placeOpenMenu} />)}
      </>
    )
  } else if (active && pasteAt && props.onPasteAt) {
    const at = pasteAt
    const onPasteAt = props.onPasteAt
    menuAnchor.current = { cx: at.x * cssW, top: at.y * cssW, bottom: at.y * cssW }
    frameView = menuSlot(
      <div class="mg-object-menu" role="menu" aria-label="Paste">
        <div class="mg-object-menu-row">
          <button
            type="button"
            role="menuitem"
            class="mg-object-menu-item"
            onClick={() => {
              showPaste(null)
              onPasteAt(at)
            }}
          >
            Paste
          </button>
        </div>
      </div>,
    )
  }
  return (
    <div ref={rootRef} class="mg-lasso" style={{ width: px(cssW), height: px(h) }}>
      <svg class="mg-lasso-svg" width={cssW} height={h} viewBox={`0 0 ${cssW} ${h}`} aria-hidden="true">
        {loop && <path class="mg-lasso-loop" d={loopPath(loop.points, cssW, loop.rect)} />}
      </svg>
      {frameView}
    </div>
  )
}
