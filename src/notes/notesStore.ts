import { computed, signal, type ReadonlySignal } from '@preact/signals'
import { newId, now } from '../lib/ids.ts'
import { compareOrder, orderBetween } from '../lib/order.ts'
import type { ImageBlock, NoteBlock, NoteStroke, NotesBackground, NotesDoc, TextBlock } from '../types.ts'

export interface NotesStore {
  doc: ReadonlySignal<NotesDoc>
  /** Blocks that are not deleted, sorted by order key. */
  blocks: ReadonlySignal<NoteBlock[]>
  /** Strokes that are not deleted. */
  strokes: ReadonlySignal<NoteStroke[]>
  canUndo: ReadonlySignal<boolean>
  canRedo: ReadonlySignal<boolean>
  /** Adds a text block after afterId; undefined appends, null puts it first. */
  addTextBlock(text: string, afterId?: string | null): TextBlock
  /** Adds an image block after afterId; w defaults to 0.8 of the sheet width. */
  addImageBlock(img: { src: string; aspect: number; w?: number; page?: number }, afterId?: string | null): ImageBlock
  /** Sets a block's text; consecutive updates of one block are one undo step. */
  updateText(id: string, text: string): void
  /** Splits a text block at offset; returns the new block holding the tail. */
  splitText(id: string, offset: number): TextBlock
  /** Joins a text block onto the previous text block, or names the previous image block without changing anything. */
  joinWithPrevious(id: string): { kind: 'text'; id: string; caret: number } | { kind: 'image'; id: string } | null
  /** Sets an image's width as a fraction of the sheet width, clamped to [0.15, 1]. */
  resizeImage(id: string, w: number): void
  removeBlock(id: string): void
  addStroke(s: NoteStroke): void
  removeStroke(id: string): void
  /** Sets the sheet background; persisted, not undoable. */
  setBackground(bg: NotesBackground): void
  undo(): void
  redo(): void
  /** Replaces state with a merged doc from the sync layer; clears undo history. */
  replaceFromRemote(doc: NotesDoc): void
}

type Collection = 'blocks' | 'strokes'
type AnyItem = NoteBlock | NoteStroke

interface Change {
  collection: Collection
  before?: AnyItem
  after: AnyItem
}

type HistoryEntry = Change[]

const MAX_HISTORY = 100
const DEFAULT_IMAGE_W = 0.8
const MIN_IMAGE_W = 0.15
const MAX_IMAGE_W = 1

export function createNotesStore(initial: NotesDoc, persist: (doc: NotesDoc) => void): NotesStore {
  const state = signal<NotesDoc>(initial)
  const undoStack = signal<HistoryEntry[]>([])
  const redoStack = signal<HistoryEntry[]>([])
  // Id of the text block whose typing the top undo entry is collecting.
  let typing: string | null = null

  const blocks = computed(() => state.value.blocks.filter((b) => !b.deleted).sort(compareOrder))
  const strokes = computed(() => state.value.strokes.filter((s) => !s.deleted))

  function commit(next: NotesDoc): void {
    state.value = next
    persist(next)
  }

  function find(collection: Collection, id: string): AnyItem | undefined {
    return (state.value[collection] as AnyItem[]).find((i) => i.id === id)
  }

  // Writes the items into their collections and persists once.
  function put(items: { collection: Collection; item: AnyItem }[]): void {
    let next = state.value
    for (const { collection, item } of items) {
      const list = next[collection] as AnyItem[]
      const nextList = list.some((i) => i.id === item.id)
        ? list.map((i) => (i.id === item.id ? item : i))
        : [...list, item]
      next = { ...next, [collection]: nextList }
    }
    commit(next)
  }

  function record(entry: HistoryEntry): void {
    undoStack.value = [...undoStack.value, entry].slice(-MAX_HISTORY)
    redoStack.value = []
    typing = null
  }

  // Applies new versions of items as one undo step and returns the stamped versions.
  function change(items: { collection: Collection; item: AnyItem }[]): AnyItem[] {
    const t = now()
    const entry: HistoryEntry = items.map(({ collection, item }) => ({
      collection,
      before: find(collection, item.id),
      after: { ...item, updatedAt: t } as AnyItem,
    }))
    put(entry.map((c) => ({ collection: c.collection, item: c.after })))
    record(entry)
    return entry.map((c) => c.after)
  }

  function tombstone(collection: Collection, id: string): void {
    const before = find(collection, id)
    if (before && !before.deleted) change([{ collection, item: { ...before, deleted: true } }])
  }

  // Order key for a block placed after afterId (undefined: at the end; null: at the start).
  function orderAfter(afterId: string | null | undefined): string {
    const list = blocks.value
    const found = afterId ? list.findIndex((b) => b.id === afterId) : -1
    const i = afterId === null ? -1 : found >= 0 ? found : list.length - 1
    return orderBetween(list[i]?.order ?? null, list[i + 1]?.order ?? null)
  }

  function addBlock<B extends NoteBlock>(block: Omit<B, 'id' | 'createdAt' | 'updatedAt' | 'order'>, afterId: string | null | undefined): B {
    const t = now()
    const item = { ...block, id: newId(), order: orderAfter(afterId), createdAt: t, updatedAt: t } as B
    return change([{ collection: 'blocks', item }])[0] as B
  }

  function textBlock(id: string): TextBlock | undefined {
    const b = find('blocks', id)
    return b && b.kind === 'text' && !b.deleted ? b : undefined
  }

  function undo(): void {
    const entry = undoStack.value[undoStack.value.length - 1]
    if (!entry) return
    undoStack.value = undoStack.value.slice(0, -1)
    typing = null
    const t = now()
    put(
      [...entry].reverse().map((c) => ({
        collection: c.collection,
        item: { ...(c.before ?? { ...c.after, deleted: true }), updatedAt: t } as AnyItem,
      })),
    )
    redoStack.value = [...redoStack.value, entry]
  }

  function redo(): void {
    const entry = redoStack.value[redoStack.value.length - 1]
    if (!entry) return
    redoStack.value = redoStack.value.slice(0, -1)
    typing = null
    const t = now()
    put(entry.map((c) => ({ collection: c.collection, item: { ...c.after, updatedAt: t } as AnyItem })))
    undoStack.value = [...undoStack.value, entry]
  }

  return {
    doc: state,
    blocks,
    strokes,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    addTextBlock: (text, afterId) => addBlock<TextBlock>({ kind: 'text', text }, afterId),
    addImageBlock(img, afterId) {
      const block = { kind: 'image' as const, src: img.src, aspect: img.aspect, w: img.w ?? DEFAULT_IMAGE_W }
      return addBlock<ImageBlock>(img.page === undefined ? block : { ...block, page: img.page }, afterId)
    },
    updateText(id, text) {
      const before = textBlock(id)
      if (!before || before.text === text) return
      const top = undoStack.value[undoStack.value.length - 1]
      if (typing === id && top?.length === 1) {
        const after = { ...before, text, updatedAt: now() }
        put([{ collection: 'blocks', item: after }])
        undoStack.value = [...undoStack.value.slice(0, -1), [{ ...top[0], after }]]
        return
      }
      change([{ collection: 'blocks', item: { ...before, text } }])
      typing = id
    },
    splitText(id, offset) {
      const block = textBlock(id)
      if (!block) throw new Error(`No text block ${id}`)
      const t = now()
      const tail: TextBlock = {
        kind: 'text', id: newId(), order: orderAfter(id), text: block.text.slice(offset), createdAt: t, updatedAt: t,
      }
      const [, added] = change([
        { collection: 'blocks', item: { ...block, text: block.text.slice(0, offset) } },
        { collection: 'blocks', item: tail },
      ])
      return added as TextBlock
    },
    joinWithPrevious(id) {
      const list = blocks.value
      const i = list.findIndex((b) => b.id === id)
      const current = list[i]
      const prev = list[i - 1]
      if (!current || current.kind !== 'text' || !prev) return null
      if (prev.kind === 'image') return { kind: 'image', id: prev.id }
      change([
        { collection: 'blocks', item: { ...prev, text: prev.text + current.text } },
        { collection: 'blocks', item: { ...current, deleted: true } },
      ])
      return { kind: 'text', id: prev.id, caret: prev.text.length }
    },
    resizeImage(id, w) {
      const block = find('blocks', id)
      if (!block || block.kind !== 'image') return
      change([{ collection: 'blocks', item: { ...block, w: Math.min(MAX_IMAGE_W, Math.max(MIN_IMAGE_W, w)) } }])
    },
    removeBlock: (id) => tombstone('blocks', id),
    addStroke: (s) => void change([{ collection: 'strokes', item: s }]),
    removeStroke: (id) => tombstone('strokes', id),
    setBackground(bg) {
      commit({ ...state.value, background: bg, backgroundUpdatedAt: now() })
    },
    undo,
    redo,
    replaceFromRemote(doc) {
      state.value = doc
      undoStack.value = []
      redoStack.value = []
      typing = null
    },
  }
}
