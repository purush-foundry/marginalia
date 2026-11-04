import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { itemsBounds, rectLoop, selectInLoop, type ItemRef, type LassoItem } from '../ink/lasso.ts'
import { fingerDraws, penActivity, tool } from '../ink/tools.ts'
import { now } from '../lib/ids.ts'
import './lasso.css'

export interface ObjectMenuProps {
  colors: readonly string[]
  onCut(): void
  onCopy(): void
  onDuplicate(): void
  onDelete(): void
  onRecolor(color: string): void
  onFront?(): void
  onBack?(): void
}

/** Actions on a lasso selection; Recolor opens a row of colours. */
export function ObjectMenu(props: ObjectMenuProps): JSX.Element {
  const [colorsOpen, setColorsOpen] = useState(false)
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
  /** Pointerdowns on these targets are left alone. */
  skip?(target: Element): boolean
  onSelect(refs: ItemRef[]): void
  onMove(dx: number, dy: number, client: { x: number; y: number }, done: boolean): void
  onScale(origin: { x: number; y: number }, k: number, done: boolean): void
  menu: ObjectMenuProps
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
// A frame whose top is closer than this to the page top gets the menu below it.
const MENU_ROOM_PX = 64

const fmt = (v: number) => String(Math.round(v * 100) / 100)
const px = (v: number) => `${fmt(v)}px`

// The corner of the bounds opposite `corner`.
function opposite(b: Bounds, corner: Corner): Point {
  return { x: corner.includes('w') ? b.x + b.w : b.x, y: corner.includes('n') ? b.y + b.h : b.y }
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
  const active = tool.value === 'lasso'
  const frame = active && props.selection.length ? itemsBounds(props.items, props.selection) : null
  const live = useRef({ props, frame })
  live.current = { props, frame }

  const fingerLoops = active && fingerDraws.value

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

    // Selects the topmost object under the point, or clears the selection when there is none.
    const tap = (p: Point) => {
      const { onSelect, selection } = live.current.props
      const hit = items().findLast((i) => i.box && p.x >= i.box.x && p.x <= i.box.x + i.box.w && p.y >= i.box.y && p.y <= i.box.y + i.box.h)
      if (hit) onSelect([{ kind: hit.kind, id: hit.id }])
      else if (selection.length) onSelect([])
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
      if (target?.closest('.mg-object-menu') || (target && live.current.props.skip?.(target))) return
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
  let frameView: JSX.Element | null = null
  if (frame) {
    const left = frame.x * cssW - FRAME_PAD_PX
    const top = frame.y * cssW - FRAME_PAD_PX
    const height = frame.h * cssW + 2 * FRAME_PAD_PX
    const below = top < MENU_ROOM_PX
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
        {!preview && (
          <div
            class="mg-lasso-menu"
            data-side={below ? 'below' : 'above'}
            style={{ left: px((frame.x + frame.w / 2) * cssW), top: px(below ? top + height : top) }}
          >
            <ObjectMenu {...props.menu} />
          </div>
        )}
      </>
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
