// Page thumbnail strip: tap jumps, long-press opens Delete and Duplicate, long-press then drag reorders.
import type { JSX } from 'preact'
import { memo } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Icon } from '../app/icons.tsx'
import { inkOutlinePath } from '../ink/geometry.ts'
import { inkDisplayColor } from '../ink/tools.ts'
import type { NotebookStroke, NotePage, PageContent, PaperColor } from './model.ts'
import type { NotebookStore } from './notebookStore.ts'
import './thumbnails.css'

export const THUMB_W = 160
export const THUMB_LONG_PRESS_MS = 500
const DRAG_PX = 8
const PAPER: Record<PaperColor, string> = { white: '#ffffff', yellow: '#fbf3d0', dark: '#1f1f21' }
const TEXT_LINE_H: Record<'s' | 'm' | 'l', number> = { s: 0.03, m: 0.045, l: 0.07 }
const outlines = new WeakMap<NotebookStroke, string>()
const EMPTY: PageContent = { strokes: [], texts: [], images: [] }

export interface ThumbnailsProps {
  store: NotebookStore
  current: string | null
  layout: 'column' | 'sheet'
  onJump(pageId: string): void
  onClose(): void
}

interface Gesture {
  pointerId: number
  id: string
  startX: number
  startY: number
  long: boolean
  dragging: boolean
}

// Outline of a stroke at thumbnail scale, computed once per stroke object.
function outlineOf(s: NotebookStroke): string {
  let d = outlines.get(s)
  if (d === undefined) {
    d = inkOutlinePath(s.points, s.width, THUMB_W, THUMB_W, s.pen)
    outlines.set(s, d)
  }
  return d
}

// Page drawn as paper, ink paths and object boxes, all scaled to THUMB_W.
const Thumb = memo(function Thumb({ page, content }: { page: NotePage; content: PageContent }) {
  const h = (THUMB_W * page.size.h) / page.size.w
  const dark = page.color === 'dark'
  return (
    <svg class="mg-thumb-svg" width={THUMB_W} height={h} viewBox={`0 0 ${THUMB_W} ${h}`} aria-hidden="true">
      <rect width={THUMB_W} height={h} fill={PAPER[page.color]} />
      {content.strokes.map((s) => (
        <path
          key={s.id}
          d={outlineOf(s)}
          fill={inkDisplayColor(s.color, dark)}
          opacity={s.tool === 'highlighter' ? 0.4 : undefined}
        />
      ))}
      {content.texts.map((t) => (
        <rect
          key={t.id}
          class="mg-thumb-box"
          x={t.box.x * THUMB_W}
          y={t.box.y * THUMB_W}
          width={t.box.w * THUMB_W}
          height={Math.max(1, t.text.split('\n').length) * TEXT_LINE_H[t.size] * THUMB_W}
        />
      ))}
      {content.images.map((im) => (
        <rect
          key={im.id}
          class="mg-thumb-box"
          x={im.box.x * THUMB_W}
          y={im.box.y * THUMB_W}
          width={im.box.w * THUMB_W}
          height={im.box.w * im.aspect * THUMB_W}
        />
      ))}
    </svg>
  )
})

export function Thumbnails({ store, current, layout, onJump, onClose }: ThumbnailsProps): JSX.Element {
  const pages = store.pages.value
  const contents = store.content.value
  const navRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const swallowClick = useRef(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ from: string; over: string; before: boolean } | null>(null)
  const lastDrag = useRef('')

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clearTimer, [])

  // Holds the list still under a long-press so a drag reorders instead of scrolling.
  const holdList = (on: boolean) => {
    if (listRef.current) listRef.current.style.touchAction = on ? 'none' : ''
  }
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const onTouchMove = (e: TouchEvent) => {
      if (gesture.current?.long) e.preventDefault()
    }
    nav.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => nav.removeEventListener('touchmove', onTouchMove)
  }, [])

  useEffect(() => {
    if (menu === null) return
    const away = (e: Event) => {
      if (!(e.target as Element).closest?.('.mg-thumb-menu')) setMenu(null)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', key)
    }
  }, [menu])

  // Page nearest the point and whether the point is before that thumbnail's centre.
  const dropAt = (x: number, y: number, fallback: string): { over: string; before: boolean } => {
    const cells = navRef.current?.querySelectorAll<HTMLElement>('.mg-thumb') ?? []
    const row = layout === 'sheet'
    let over = fallback
    let before = false
    let bestD = Infinity
    cells.forEach((el) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const d = Math.hypot(x - cx, y - cy)
      if (d < bestD) {
        bestD = d
        over = el.dataset.page ?? fallback
        before = row ? x < cx : y < cy
      }
    })
    return { over, before }
  }

  const onDown = (e: PointerEvent, id: string) => {
    if (!e.isPrimary || e.button !== 0) return
    clearTimer()
    swallowClick.current = false
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // The pointer can no longer be captured.
    }
    const g: Gesture = { pointerId: e.pointerId, id, startX: e.clientX, startY: e.clientY, long: false, dragging: false }
    gesture.current = g
    timer.current = setTimeout(() => {
      timer.current = null
      g.long = true
      holdList(true)
      setMenu(id)
    }, THUMB_LONG_PRESS_MS)
  }

  const onMove = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    const far = Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > DRAG_PX
    if (!g.long) {
      if (far) clearTimer()
      return
    }
    if (!g.dragging && !far) return
    g.dragging = true
    setMenu(null)
    const t = dropAt(e.clientX, e.clientY, g.id)
    const key = `${t.over}:${t.before}`
    if (key === lastDrag.current) return
    lastDrag.current = key
    setDrag({ from: g.id, ...t })
  }

  const onUp = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    gesture.current = null
    clearTimer()
    if (!g.long) return
    holdList(false)
    swallowClick.current = true
    setDrag(null)
    if (!g.dragging) return
    lastDrag.current = ''
    const { over, before } = dropAt(e.clientX, e.clientY, g.id)
    if (over === g.id) return
    const rest = pages.map((p) => p.id).filter((id) => id !== g.id)
    const at = rest.indexOf(over)
    store.movePage(g.id, before ? (rest[at - 1] ?? null) : over)
  }

  const onCancel = (e: PointerEvent) => {
    if (gesture.current && e.pointerId !== gesture.current.pointerId) return
    gesture.current = null
    clearTimer()
    holdList(false)
    lastDrag.current = ''
    setDrag(null)
  }

  const onClick = (id: string) => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    onJump(id)
  }

  return (
    <nav ref={navRef} class="mg-thumbs" data-layout={layout} aria-label="Pages">
      {layout === 'sheet' && (
        <button type="button" class="mg-thumbs-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      )}
      <div ref={listRef} class="mg-thumbs-list">
        {pages.map((p, i) => (
          <div class="mg-thumb-cell" key={p.id}>
            <button
              type="button"
              class="mg-thumb"
              data-page={p.id}
              data-dragging={drag?.from === p.id ? '' : undefined}
              data-over={drag && drag.over === p.id && drag.from !== p.id ? (drag.before ? 'before' : 'after') : undefined}
              aria-label={`Page ${i + 1}`}
              aria-current={p.id === current ? 'page' : undefined}
              onPointerDown={(e) => onDown(e, p.id)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onCancel}
              onContextMenu={(e) => e.preventDefault()}
              onClick={() => onClick(p.id)}
            >
              <Thumb page={p} content={contents.get(p.id) ?? EMPTY} />
            </button>
            {menu === p.id && (
              <div class="mg-thumb-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  class="mg-thumb-menu-item"
                  disabled={pages.length < 2}
                  onClick={() => {
                    setMenu(null)
                    store.deletePage(p.id)
                  }}
                >
                  Delete
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="mg-thumb-menu-item"
                  onClick={() => {
                    setMenu(null)
                    store.duplicatePage(p.id)
                  }}
                >
                  Duplicate
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </nav>
  )
}
