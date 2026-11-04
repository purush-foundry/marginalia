// Editable text box on a notebook page: plain text at its point size, moved and widened while selected, edited on double-tap.
import type { JSX } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { MM_PER_PT } from '../ink/tools.ts'
import { now } from '../lib/ids.ts'
import { caretOffset, keepCaretVisible, placeCaret } from './caret.ts'
import type { ObjectBox, TextObject } from './model.ts'
import './objects.css'

export const TEXT_SIZE_PT = { s: 10, m: 13, l: 18 } as const
export const TEXT_BOX_DEFAULT_W = 0.6
export const TEXT_BOX_MIN_W = 0.1

const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
const TAP_SLOP_PX = 6

/** A default-width box at the tap, moved left as needed to stay on the page. */
export function textBoxAt(x: number, y: number): ObjectBox {
  const w = TEXT_BOX_DEFAULT_W
  return { x: clamp(x, 0, 1 - w), y: Math.max(0, y), w }
}

export interface TextBoxProps {
  item: TextObject
  cssW: number
  widthMm: number
  editing: boolean
  selected: boolean
  onEdit(): void
  onChange(patch: Partial<Pick<TextObject, 'text' | 'box'>>): void
  onDone(): void
  scroller: () => HTMLElement | null
}

type Side = 'left' | 'right'

interface Gesture {
  pointerId: number
  x: number
  y: number
  from: ObjectBox
  side: Side | null
  drags: boolean
  moved: boolean
  maxY: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function capture(e: PointerEvent): void {
  try {
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  } catch {
    // Ignores pointers that can no longer be captured.
  }
}

const px = (v: number) => `${v}px`

// The box after a body drag (side null) or a side-handle drag of dx, dy page-width units, kept on the page.
function draggedBox(from: ObjectBox, side: Side | null, dx: number, dy: number, maxY: number): ObjectBox {
  if (side === 'right') return { ...from, w: clamp(from.w + dx, TEXT_BOX_MIN_W, 1 - from.x) }
  if (side === 'left') {
    const right = from.x + from.w
    const x = clamp(from.x + dx, 0, right - TEXT_BOX_MIN_W)
    return { ...from, x, w: right - x }
  }
  return { x: clamp(from.x + dx, 0, 1 - from.w), y: clamp(from.y + dy, 0, Math.max(0, maxY)), w: from.w }
}

/** A text object; its DOM text follows the item whenever the item differs from what the box last sent. */
export function TextBox({ item, cssW, widthMm, editing, selected, onEdit, onChange, onDone, scroller }: TextBoxProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const lastSent = useRef<string | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null)
  const [live, setLive] = useState<ObjectBox | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || item.text === lastSent.current) return
    lastSent.current = item.text
    if (el.textContent === item.text) return
    const focused = document.activeElement === el
    const caret = focused ? caretOffset(el) : 0
    el.textContent = item.text
    if (focused) placeCaret(el, Math.min(caret, item.text.length))
  }, [item.text])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (!editing) {
      if (document.activeElement === el) el.blur()
      return
    }
    if (document.activeElement !== el) {
      el.focus({ preventScroll: true })
      placeCaret(el, el.textContent?.length ?? 0)
    }
    const s = scroller()
    if (s) keepCaretVisible(s)
  }, [editing])

  // Sizes the handle frame to the text's rendered height.
  useLayoutEffect(() => {
    const el = ref.current
    const frame = frameRef.current
    if (el && frame) frame.style.height = px(el.offsetHeight)
  })

  const send = (text: string) => {
    lastSent.current = text
    onChange({ text })
    const s = scroller()
    if (s) keepCaretVisible(s)
  }

  // Makes the box editable and focuses it inside the tap so the keyboard opens, then asks to edit.
  const startEditing = () => {
    const el = ref.current
    if (!el) return
    el.setAttribute('contenteditable', 'plaintext-only')
    el.focus({ preventScroll: true })
    placeCaret(el, el.textContent?.length ?? 0)
    onEdit()
  }

  const onDown = (side: Side | null) => (e: PointerEvent) => {
    if (editing || gesture.current?.drags) return
    const el = ref.current
    const drags = selected && el !== null
    if (drags) {
      e.preventDefault()
      e.stopPropagation()
      capture(e)
    }
    const pageH = el?.parentElement?.clientHeight ?? 0
    const maxY = pageH > 0 && el ? (pageH - el.offsetHeight) / cssW : Infinity
    gesture.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, from: item.box, side, drags, moved: false, maxY }
  }

  const onMove = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (Math.hypot(dx, dy) > TAP_SLOP_PX) g.moved = true
    if (!g.drags || !g.moved || cssW <= 0) return
    e.preventDefault()
    setLive(draggedBox(g.from, g.side, dx / cssW, dy / cssW, g.maxY))
  }

  const onUp = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    gesture.current = null
    if (g.drags && g.moved && cssW > 0) {
      setLive(null)
      onChange({ box: draggedBox(g.from, g.side, (e.clientX - g.x) / cssW, (e.clientY - g.y) / cssW, g.maxY) })
      return
    }
    if (g.moved || g.side) {
      lastTap.current = null
      return
    }
    const t = now()
    const prev = lastTap.current
    if (prev && t - prev.t <= DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= DOUBLE_TAP_PX) {
      lastTap.current = null
      startEditing()
    } else {
      lastTap.current = { x: e.clientX, y: e.clientY, t }
    }
  }

  const onCancel = () => {
    gesture.current = null
    setLive(null)
  }

  // Inserts text at the caret in place of the selection and reports the result.
  const insertAtCaret = (el: HTMLElement, text: string) => {
    const sel = document.getSelection()
    if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) sel.deleteFromDocument()
    const at = caretOffset(el)
    const old = el.textContent ?? ''
    const next = old.slice(0, at) + text + old.slice(at)
    el.textContent = next
    placeCaret(el, at + text.length)
    send(next)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const el = ref.current
    if (!el || e.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      el.blur()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      insertAtCaret(el, '\n')
    }
  }

  const onBlur = () => {
    if (ref.current?.hasAttribute('contenteditable')) onDone()
  }

  const b = live ?? item.box
  const fontPx = (TEXT_SIZE_PT[item.size] * cssW) / (widthMm / MM_PER_PT)
  const pos = { left: px(b.x * cssW), top: px(b.y * cssW), width: px(b.w * cssW) }
  const handles = selected && !editing
  const pointerHandlers = { onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onCancel }
  return (
    <>
      <div
        ref={ref}
        class="mg-nb-text"
        data-id={item.id}
        data-selected={handles ? '' : undefined}
        style={{ ...pos, fontSize: px(fontPx), color: item.color }}
        contenteditable={editing ? 'plaintext-only' : undefined}
        onPointerDown={onDown(null)}
        {...pointerHandlers}
        onInput={() => send(ref.current?.textContent ?? '')}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {handles && (
        <div ref={frameRef} class="mg-nb-text-frame" style={pos}>
          {(['left', 'right'] as const).map((side) => (
            <div key={side} class="mg-nb-text-handle" data-side={side} aria-hidden="true" onPointerDown={onDown(side)} {...pointerHandlers} />
          ))}
        </div>
      )}
    </>
  )
}
