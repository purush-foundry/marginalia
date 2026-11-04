// Image object on a notebook page: selected by a tap, moved by a drag and scaled from its corners with a fixed aspect.
import type { JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'
import type { ImageObject, ObjectBox } from './model.ts'
import './objects.css'

const IMAGE_MIN_W = 0.1
const DRAG_SLOP_PX = 6
const CORNERS = ['nw', 'ne', 'sw', 'se'] as const

type Corner = (typeof CORNERS)[number]

export interface ImageObjectProps {
  item: ImageObject
  cssW: number
  selected: boolean
  onSelect(): void
  onChange(box: ObjectBox): void
  onJumpToPage(page: number): void
}

interface Gesture {
  pointerId: number
  x: number
  y: number
  from: ObjectBox
  corner: Corner | null
  moved: boolean
  pageH: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

const px = (v: number) => `${v}px`

// The box after dragging the body (corner null) or a corner by dx, dy page-width units; corners scale about the opposite corner.
function draggedBox(from: ObjectBox, aspect: number, corner: Corner | null, dx: number, dy: number, pageH: number): ObjectBox {
  const h = from.w * aspect
  if (!corner) return { x: clamp(from.x + dx, 0, 1 - from.w), y: clamp(from.y + dy, 0, Math.max(0, pageH - h)), w: from.w }
  const sx = corner.endsWith('e') ? 1 : -1
  const sy = corner.startsWith('s') ? 1 : -1
  const grow = (sx * dx + sy * aspect * dy) / (1 + aspect * aspect)
  const maxX = sx > 0 ? 1 - from.x : from.x + from.w
  const maxY = (sy > 0 ? pageH - from.y : from.y + h) / aspect
  const lo = Math.min(IMAGE_MIN_W, from.w)
  const w = clamp(from.w + grow, lo, Math.max(lo, Math.min(maxX, maxY)))
  return { x: sx > 0 ? from.x : from.x + from.w - w, y: sy > 0 ? from.y : from.y + h - w * aspect, w }
}

/** An image with its p.N chip when it came from a PDF page; corner handles show while selected. */
export function ImageObjectView({ item, cssW, selected, onSelect, onChange, onJumpToPage }: ImageObjectProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [live, setLive] = useState<ObjectBox | null>(null)

  const onDown = (corner: Corner | null) => (e: PointerEvent) => {
    if (!selected || gesture.current) return
    e.preventDefault()
    e.stopPropagation()
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      // Ignores pointers that can no longer be captured.
    }
    const pageH = ref.current?.parentElement?.clientHeight ?? 0
    gesture.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, from: item.box, corner, moved: false, pageH: pageH > 0 ? pageH / cssW : Infinity }
  }

  const boxAt = (g: Gesture, e: PointerEvent) => draggedBox(g.from, item.aspect, g.corner, (e.clientX - g.x) / cssW, (e.clientY - g.y) / cssW, g.pageH)

  const onMove = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId || cssW <= 0) return
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > DRAG_SLOP_PX) g.moved = true
    if (!g.moved) return
    e.preventDefault()
    setLive(boxAt(g, e))
  }

  const onUp = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    gesture.current = null
    if (!g.moved || cssW <= 0) return
    setLive(null)
    onChange(boxAt(g, e))
  }

  const onCancel = () => {
    gesture.current = null
    setLive(null)
  }

  const b = live ?? item.box
  const page = item.pdfPage
  return (
    <div
      ref={ref}
      class="mg-nb-figure"
      data-id={item.id}
      data-selected={selected ? '' : undefined}
      style={{ left: px(b.x * cssW), top: px(b.y * cssW), width: px(b.w * cssW), height: px(b.w * item.aspect * cssW) }}
      onPointerDown={onDown(null)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onClick={() => {
        if (!selected) onSelect()
      }}
    >
      <img class="mg-nb-image" src={item.src} alt="" draggable={false} />
      {page !== undefined && (
        <button
          type="button"
          class="mg-nb-chip"
          aria-label={`Go to page ${page}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onJumpToPage(page)
          }}
        >
          <span>p.{page}</span>
        </button>
      )}
      {selected &&
        CORNERS.map((c) => (
          <div key={c} class="mg-nb-image-handle" data-corner={c} aria-hidden="true" onPointerDown={onDown(c)} />
        ))}
    </div>
  )
}
