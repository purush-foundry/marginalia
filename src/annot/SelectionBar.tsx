import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '../types.ts'
import './annot.css'

const MARGIN = 8
const BAR_HEIGHT = 52
const FALLBACK_WIDTH = 320

export interface SelectionBarProps {
  anchorRect: DOMRect
  current?: Highlight
  onColor(color: HighlightColor): void
  onAsk(): void
  onNote(): void
  onCopy?(): void
  onCopyImage?(): void
  onToNotes?(): void
  onDelete?(): void
  onDismiss(): void
}

interface Placement {
  top: number
  left: number
  side: 'above' | 'below'
}

function place(anchor: DOMRect, w: number, h: number): Placement {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let side: Placement['side'] = 'above'
  let top = anchor.top - h - MARGIN
  if (top < MARGIN) {
    side = 'below'
    top = anchor.bottom + MARGIN
  }
  top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - h - MARGIN))
  const centre = anchor.left + anchor.width / 2
  const left = Math.min(Math.max(centre - w / 2, MARGIN), Math.max(MARGIN, vw - w - MARGIN))
  return { top, left, side }
}

const label = (c: HighlightColor) => c[0].toUpperCase() + c.slice(1)

/** Floating bar of highlight colours and actions anchored to a selection or highlight. */
export function SelectionBar(props: SelectionBarProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Placement>(() => place(props.anchorRect, FALLBACK_WIDTH, BAR_HEIGHT))
  const dismiss = useRef(props.onDismiss)
  dismiss.current = props.onDismiss

  useLayoutEffect(() => {
    const el = ref.current
    const w = el?.offsetWidth || FALLBACK_WIDTH
    const h = el?.offsetHeight || BAR_HEIGHT
    setPos(place(props.anchorRect, w, h))
  }, [props.anchorRect, props.onCopy !== undefined, props.onCopyImage !== undefined, props.onDelete !== undefined])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) dismiss.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss.current()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const keepSelection = (e: Event) => e.preventDefault()

  return (
    <div
      ref={ref}
      class="mg-selbar"
      role="toolbar"
      aria-label="Selection actions"
      data-placement={pos.side}
      style={{ top: `${pos.top}px`, left: `${pos.left}px`, flexWrap: 'wrap', maxWidth: 'calc(100vw - 16px)' }}
      onPointerDown={keepSelection}
      onMouseDown={keepSelection}
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          class="mg-selbar-dot"
          aria-label={label(c)}
          aria-pressed={props.current?.color === c ? 'true' : 'false'}
          style={{ '--dot': `var(--hl-${c})` }}
          onClick={() => props.onColor(c)}
        />
      ))}
      <span class="mg-selbar-sep" />
      <button type="button" class="mg-selbar-btn" aria-label="Ask" onClick={() => props.onAsk()}>
        Ask
      </button>
      <button type="button" class="mg-selbar-btn" aria-label="Note" onClick={() => props.onNote()}>
        Note
      </button>
      {props.onCopyImage && (
        <button type="button" class="mg-selbar-btn" aria-label="Copy image" onClick={() => props.onCopyImage?.()}>
          Copy image
        </button>
      )}
      {props.onToNotes && (
        <button type="button" class="mg-selbar-btn" aria-label="To notes" onClick={() => props.onToNotes?.()}>
          To notes
        </button>
      )}
      {props.onCopy && (
        <button type="button" class="mg-selbar-btn" aria-label="Copy" onClick={() => props.onCopy?.()}>
          Copy
        </button>
      )}
      {props.onDelete && (
        <button
          type="button"
          class="mg-selbar-btn danger"
          aria-label="Delete"
          onClick={() => props.onDelete?.()}
        >
          Delete
        </button>
      )}
    </div>
  )
}
