// Reader sidebar: outline, highlights with a colour filter, Ask threads, and the paper's done toggle.
import { useEffect, useState } from 'preact/hooks'
import type { AnnotationStore } from '../annot/store'
import type { OutlineItem, PdfDoc } from '../pdf/document'
import { HIGHLIGHT_COLORS, type Box, type Highlight, type HighlightColor, type ReadStatus, type Thread } from '../types'
import { Icon } from './icons'

export type SidebarTab = 'outline' | 'highlights' | 'threads'

export interface SidebarProps {
  doc: PdfDoc
  store: AnnotationStore
  tab: SidebarTab
  status: ReadStatus
  onTab(tab: SidebarTab): void
  onGo(page: number, box?: Box): void
  onOpenThread(thread: Thread): void
  onToggleDone(): void
  onClose(): void
}

const TABS: Array<{ id: SidebarTab; label: string }> = [
  { id: 'outline', label: 'Outline' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'threads', label: 'Threads' },
]

function excerpt(text: string, max = 140): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t
}

export function firstBox(h: Highlight): Box {
  return h.kind === 'text' ? h.boxes[0] : h.box
}

function Outline({ items, onGo }: { items: OutlineItem[]; onGo(page: number): void }) {
  return (
    <ul class="mg-list mg-outline">
      {items.map((item, i) => (
        <li key={i}>
          <button type="button" class="mg-row" disabled={item.page === null} onClick={() => item.page && onGo(item.page)}>
            <span class="mg-row-name">{item.title}</span>
            {item.page !== null && <span class="mg-muted">{item.page}</span>}
          </button>
          {item.items.length > 0 && <Outline items={item.items} onGo={onGo} />}
        </li>
      ))}
    </ul>
  )
}

function OutlineTab({ doc, onGo }: { doc: PdfDoc; onGo(page: number): void }) {
  const [items, setItems] = useState<OutlineItem[] | null>(null)
  useEffect(() => {
    let live = true
    doc.getOutline().then(
      (o) => live && setItems(o),
      () => live && setItems([]),
    )
    return () => {
      live = false
    }
  }, [doc])
  if (!items) return <p class="mg-muted mg-pad">Loading…</p>
  if (!items.length) return <p class="mg-muted mg-pad">This PDF has no outline.</p>
  return <Outline items={items} onGo={onGo} />
}

function HighlightsTab({ store, onGo }: { store: AnnotationStore; onGo(page: number, box?: Box): void }) {
  const [filter, setFilter] = useState<HighlightColor | null>(null)
  const all = store.highlights.value
  const list = filter ? all.filter((h) => h.color === filter) : all
  return (
    <>
      <div class="mg-filter" role="group" aria-label="Filter by colour">
        <button type="button" class="btn" aria-pressed={filter === null} onClick={() => setFilter(null)}>
          All
        </button>
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            class="btn mg-swatch"
            aria-label={`Only ${c}`}
            aria-pressed={filter === c}
            style={{ '--swatch': `var(--hl-${c})` }}
            onClick={() => setFilter(filter === c ? null : c)}
          />
        ))}
      </div>
      {!list.length && <p class="mg-muted mg-pad">No highlights{filter ? ' in this colour' : ''} yet.</p>}
      <ul class="mg-list">
        {list.map((h) => (
          <li key={h.id}>
            <button type="button" class="mg-row mg-hl-row" onClick={() => onGo(h.page, firstBox(h))}>
              <span class="mg-hl-bar" style={{ background: `var(--hl-${h.color})` }} />
              <span class="mg-hl-body">
                <span>{h.kind === 'text' ? excerpt(h.text) : 'Area'}</span>
                {h.note && <span class="mg-muted mg-hl-note">{excerpt(h.note, 200)}</span>}
              </span>
              <span class="mg-muted">p.{h.page}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function ThreadsTab({ store, onOpen }: { store: AnnotationStore; onOpen(t: Thread): void }) {
  const threads = store.threads.value
  if (!threads.length) return <p class="mg-muted mg-pad">Select a passage or area and tap Ask to start a thread.</p>
  return (
    <ul class="mg-list">
      {threads.map((t) => (
        <li key={t.id}>
          <button type="button" class="mg-row" onClick={() => onOpen(t)}>
            <Icon name="chat" />
            <span class="mg-hl-body">
              <span>{t.anchor.text ? excerpt(t.anchor.text, 100) : `Area on p.${t.anchor.page}`}</span>
              <span class="mg-muted">
                p.{t.anchor.page} · {t.messages.length} message{t.messages.length === 1 ? '' : 's'}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside class="mg-sidebar" aria-label="Sidebar">
      <div class="mg-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            class="btn"
            aria-selected={props.tab === t.id}
            onClick={() => props.onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button type="button" class="btn mg-sidebar-close" aria-label="Close sidebar" onClick={props.onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div class="mg-sidebar-body">
        {props.tab === 'outline' && <OutlineTab doc={props.doc} onGo={(p) => props.onGo(p)} />}
        {props.tab === 'highlights' && <HighlightsTab store={props.store} onGo={props.onGo} />}
        {props.tab === 'threads' && <ThreadsTab store={props.store} onOpen={props.onOpenThread} />}
      </div>
      <div class="mg-sidebar-foot">
        <button type="button" class="btn" aria-pressed={props.status === 'done'} onClick={props.onToggleDone}>
          <Icon name="check" />
          {props.status === 'done' ? 'Done' : 'Mark as done'}
        </button>
      </div>
    </aside>
  )
}
