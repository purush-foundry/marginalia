import { computed, signal, type ReadonlySignal } from '@preact/signals'
import { newId, now } from '../lib/ids.ts'
import type { ItemRef } from '../ink/lasso.ts'
import { compareOrder, orderBetween } from '../lib/order.ts'
import type { Clip } from './clipboard.ts'
import {
  PAGE_SIZES, compareZ,
  type ImageObject, type NotePage, type NotebookStroke, type NotesDocV2, type ObjectBox, type PageContent, type PageStyle, type TextObject,
} from './model.ts'

export type NewStroke = Omit<NotebookStroke, 'z'>

export interface NotebookStore {
  doc: ReadonlySignal<NotesDocV2>
  /** Pages that are not deleted, by order key. */
  pages: ReadonlySignal<NotePage[]>
  /** Live items of each live page, keyed by page id. */
  content: ReadonlySignal<Map<string, PageContent>>
  canUndo: ReadonlySignal<boolean>
  canRedo: ReadonlySignal<boolean>
  /** Adds a page after `after` (undefined: last; null: first) styled like the page it follows (the first page when null). */
  addPage(after?: string | null, style?: Partial<PageStyle>): NotePage
  /** Tombstones a page unless it is the only live page. */
  deletePage(id: string): void
  /** Copies the page's style and live items with new ids into a page right after it. */
  duplicatePage(id: string): NotePage
  movePage(id: string, after: string | null): void
  /** Patches one page, or every live page, as one undo step. */
  setPageStyle(id: string, patch: Partial<PageStyle>, applyToAll: boolean): void
  addStroke(s: NewStroke): NotebookStroke
  removeStroke(id: string): void
  /** Tombstones a stroke and adds the pieces at its z, as one undo step. */
  replaceStroke(id: string, pieces: NewStroke[]): void
  addText(t: { page: string; box: ObjectBox; text: string; size: TextObject['size']; color: string }): TextObject
  /** Patches a text box; consecutive text-only patches of one box are one undo step. */
  updateText(id: string, patch: Partial<Pick<TextObject, 'text' | 'box' | 'size' | 'color'>>): void
  /** Adds an image; the box defaults to half the page width centred on the page. */
  addImage(img: { page: string; src: string; aspect: number; pdfPage?: number; box?: ObjectBox }): ImageObject
  updateImage(id: string, patch: { box: ObjectBox }): void
  removeObject(kind: 'texts' | 'images', id: string): void
  /** Shifts the items; `toPage` re-parents them on top of that page. One undo step. */
  moveItems(refs: ItemRef[], dx: number, dy: number, toPage?: string): void
  /** Scales stroke points and widths and object positions and widths about `origin`; text size is unchanged. One undo step. */
  scaleItems(refs: ItemRef[], origin: { x: number; y: number }, k: number): void
  /** Sets the colour of the strokes and texts among the items. One undo step. */
  recolorItems(refs: ItemRef[], color: string): void
  /** Puts the items above everything on their page, keeping their order. One undo step. */
  bringToFront(refs: ItemRef[]): void
  /** Puts the items below everything on their page, keeping their order. One undo step. */
  sendToBack(refs: ItemRef[]): void
  /** Tombstones the items. One undo step. */
  removeItems(refs: ItemRef[]): void
  /** Copies the items with new ids on top of their page, shifted right and down by `offset`; returns the copies bottom to top. One undo step. */
  duplicateItems(refs: ItemRef[], offset: number): ItemRef[]
  /** Adds the clip's items on top of `page` with the clip's top-left at `at`; returns them bottom to top. One undo step. */
  insertClip(clip: Clip, page: string, at: { x: number; y: number }): ItemRef[]
  undo(): void
  redo(): void
  /** Replaces state with a merged doc from the sync layer; clears undo history. */
  replaceFromRemote(doc: NotesDocV2): void
}

type Collection = 'pages' | 'strokes' | 'texts' | 'images'
type AnyItem = NotePage | NotebookStroke | TextObject | ImageObject
type PageItem = NotebookStroke | TextObject | ImageObject

interface Change {
  collection: Collection
  before?: AnyItem
  after: AnyItem
}

type HistoryEntry = Change[]
type Put = { collection: Collection; item: AnyItem }
type ItemCollection = 'strokes' | 'texts' | 'images'
type ItemPut = { collection: ItemCollection; item: PageItem }

const COLLECTION_OF: Record<ItemRef['kind'], ItemCollection> = { stroke: 'strokes', text: 'texts', image: 'images' }
const KIND_OF: Record<ItemCollection, ItemRef['kind']> = { strokes: 'stroke', texts: 'text', images: 'image' }

const MAX_HISTORY = 100
const DEFAULT_IMAGE_W = 0.5

// Copy of an item with each position (x, y) mapped to (x * k + dx, y * k + dy) and its stroke or box width scaled by k.
function transformed(item: PageItem, k: number, dx: number, dy: number): PageItem {
  if ('points' in item) {
    const points = item.points.map((v, i) => (i % 3 === 0 ? v * k + dx : i % 3 === 1 ? v * k + dy : v))
    return { ...item, points, width: item.width * k }
  }
  return { ...item, box: { x: item.box.x * k + dx, y: item.box.y * k + dy, w: item.box.w * k } }
}

const refOf = ({ collection, item }: ItemPut): ItemRef => ({ kind: KIND_OF[collection], id: item.id })

// The style of a page, or A4 blank white when there is none.
function styleOf(page: NotePage | undefined): PageStyle {
  return page
    ? { template: page.template, color: page.color, size: { ...page.size } }
    : { template: 'blank', color: 'white', size: { ...PAGE_SIZES.a4 } }
}

export function createNotebookStore(initial: NotesDocV2, persist: (doc: NotesDocV2) => void): NotebookStore {
  const state = signal<NotesDocV2>(initial)
  const undoStack = signal<HistoryEntry[]>([])
  const redoStack = signal<HistoryEntry[]>([])
  // Id of the text box whose typing the top undo entry is collecting.
  let typing: string | null = null

  const pages = computed(() => state.value.pages.filter((p) => !p.deleted).sort(compareOrder))
  const content = computed(() => {
    const map = new Map<string, PageContent>(pages.value.map((p) => [p.id, { strokes: [], texts: [], images: [] }]))
    const doc = state.value
    for (const s of doc.strokes) if (!s.deleted) map.get(s.page)?.strokes.push(s)
    for (const t of doc.texts) if (!t.deleted) map.get(t.page)?.texts.push(t)
    for (const m of doc.images) if (!m.deleted) map.get(m.page)?.images.push(m)
    for (const c of map.values()) {
      c.strokes.sort(compareZ)
      c.texts.sort(compareZ)
      c.images.sort(compareZ)
    }
    return map
  })

  function commit(next: NotesDocV2): void {
    state.value = next
    persist(next)
  }

  function find(collection: Collection, id: string): AnyItem | undefined {
    return (state.value[collection] as AnyItem[]).find((i) => i.id === id)
  }

  function live(collection: Collection, id: string): AnyItem | undefined {
    const item = find(collection, id)
    return item && !item.deleted ? item : undefined
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
    typing = null
  }

  // Applies new versions of items as one undo step and returns the stamped versions; nothing happens for none.
  function change(items: Put[]): AnyItem[] {
    if (!items.length) return []
    const t = now()
    const entry: HistoryEntry = items.map(({ collection, item }) => ({
      collection,
      before: find(collection, item.id),
      after: { ...item, updatedAt: t },
    }))
    put(entry.map((c) => ({ collection: c.collection, item: c.after })))
    record(entry)
    return entry.map((c) => c.after)
  }

  function tombstone(collection: Collection, id: string): void {
    const before = live(collection, id)
    if (before) change([{ collection, item: { ...before, deleted: true } }])
  }

  // Order key and preceding page for a page placed after `after` (undefined or unknown: last; null: first), leaving out `skip`.
  function placeAfter(after: string | null | undefined, skip?: string): { order: string; prev?: NotePage } {
    const list = pages.value.filter((p) => p.id !== skip)
    const found = after ? list.findIndex((p) => p.id === after) : -1
    const i = after === null ? -1 : found >= 0 ? found : list.length - 1
    return { order: orderBetween(list[i]?.order ?? null, list[i + 1]?.order ?? null), prev: list[i] }
  }

  // A new page after `after`, styled like the page it follows (the first page when null) and then `style`.
  function pageItem(after: string | null | undefined, style: Partial<PageStyle> = {}): NotePage {
    const { order, prev } = placeAfter(after)
    const t = now()
    return { id: newId(), order, ...styleOf(after === null ? pages.value[0] : prev), ...style, createdAt: t, updatedAt: t }
  }

  // A page to add after `page` when it is the last live page and holds no live items.
  function autoPage(page: string): Put[] {
    const list = pages.value
    const c = content.value.get(page)
    if (list[list.length - 1]?.id !== page || !c || c.strokes.length + c.texts.length + c.images.length) return []
    return [{ collection: 'pages', item: pageItem(page) }]
  }

  // A z key above every live item on the page.
  function zOnTop(page: string): string {
    const { strokes, texts, images } = state.value
    let top: string | null = null
    for (const item of [...strokes, ...texts, ...images]) {
      if (item.page === page && !item.deleted && (top === null || item.z > top)) top = item.z
    }
    return orderBetween(top, null)
  }

  // The lowest z key among the page's live items, or null when it has none.
  function zBottom(page: string): string | null {
    const { strokes, texts, images } = state.value
    let bottom: string | null = null
    for (const item of [...strokes, ...texts, ...images]) {
      if (item.page === page && !item.deleted && (bottom === null || item.z < bottom)) bottom = item.z
    }
    return bottom
  }

  // The items with z keys above everything on their pages, in the given order.
  function stackOnTop(list: ItemPut[]): ItemPut[] {
    const last = new Map<string, string>()
    return list.map(({ collection, item }) => {
      const prev = last.get(item.page)
      const z = prev === undefined ? zOnTop(item.page) : orderBetween(prev, null)
      last.set(item.page, z)
      return { collection, item: { ...item, z } }
    })
  }

  // The items with z keys below everything on their pages, in the given order.
  function stackBelow(list: ItemPut[]): ItemPut[] {
    const first = new Map<string, string | null>()
    return [...list].reverse().map(({ collection, item }) => {
      const next = first.has(item.page) ? first.get(item.page)! : zBottom(item.page)
      const z = orderBetween(null, next)
      first.set(item.page, z)
      return { collection, item: { ...item, z } }
    }).reverse()
  }

  // The live items the refs name, once each, bottom to top.
  function picked(refs: ItemRef[]): ItemPut[] {
    const out: ItemPut[] = []
    for (const { kind, id } of refs) {
      const collection = COLLECTION_OF[kind]
      const item = live(collection, id) as PageItem | undefined
      if (item && !out.some((p) => p.item === item)) out.push({ collection, item })
    }
    return out.sort((a, b) => compareZ(a.item, b.item))
  }

  // Adds an item on top of its page, plus a following page when the rule calls for one, as one undo step.
  function addItem<T extends PageItem>(collection: 'strokes' | 'texts' | 'images', item: Omit<T, 'z'>): T {
    const extra = autoPage(item.page)
    return change([{ collection, item: { ...item, z: zOnTop(item.page) } as T }, ...extra])[0] as T
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
        item: { ...(c.before ?? { ...c.after, deleted: true }), updatedAt: t },
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
    put(entry.map((c) => ({ collection: c.collection, item: { ...c.after, updatedAt: t } })))
    undoStack.value = [...undoStack.value, entry]
  }

  return {
    doc: state,
    pages,
    content,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    addPage: (after, style) => change([{ collection: 'pages', item: pageItem(after, style) }])[0] as NotePage,
    deletePage(id) {
      if (pages.value.some((p) => p.id !== id)) tombstone('pages', id)
    },
    duplicatePage(id) {
      const c = content.value.get(id)
      if (!c) throw new Error(`No page ${id}`)
      const copy = pageItem(id)
      const t = now()
      const clone = <T extends PageItem>(x: T): T => ({ ...x, id: newId(), page: copy.id, createdAt: t, updatedAt: t })
      return change([
        { collection: 'pages', item: copy },
        ...c.strokes.map((s) => ({ collection: 'strokes' as const, item: clone(s) })),
        ...c.texts.map((x) => ({ collection: 'texts' as const, item: clone(x) })),
        ...c.images.map((m) => ({ collection: 'images' as const, item: clone(m) })),
      ])[0] as NotePage
    },
    movePage(id, after) {
      const page = live('pages', id) as NotePage | undefined
      if (!page || after === id) return
      change([{ collection: 'pages', item: { ...page, order: placeAfter(after, id).order } }])
    },
    setPageStyle(id, patch, applyToAll) {
      const targets = pages.value.filter((p) => applyToAll || p.id === id)
      if (targets.length) change(targets.map((p) => ({ collection: 'pages', item: { ...p, ...patch } })))
    },
    addStroke: (s) => addItem<NotebookStroke>('strokes', s),
    removeStroke: (id) => tombstone('strokes', id),
    replaceStroke(id, pieces) {
      const original = live('strokes', id) as NotebookStroke | undefined
      if (!original) return
      change([
        { collection: 'strokes', item: { ...original, deleted: true } },
        ...pieces.map((p) => ({ collection: 'strokes' as const, item: { ...p, z: original.z } })),
      ])
    },
    addText(t) {
      const at = now()
      return addItem<TextObject>('texts', { ...t, id: newId(), createdAt: at, updatedAt: at })
    },
    updateText(id, patch) {
      const before = live('texts', id) as TextObject | undefined
      if (!before || Object.entries(patch).every(([k, v]) => before[k as keyof typeof patch] === v)) return
      const textOnly = Object.keys(patch).every((k) => k === 'text')
      const top = undoStack.value[undoStack.value.length - 1]
      if (textOnly && typing === id && top?.length === 1) {
        const after = { ...before, ...patch, updatedAt: now() }
        put([{ collection: 'texts', item: after }])
        undoStack.value = [...undoStack.value.slice(0, -1), [{ ...top[0], after }]]
        return
      }
      change([{ collection: 'texts', item: { ...before, ...patch } }])
      typing = textOnly ? id : null
    },
    addImage({ pdfPage, box, ...img }) {
      const size = (find('pages', img.page) as NotePage | undefined)?.size ?? PAGE_SIZES.a4
      const w = DEFAULT_IMAGE_W
      const at = now()
      return addItem<ImageObject>('images', {
        ...img,
        box: box ?? { x: (1 - w) / 2, y: (size.h / size.w - w * img.aspect) / 2, w },
        ...(pdfPage !== undefined ? { pdfPage } : {}),
        id: newId(),
        createdAt: at,
        updatedAt: at,
      })
    },
    updateImage(id, patch) {
      const before = live('images', id) as ImageObject | undefined
      if (before) change([{ collection: 'images', item: { ...before, box: patch.box } }])
    },
    removeObject: (kind, id) => tombstone(kind, id),
    moveItems(refs, dx, dy, toPage) {
      const target = toPage !== undefined && live('pages', toPage) ? toPage : undefined
      const moved = picked(refs).map(({ collection, item }) => ({ collection, item: transformed(item, 1, dx, dy) }))
      const staying = moved.filter((p) => target === undefined || p.item.page === target)
      const leaving = moved.filter((p) => !staying.includes(p)).map((p) => ({ ...p, item: { ...p.item, page: target! } }))
      change([...staying, ...stackOnTop(leaving), ...(leaving.length ? autoPage(target!) : [])])
    },
    scaleItems(refs, origin, k) {
      change(picked(refs).map(({ collection, item }) => ({ collection, item: transformed(item, k, origin.x * (1 - k), origin.y * (1 - k)) })))
    },
    recolorItems(refs, color) {
      const inked = picked(refs).filter((p) => p.collection !== 'images' && (p.item as NotebookStroke | TextObject).color !== color)
      change(inked.map(({ collection, item }) => ({ collection, item: { ...item, color } })))
    },
    bringToFront(refs) {
      change(stackOnTop(picked(refs)))
    },
    sendToBack(refs) {
      change(stackBelow(picked(refs)))
    },
    removeItems(refs) {
      change(picked(refs).map(({ collection, item }) => ({ collection, item: { ...item, deleted: true } })))
    },
    duplicateItems(refs, offset) {
      const t = now()
      const copies = stackOnTop(
        picked(refs).map(({ collection, item }) => ({
          collection,
          item: { ...transformed(item, 1, offset, offset), id: newId(), createdAt: t, updatedAt: t },
        })),
      )
      change(copies)
      return copies.map(refOf)
    },
    insertClip(clip, page, at) {
      const t = now()
      const fresh = { id: '', page, z: '', createdAt: t, updatedAt: t }
      const list: ItemPut[] = [
        ...clip.images.map((m) => ({ collection: 'images' as const, item: { ...m, ...fresh } })),
        ...clip.texts.map((x) => ({ collection: 'texts' as const, item: { ...x, ...fresh } })),
        ...clip.strokes.map((s) => ({ collection: 'strokes' as const, item: { ...s, ...fresh } })),
      ]
      const placed = stackOnTop(list.map(({ collection, item }) => ({ collection, item: { ...transformed(item, 1, at.x, at.y), id: newId() } })))
      change([...placed, ...autoPage(page)])
      return placed.map(refOf)
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
