// Reader: loads a paper and its sidecar, then wires the viewer, ink, selection bar, sidebar and Ask panel.
import { computed, useComputed, useSignal } from '@preact/signals'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { AskPanel } from '../ai/AskPanel'
import { SelectionBar } from '../annot/SelectionBar'
import { createAnnotationStore, type AnnotationStore } from '../annot/store'
import { IMAGE_MAX_EDGE_PX } from '../config'
import {
  flushPendingWrites,
  getPdfBlob,
  library,
  loadSidecar,
  refreshSidecar,
  saveSidecar,
} from '../drive/library'
import { sidecarToMarkdown } from '../export/markdown'
import { InkLayer } from '../ink/InkLayer'
import { mouseDraws, penTool } from '../ink/tools'
import { newId, now } from '../lib/ids'
import { openPdf, type PageLink, type PdfDoc } from '../pdf/document'
import { isIOS } from '../pdf/platform'
import { Viewer, type PendingSelection, type ViewerHandle } from '../pdf/Viewer'
import type { Anchor, Box, HighlightColor, InkStroke, PageText, Thread } from '../types'
import { Icon } from './icons'
import { folderHash, navigate } from './route'
import { saveSettings, settings } from './settings'
import { Sidebar, type SidebarTab } from './Sidebar'
import { Toolbar } from './Toolbar'
import { copyText, settingsOpen, showToast } from './ui'
import './reader.css'

type Bar = { kind: 'selection'; sel: PendingSelection } | { kind: 'highlight'; id: string; rect: DOMRect }

interface Loaded {
  doc: PdfDoc
  store: AnnotationStore
  title: string
  initial: { page: number; offset: number; zoom: number }
}

const NO_STROKES: InkStroke[] = []
const NO_THREADS: Thread[] = []
const DEFAULT_NOTE_COLOR: HighlightColor = 'yellow'
const NOTE_W = 320
const NOTE_H = 170

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
  const areaArmed = useSignal(false)
  const penDrawing = useMemo(() => computed(() => penTool.value !== 'select'), [])
  const [bar, setBar] = useState<Bar | null>(null)
  const [note, setNote] = useState<{ id: string; rect: DOMRect } | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [sidebar, setSidebar] = useState<SidebarTab | null>(null)
  const [backTo, setBackTo] = useState<number | null>(null)
  const penCapable = s.penSeen || isIPadOS()
  const finePointer = useMemo(() => matches('(any-pointer: fine)'), [])
  const wide = () => matches('(min-width: 700px)')

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

  const state = useRef({ bar, note, thread, sidebar })
  state.current = { bar, note, thread, sidebar }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as Element | null)?.closest?.('input, textarea, [contenteditable]')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (e.key !== 'Escape') return
      const cur = state.current
      if (cur.bar || cur.note) return
      if (cur.thread) setThread(null)
      else if (cur.sidebar && !wide()) setSidebar(null)
      else if (mouseDraws.value) mouseDraws.value = false
      else if (areaArmed.value) areaArmed.value = false
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    const scroller = wrap.current?.querySelector('.mg-scroller')
    if (!bar || !scroller) return
    const close = () => setBar(null)
    scroller.addEventListener('scroll', close, { passive: true, once: true })
    return () => scroller.removeEventListener('scroll', close)
  }, [bar])

  const go = (page: number, box?: Box) => {
    viewer.current?.scrollTo(page, box, 'smooth')
    if (!wide()) setSidebar(null)
  }

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
      setBackTo(viewer.current?.currentPage.peek() ?? null)
      viewer.current?.scrollTo(link.page)
    } else if (link.url) {
      window.open(link.url, '_blank', 'noopener,noreferrer')
    }
  }

  const onCite = (page: number, quote: string) => {
    doc.getPageText(page).then(
      (pt) => viewer.current?.scrollTo(page, findQuote(pt, quote), 'smooth'),
      () => viewer.current?.scrollTo(page),
    )
  }

  const exportMarkdown = () => {
    const text = (async () => {
      const sidecar = store.sidecar.peek()
      const pages = new Set(sidecar.highlights.filter((h) => !h.deleted).map((h) => h.page))
      await Promise.all([...pages].map(ensureColumns))
      return sidecarToMarkdown(sidecar, { title, columns: columns.current })
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
        onAddStroke={store.addStroke}
        onEraseStroke={store.removeStroke}
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
    </>
  )

  return (
    <div class="mg-reader">
      <Toolbar
        title={title}
        store={store}
        areaArmed={areaArmed}
        penCapable={penCapable}
        finePointer={finePointer}
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
        <div ref={wrap} class={`mg-viewer-wrap${mouseDraws.value ? ' mg-drawing' : ''}`}>
          <Viewer
            doc={doc}
            highlights={store.highlights}
            crop={store.sidecar.peek().reading.crop}
            nightMode={s.nightMode}
            invertImages={s.invertImages}
            initial={loaded.initial}
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
            onReadingPosition={(pos) => store.setReading(pos)}
            handle={(h) => (viewer.current = h)}
          />
          {backTo !== null && (
            <button
              type="button"
              class="btn mg-back-chip"
              onClick={() => {
                viewer.current?.scrollTo(backTo)
                setBackTo(null)
              }}
            >
              ← back to p.{backTo}
            </button>
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
    setLoaded(null)
    setError(null)
    setProgress(0)
    void (async () => {
      const blob = await getPdfBlob(pdfId, (f) => !cancelled && setProgress(f))
      if (cancelled) return
      doc = await openPdf(blob)
      const sidecar = await loadSidecar(pdfId)
      if (cancelled) return
      const opened = createAnnotationStore(sidecar, (next) => saveSidecar(pdfId, next))
      store = opened
      const { page, offset, zoom, status } = sidecar.reading
      if (status === 'unread') opened.setReading({ status: 'reading' })
      const name = library.peek()?.papers[pdfId]?.name ?? sidecar.pdfName
      const title = name.replace(/\.pdf$/i, '') || doc.title || 'Untitled'
      setLoaded({ doc, store: opened, title, initial: { page, offset, zoom } })
      refreshSidecar(pdfId).then(
        (merged) => {
          if (merged && !cancelled) opened.replaceFromRemote(merged)
        },
        () => undefined,
      )
    })().catch((err: unknown) => {
      if (!cancelled) setError(errorText(err))
    })
    return () => {
      cancelled = true
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
