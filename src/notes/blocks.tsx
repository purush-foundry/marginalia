import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ImageBlock, TextBlock } from '../types.ts'
import { MAX_IMAGE_W, MIN_IMAGE_W, type NotesStore } from './notesStore.ts'

const CARET_MARGIN_PX = 16

/** Character offset of the selection start inside el, or 0 when the selection is elsewhere. */
export function caretOffset(el: HTMLElement): number {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return 0
  const before = document.createRange()
  before.setStart(el, 0)
  before.setEnd(range.startContainer, range.startOffset)
  return before.toString().length
}

/** Collapses the selection to the given character offset inside el. */
export function placeCaret(el: HTMLElement, offset: number): void {
  const sel = document.getSelection()
  if (!sel) return
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let left = offset
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node as Text).length
    if (left <= length) {
      sel.collapse(node, left)
      return
    }
    left -= length
  }
  sel.collapse(el, el.childNodes.length)
}

/** Scrolls the scroller so the caret sits above the visual viewport's bottom edge. */
export function keepCaretVisible(scroller: HTMLElement): void {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (!scroller.contains(range.endContainer)) return
  let rect = range.getBoundingClientRect()
  if (rect.top === 0 && rect.bottom === 0) {
    const node = range.endContainer
    rect = (node instanceof Element ? node : node.parentElement)?.getBoundingClientRect() ?? rect
  }
  const vv = window.visualViewport
  const limit = (vv ? vv.offsetTop + vv.height : window.innerHeight) - CARET_MARGIN_PX
  if (rect.bottom > limit) scroller.scrollTop += rect.bottom - limit
}

export interface TextBlockViewProps {
  block: TextBlock
  title: boolean
  store: NotesStore
  onFocusBlock(id: string, caret: number): void
  onSelectImage(id: string): void
}

/** Plain-text paragraph; its DOM text follows the store only while it is not focused. */
export function TextBlockView({ block, title, store, onFocusBlock, onSelectImage }: TextBlockViewProps) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.textContent !== block.text) el.textContent = block.text
  }, [block.text])

  const onKeyDown = (e: KeyboardEvent) => {
    const el = ref.current
    if (!el || e.isComposing || e.keyCode === 229) return
    const sel = document.getSelection()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (sel && !sel.isCollapsed) {
        sel.deleteFromDocument()
        store.updateText(block.id, el.textContent ?? '')
      }
      const offset = caretOffset(el)
      const next = store.splitText(block.id, offset)
      el.textContent = (el.textContent ?? '').slice(0, offset)
      onFocusBlock(next.id, 0)
      return
    }
    if (e.key === 'Backspace' && sel?.isCollapsed && caretOffset(el) === 0) {
      const joined = store.joinWithPrevious(block.id)
      if (!joined) return
      e.preventDefault()
      if (joined.kind === 'text') {
        onFocusBlock(joined.id, joined.caret)
      } else {
        el.blur()
        onSelectImage(joined.id)
      }
    }
  }

  // Shows the store's latest text once editing ends.
  const onBlur = () => {
    const el = ref.current
    const latest = store.doc.value.blocks.find((b) => b.id === block.id)
    if (el && latest?.kind === 'text' && !latest.deleted && el.textContent !== latest.text) el.textContent = latest.text
  }

  return (
    <div
      ref={ref}
      class={title ? 'mg-note-text mg-note-title' : 'mg-note-text'}
      data-id={block.id}
      contenteditable="plaintext-only"
      onKeyDown={onKeyDown}
      onInput={() => store.updateText(block.id, ref.current?.textContent ?? '')}
      onBlur={onBlur}
    />
  )
}

export interface ImageBlockViewProps {
  block: ImageBlock
  selected: boolean
  store: NotesStore
  onJumpToPage(page: number): void
}

/** Image block; when selected it shows a Delete bar and a corner handle that resizes it in sheet units. */
export function ImageBlockView({ block, selected, store, onJumpToPage }: ImageBlockViewProps) {
  const ref = useRef<HTMLElement>(null)
  const drag = useRef<{ left: number; sheetW: number } | null>(null)
  const [liveW, setLiveW] = useState<number | null>(null)

  const widthAt = (e: PointerEvent) => {
    const d = drag.current
    if (!d || d.sheetW <= 0) return block.w
    return Math.min(MAX_IMAGE_W, Math.max(MIN_IMAGE_W, (e.clientX - d.left) / d.sheetW))
  }

  const onHandleDown = (e: PointerEvent) => {
    const figure = ref.current
    const sheet = figure?.closest('.mg-notes-sheet')
    if (!figure || !sheet) return
    e.preventDefault()
    drag.current = { left: figure.getBoundingClientRect().left, sheetW: sheet.getBoundingClientRect().width }
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      // Ignores pointers that can no longer be captured.
    }
  }

  const onHandleMove = (e: PointerEvent) => {
    if (drag.current) setLiveW(widthAt(e))
  }

  const onHandleUp = (e: PointerEvent) => {
    if (!drag.current) return
    store.resizeImage(block.id, widthAt(e))
    drag.current = null
    setLiveW(null)
  }

  const onHandleCancel = () => {
    drag.current = null
    setLiveW(null)
  }

  const page = block.page
  return (
    <figure
      ref={ref}
      class="mg-note-image"
      data-id={block.id}
      data-selected={selected ? '' : undefined}
      style={{ width: `calc(var(--sheet-w) * ${liveW ?? block.w})` }}
    >
      <img src={block.src} alt="" draggable={false} style={{ aspectRatio: `1 / ${block.aspect}` }} />
      {page !== undefined && (
        <button type="button" class="mg-note-chip" aria-label={`Go to page ${page}`} onClick={() => onJumpToPage(page)}>
          <span>p.{page}</span>
        </button>
      )}
      {selected && (
        <>
          <div class="mg-note-bar">
            <button type="button" class="btn" onClick={() => store.removeBlock(block.id)}>Delete</button>
          </div>
          <div
            class="mg-note-handle"
            aria-hidden="true"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleCancel}
          />
        </>
      )}
    </figure>
  )
}
