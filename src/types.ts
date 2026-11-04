// Shared domain types. Every module imports from here; nothing here imports from a module.

/** Rectangle normalised to the unrotated page: x, y, w, h in [0, 1]; origin top-left. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink'

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['yellow', 'green', 'blue', 'pink']

interface Item {
  id: string
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

/** Text highlight: one or more line boxes over the text layer. */
export interface TextHighlight extends Item {
  kind: 'text'
  page: number
  color: HighlightColor
  boxes: Box[]
  text: string
  note?: string
}

/** Area highlight: one rectangle over anything (equation, figure, table). */
export interface AreaHighlight extends Item {
  kind: 'area'
  page: number
  color: HighlightColor
  box: Box
  note?: string
}

export type Highlight = TextHighlight | AreaHighlight

/** Freehand stroke; points are flat [x, y, pressure, ...] normalised to the page. */
export interface InkStroke extends Item {
  kind: 'ink'
  page: number
  color: string
  /** Stroke width as a fraction of page width. */
  width: number
  tool: 'pen' | 'marker'
  points: number[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

/** What a thread is about: boxes on a page, the selected text if any, and the highlight it came from. */
export interface Anchor {
  page: number
  boxes: Box[]
  text?: string
  highlightId?: string
}

export interface Thread extends Item {
  kind: 'thread'
  anchor: Anchor
  model: string
  messages: ChatMessage[]
}

export type ReadStatus = 'unread' | 'reading' | 'done'

export interface ReadingState {
  page: number
  /** Scroll offset within the page as a fraction of page height. */
  offset: number
  zoom: number
  status: ReadStatus
  /** Per-paper horizontal crop on phones: fraction trimmed from left/right. */
  crop?: { left: number; right: number }
  updatedAt: number
}

/** One sidecar JSON per PDF, stored next to it in Drive as `<name>.marginalia.json`. */
export interface Sidecar {
  schema: 1
  pdfId: string
  pdfName: string
  highlights: Highlight[]
  inks: InkStroke[]
  threads: Thread[]
  reading: ReadingState
  colorLabels?: Partial<Record<HighlightColor, string>>
}

export type Annotation = Highlight | InkStroke | Thread

export function emptySidecar(pdfId: string, pdfName: string, now: number): Sidecar {
  return {
    schema: 1,
    pdfId,
    pdfName,
    highlights: [],
    inks: [],
    threads: [],
    reading: { page: 1, offset: 0, zoom: 0, status: 'unread', updatedAt: now },
  }
}

/** A file or folder as the Drive API describes it; only the fields the app uses. */
export interface DriveNode {
  id: string
  name: string
  mimeType: string
  parents: string[]
  modifiedTime: string
  version: string
  size?: number
  md5Checksum?: string
  appProperties?: Record<string, string>
}

export type HomeArtSlot = 'landscape' | 'portrait' | 'generic'

export type HomeArtFiles = Partial<Record<HomeArtSlot, DriveNode>>

export const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const PDF_MIME = 'application/pdf'

/** The mirrored Drive folder tree, persisted in IndexedDB. */
export interface LibraryIndex {
  rootId: string
  rootName: string
  folders: Record<string, DriveNode>
  papers: Record<string, DriveNode>
  /** Sidecar node keyed by the PDF file id it belongs to. */
  sidecars: Record<string, DriveNode>
  /** Notes file node keyed by the PDF file id it belongs to. */
  notes?: Record<string, DriveNode>
  /** Home pictures found in the root folder, by slot. */
  homeArt?: HomeArtFiles
  syncedAt: number
  changesToken?: string
}

export interface Settings {
  googleClientId: string
  anthropicApiKey: string
  textModel: string
  visionModel: string
  nightMode: boolean
  invertImages: boolean
  fingerDraws: boolean
}

/** A page's text as lines grouped into columns, for selection clamping, snapping and LLM context. */
export interface TextLine {
  text: string
  box: Box
  column: number
}

export interface PageText {
  page: number
  lines: TextLine[]
  /** columns[0] is the box around all text (full-width lines are column 0); columns[1..] are the real columns left to right. */
  columns: Box[]
  /** Plain text in reading order with paragraph breaks. */
  text: string
}

// Notes

export type NotesBackground = 'blank' | 'grid' | 'dots' | 'lines'

/** Plain-text paragraph on the notes sheet. */
export interface TextBlock extends Item {
  kind: 'text'
  order: string
  text: string
}

/** Image on the notes sheet; `w` is its width as a fraction of the sheet width, `aspect` is height / width; `page` links a Snip to its page. */
export interface ImageBlock extends Item {
  kind: 'image'
  order: string
  src: string
  w: number
  aspect: number
  page?: number
}

export type NoteBlock = TextBlock | ImageBlock

/** Freehand stroke on the notes sheet; points are flat [x, y, pressure] with x and y divided by the sheet width; width is a fraction of the sheet width. */
export interface NoteStroke extends Item {
  kind: 'ink'
  color: string
  width: number
  points: number[]
}

/** One notes file per PDF, stored next to it in Drive as `<name>.marginalia-notes.json`. */
export interface NotesDoc {
  schema: 1
  kind: 'notes'
  pdfId: string
  pdfName: string
  blocks: NoteBlock[]
  strokes: NoteStroke[]
  background: NotesBackground
  backgroundUpdatedAt: number
}

export function emptyNotes(pdfId: string, pdfName: string, now: number): NotesDoc {
  return { schema: 1, kind: 'notes', pdfId, pdfName, blocks: [], strokes: [], background: 'blank', backgroundUpdatedAt: now }
}

export function isNotesDoc(x: unknown): x is NotesDoc {
  if (typeof x !== 'object' || x === null) return false
  const doc = x as Partial<NotesDoc>
  return doc.kind === 'notes' && doc.schema === 1 && Array.isArray(doc.blocks) && Array.isArray(doc.strokes)
}
