import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { showToast } from '../app/ui.ts'
import type { NoteStroke, NotesBackground } from '../types.ts'
import { ImageBlockView, keepCaretVisible, placeCaret, TextBlockView } from './blocks.tsx'
import { ImageTooLargeError, prepareImage } from './images.ts'
import type { NotesStore } from './notesStore.ts'
import { SheetInk } from './SheetInk.tsx'
import './notes.css'

export interface NotesSheetHandle {
  scrollToBlock(id: string): void
}

export interface NotesSheetProps {
  store: NotesStore
  onJumpToPage(page: number): void
  handle?: (h: NotesSheetHandle) => void
}

const BACKGROUNDS: readonly { value: NotesBackground; label: string }[] = [
  { value: 'blank', label: 'Blank' },
  { value: 'grid', label: 'Grid' },
  { value: 'dots', label: 'Dots' },
  { value: 'lines', label: 'Lines' },
]

const SCROLL_MARGIN_PX = 16

interface SheetSize {
  width: number
  pane: number
  content: number
}

// Lowest stroke y in sheet units.
function lowestY(strokes: NoteStroke[]): number {
  let max = 0
  for (const s of strokes) for (let i = 1; i < s.points.length; i += 3) max = Math.max(max, s.points[i])
  return max
}

function imageFiles(list: ArrayLike<File> | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
}

// Id of the focused text block inside root, if any.
function focusedBlockId(root: Element | null): string | undefined {
  const el = document.activeElement?.closest?.<HTMLElement>('.mg-note-text')
  return el && root?.contains(el) ? el.dataset.id : undefined
}

/** One continuous notes sheet: text and image blocks with ink over the whole sheet. */
export function NotesSheet({ store, onJumpToPage, handle }: NotesSheetProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const blocksRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<{ id: string; caret: number } | null>(null)
  const pickAfter = useRef<string | undefined>(undefined)
  const armed = useRef(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [size, setSize] = useState<SheetSize>({ width: 0, pane: 0, content: 0 })
  const [, setTick] = useState(0)

  const blocks = store.blocks.value
  const strokes = store.strokes.value
  const background = store.doc.value.background
  const lowest = useMemo(() => lowestY(strokes), [strokes])
  const height = Math.max(size.pane, Math.max(size.content, lowest * size.width) + size.pane)
  const titleId = blocks.find((b) => b.kind === 'text')?.id
  const selectedId = blocks.some((b) => b.id === selected && b.kind === 'image') ? selected : null
  const empty = strokes.length === 0 && blocks.every((b) => b.kind === 'text' && b.text === '')

  const focusBlock = (id: string, caret: number) => {
    pendingFocus.current = { id, caret }
    setTick((n) => n + 1)
  }

  const measure = () => {
    const scroller = scrollerRef.current
    const sheet = sheetRef.current
    const list = blocksRef.current
    if (!scroller || !sheet || !list) return
    const sheetRect = sheet.getBoundingClientRect()
    const next = {
      width: sheetRect.width,
      pane: scroller.getBoundingClientRect().height,
      content: list.getBoundingClientRect().bottom - sheetRect.top,
    }
    setSize((prev) =>
      prev.width === next.width && prev.pane === next.pane && prev.content === next.content ? prev : next,
    )
  }

  useLayoutEffect(measure)

  // Focuses a block requested by Enter, Backspace or a tap once it is rendered with its text.
  useLayoutEffect(() => {
    const p = pendingFocus.current
    const el = p && sheetRef.current?.querySelector<HTMLElement>(`.mg-note-text[data-id="${p.id}"]`)
    if (!p || !el) return
    pendingFocus.current = null
    el.focus()
    placeCaret(el, p.caret)
    if (scrollerRef.current) keepCaretVisible(scrollerRef.current)
  })

  useEffect(() => {
    const scroller = scrollerRef.current
    const list = blocksRef.current
    if (!scroller || !list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(scroller)
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  // Keeps the caret above the on-screen keyboard and pads the scroller by the keyboard height.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const onFocusIn = (e: FocusEvent) => {
      if (!(e.target as Element).closest?.('.mg-note-text')) return
      setSelected(null)
      keepCaretVisible(scroller)
    }
    const onInput = () => keepCaretVisible(scroller)
    const vv = window.visualViewport
    const onViewport = () => {
      if (!vv) return
      scroller.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.offsetTop - vv.height)}px`)
      if (focusedBlockId(scroller)) keepCaretVisible(scroller)
    }
    onViewport()
    scroller.addEventListener('focusin', onFocusIn)
    scroller.addEventListener('input', onInput)
    vv?.addEventListener('resize', onViewport)
    return () => {
      scroller.removeEventListener('focusin', onFocusIn)
      scroller.removeEventListener('input', onInput)
      vv?.removeEventListener('resize', onViewport)
    }
  }, [])

  // Backspace or Delete removes the selected image when no text is being edited.
  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      if (document.activeElement?.closest?.('input, textarea, [contenteditable]')) return
      e.preventDefault()
      store.removeBlock(selectedId)
      setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId, store])

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
      scrollToBlock(id) {
        const scroller = scrollerRef.current
        const el = scroller?.querySelector(`[data-id="${id}"]`)
        if (!scroller || !el) return
        scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - SCROLL_MARGIN_PX
      },
    })
  }, [handle])

  const addImages = async (files: File[], afterId: string | undefined) => {
    let after = afterId
    for (const file of files) {
      try {
        const img = await prepareImage(file)
        after = store.addImageBlock({ src: img.dataUrl, aspect: img.height / img.width }, after).id
      } catch (err) {
        showToast(err instanceof ImageTooLargeError ? 'Image too large to add' : 'Could not add that image')
      }
    }
  }

  const onPaste = (e: ClipboardEvent) => {
    const files = imageFiles(e.clipboardData?.files)
    if (files.length === 0) return
    e.preventDefault()
    void addImages(files, focusedBlockId(scrollerRef.current))
  }

  const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  const onDrop = (e: DragEvent) => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    const files = imageFiles(e.dataTransfer?.files)
    if (files.length > 0) void addImages(files, focusedBlockId(scrollerRef.current))
  }

  const onPicked = () => {
    const input = inputRef.current
    const files = imageFiles(input?.files)
    if (input) input.value = ''
    if (files.length > 0) void addImages(files, pickAfter.current)
  }

  const selectImage = (id: string) => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('.mg-note-text')) active.blur()
    setSelected(id)
  }

  // Routes a tap on the sheet: an image selects it; empty space puts the caret at the end of the notes.
  const onSheetClick = (e: MouseEvent) => {
    if (!armed.current) return
    armed.current = false
    const target = e.target as Element
    if (target.closest('button, .mg-note-handle')) return
    const figure = target.closest<HTMLElement>('.mg-note-image')
    if (figure?.dataset.id) {
      selectImage(figure.dataset.id)
      return
    }
    setSelected(null)
    if (target.closest('.mg-note-text')) return
    const list = store.blocks.value
    const last = list[list.length - 1]
    if (last?.kind === 'text') focusBlock(last.id, last.text.length)
    else focusBlock(store.addTextBlock('').id, 0)
  }

  return (
    <div
      ref={scrollerRef}
      class="mg-notes"
      data-bg={background}
      onPaste={onPaste}
      onDragOver={(e) => carriesFiles(e) && e.preventDefault()}
      onDrop={onDrop}
    >
      <div class="mg-notes-bar">
        <div class="mg-notes-menu-anchor" ref={menuRef}>
          <button
            type="button"
            class="btn mg-notes-tool"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            Background
          </button>
          {menuOpen && (
            <div class="mg-notes-menu" role="menu">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={background === b.value}
                  class="mg-notes-menu-item"
                  onClick={() => {
                    store.setBackground(b.value)
                    setMenuOpen(false)
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          class="btn mg-notes-tool"
          onClick={() => {
            pickAfter.current = focusedBlockId(scrollerRef.current)
            inputRef.current?.click()
          }}
        >
          + Image
        </button>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPicked} />
      </div>
      <div
        ref={sheetRef}
        class="mg-notes-sheet"
        style={{ height: `${height}px`, '--sheet-w': size.width > 0 ? `${size.width}px` : undefined }}
        onPointerDown={() => (armed.current = true)}
        onPointerCancel={() => (armed.current = false)}
        onClick={onSheetClick}
      >
        {empty && <p class="mg-notes-empty">Write or type your notes</p>}
        <div ref={blocksRef} class="mg-notes-blocks">
          {blocks.map((b) =>
            b.kind === 'text' ? (
              <TextBlockView
                key={b.id}
                block={b}
                title={b.id === titleId}
                store={store}
                onFocusBlock={focusBlock}
                onSelectImage={selectImage}
              />
            ) : (
              <ImageBlockView key={b.id} block={b} selected={b.id === selectedId} store={store} onJumpToPage={onJumpToPage} />
            ),
          )}
        </div>
        {size.width > 0 && height > 0 && (
          <SheetInk
            width={size.width}
            height={height}
            strokes={strokes}
            onAddStroke={store.addStroke}
            onEraseStroke={store.removeStroke}
          />
        )}
      </div>
    </div>
  )
}
