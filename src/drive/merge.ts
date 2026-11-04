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

// True when two JSON-shaped values are structurally equal.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !same(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a)
  if (Array.isArray(b) || ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  return true
}

// JSON of the item's fields in key order, leaving out points and src.
function tieKey(x: object): string {
  const r = x as Record<string, unknown>
  return JSON.stringify(Object.keys(r).filter((k) => k !== 'points' && k !== 'src').sort().map((k) => [k, r[k]]))
}

// Orders two number arrays element by element, then by length.
function comparePoints(a: readonly number[] = [], b: readonly number[] = []): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return a.length - b.length
}

// Like winner, but a tie between versions with the same tombstone state goes to the greater small-field JSON, then points, then src, so both merge orders agree.
function orderFreeWinner<T extends Versioned>(x: T, y: T): T {
  if (x.updatedAt !== y.updatedAt || !x.deleted !== !y.deleted) return winner(x, y)
  if (same(x, y)) return x
  const kx = tieKey(x)
  const ky = tieKey(y)
  if (kx !== ky) return ky > kx ? y : x
  const [px, py] = [x, y].map((v) => (v as { points?: number[] }).points)
  const byPoints = comparePoints(px, py)
  if (byPoints !== 0) return byPoints < 0 ? y : x
  const [sx, sy] = [x, y].map((v) => (v as { src?: string }).src ?? '')
  return sy > sx ? y : x
}

// Unions two item lists by id, ordered by createdAt then id; `pick` chooses between two versions of one id.
function mergeItems<T extends Versioned>(a: T[], b: T[], pick: (x: T, y: T) => T = winner): T[] {
  const byId = new Map<string, T>()
  for (const item of [...a, ...b]) {
    const seen = byId.get(item.id)
    byId.set(item.id, seen ? pick(seen, item) : item)
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

/** Pages, strokes, texts and images per id, newest updatedAt wins, tombstones win ties, other ties go to the greater small-field JSON, then points, then src; pdfId and pdfName from the more recently touched doc. */
export function mergeNotebooks(a: NotesDocV2, b: NotesDocV2): NotesDocV2 {
  const newer = notebookTouched(b) > notebookTouched(a) ? b : a
  return {
    schema: 2,
    kind: 'notes',
    pdfId: newer.pdfId,
    pdfName: newer.pdfName,
    pages: mergeItems(a.pages, b.pages, orderFreeWinner),
    strokes: mergeItems(a.strokes, b.strokes, orderFreeWinner),
    texts: mergeItems(a.texts, b.texts, orderFreeWinner),
    images: mergeItems(a.images, b.images, orderFreeWinner),
  }
}
