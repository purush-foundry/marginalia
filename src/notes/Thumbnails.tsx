// Page thumbnail strip: tap jumps, long-press opens Delete and Duplicate, long-press then drag reorders.
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Icon } from '../app/icons.tsx'
import { inkOutlinePath } from '../ink/geometry.ts'
import type { NotePage, PageContent, PaperColor } from './model.ts'
import type { NotebookStore } from './notebookStore.ts'
import './thumbnails.css'

export const THUMB_W = 160
export const THUMB_LONG_PRESS_MS = 500
const DRAG_PX = 8
const PAPER: Record<PaperColor, string> = { white: '#ffffff', yellow: '#fbf3d0', dark: '#1f1f21' }
const TEXT_LINE_H: Record<'s' | 'm' | 'l', number> = { s: 0.03, m: 0.045, l: 0.07 }
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

// Page drawn as paper, ink paths and object boxes, all scaled to THUMB_W.
function Thumb({ page, content }: { page: NotePage; content: PageContent }) {
  const h = (THUMB_W * page.size.h) / page.size.w
  const ink = page.color === 'dark' ? '#f2f2f2' : undefined
  return (
    <svg class="mg-thumb-svg" width={THUMB_W} height={h} viewBox={`0 0 ${THUMB_W} ${h}`} aria-hidden="true">
      <rect width={THUMB_W} height={h} fill={PAPER[page.color]} />
      {content.strokes.map((s) => (
        <path
          key={s.id}
          d={inkOutlinePath(s.points, s.width, THUMB_W, THUMB_W, s.pen)}
          fill={ink ?? s.color}
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
}

export function Thumbnails({ store, current, layout, onJump, onClose }: ThumbnailsProps): JSX.Element {
  const pages = store.pages.value
  const contents = store.content.value
  const navRef = useRef<HTMLElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const swallowClick = useRef(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ from: string; over: string } | null>(null)

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clearTimer, [])

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

  // Page whose thumbnail is nearest the point.
  const pageAt = (x: number, y: number, fallback: string): string => {
    const cells = navRef.current?.querySelectorAll<HTMLElement>('.mg-thumb') ?? []
    let best = fallback
    let bestD = Infinity
    cells.forEach((el) => {
      const r = el.getBoundingClientRect()
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2))
      if (d < bestD) {
        bestD = d
        best = el.dataset.page ?? fallback
      }
    })
    return best
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
    setDrag({ from: g.id, over: pageAt(e.clientX, e.clientY, g.id) })
  }

  const onUp = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    gesture.current = null
    clearTimer()
    if (!g.long) return
    swallowClick.current = true
    setDrag(null)
    if (!g.dragging) return
    const over = pageAt(e.clientX, e.clientY, g.id)
    if (over !== g.id) store.movePage(g.id, over)
  }

  const onCancel = (e: PointerEvent) => {
    if (gesture.current && e.pointerId !== gesture.current.pointerId) return
    gesture.current = null
    clearTimer()
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
      <div class="mg-thumbs-list">
        {pages.map((p, i) => (
          <div class="mg-thumb-cell" key={p.id}>
            <button
              type="button"
              class="mg-thumb"
              data-page={p.id}
              data-dragging={drag?.from === p.id ? '' : undefined}
              data-over={drag && drag.over === p.id && drag.from !== p.id ? '' : undefined}
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
