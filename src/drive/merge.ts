import type { NotesDocV2 } from '../notes/model'
import type { Sidecar } from '../types'

interface Versioned {
  id: string
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

// Returns the item that wins a merge: newer updatedAt, then a tombstone on ties, else the first.
function winner<T extends Versioned>(x: T, y: T): T {
  if (x.updatedAt !== y.updatedAt) return x.updatedAt > y.updatedAt ? x : y
  if (!x.deleted && y.deleted) return y
  return x
}

// Unions two item lists by id, ordered by createdAt then id.
function mergeItems<T extends Versioned>(a: T[], b: T[]): T[] {
  const byId = new Map<string, T>()
  for (const item of [...a, ...b]) {
    const seen = byId.get(item.id)
    byId.set(item.id, seen ? winner(seen, item) : item)
  }
  return [...byId.values()].sort((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
}

// Latest updatedAt anywhere in the sidecar.
function lastTouched(s: Sidecar): number {
  return Math.max(s.reading.updatedAt, ...[...s.highlights, ...s.inks, ...s.threads].map((i) => i.updatedAt))
}

/** Per item by id, newest updatedAt wins, tombstones win ties; reading state newest wins; colorLabels union (newer sidecar's labels win). */
export function mergeSidecars(a: Sidecar, b: Sidecar): Sidecar {
  const [older, newer] = lastTouched(b) > lastTouched(a) ? [a, b] : [b, a]
  const merged: Sidecar = {
    schema: 1,
    pdfId: newer.pdfId,
    pdfName: newer.pdfName,
    highlights: mergeItems(a.highlights, b.highlights),
    inks: mergeItems(a.inks, b.inks),
    threads: mergeItems(a.threads, b.threads),
    reading: b.reading.updatedAt > a.reading.updatedAt ? b.reading : a.reading,
  }
  if (older.colorLabels || newer.colorLabels) {
    merged.colorLabels = { ...older.colorLabels, ...newer.colorLabels }
  }
  return merged
}

// Latest change time anywhere in the notebook.
function notebookTouched(n: NotesDocV2): number {
  return Math.max(0, ...[...n.pages, ...n.strokes, ...n.texts, ...n.images].map((i) => i.updatedAt))
}

/** Pages, strokes, texts and images per id, newest updatedAt wins, tombstones win ties; pdfId and pdfName from the more recently touched doc. */
export function mergeNotebooks(a: NotesDocV2, b: NotesDocV2): NotesDocV2 {
  const newer = notebookTouched(b) > notebookTouched(a) ? b : a
  return {
    schema: 2,
    kind: 'notes',
    pdfId: newer.pdfId,
    pdfName: newer.pdfName,
    pages: mergeItems(a.pages, b.pages),
    strokes: mergeItems(a.strokes, b.strokes),
    texts: mergeItems(a.texts, b.texts),
    images: mergeItems(a.images, b.images),
  }
}
