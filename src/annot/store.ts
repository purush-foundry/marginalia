import { computed, signal, type ReadonlySignal } from '@preact/signals'
import { newId, now } from '../lib/ids'
import type {
  Box, Highlight, HighlightColor, InkStroke, ReadingState, Sidecar, TextHighlight, Thread,
} from '../types'

export interface AnnotationStore {
  sidecar: ReadonlySignal<Sidecar>
  highlights: ReadonlySignal<Highlight[]>
  inks: ReadonlySignal<InkStroke[]>
  threads: ReadonlySignal<Thread[]>
  canUndo: ReadonlySignal<boolean>
  canRedo: ReadonlySignal<boolean>
  setColumns(page: number, columns: Box[]): void
  addHighlight(h: NewHighlight): Highlight
  updateHighlight(id: string, patch: Partial<Pick<TextHighlight, 'color' | 'note'>>): void
  removeHighlight(id: string): void
  addStroke(s: InkStroke): void
  removeStroke(id: string): void
  /** Tombstones a stroke and adds the pieces, as one undo step. */
  replaceStroke(id: string, pieces: InkStroke[]): void
  /** Replaces the live strokes with these versions, as one undo step. */
  updateStrokes(next: InkStroke[]): void
  /** Adds the strokes as one undo step. */
  addStrokes(list: InkStroke[]): void
  /** Tombstones the live strokes, as one undo step. */
  removeStrokes(ids: string[]): void
  upsertThread(t: Thread): void
  removeThread(id: string): void
  setReading(patch: Partial<ReadingState>): void
  setColorLabel(color: HighlightColor, label: string): void
  undo(): void
  redo(): void
  /** Replaces state with a merged sidecar from the sync layer; clears undo history. */
  replaceFromRemote(sidecar: Sidecar): void
  /** Removes the document undo/redo listeners, if any; later events do nothing. */
  dispose(): void
}

export type NewHighlight = Highlight extends infer H
  ? H extends Highlight
    ? Omit<H, 'id' | 'createdAt' | 'updatedAt'>
    : never
  : never

type Collection = 'highlights' | 'inks' | 'threads'
type AnyItem = Highlight | InkStroke | Thread

interface Change {
  collection: Collection
  id: string
  before: AnyItem | undefined
  after: AnyItem
}

type HistoryEntry = Change[]

interface Put {
  collection: Collection
  item: AnyItem
}

const MAX_HISTORY = 100

function firstBox(h: Highlight): Box {
  return h.kind === 'text' ? h.boxes[0] ?? { x: 0, y: 0, w: 0, h: 0 } : h.box
}

function columnIndex(columns: Box[] | undefined, box: Box): number {
  if (!columns) return 0
  const cx = box.x + box.w / 2
  const i = columns.findIndex((c) => cx >= c.x && cx <= c.x + c.w)
  return i < 0 ? 0 : i
}

/** Sorts highlights by page, column (when known), y, then x. */
export function sortHighlights(list: Highlight[], columns: Record<number, Box[]> = {}): Highlight[] {
  const keyed = list.map((h) => {
    const b = firstBox(h)
    return { h, page: h.page, col: columnIndex(columns[h.page], b), y: b.y, x: b.x }
  })
  keyed.sort((a, b) => a.page - b.page || a.col - b.col || a.y - b.y || a.x - b.x)
  return keyed.map((k) => k.h)
}

/** With `documentUndo: false` the store ignores the document's marginalia:undo and marginalia:redo events. */
export function createAnnotationStore(
  initial: Sidecar,
  persist: (sidecar: Sidecar) => void,
  opts: { documentUndo?: boolean } = {},
): AnnotationStore {
  const state = signal<Sidecar>(initial)
  const columns = signal<Record<number, Box[]>>({})
  const undoStack = signal<HistoryEntry[]>([])
  const redoStack = signal<HistoryEntry[]>([])

  const highlights = computed(() =>
    sortHighlights(state.value.highlights.filter((h) => !h.deleted), columns.value),
  )
  const inks = computed(() => state.value.inks.filter((s) => !s.deleted))
  const threads = computed(() =>
    state.value.threads.filter((t) => !t.deleted).sort((a, b) => b.createdAt - a.createdAt),
  )

  function commit(next: Sidecar): void {
    state.value = next
    persist(next)
  }

  function find(collection: Collection, id: string): AnyItem | undefined {
    return (state.value[collection] as AnyItem[]).find((i) => i.id === id)
  }

  // Writes the items into their collections and persists once.
  function put(items: Put[]): void {
    let next = state.value
    for (const { collection, item } of items) {
      const list = next[collection] as AnyItem[]
      const nextList = list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item]
      next = { ...next, [collection]: nextList }
    }
    commit(next)
  }

  function record(entry: HistoryEntry): void {
    undoStack.value = [...undoStack.value, entry].slice(-MAX_HISTORY)
    redoStack.value = []
  }

  // Applies new versions of items as one undo step; nothing happens for none.
  function change(items: Put[]): void {
    if (!items.length) return
    const t = now()
    const entry: HistoryEntry = items.map(({ collection, item }) => ({
      collection,
      id: item.id,
      before: find(collection, item.id),
      after: { ...item, updatedAt: t } as AnyItem,
    }))
    put(entry.map((c) => ({ collection: c.collection, item: c.after })))
    record(entry)
  }

  function tombstone(collection: Collection, id: string): void {
    const before = find(collection, id)
    if (!before || before.deleted) return
    change([{ collection, item: { ...before, deleted: true } }])
  }

  // The live stroke with this id.
  function liveInk(id: string): InkStroke | undefined {
    const s = find('inks', id) as InkStroke | undefined
    return s && !s.deleted ? s : undefined
  }

  function undo(): void {
    const entry = undoStack.value[undoStack.value.length - 1]
    if (!entry) return
    undoStack.value = undoStack.value.slice(0, -1)
    const t = now()
    put(
      [...entry].reverse().map((c) => {
        const restored = c.before
          ? { ...c.before, ...(c.after.deleted ? { deleted: false } : {}) }
          : { ...c.after, deleted: true }
        return { collection: c.collection, item: { ...restored, updatedAt: t } as AnyItem }
      }),
    )
    redoStack.value = [...redoStack.value, entry]
  }

  function redo(): void {
    const entry = redoStack.value[redoStack.value.length - 1]
    if (!entry) return
    redoStack.value = redoStack.value.slice(0, -1)
    const t = now()
    put(entry.map((c) => ({ collection: c.collection, item: { ...c.after, updatedAt: t } as AnyItem })))
    undoStack.value = [...undoStack.value, entry]
  }

  if (opts.documentUndo !== false) {
    document.addEventListener('marginalia:undo', undo)
    document.addEventListener('marginalia:redo', redo)
  }

  return {
    sidecar: state,
    highlights,
    inks,
    threads,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    setColumns(page, cols) {
      columns.value = { ...columns.value, [page]: cols }
    },
    addHighlight(h) {
      const t = now()
      const item = { ...h, id: newId(), createdAt: t, updatedAt: t } as Highlight
      put([{ collection: 'highlights', item }])
      record([{ collection: 'highlights', id: item.id, before: undefined, after: item }])
      return item
    },
    updateHighlight(id, patch) {
      const before = find('highlights', id)
      if (before) change([{ collection: 'highlights', item: { ...before, ...patch } as Highlight }])
    },
    removeHighlight: (id) => tombstone('highlights', id),
    addStroke: (s) => change([{ collection: 'inks', item: s }]),
    removeStroke: (id) => tombstone('inks', id),
    replaceStroke(id, pieces) {
      const original = find('inks', id)
      if (!original || original.deleted) return
      change([
        { collection: 'inks', item: { ...original, deleted: true } },
        ...pieces.map((item) => ({ collection: 'inks' as const, item })),
      ])
    },
    updateStrokes(next) {
      change(next.filter((s) => liveInk(s.id)).map((item) => ({ collection: 'inks' as const, item })))
    },
    addStrokes: (list) => change(list.map((item) => ({ collection: 'inks' as const, item }))),
    removeStrokes(ids) {
      const gone = [...new Set(ids)].map(liveInk).filter((s) => s !== undefined)
      change(gone.map((s) => ({ collection: 'inks' as const, item: { ...s, deleted: true } })))
    },
    upsertThread: (t) => put([{ collection: 'threads', item: { ...t, updatedAt: now() } }]),
    removeThread: (id) => tombstone('threads', id),
    setReading(patch) {
      commit({ ...state.value, reading: { ...state.value.reading, ...patch, updatedAt: now() } })
    },
    setColorLabel(color, label) {
      commit({ ...state.value, colorLabels: { ...state.value.colorLabels, [color]: label } })
    },
    undo,
    redo,
    dispose() {
      document.removeEventListener('marginalia:undo', undo)
      document.removeEventListener('marginalia:redo', redo)
    },
    replaceFromRemote(sidecar) {
      state.value = sidecar
      undoStack.value = []
      redoStack.value = []
    },
  }
}
