// Reader: loads a paper and its sidecar, then wires the paper and notes panes, ink, selection bar, sidebar and Ask panel.
import { computed, effect, signal, useComputed, useSignal, type ReadonlySignal, type Signal } from '@preact/signals'
import type { RefObject } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { AskPanel } from '../ai/AskPanel'
import { SelectionBar } from '../annot/SelectionBar'
import { createAnnotationStore, type AnnotationStore } from '../annot/store'
import { IMAGE_MAX_EDGE_PX } from '../config'
import {
  flushPendingWrites,
  getPdfBlob,
  library,
  loadNotebook,
  loadSidecar,
  refreshNotebook,
  refreshSidecar,
  saveNotebook,
  saveSidecar,
} from '../drive/library'
import { notebookToMarkdown, sidecarToMarkdown } from '../export/markdown'
import { PRESET_COLORS } from '../ink/color'
import { InkLayer } from '../ink/InkLayer'
import type { ItemRef, LassoItem } from '../ink/lasso'
import { ToolMenu } from '../ink/ToolMenu'
import { isInkTool, lassoSettings, pageWidthMm, setTool, tool, type Tool } from '../ink/tools'
import { newId, now } from '../lib/ids'
import { copyItems } from '../notes/clipboard'
import { IMAGE_LONG_EDGE_PX, prepareImage } from '../notes/images'
import { LassoLayer } from '../notes/Lasso'
import { Notebook, type NotebookHandle } from '../notes/Notebook'
import { createNotebookStore, type NotebookStore } from '../notes/notebookStore'
import { openPdf, type PageLink, type PdfDoc } from '../pdf/document'
import { isIOS } from '../pdf/platform'
import { Viewer, type PendingSelection, type ViewerHandle } from '../pdf/Viewer'
import type { Anchor, Box, HighlightColor, InkStroke, PageText, Sidecar, Thread } from '../types'
import { Icon } from './icons'
import { folderHash, navigate } from './route'
import { saveSettings, settings, type NotesLayout } from './settings'
import { Sidebar, type SidebarTab } from './Sidebar'
import { Toolbar, type UndoTarget } from './Toolbar'
import { copyImage, copyText, settingsOpen, showToast } from './ui'
import './reader.css'

type Bar = { kind: 'selection'; sel: PendingSelection } | { kind: 'highlight'; id: string; rect: DOMRect }

interface Loaded {
  doc: PdfDoc
  store: AnnotationStore
  title: string
  /** A newer reading position merged from Drive after open; the view scrolls there unless the user already moved. */
  remotePosition: Signal<{ page: number; offset: number } | null>
  /** The notebook store, once the notes have been shown. */
  notes: ReadonlySignal<NotebookStore | null>
  /** Loads the notebook and creates its store on the first call; later calls share it. */
  ensureNotes(): Promise<NotebookStore>
}

type Pane = 'paper' | 'notes'

const NAV_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '])
const TOOL_KEYS: Record<string, Tool> = { l: 'lasso', p: 'pen', h: 'highlighter', e: 'eraser', t: 'text' }
const MENU_TOOLS: readonly Tool[] = ['lasso', 'pen', 'highlighter', 'eraser']
const NOTES_MENU_TOOLS: readonly Tool[] = [...MENU_TOOLS, 'text']
const DUPLICATE_OFFSET = 0.02

const NO_STROKES: InkStroke[] = []
const NO_REFS: ItemRef[] = []
const NO_THREADS: Thread[] = []
const DEFAULT_NOTE_COLOR: HighlightColor = 'yellow'
const NOTE_W = 320
const NOTE_H = 170
const WIDE = '(min-width: 700px)'
const MIN_PANE_PX = 320
const SPLIT_STEP = 0.05
const NO_HISTORY: UndoTarget = { canUndo: signal(false), canRedo: signal(false), undo() {}, redo() {} }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function groupByPage<T>(items: T[], pageOf: (item: T) => number): Map<number, T[]> {
  const out = new Map<number, T[]>()
  for (const item of items) {
    const page = pageOf(item)
    const list = out.get(page)
    if (list) list.push(item)
    else out.set(page, [item])
  }
  return out
}

function isIPadOS(): boolean {
  return isIOS() && !/iPhone|iPod/.test(navigator.userAgent)
}

function matches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches
}

// Live result of a media query.
function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matches(query))
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

// Paper pane ratio clamped so each pane keeps MIN_PANE_PX of the given width.
function clampSplit(ratio: number, width: number): number {
  const min = Math.min(0.5, MIN_PANE_PX / width)
  return Math.min(1 - min, Math.max(min, ratio))
}

// Draggable bar between the panes: sets --split on the panes while dragging and stores the ratio on release; arrow keys step it.
function Divider({ panes, ratio }: { panes: RefObject<HTMLDivElement | null>; ratio: number }) {
  const drag = useRef<{ pointerId: number; x: number; ratio: number; width: number } | null>(null)
  const widthOf = () => panes.current?.getBoundingClientRect().width ?? 0
  const place = (r: number) => panes.current?.style.setProperty('--split', String(r))
  const at = (e: PointerEvent) => {
    const d = drag.current
    return d && e.pointerId === d.pointerId ? clampSplit(d.ratio + (e.clientX - d.x) / d.width, d.width) : null
  }
  return (
    <div
      class="mg-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panes"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={(e) => {
        const width = widthOf()
        if (e.button !== 0 || width <= 0) return
        e.preventDefault()
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // The pointer can no longer be captured.
        }
        drag.current = { pointerId: e.pointerId, x: e.clientX, ratio, width }
      }}
      onPointerMove={(e) => {
        const r = at(e)
        if (r !== null) place(r)
      }}
      onPointerUp={(e) => {
        const r = at(e)
        if (r === null) return
        drag.current = null
        void saveSettings({ splitRatio: r })
      }}
      onPointerCancel={() => {
        drag.current = null
        place(ratio)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        void saveSettings({ splitRatio: clampSplit(ratio + (e.key === 'ArrowLeft' ? -SPLIT_STEP : SPLIT_STEP), widthOf()) })
      }}
    />
  )
}

// The library route of the folder that holds the paper.
function folderOf(pdfId: string): string {
  const index = library.peek()
  const parent = index?.papers[pdfId]?.parents.find((id) => id !== index.rootId && index.folders[id])
  return folderHash(parent)
}

async function cropBase64(doc: PdfDoc, page: number, box: Box): Promise<{ mediaType: 'image/png'; dataBase64: string }> {
  const { blob, mediaType } = await doc.renderCrop(page, box, IMAGE_MAX_EDGE_PX)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { mediaType, dataBase64: btoa(bin) }
}

// Box of the first line containing the quote's opening words, if any.
function findQuote(pageText: PageText, quote: string): Box | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const head = norm(quote).split(' ').slice(0, 4).join(' ')
  return head ? pageText.lines.find((l) => norm(l.text).includes(head))?.box : undefined
}

// Copy of a paper stroke with each point mapped in page-width units (y times the page aspect) and its width times k.
function mapStroke(s: InkStroke, aspect: number, f: (x: number, y: number) => [number, number], k = 1): InkStroke {
  const points = s.points.slice()
  for (let i = 0; i + 1 < points.length; i += 3) {
    const [x, y] = f(points[i], points[i + 1] * aspect)
    points[i] = x
    points[i + 1] = y / aspect
  }
  return { ...s, points, width: s.width * k }
}

interface PaperLassoProps {
  strokes: InkStroke[]
  cssW: number
  cssH: number
  store: AnnotationStore
  selection: ItemRef[]
  onSelect(refs: ItemRef[]): void
}

/** Lasso over a paper page's ink: strokes only; presses on text, links and thread markers pass through; edits go to the annotation store. */
function PaperLasso({ strokes, cssW, cssH, store, selection, onSelect }: PaperLassoProps) {
  const aspect = cssH / cssW
  const widthPoints = (s: InkStroke) => s.points.map((v, i) => (i % 3 === 1 ? v * aspect : v))
  const items = useMemo<LassoItem[]>(() => strokes.map((s) => ({ kind: 'stroke', id: s.id, points: widthPoints(s) })), [strokes, aspect])
  const picked = () => strokes.filter((s) => selection.some((r) => r.id === s.id))
  const ids = () => picked().map((s) => s.id)
  // Puts the selected ink in the notebook clipboard, in page-width units.
  const copy = () => {
    const list = picked().map((s) => ({
      id: s.id, page: '', z: '', tool: s.tool ?? 'pen', pen: s.pen ?? 'fountain', color: s.color, width: s.width,
      points: widthPoints(s), createdAt: s.createdAt, updatedAt: s.updatedAt,
    }))
    copyItems({ strokes: list, texts: [], images: [] }, selection)
  }
  return (
    <LassoLayer
      items={items}
      cssW={cssW}
      aspect={aspect}
      rect={lassoSettings.value.rect}
      objects={false}
      selection={selection}
      skip={(target) => target.closest('.textLayer span, .mg-link, .mg-thread-marker') !== null}
      onSelect={onSelect}
      onMove={(dx, dy, _client, done) => done && store.updateStrokes(picked().map((s) => mapStroke(s, aspect, (x, y) => [x + dx, y + dy])))}
      onScale={(o, k, done) =>
        done && store.updateStrokes(picked().map((s) => mapStroke(s, aspect, (x, y) => [o.x + (x - o.x) * k, o.y + (y - o.y) * k], k)))
      }
      menu={{
        colors: PRESET_COLORS,
        onCut() {
          copy()
          store.removeStrokes(ids())
          onSelect([])
        },
        onCopy: copy,
        onDuplicate() {
          const t = now()
          const copies = picked().map((s) => ({
            ...mapStroke(s, aspect, (x, y) => [x + DUPLICATE_OFFSET, y + DUPLICATE_OFFSET]),
            id: newId(),
            createdAt: t,
            updatedAt: t,
          }))
          store.addStrokes(copies)
          onSelect(copies.map((s) => ({ kind: 'stroke', id: s.id })))
        },
        onDelete() {
          store.removeStrokes(ids())
          onSelect([])
        },
        onRecolor: (color) => store.updateStrokes(picked().map((s) => ({ ...s, color }))),
      }}
    />
  )
}

function NoteEditor(props: { rect: DOMRect; initial: string; onSave(note: string): void; onCancel(): void }) {
  const [draft, setDraft] = useState(props.initial)
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const latest = useRef({ draft, props })
  latest.current = { draft, props }

  useEffect(() => {
    input.current?.focus()
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) latest.current.props.onSave(latest.current.draft)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [])

  const { rect } = props
  const below = rect.bottom + 8 + NOTE_H <= window.innerHeight
  const top = below ? rect.bottom + 8 : Math.max(8, rect.top - NOTE_H - 8)
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - NOTE_W / 2), Math.max(8, window.innerWidth - NOTE_W - 8))
  return (
    <div ref={ref} class="mg-note" role="dialog" aria-label="Note" style={{ top: `${top}px`, left: `${left}px` }}>
      <textarea
        ref={input}
        rows={4}
        placeholder="Note"
        value={draft}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onCancel()
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) props.onSave(draft)
        }}
      />
      <div class="mg-actions">
        <button type="button" class="btn" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" class="btn primary" onClick={() => props.onSave(draft)}>
          Save
        </button>
      </div>
    </div>
  )
}

function ReaderView({ pdfId, loaded }: { pdfId: string; loaded: Loaded }) {
  const { doc, store, title } = loaded
  const s = settings.value
  const viewer = useRef<ViewerHandle | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const panes = useRef<HTMLDivElement>(null)
  const notebook = useRef<NotebookHandle | null>(null)
  const notebookHandle = useMemo(() => (h: NotebookHandle) => (notebook.current = h), [])
  const areaArmed = useSignal(false)
  const lastPane = useSignal<Pane>('paper')
  const penDrawing = useMemo(() => computed(() => isInkTool(tool.value)), [])
  const [bar, setBar] = useState<Bar | null>(null)
  const [note, setNote] = useState<{ id: string; rect: DOMRect } | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [sidebar, setSidebar] = useState<SidebarTab | null>(null)
  const [backTo, setBackTo] = useState<number | null>(null)
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  const [jumpTarget, setJumpTarget] = useState<{ page: number; box?: Box } | null>(null)
  const [notesFailed, setNotesFailed] = useState(false)
  const [notesAttempt, setNotesAttempt] = useState(0)
  const [paperSelection, setPaperSelection] = useState<{ page: number; refs: ItemRef[] } | null>(null)
  const touchUi = s.penSeen || isIPadOS() || s.fingerDraws
  const wide = () => matches(WIDE)
  const canLayoutBoth = useMedia(WIDE)
  const layout: NotesLayout = s.notesLayout === 'both' && !canLayoutBoth ? 'paper' : s.notesLayout
  const showPaper = layout !== 'notes'
  const showNotes = layout !== 'paper'
  const notes = loaded.notes.value
  const active: Pane = layout === 'both' ? lastPane.value : layout === 'notes' ? 'notes' : 'paper'
  const history: UndoTarget = active === 'notes' ? (notes ?? NO_HISTORY) : store
  const historyRef = useRef(history)
  historyRef.current = history
  const chooseLayout = (next: NotesLayout) => void saveSettings({ notesLayout: next })
  const paperInitial = useMemo(() => {
    const { page, offset, zoom } = store.sidecar.peek().reading
    return { page, offset, zoom }
  }, [showPaper])

  const inksByPage = useComputed(() => groupByPage(store.inks.value, (s) => s.page))
  const threadsByPage = useComputed(() => groupByPage(store.threads.value, (t) => t.anchor.page))
  const status = useComputed(() => store.sidecar.value.reading.status).value
  const threadCount = useComputed(() => store.threads.value.length).value

  // Column boxes per page, fetched once per page that carries a highlight.
  const columns = useRef<Record<number, Box[]>>({})
  const columnLoads = useRef(new Map<number, Promise<void>>())
  const ensureColumns = (page: number): Promise<void> => {
    let load = columnLoads.current.get(page)
    if (!load) {
      load = doc.getPageText(page).then(
        (t) => {
          const cols = t.columns.slice(1)
          columns.current[page] = cols
          store.setColumns(page, cols)
        },
        () => undefined,
      )
      columnLoads.current.set(page, load)
    }
    return load
  }
  const highlightPages = useComputed(() => [...new Set(store.highlights.value.map((h) => h.page))].join(',')).value
  useEffect(() => {
    for (const p of highlightPages.split(',')) if (p) void ensureColumns(Number(p))
  }, [highlightPages])

  // True once the user scrolls, zooms or jumps; reading positions before that are restore-time and not persisted.
  const moved = useRef(false)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    moved.current = false
    const mark = (e: Event) => {
      if (!(e.target as Element | null)?.closest?.('.mg-toolmenu')) moved.current = true
    }
    const onKey = (e: KeyboardEvent) => {
      if (NAV_KEYS.has(e.key) && !(e.target as Element | null)?.closest?.('input, textarea, [contenteditable]')) mark(e)
    }
    const opts = { capture: true, passive: true }
    for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) el.addEventListener(type, mark, opts)
    window.addEventListener('keydown', onKey, true)
    return () => {
      for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) el.removeEventListener(type, mark, opts)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [showPaper])
  useEffect(
    () =>
      loaded.remotePosition.subscribe((pos) => {
        if (pos && !moved.current) viewer.current?.scrollTo(pos.page, { x: 0.5, y: pos.offset, w: 0, h: 0 })
      }),
    [],
  )

  const state = useRef({ bar, note, thread, sidebar })
  state.current = { bar, note, thread, sidebar }

  // Clears the paper lasso selection when the tool leaves Lasso.
  useEffect(
    () =>
      effect(() => {
        if (tool.value !== 'lasso') setPaperSelection(null)
      }),
    [],
  )

  // Opens and leaves the reader in Lasso on a device without touch UI.
  useEffect(() => {
    if (touchUi) return
    setTool('lasso')
    return () => setTool('lasso')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as Element | null)?.closest?.('input, textarea, [contenteditable]')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        if (e.shiftKey) historyRef.current.redo()
        else historyRef.current.undo()
        return
      }
      const picked = TOOL_KEYS[e.key.toLowerCase()]
      if (picked && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setTool(picked)
        return
      }
      if (e.key !== 'Escape') return
      const cur = state.current
      if (cur.bar || cur.note) return
      if (cur.thread) setThread(null)
      else if (cur.sidebar && !wide()) setSidebar(null)
      else if (areaArmed.value) areaArmed.value = false
      else if (tool.peek() !== 'lasso' && !typing) setTool('lasso')
    }
    const undo = () => historyRef.current.undo()
    const redo = () => historyRef.current.redo()
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('marginalia:undo', undo)
    document.addEventListener('marginalia:redo', redo)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('marginalia:undo', undo)
      document.removeEventListener('marginalia:redo', redo)
    }
  }, [])

  useEffect(() => {
    if (!showNotes) return
    let live = true
    setNotesFailed(false)
    loaded.ensureNotes().catch(() => live && setNotesFailed(true))
    return () => {
      live = false
    }
  }, [showNotes, notesAttempt])

  // Scrolls the notebook to an image added by To notes once the notebook is on screen.
  useEffect(() => {
    if (!scrollTarget || !showNotes || !notes || !notebook.current) return
    notebook.current.scrollToItem(scrollTarget)
    setScrollTarget(null)
  }, [scrollTarget, showNotes, notes])

  useEffect(() => {
    const scroller = wrap.current?.querySelector('.mg-scroller')
    if (!bar || !scroller) return
    const close = () => setBar(null)
    scroller.addEventListener('scroll', close, { passive: true, once: true })
    return () => scroller.removeEventListener('scroll', close)
  }, [bar])

  // Scrolls the paper to the page, showing the paper first when only the notes are on screen.
  const go = (page: number, box?: Box) => {
    if (!showPaper) {
      setJumpTarget({ page, box })
      chooseLayout(canLayoutBoth ? 'both' : 'paper')
      return
    }
    moved.current = true
    viewer.current?.scrollTo(page, box, 'smooth')
    if (!wide()) setSidebar(null)
  }
  useEffect(() => {
    if (!jumpTarget || !showPaper) return
    setJumpTarget(null)
    go(jumpTarget.page, jumpTarget.box)
  }, [jumpTarget, showPaper])

  const openThread = (t: Thread) => {
    setThread(t)
    if (!wide()) setSidebar(null)
  }

  const ask = (anchor: Anchor) => {
    const t = now()
    const area = !anchor.text?.trim()
    openThread({
      kind: 'thread',
      id: newId(),
      createdAt: t,
      updatedAt: t,
      anchor,
      model: area ? s.visionModel : s.textModel,
      messages: [],
    })
  }

  // Hides the bar and clears the viewer's text selection and area box.
  const closeBar = () => {
    setBar(null)
    viewer.current?.clearSelection()
  }

  const addFromSelection = (sel: PendingSelection, color: HighlightColor) =>
    sel.kind === 'text'
      ? store.addHighlight({ kind: 'text', page: sel.page, color, boxes: sel.boxes, text: sel.text })
      : store.addHighlight({ kind: 'area', page: sel.page, color, box: sel.boxes[0] })

  const current = bar?.kind === 'highlight' ? store.highlights.value.find((h) => h.id === bar.id) : undefined
  const barText = bar?.kind === 'selection' ? (bar.sel.kind === 'text' ? bar.sel.text : '') : current?.kind === 'text' ? current.text : ''

  const toNotes = (page: number, box: Box) => {
    const shown = showNotes
    void (async () => {
      const nb = await loaded.ensureNotes()
      const { blob } = await doc.renderCrop(page, box, IMAGE_LONG_EDGE_PX)
      const img = await prepareImage(blob)
      const target = (shown ? notebook.current?.currentPage() : null) ?? nb.pages.peek()[0]?.id ?? nb.addPage().id
      const image = nb.addImage({ page: target, src: img.dataUrl, aspect: img.height / img.width, pdfPage: page })
      chooseLayout(wide() ? 'both' : 'notes')
      setScrollTarget(image.id)
    })().catch(() => showToast('Could not add to notes'))
  }

  const barArea =
    bar?.kind === 'selection'
      ? bar.sel.kind === 'area'
        ? { page: bar.sel.page, box: bar.sel.boxes[0] }
        : null
      : current?.kind === 'area'
        ? { page: current.page, box: current.box }
        : null

  const barHandlers = bar && {
    anchorRect: bar.kind === 'selection' ? bar.sel.endRect : bar.rect,
    current,
    onColor(color: HighlightColor) {
      if (bar.kind === 'selection') {
        addFromSelection(bar.sel, color)
      } else store.updateHighlight(bar.id, { color })
      closeBar()
    },
    onAsk() {
      if (bar.kind === 'selection') {
        const { sel } = bar
        ask({ page: sel.page, boxes: sel.boxes, text: sel.kind === 'text' ? sel.text : undefined })
      } else if (current) {
        ask({
          page: current.page,
          boxes: current.kind === 'text' ? current.boxes : [current.box],
          text: current.kind === 'text' ? current.text : undefined,
          highlightId: current.id,
        })
      }
      closeBar()
    },
    onNote() {
      const rect = bar.kind === 'selection' ? bar.sel.endRect : bar.rect
      const id = bar.kind === 'selection' ? addFromSelection(bar.sel, DEFAULT_NOTE_COLOR).id : bar.id
      closeBar()
      setNote({ id, rect })
    },
    onCopyImage: barArea
      ? () => {
          const { page, box } = barArea
          const png = doc.renderCrop(page, box, IMAGE_MAX_EDGE_PX).then((r) => r.blob)
          copyImage(png, `${title} p${page}.png`).then(
            (how) => showToast(how === 'copied' ? 'Image copied' : 'Image saved'),
            () => showToast('Could not copy'),
          )
          closeBar()
        }
      : undefined,
    onToNotes: barArea
      ? () => {
          toNotes(barArea.page, barArea.box)
          closeBar()
        }
      : undefined,
    onCopy: barText
      ? () => {
          copyText(barText).then(() => showToast('Copied'), () => showToast('Could not copy'))
          closeBar()
        }
      : undefined,
    onDelete:
      bar.kind === 'highlight'
        ? () => {
            store.removeHighlight(bar.id)
            closeBar()
          }
        : undefined,
    onDismiss: closeBar,
  }

  const onLink = (link: PageLink) => {
    if (link.page) {
      moved.current = true
      setBackTo(viewer.current?.currentPage.peek() ?? null)
      viewer.current?.scrollTo(link.page)
    } else if (link.url) {
      window.open(link.url, '_blank', 'noopener,noreferrer')
    }
  }

  const onCite = (page: number, quote: string) => {
    doc.getPageText(page).then(
      (pt) => go(page, findQuote(pt, quote)),
      () => go(page),
    )
  }

  const exportMarkdown = () => {
    const text = (async () => {
      const sidecar = store.sidecar.peek()
      const pages = new Set(sidecar.highlights.filter((h) => !h.deleted).map((h) => h.page))
      await Promise.all([...pages].map(ensureColumns))
      const md = sidecarToMarkdown(sidecar, { title, columns: columns.current })
      const notesMd = notebookToMarkdown(loaded.notes.peek()?.doc.peek() ?? (await loadNotebook(pdfId)))
      return notesMd ? `${md}\n${notesMd}` : md
    })()
    copyText(text).then(() => showToast('Copied as Markdown'), () => showToast('Could not copy'))
  }

  const back = async () => {
    await flushPendingWrites()
    navigate(folderOf(pdfId))
  }

  const pageOverlay = (page: number, cssW: number, cssH: number) => (
    <>
      <InkLayer
        page={page}
        cssW={cssW}
        cssH={cssH}
        strokes={inksByPage.value.get(page) ?? NO_STROKES}
        pageWidthMm={pageWidthMm(doc.pageSize(page).w)}
        paperDark={s.nightMode}
        onAddStroke={store.addStroke}
        onEraseStroke={store.removeStroke}
        onReplaceStroke={store.replaceStroke}
      />
      {(threadsByPage.value.get(page) ?? NO_THREADS).map((t) => {
        const b = t.anchor.boxes[0]
        if (!b) return null
        return (
          <button
            key={t.id}
            type="button"
            class="mg-thread-marker"
            aria-label={`Open thread on p.${page}`}
            style={{ left: `${(b.x + b.w) * cssW}px`, top: `${b.y * cssH}px` }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => openThread(t)}
          >
            <Icon name="chat" size={14} />
          </button>
        )
      })}
      <PaperLasso
        strokes={inksByPage.value.get(page) ?? NO_STROKES}
        cssW={cssW}
        cssH={cssH}
        store={store}
        selection={paperSelection?.page === page ? paperSelection.refs : NO_REFS}
        onSelect={(refs) => setPaperSelection(refs.length ? { page, refs } : null)}
      />
    </>
  )

  return (
    <div class="mg-reader">
      <Toolbar
        title={title}
        history={history}
        areaArmed={areaArmed}
        layout={layout}
        wide={canLayoutBoth}
        onLayout={chooseLayout}
        nightMode={s.nightMode}
        threadCount={threadCount}
        sidebarOpen={sidebar !== null}
        onBack={() => void back()}
        onToggleNight={() => void saveSettings({ nightMode: !s.nightMode })}
        onToggleSidebar={() => setSidebar(sidebar ? null : 'outline')}
        onThreads={() => setSidebar('threads')}
        onExport={exportMarkdown}
      />
      <div class="mg-reader-body">
        {sidebar && (
          <Sidebar
            doc={doc}
            store={store}
            tab={sidebar}
            status={status}
            onTab={setSidebar}
            onGo={go}
            onOpenThread={openThread}
            onToggleDone={() => store.setReading({ status: status === 'done' ? 'reading' : 'done' })}
            onClose={() => setSidebar(null)}
          />
        )}
        <div
          ref={panes}
          class={`mg-panes mg-layout-${layout}`}
          style={{ '--split': String(s.splitRatio) }}
        >
          {showPaper && (
            <div
              ref={wrap}
              class="mg-pane mg-pane-paper"
              onPointerDownCapture={() => (lastPane.value = 'paper')}
              onFocusIn={() => (lastPane.value = 'paper')}
            >
              <Viewer
                doc={doc}
                highlights={store.highlights}
                crop={store.sidecar.peek().reading.crop}
                nightMode={s.nightMode}
                invertImages={s.invertImages}
                initial={paperInitial}
                areaSelectArmed={areaArmed}
                penDrawing={penDrawing}
                pageOverlay={pageOverlay}
                onSelection={(sel) => {
                  if (sel) {
                    setBar({ kind: 'selection', sel })
                    if (sel.kind === 'area') areaArmed.value = false
                  } else setBar((b) => (b?.kind === 'selection' ? null : b))
                }}
                onTapHighlight={(id, rect) => setBar({ kind: 'highlight', id, rect })}
                onLink={onLink}
                onReadingPosition={(pos) => {
                  if (moved.current) store.setReading(pos)
                }}
                handle={(h) => (viewer.current = h)}
              />
              {backTo !== null && (
                <button
                  type="button"
                  class="btn mg-back-chip"
                  onClick={() => {
                    moved.current = true
                    viewer.current?.scrollTo(backTo)
                    setBackTo(null)
                  }}
                >
                  ← back to p.{backTo}
                </button>
              )}
              {active === 'paper' && <ToolMenu tools={MENU_TOOLS} />}
            </div>
          )}
          {layout === 'both' && <Divider panes={panes} ratio={s.splitRatio} />}
          {showNotes && (
            <div
              class="mg-pane mg-pane-notes"
              onPointerDownCapture={() => {
                lastPane.value = 'notes'
                setPaperSelection(null)
              }}
              onFocusIn={() => (lastPane.value = 'notes')}
            >
              {notes ? (
                <Notebook store={notes} onJumpToPage={go} handle={notebookHandle} />
              ) : notesFailed ? (
                <div class="mg-notes-loading">
                  <p class="mg-error">Could not open notes</p>
                  <button type="button" class="btn" onClick={() => setNotesAttempt((n) => n + 1)}>
                    Retry
                  </button>
                </div>
              ) : (
                <p class="mg-muted mg-notes-loading">Loading notes…</p>
              )}
              {active === 'notes' && <ToolMenu tools={NOTES_MENU_TOOLS} />}
            </div>
          )}
        </div>
        {thread && (
          <div class="mg-ask-wrap">
            <AskPanel
              key={thread.id}
              thread={thread}
              paperTitle={doc.title ?? title}
              apiKey={s.anthropicApiKey}
              textModel={s.textModel}
              visionModel={s.visionModel}
              getPageText={(p) => doc.getPageText(p)}
              getCrop={(p, b) => cropBase64(doc, p, b)}
              onThreadChange={store.upsertThread}
              onCite={onCite}
              onOpenSettings={() => (settingsOpen.value = true)}
              onClose={() => setThread(null)}
            />
          </div>
        )}
      </div>
      {barHandlers && <SelectionBar {...barHandlers} />}
      {note && (
        <NoteEditor
          key={note.id}
          rect={note.rect}
          initial={store.highlights.peek().find((h) => h.id === note.id)?.note ?? ''}
          onSave={(text) => {
            const before = store.highlights.peek().find((h) => h.id === note.id)?.note ?? ''
            if (text.trim() !== before) store.updateHighlight(note.id, { note: text.trim() || undefined })
            setNote(null)
          }}
          onCancel={() => setNote(null)}
        />
      )}
    </div>
  )
}

export function Reader({ pdfId }: { pdfId: string }) {
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let doc: PdfDoc | null = null
    let store: AnnotationStore | null = null
    let edited = false
    let notes: NotebookStore | null = null
    let notesEdited = false
    let notesLoad: Promise<NotebookStore> | null = null
    const notesSignal = signal<NotebookStore | null>(null)
    // Reads the local notebook, creates its store, then merges the remote notebook when it arrives.
    const openNotes = async (): Promise<NotebookStore> => {
      const initial = await loadNotebook(pdfId)
      if (cancelled) throw new Error('Reader closed')
      const created = createNotebookStore(initial, (d) => {
        notesEdited = true
        saveNotebook(pdfId, d)
      })
      notes = created
      notesSignal.value = created
      refreshNotebook(pdfId).then(
        (merged) => {
          if (merged && !cancelled) created.replaceFromRemote(merged)
        },
        () => undefined,
      )
      return created
    }
    const ensureNotes = (): Promise<NotebookStore> => {
      if (!notesLoad) {
        notesLoad = openNotes()
        notesLoad.catch(() => (notesLoad = null))
      }
      return notesLoad
    }
    setLoaded(null)
    setError(null)
    setProgress(0)
    void (async () => {
      const onProgress = (f: number) => !cancelled && setProgress(f)
      const blob = await getPdfBlob(pdfId, onProgress)
      if (cancelled) return
      doc = await openPdf(blob).catch(async (err: unknown) => {
        const fresh = await getPdfBlob(pdfId, onProgress, { fresh: true }).catch(() => Promise.reject(err))
        return openPdf(fresh)
      })
      const sidecar = await loadSidecar(pdfId)
      if (cancelled) return
      const opened = createAnnotationStore(
        sidecar,
        (next) => {
          edited = true
          saveSidecar(pdfId, next)
        },
        { documentUndo: false },
      )
      store = opened
      const name = library.peek()?.papers[pdfId]?.name ?? sidecar.pdfName
      const title = name.replace(/\.pdf$/i, '') || doc.title || 'Untitled'
      const remotePosition = signal<{ page: number; offset: number } | null>(null)
      setLoaded({ doc, store: opened, title, remotePosition, notes: notesSignal, ensureNotes })
      // Applies the merged remote sidecar, then moves an unread paper to reading.
      const settle = (merged: Sidecar | null) => {
        if (cancelled) return
        if (merged) {
          opened.replaceFromRemote(merged)
          if (merged.reading.updatedAt > sidecar.reading.updatedAt) {
            remotePosition.value = { page: merged.reading.page, offset: merged.reading.offset }
          }
        }
        if (opened.sidecar.peek().reading.status === 'unread') opened.setReading({ status: 'reading' })
      }
      refreshSidecar(pdfId).then(settle, () => settle(null))
    })().catch((err: unknown) => {
      if (!cancelled) setError(errorText(err))
    })
    return () => {
      cancelled = true
      if (store && edited) saveSidecar(pdfId, store.sidecar.peek())
      if (notes && notesEdited) saveNotebook(pdfId, notes.doc.peek())
      store?.dispose()
      doc?.destroy()
      void flushPendingWrites()
    }
  }, [pdfId, attempt])

  if (loaded) return <ReaderView pdfId={pdfId} loaded={loaded} />
  return (
    <div class="mg-reader">
      <header class="mg-toolbar">
        <div class="mg-toolbar-lead">
          <button type="button" class="btn mg-tool" aria-label="Library" onClick={() => navigate(folderOf(pdfId))}>
            <Icon name="back" />
          </button>
          <span class="mg-title">{library.value?.papers[pdfId]?.name.replace(/\.pdf$/i, '') ?? ''}</span>
        </div>
      </header>
      <div class="mg-loading">
        {error ? (
          <>
            <p class="mg-error">Could not open this paper: {error}</p>
            <button type="button" class="btn" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </>
        ) : (
          <>
            <p class="mg-muted">Opening…</p>
            <div class="mg-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
