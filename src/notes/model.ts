// Schema-2 notebook: fixed pages with z-ordered strokes, text boxes and images, and the schema-1 conversion.
import { compareOrder, orderBetween } from '../lib/order.ts'
import type { ImageBlock, NoteStroke, NotesBackground, NotesDoc, PenStyle, TextBlock } from '../types.ts'

interface Item {
  id: string
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

export type PageTemplate = 'blank' | 'ruled-narrow' | 'ruled-college' | 'ruled-wide' | 'grid' | 'dots'
export type PaperColor = 'white' | 'yellow' | 'dark'

/** Page size in millimetres. */
export interface PageSize {
  w: number
  h: number
}

/** Portrait page sizes in millimetres. */
export const PAGE_SIZES: { a4: PageSize; letter: PageSize; standard: PageSize } = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
  standard: { w: 160.5, h: 207.5 },
}

/** Line or grid spacing in millimetres per template. */
export const TEMPLATE_SPACING_MM: Record<Exclude<PageTemplate, 'blank'>, number> = {
  'ruled-narrow': 6.4,
  'ruled-college': 7.1,
  'ruled-wide': 8.7,
  grid: 5,
  dots: 5,
}

export interface NotePage extends Item {
  order: string
  size: PageSize
  template: PageTemplate
  color: PaperColor
}

/** Object position and width in page-width units. */
export interface ObjectBox {
  x: number
  y: number
  w: number
}

/** Freehand stroke on a page; points are flat [x, y, pressure] in page-width units; width is a fraction of the page width. */
export interface NotebookStroke extends Item {
  page: string
  tool: 'pen' | 'highlighter'
  pen: PenStyle
  color: string
  width: number
  points: number[]
  z: string
}

export interface TextObject extends Item {
  page: string
  box: ObjectBox
  text: string
  size: 's' | 'm' | 'l'
  color: string
  z: string
}

/** Image on a page; `aspect` is height / width; `pdfPage` links a Snip to its PDF page. */
export interface ImageObject extends Item {
  page: string
  box: ObjectBox
  src: string
  aspect: number
  pdfPage?: number
  z: string
}

/** One notes file per PDF in schema 2, stored next to it in Drive as `<name>.marginalia-notes.json`. */
export interface NotesDocV2 {
  schema: 2
  kind: 'notes'
  pdfId: string
  pdfName: string
  pages: NotePage[]
  strokes: NotebookStroke[]
  texts: TextObject[]
  images: ImageObject[]
}

export type PageStyle = Pick<NotePage, 'template' | 'color' | 'size'>

export const FIRST_PAGE_ID = 'page-1'

export function emptyNotebook(pdfId: string, pdfName: string, now: number): NotesDocV2 {
  const page: NotePage = {
    id: FIRST_PAGE_ID, order: orderBetween(null, null), size: { ...PAGE_SIZES.a4 }, template: 'blank', color: 'white', createdAt: now, updatedAt: now,
  }
  return { schema: 2, kind: 'notes', pdfId, pdfName, pages: [page], strokes: [], texts: [], images: [] }
}

export function isNotebookDoc(x: unknown): x is NotesDocV2 {
  if (typeof x !== 'object' || x === null) return false
  const doc = x as Partial<NotesDocV2>
  return doc.kind === 'notes' && doc.schema === 2 && [doc.pages, doc.strokes, doc.texts, doc.images].every(Array.isArray)
}

const CONVERT_ASPECT = PAGE_SIZES.a4.h / PAGE_SIZES.a4.w
const CONVERT_MARGIN = 0.08
const CONVERT_WIDTH = 0.84
const CONVERT_LINE = 0.032
const CONVERT_GAP = 0.016
const CONVERT_CHARS_PER_LINE = 70
const CONVERT_TEXT_COLOR = '#1c1c1a'

const TEMPLATE_OF: Record<NotesBackground, PageTemplate> = { lines: 'ruled-college', grid: 'grid', dots: 'dots', blank: 'blank' }

const pageId = (index: number) => `page-${index + 1}`

// Copies id, times and tombstone of a schema-1 item.
function itemOf(x: Item): Item {
  return { id: x.id, createdAt: x.createdAt, updatedAt: x.updatedAt, ...(x.deleted ? { deleted: true } : {}) }
}

// The A4 page index a schema-1 stroke falls on, by the middle of its y-range.
function strokePage(s: NoteStroke): number {
  const ys = s.points.filter((_, i) => i % 3 === 1)
  const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0
  return Math.max(0, Math.floor(cy / CONVERT_ASPECT))
}

type Converted =
  | { kind: 'strokes'; item: Omit<NotebookStroke, 'z'> }
  | { kind: 'texts'; item: Omit<TextObject, 'z'> }
  | { kind: 'images'; item: Omit<ImageObject, 'z'> }

// A schema-1 stroke moved onto its page, without its z.
function convertStroke(s: NoteStroke): Converted {
  const index = strokePage(s)
  const top = index * CONVERT_ASPECT
  const points = s.points.map((v, i) => (i % 3 === 1 ? v - top : v))
  return { kind: 'strokes', item: { ...itemOf(s), page: pageId(index), tool: 'pen', pen: 'fountain', color: s.color, width: s.width, points } }
}

// Height of a text block in page-width units at the given line height.
function textHeight(text: string, line: number): number {
  return line * text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / CONVERT_CHARS_PER_LINE)), 0)
}

// Stacks live blocks from the top of page 1, moving one that would pass the bottom margin to the next page; tombstones sit at the top of page 1.
function stackBlocks(blocks: (TextBlock | ImageBlock)[]): { blocks: Converted[]; pages: number } {
  const out: Converted[] = []
  let page = 0
  let y = CONVERT_MARGIN
  let sawText = false
  for (const block of blocks) {
    const w = block.kind === 'text' ? CONVERT_WIDTH : Math.min(block.w, CONVERT_WIDTH)
    const size = block.kind === 'text' && !sawText && !block.deleted ? 'l' : 'm'
    let at = { page: 0, y: CONVERT_MARGIN }
    if (!block.deleted) {
      const h = block.kind === 'text' ? textHeight(block.text, size === 'l' ? (CONVERT_LINE * 18) / 13 : CONVERT_LINE) : w * block.aspect
      if (y > CONVERT_MARGIN && y + h > CONVERT_ASPECT - CONVERT_MARGIN) {
        page++
        y = CONVERT_MARGIN
      }
      at = { page, y }
      y += h + CONVERT_GAP
      sawText ||= block.kind === 'text'
    }
    const base = { ...itemOf(block), page: pageId(at.page), box: { x: CONVERT_MARGIN, y: at.y, w } }
    out.push(
      block.kind === 'text'
        ? { kind: 'texts', item: { ...base, text: block.text, size, color: CONVERT_TEXT_COLOR } }
        : { kind: 'images', item: { ...base, src: block.src, aspect: block.aspect, ...(block.page !== undefined ? { pdfPage: block.page } : {}) } },
    )
  }
  return { blocks: out, pages: page + 1 }
}

/** Converts schema-1 notes to A4 pages; the same input always gives the same output. */
export function convertV1(doc: NotesDoc): NotesDocV2 {
  const objects = stackBlocks([...doc.blocks].filter((b) => b.kind === 'image' || b.text.trim()).sort(compareOrder))
  const strokes = [...doc.strokes].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const count = Math.max(1, objects.pages, ...strokes.filter((s) => !s.deleted).map((s) => strokePage(s) + 1))
  const pages: NotePage[] = []
  for (let i = 0, order: string | null = null; i < count; i++) {
    order = orderBetween(order, null)
    pages.push({ id: pageId(i), order, size: { ...PAGE_SIZES.a4 }, template: TEMPLATE_OF[doc.background] ?? 'blank', color: 'white', createdAt: 0, updatedAt: 0 })
  }

  const out: NotesDocV2 = { schema: 2, kind: 'notes', pdfId: doc.pdfId, pdfName: doc.pdfName, pages, strokes: [], texts: [], images: [] }
  const items = [...objects.blocks, ...strokes.map(convertStroke)]
  const lastZ = new Map<string, string>()
  for (const { kind, item } of [...items.filter((c) => !c.item.deleted), ...items.filter((c) => c.item.deleted)]) {
    const z = orderBetween(lastZ.get(item.page) ?? null, null)
    lastZ.set(item.page, z)
    if (kind === 'strokes') out.strokes.push({ ...item, z })
    else if (kind === 'texts') out.texts.push({ ...item, z })
    else out.images.push({ ...item, z })
  }
  return out
}

/** Live items of one page, each kind sorted by z. */
export interface PageContent {
  strokes: NotebookStroke[]
  texts: TextObject[]
  images: ImageObject[]
}

export type PageLayer = { kind: 'ink'; strokes: NotebookStroke[] } | { kind: 'text'; item: TextObject } | { kind: 'image'; item: ImageObject }

/** Sorts by z key with plain code-unit comparison, then by id. */
export function compareZ(x: { z: string; id: string }, y: { z: string; id: string }): number {
  return compareOrder({ order: x.z, id: x.id }, { order: y.z, id: y.id })
}

/** All items of a page by z; consecutive strokes form one ink layer. */
export function pageLayers(content: PageContent): PageLayer[] {
  const items = [
    ...content.strokes.map((item) => ({ kind: 'ink' as const, item })),
    ...content.texts.map((item) => ({ kind: 'text' as const, item })),
    ...content.images.map((item) => ({ kind: 'image' as const, item })),
  ].sort((a, b) => compareZ(a.item, b.item))
  const layers: PageLayer[] = []
  for (const entry of items) {
    const last = layers[layers.length - 1]
    if (entry.kind !== 'ink') layers.push(entry)
    else if (last?.kind === 'ink') last.strokes.push(entry.item)
    else layers.push({ kind: 'ink', strokes: [entry.item] })
  }
  return layers
}
