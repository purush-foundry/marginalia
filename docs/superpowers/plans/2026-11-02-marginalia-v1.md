# Marginalia v1 — implementation plan

Spec: `docs/superpowers/specs/2026-11-02-marginalia-design.md` (binding authority).
Research the spec draws on: product findings and technical findings are summarised in the
spec; where this plan quotes a platform fact it comes from those reports.

Tasks 1–5 are independent modules built in parallel on separate branches/worktrees. Task 6
integrates them into the app shell. Task 7 is the final review and deploy.

## Global Constraints

- Stack: TypeScript, Vite 8, Preact 11, `@preact/signals` 2, `pdfjs-dist` 6.5.438,
  `perfect-freehand` 1.2.3. **No new dependencies.** Tests: vitest + happy-dom.
- Checks before every commit: `npx tsc -b && npx vitest run && npm run build` all clean.
  Node is at `~/.local/node/bin` (`export PATH="$HOME/.local/node/bin:$PATH"`).
- Shared types are `src/types.ts`; import from there. Extending a shared type is allowed only
  when the module cannot work otherwise, and must be called out in the report.
- Every annotation box/point is normalised to the unrotated page (`Box`: x, y, w, h in [0, 1],
  origin top-left). Pages are 1-based.
- Tool state belongs to the input, never to the document: finger and mouse never enter a
  highlighter mode; the Pencil owns pen/eraser/select; finger never draws unless the
  `fingerDraws` preference is on.
- Secrets (Anthropic key, Drive token) live only in IndexedDB; never in URLs, logs, sidecars
  or source.
- Drive scopes exactly: `https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file`.
- Sidecar name: `<pdf name without .pdf>.marginalia.json`, same parent folder as the PDF,
  `appProperties: { marginalia: "1", pdf: <pdfFileId> }`.
- Comments: one line, what the code does; no dates, history, measured constants or
  justifications.
- Module boundaries: `src/drive` (Task 1), `src/pdf` + `src/annot/selection.ts` +
  `src/annot/HighlightLayer.tsx` + `src/annot/SelectionBar.tsx` (Task 2), `src/ink` (Task 3),
  `src/ai` (Task 4), `src/annot/store.ts` + `src/export` (Task 5), `src/app` + `src/library` +
  PWA files (Task 6). A task edits only its own files plus its tests.
- Touch targets ≥ 44 px. Everything must work with mouse, touch and pen.
- Keep it light: no framework beyond Preact, no CSS framework, no icon fonts (inline SVG).

## File layout

```
src/
  main.tsx, config.ts, types.ts
  lib/ids.ts, lib/idb.ts
  app/App.tsx, app/theme.css, app/state.ts, app/settings.ts, app/Settings.tsx, app/Reader.tsx, app/Toolbar.tsx, app/Sidebar.tsx
  library/Library.tsx
  drive/auth.ts, drive/api.ts, drive/library.ts, drive/merge.ts
  pdf/document.ts, pdf/text.ts, pdf/Viewer.tsx, pdf/PageView.tsx, pdf/viewer.css
  annot/selection.ts, annot/HighlightLayer.tsx, annot/SelectionBar.tsx, annot/store.ts
  ink/tools.ts, ink/InkLayer.tsx, ink/geometry.ts
  ai/claude.ts, ai/context.ts, ai/AskPanel.tsx, ai/markdown.ts
  export/markdown.ts
  sw.ts
public/manifest.webmanifest, public/icons/*
```

---

### Task 1: Drive — auth, API, library mirror, PDF cache, sidecar sync

**Branch:** `feat/drive`. **Files:** `src/lib/idb.ts`, `src/drive/auth.ts`, `src/drive/api.ts`,
`src/drive/library.ts`, `src/drive/merge.ts`, tests beside them.

**`src/lib/idb.ts`** — a ~60-line IndexedDB key-value helper used by every module. Database
`marginalia`, version 1, object stores: `files` (PDF blobs; key `<fileId>`; value
`{ version: string, blob: Blob, size: number, openedAt: number }`), `sidecars` (key pdfId; value
`{ sidecar: Sidecar, remoteVersion?: string, dirty: boolean }`), `settings` (key `'settings'`),
`meta` (library index under `'library'`, auth token under `'token'`), `queue` (pending sidecar
uploads keyed by pdfId).

```ts
export type StoreName = 'files' | 'sidecars' | 'settings' | 'meta' | 'queue'
export function idbGet<T>(store: StoreName, key: string): Promise<T | undefined>
export function idbSet(store: StoreName, key: string, value: unknown): Promise<void>
export function idbDel(store: StoreName, key: string): Promise<void>
export function idbKeys(store: StoreName): Promise<string[]>
export function idbGetAll<T>(store: StoreName): Promise<Array<{ key: string; value: T }>>
```

**`src/drive/auth.ts`** — Google Identity Services token model.

```ts
export interface AuthState { status: 'signed-out' | 'ok' | 'expired'; expiresAt?: number }
export const authState: Signal<AuthState>
/** Loads https://accounts.google.com/gsi/client (tolerates offline), restores a cached token. */
export function initAuth(clientId: string): Promise<void>
/** Must run inside a user gesture: opens the GIS popup; on `popup_failed_to_open` falls back to the implicit redirect flow. */
export function connect(): Promise<void>
export function getAccessToken(): string | null
/** Call on any user gesture; renews silently (prompt: '') when less than TOKEN_RENEW_MARGIN_MS remains. */
export function maybeRenew(): void
export function signOut(): Promise<void>
/** Handles the `#access_token=` fragment after a redirect-flow return; returns true if one was consumed. */
export function consumeRedirectToken(): boolean
```

Token `{ accessToken, expiresAt }` is kept in memory and mirrored to `meta/token`. Scopes from
`config.ts`. `initTokenClient({ client_id, scope, prompt: '', callback, error_callback })`.
The redirect fallback navigates to
`https://accounts.google.com/o/oauth2/v2/auth?response_type=token&client_id=…&redirect_uri=<location.origin + import.meta.env.BASE_URL>&scope=…&prompt=none&include_granted_scopes=true&state=<random>`;
`consumeRedirectToken()` validates `state` (stored in sessionStorage) and strips the fragment.
Expose a `gisAvailable: Signal<boolean>` so the UI can say "offline" instead of failing.

**`src/drive/api.ts`** — thin REST layer over `fetch` with `Authorization: Bearer`, JSON
errors mapped to `DriveError { status, reason }`. 401 → sets `authState` to `expired` and
throws. 403 `userRateLimitExceeded` / 429 → retry with exponential backoff (max 3). Field mask
for nodes: `id,name,mimeType,parents,modifiedTime,version,size,md5Checksum,appProperties`.

```ts
export class DriveError extends Error { status: number; reason?: string }
export function listChildren(parentIds: string[]): Promise<DriveNode[]>   // batches up to 20 parents per call with `or`, follows nextPageToken, excludes trashed
export function listMyDriveFolders(): Promise<DriveNode[]>                 // `'root' in parents and mimeType = folder`, for the first-run root picker
export function getNode(id: string): Promise<DriveNode>
export function downloadFile(id: string): Promise<Blob>                    // alt=media
export function downloadJson<T>(id: string): Promise<T>
export function createJsonFile(name: string, parentId: string, body: unknown, appProperties: Record<string, string>): Promise<DriveNode>  // multipart POST
export function updateJsonFile(id: string, body: unknown): Promise<DriveNode>  // PATCH uploadType=media, returns fields
export function getStartPageToken(): Promise<string>
export function listChanges(pageToken: string): Promise<{ changes: Array<{ fileId: string; removed: boolean; file?: DriveNode & { trashed?: boolean } }>; newStartPageToken?: string; nextPageToken?: string }>
```

**`src/drive/merge.ts`** — pure.

```ts
/** Per item by id, newest updatedAt wins, tombstones win ties; reading state newest wins; colorLabels union (newer sidecar's labels win). */
export function mergeSidecars(a: Sidecar, b: Sidecar): Sidecar
```

**`src/drive/library.ts`** — the mirror and the caches.

```ts
export const library: Signal<LibraryIndex | null>
export const syncState: Signal<{ status: 'idle' | 'syncing' | 'offline' | 'error'; message?: string; at?: number }>
export function loadLibrary(): Promise<void>                       // from meta/library
export function setRootFolder(node: DriveNode): Promise<void>      // resets the index, then syncLibrary()
export function syncLibrary(): Promise<void>                       // changes.list when a token exists, else full walk; never throws (sets syncState)
export function startAutoSync(): () => void                        // on call, on visibilitychange→visible, every LIBRARY_SYNC_INTERVAL_MS while visible
export function childrenOf(folderId: string): { folders: DriveNode[]; papers: DriveNode[] }  // sorted: folders then papers, by name
export function pathTo(nodeId: string): DriveNode[]                 // breadcrumbs from root
export function isCached(pdfId: string): Promise<boolean>
export function getPdfBlob(pdfId: string, onProgress?: (frac: number) => void): Promise<Blob>  // cache hit (same version) or download; updates openedAt; evicts LRU above PDF_CACHE_LIMIT_BYTES
export function loadSidecar(pdfId: string): Promise<Sidecar>        // local copy or emptySidecar()
export function saveSidecar(pdfId: string, sidecar: Sidecar): void  // debounced SIDECAR_SAVE_DEBOUNCE_MS: write idb (dirty) + queue
export function refreshSidecar(pdfId: string): Promise<Sidecar | null>  // if remote version differs from stored remoteVersion: download, merge with local, store, return merged; else null
export function flushQueue(): Promise<void>                         // for each queued pdfId: if remote moved, download+merge; then create or update the sidecar file; clear dirty on success; keep queued on failure
export function sidecarNameFor(pdfName: string): string
```

Full walk: BFS from root using `listChildren` over batches of parents; keep only folders, PDFs
and sidecars (`name.endsWith(SIDECAR_SUFFIX)` or `appProperties.marginalia === '1'`); map a
sidecar to its PDF by `appProperties.pdf`, else by name + same parent. Changes path: filter
changes to known folder ids as parents; unknown parent → ignore; `removed`/`trashed` → delete
from index; new folder under a known folder → walk it. `syncLibrary()` calls `flushQueue()`
at the end when a token exists.

**Tests (vitest, mocked `fetch` + the real happy-dom IndexedDB — if happy-dom lacks IndexedDB,
implement an in-memory fallback inside `idb.ts` used when `indexedDB` is undefined and say so):**
`merge.test.ts` (newest wins, tombstones, reading state, labels), `api.test.ts` (request shapes:
query string, field mask, multipart body, PATCH media; 401 sets expired; 429 retries),
`library.test.ts` (full walk builds tree with sidecar mapping; changes removal; childrenOf sort
order; flushQueue creates then updates; refreshSidecar merges when version moved; LRU eviction).

**Done when:** all above exported with those signatures, tests pass, `npx tsc -b` clean, no
UI code in this task.

---

### Task 2: PDF viewer — document, text/columns, virtualised pages, selection → highlights

**Branch:** `feat/viewer`. **Files:** `src/pdf/document.ts`, `src/pdf/text.ts`,
`src/pdf/Viewer.tsx`, `src/pdf/PageView.tsx`, `src/pdf/viewer.css`, `src/annot/selection.ts`,
`src/annot/HighlightLayer.tsx`, `src/annot/SelectionBar.tsx`, tests.

**`src/pdf/document.ts`**

```ts
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
export interface OutlineItem { title: string; page: number | null; items: OutlineItem[] }
export interface PageLink { box: Box; page?: number; url?: string }
export interface PdfDoc {
  numPages: number
  title: string | null
  pageSize(page: number): { w: number; h: number }          // unrotated points, known for all pages after open
  getPage(page: number): Promise<PDFPageProxy>
  getOutline(): Promise<OutlineItem[]>
  getPageText(page: number): Promise<PageText>               // cached per page
  getLinks(page: number): Promise<PageLink[]>                // Link annotations with internal destinations resolved to page numbers
  renderCrop(page: number, box: Box, maxEdgePx: number): Promise<{ blob: Blob; mediaType: 'image/png' }>
  destroy(): void
}
export function openPdf(data: ArrayBuffer | Blob): Promise<PdfDoc>
```

Worker: `GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()`.
`getDocument({ data, isEvalSupported: false, disableAutoFetch: false })`. `pageSize` comes from
`page.view` for every page at open (cheap `getPage` loop with a concurrency of 4; or
`getPageSizes` approach via `page.getViewport({scale:1})`).

**`src/pdf/text.ts`** — pure, tested on the fixture through pdf.js in node (the legacy build
`pdfjs-dist/legacy/build/pdf.mjs` works in Node without canvas for `getTextContent`).

```ts
/** Groups text items into lines (same baseline ±, sorted by x), clusters lines into columns by x-overlap, orders reading order column-major, joins text with hyphenation/ligature fixes. */
export function buildPageText(page: number, items: TextItem[], viewportW: number, viewportH: number): PageText
export function columnAt(pageText: PageText, box: Box): number
export function linesIntersecting(pageText: PageText, box: Box): TextLine[]
```

Column clustering: lines whose x-ranges overlap > 50 % belong to the same column; a line
spanning > 70 % of the page width is "full width" (column 0) and does not merge columns.
Expected on `attention.pdf` page 2: two columns; page 1: full-width title/abstract plus two
columns.

**`src/pdf/Viewer.tsx`** — continuous vertical scroll of all pages, virtualised.

```ts
export interface ViewerHandle {
  scrollTo(page: number, box?: Box, behavior?: 'smooth' | 'auto'): void
  currentPage: ReadonlySignal<number>
  scale: ReadonlySignal<number>           // CSS px per PDF point
  setZoom(mode: 'fit-width' | number): void
  pageElement(page: number): HTMLElement | null
  getReadingPosition(): { page: number; offset: number }
}
export interface PendingSelection { page: number; boxes: Box[]; text: string; endRect: DOMRect; kind: 'text' | 'area' }
export interface ViewerProps {
  doc: PdfDoc
  highlights: ReadonlySignal<Highlight[]>
  crop?: { left: number; right: number }
  nightMode: boolean
  invertImages: boolean
  initial?: { page: number; offset: number; zoom: number }
  areaSelectArmed: ReadonlySignal<boolean>      // toolbar "area" button; also long-press on non-text starts an area drag on touch
  pageOverlay?: (page: number, cssW: number, cssH: number) => ComponentChildren   // slot for the ink layer, rendered above the text layer
  onSelection(sel: PendingSelection | null): void
  onTapHighlight(id: string, rect: DOMRect): void
  onLink(link: PageLink): void
  onReadingPosition(pos: { page: number; offset: number; zoom: number }): void    // throttled
  handle: (h: ViewerHandle) => void
}
```

Behaviour: one placeholder div per page sized from `pageSize × scale`; render canvas + text
layer only for visible pages ± 1 (IntersectionObserver), cancel in-flight renders on scroll,
free canvases off-screen (`width = height = 0`); cap canvas pixels at 5 MP on iOS
(`OutputScale.limitCanvas` pattern) and `devicePixelRatio` otherwise. Text layer via
`new TextLayer({ textContentSource, container, viewport })` with the `.textLayer` CSS rules
copied from `pdfjs-dist/web/pdf_viewer.css` into `viewer.css`. Zoom: ctrl/⌘ + wheel and
two-finger pinch (own implementation: CSS transform during the gesture, re-render at the new
scale on end; scroller has `touch-action: pan-x pan-y`); fit-width default; `crop` trims the
page horizontally by translating the canvas inside a clipped wrapper. Night mode: a CSS filter
`invert(1) hue-rotate(180deg)` on the page canvas, and when `invertImages` is false the same
filter is applied again to image regions… simplest acceptable v1: night mode inverts the whole
canvas; `invertImages=false` is honoured by rendering the page a second time with
`page.getOperatorList()` image masks is out of scope → implement as: whole-canvas invert, plus
a per-page "image regions" list from `page.getOperatorList()` (`OPS.paintImageXObject`
transforms) drawn as un-inverted rectangles only when cheap; if not achievable in the task,
report it and ship whole-canvas invert.

Selection: listen to `selectionchange` (debounced 80 ms) and `pointerup`; convert with
`selectionToBoxes` (below); call `onSelection` with the end rect (last client rect) so the bar
appears where the drag ended; clear with `null` when the selection collapses. Area select:
when `areaSelectArmed` or on touch long-press (500 ms, pointer moved < 8 px) over the page
outside text spans, drag a rectangle (`touch-action: none` only during the drag), emit a
`kind: 'area'` selection. Links: render `PageLink`s as absolutely positioned transparent
buttons over the page; `onLink` on tap. Double-tap on touch: zoom to the column under the tap
(`columnAt`), double-tap again → fit-width. Reading position throttled to 500 ms. Restore
`initial` on first layout.

**`src/annot/selection.ts`** — pure given DOM rects.

```ts
/** Client rects of the selection within one text layer → page-normalised boxes merged per line and clamped to the column the selection started in; null when the selection has no text in this layer. */
export function selectionToBoxes(range: Range, textLayer: HTMLElement, pageText: PageText): { boxes: Box[]; text: string } | null
```

**`src/annot/HighlightLayer.tsx`** — `<svg>` over the page: rects for `boxes`/`box` filled with
`var(--hl-<color>)`, `mix-blend-mode: multiply`, `pointer-events: all` on rects only; tapping a
rect calls `onTap(id, rect.getBoundingClientRect())`. Area highlights are drawn as a stroked
+ lightly filled rect.

**`src/annot/SelectionBar.tsx`** — floating bar positioned near `anchorRect` (above it, flipped
below when there is no room, clamped to the viewport), 44 px targets:

```ts
export interface SelectionBarProps {
  anchorRect: DOMRect
  current?: Highlight              // when opened from an existing highlight
  onColor(color: HighlightColor): void
  onAsk(): void
  onNote(): void
  onCopy?(): void
  onDelete?(): void
  onDismiss(): void
}
```

**Tests:** `text.test.ts` on the fixture (columns on p.1/p.2, reading order, hyphen join),
`selection.test.ts` with synthetic rects (merge per line, clamp to column), `document.test.ts`
(numPages=15, pageSize, outline/links resolve to page numbers, getPageText caches),
a `SelectionBar.test.tsx` render test (buttons present, flips when near the top).
Viewer/PageView are verified by `npm run build` + a `src/pdf/dev.tsx` story is NOT required.

**Done when:** exports match, tests pass, `tsc -b` + build clean.

---

### Task 3: Ink — pen/eraser overlay with Apple Pencil support

**Branch:** `feat/ink`. **Files:** `src/ink/tools.ts`, `src/ink/geometry.ts`, `src/ink/InkLayer.tsx`,
`src/ink/ink.css`, tests.

**`src/ink/tools.ts`**

```ts
export type PenTool = 'pen' | 'eraser' | 'select'
export const penTool: Signal<PenTool>            // default 'pen'
export const penColor: Signal<string>            // default '#d33a2c'
export const penWidth: Signal<number>            // fraction of page width, default 0.004
export const mouseDraws: Signal<boolean>         // laptop "Draw" latch, default false
export const fingerDraws: Signal<boolean>        // preference, default false
```

**`src/ink/geometry.ts`** — pure.

```ts
export function strokeOutlinePath(points: number[], widthPx: number, pressureIsReal: boolean): string   // perfect-freehand getStroke → SVG path d
export function strokeHitsPoint(points: number[], x: number, y: number, radius: number): boolean         // any segment within radius (normalised units)
export function simplifyPoints(points: number[], tolerance: number): number[]                             // drop near-duplicate samples
```

**`src/ink/InkLayer.tsx`**

```ts
export interface InkLayerProps {
  page: number
  cssW: number
  cssH: number
  strokes: InkStroke[]                       // this page only
  onAddStroke(stroke: InkStroke): void
  onEraseStroke(id: string): void
}
```

Rendering: one `<svg>` sized to the page for committed strokes (paths from `strokeOutlinePath`
scaled by `cssW`) plus a `<canvas>` for the live stroke (cheap polyline while drawing). Pointer
handling on the layer root:

- `pointerType === 'pen'`: always draws (tool `pen`) or erases (tool `eraser`); `select` lets
  events through to the text layer (the layer sets `pointer-events: none` while tool is
  `select`, so text selection with the Pencil works).
- `pointerType === 'mouse'`: draws/erases only when `mouseDraws` is true; otherwise
  `pointer-events: none`.
- `pointerType === 'touch'`: ignored unless `fingerDraws`; while a pen pointer is down, or for
  500 ms after it lifts, touch pointers are ignored (palm rejection).
- Scribble/pan guard: non-passive `touchstart`/`touchmove` listeners that `preventDefault()`
  only when a touch has `touchType === 'stylus'` (so finger scrolling keeps working). CSS
  `touch-action: pan-x pan-y` normally, `none` when `fingerDraws`. `-webkit-user-select: none`,
  `-webkit-touch-callout: none` on the layer.
- Use `getCoalescedEvents()` when available; record `[x/cssW, y/cssH, pressure]`; pressure is
  real for pen (`simulatePressure: false`), simulated for mouse/finger.
- `setPointerCapture` on down; `pointercancel` discards the live stroke.
- Eraser: on move, any stroke hit within `max(penWidth*3, 12px/cssW)` → `onEraseStroke(id)` once.
- A stroke is committed on `pointerup` via `onAddStroke({ kind:'ink', id, page, color, width, tool:'pen', points, createdAt, updatedAt })`.
- Two-finger double-tap → dispatches a `CustomEvent('marginalia:undo')` on `document`.

**Tests:** `geometry.test.ts` (outline path non-empty and scales, hit test true/false, simplify
keeps endpoints), `InkLayer.test.tsx` with synthetic `PointerEvent`s (pen down/move/up commits a
stroke with normalised points; touch is ignored by default; touch ignored within 500 ms after
pen up; eraser calls `onEraseStroke`; mouse draws only when `mouseDraws`).

**Done when:** exports match, tests pass, `tsc -b` + build clean.

---

### Task 4: Ask Claude — client, context builder, panel

**Branch:** `feat/ai`. **Files:** `src/ai/claude.ts`, `src/ai/context.ts`, `src/ai/markdown.ts`,
`src/ai/AskPanel.tsx`, `src/ai/ask.css`, tests. **Before writing any code, invoke the
`claude-api` skill** and follow it for request format, headers, streaming events and model ids.

**`src/ai/claude.ts`** — plain `fetch` (no SDK), streaming.

```ts
export type ContentBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } }
export interface ApiMessage { role: 'user' | 'assistant'; content: string | ContentBlock[] }
export interface StreamOptions { apiKey: string; model: string; system: string; messages: ApiMessage[]; maxTokens?: number; signal?: AbortSignal }
export class ClaudeError extends Error { status?: number; type?: string }
/** Yields text deltas; throws ClaudeError on HTTP/stream errors; resolves when message_stop arrives. Sets stopReason on the returned iterator's final value. */
export function streamMessage(opts: StreamOptions): AsyncGenerator<string, { stopReason: string | null }, void>
export function checkApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }>   // cheapest possible request
```

Headers: `x-api-key`, `anthropic-version`, `anthropic-dangerous-direct-browser-access: true`,
`content-type: application/json`. Parse SSE with `getReader()` (Safari-safe), handle
`content_block_delta` text deltas, `message_delta.stop_reason`, `error` events, `overloaded`
→ one retry after 2 s.

**`src/ai/context.ts`** — pure.

```ts
export type Preset = 'explain' | 'define' | 'math' | 'why'
export const PRESET_LABELS: Record<Preset, string>   // 'Explain', 'Define here', 'Unpack the maths', 'Why does it matter'
export interface AskInput {
  paperTitle: string | null
  anchor: Anchor
  pageText: PageText                                   // the anchor page
  crop?: { mediaType: 'image/png'; dataBase64: string } // for area anchors
  history: ChatMessage[]                               // prior turns in the thread
  question: string                                     // free text or presetQuestion(preset)
}
export function presetQuestion(preset: Preset, anchor: Anchor): string
export function buildRequest(input: AskInput): { system: string; messages: ApiMessage[]; summary: { words: number; page: number; hasImage: boolean } }
export interface Citation { quote: string; page: number }
/** Finds `"…" (p. N)` citations in an answer. */
export function extractCitations(answer: string): Citation[]
```

System prompt requirements: the assistant is reading this paper with the user; answer about
the selected passage in the context of the page text provided; quote supporting passages
verbatim in the form `"…" (p. N)`; if the answer is not supported by the provided text say so
plainly; be concise; use plain Markdown. The user turn contains: the page text with the
selected passage marked between `<<` `>>`, the image block when present, then the question.
History turns are appended as plain text/assistant messages before the new question.

**`src/ai/markdown.ts`** — tiny renderer: paragraphs, `**bold**`, `*italic*`, inline code,
fenced code, `-`/`1.` lists, headings; returns Preact nodes; `"…" (p. N)` citations become
`<button class="cite">` elements that call an `onCite(page, quote)` callback. No HTML
injection (never `dangerouslySetInnerHTML`).

**`src/ai/AskPanel.tsx`**

```ts
export interface AskPanelProps {
  thread: Thread                                   // new (empty messages) or existing
  paperTitle: string | null
  apiKey: string                                   // '' → show "Add your Claude key in Settings" with onOpenSettings
  textModel: string
  visionModel: string
  getPageText(page: number): Promise<PageText>
  getCrop(page: number, box: Box): Promise<{ mediaType: 'image/png'; dataBase64: string }>
  onThreadChange(thread: Thread): void             // after every completed or aborted turn
  onCite(page: number, quote: string): void
  onOpenSettings(): void
  onClose(): void
}
```

UI: header with the anchor excerpt (first ~120 chars or "Area on p.N" with a thumbnail from
`getCrop`), a "Smart" toggle (uses `visionModel`; auto-on for area anchors), the four preset
chips when the thread is empty, the message list (user bubbles plain, assistant via
`markdown.ts`), the status line "Sending N words from p.X (+ image)" while a request runs,
a Stop button, an input with Send (Enter sends, Shift+Enter newline), error line on failure
with Retry. Streaming updates the last assistant message in place. Refusal
(`stop_reason === 'refusal'`) shows a neutral note. Panel is layout-agnostic (fills its
container); the shell decides side panel vs bottom sheet.

**Tests:** `claude.test.ts` with a mocked `fetch` returning an SSE `ReadableStream` (deltas
concatenate, stop reason captured, 401 → ClaudeError with status, abort stops),
`context.test.ts` (marking of the selection in page text, image block present for area
anchors, history order, `extractCitations`), `markdown.test.tsx` (bold/list/code render, cite
buttons fire), `AskPanel.test.tsx` (missing key state, preset chip sends a request and the
streamed answer appears, onThreadChange called with both turns).

**Done when:** exports match, tests pass, `tsc -b` + build clean, no secrets logged.

---

### Task 5: Annotation store, undo/redo, Markdown export

**Branch:** `feat/store`. **Files:** `src/annot/store.ts`, `src/export/markdown.ts`, tests.

**`src/annot/store.ts`**

```ts
export interface AnnotationStore {
  sidecar: ReadonlySignal<Sidecar>
  highlights: ReadonlySignal<Highlight[]>       // not deleted, sorted by page, then column (when columns known), then y, then x
  inks: ReadonlySignal<InkStroke[]>             // not deleted
  threads: ReadonlySignal<Thread[]>             // not deleted, newest first
  canUndo: ReadonlySignal<boolean>
  canRedo: ReadonlySignal<boolean>
  setColumns(page: number, columns: Box[]): void   // informs sorting; from PageText.columns
  addHighlight(h: Omit<Highlight, 'id' | 'createdAt' | 'updatedAt'>): Highlight
  updateHighlight(id: string, patch: Partial<Pick<TextHighlight, 'color' | 'note'>>): void
  removeHighlight(id: string): void
  addStroke(s: InkStroke): void
  removeStroke(id: string): void
  upsertThread(t: Thread): void
  removeThread(id: string): void
  setReading(patch: Partial<ReadingState>): void   // not undoable, persisted
  setColorLabel(color: HighlightColor, label: string): void
  undo(): void
  redo(): void
  /** Replaces state with a merged sidecar from the sync layer; clears undo history. */
  replaceFromRemote(sidecar: Sidecar): void
}
export function createAnnotationStore(initial: Sidecar, persist: (sidecar: Sidecar) => void): AnnotationStore
```

Every mutation stamps `updatedAt = now()`, removals set `deleted: true` (tombstone), and calls
`persist(sidecar)` synchronously (the Drive layer debounces). Undo/redo is a stack of inverse
operations for highlight/stroke/thread changes (max 100); undone removals restore
`deleted: false` with a fresh `updatedAt`. Also listen for `document` `CustomEvent('marginalia:undo')`
and `('marginalia:redo')` → `undo()`/`redo()`.

**`src/export/markdown.ts`**

```ts
export interface ExportOptions { title: string; colorLabels?: Partial<Record<HighlightColor, string>>; pageLink?: (page: number) => string }
/** Title, then highlights in store order as `> quote` blocks with `— p.N · <colour label>` and the note below; area highlights as `[Area on p.N]`; then threads as Q/A. */
export function sidecarToMarkdown(sidecar: Sidecar, opts: ExportOptions): string
```

**Tests:** `store.test.ts` (add/update/remove with tombstones + persist calls, sort order with
and without columns, undo/redo round-trip for each kind, replaceFromRemote clears history,
setReading persists but is not undoable, document undo event), `markdown.test.ts` (shape of
output, colour labels, notes, threads, pageLink).

**Done when:** exports match, tests pass, `tsc -b` clean.

---

### Task 6: App shell, library browser, settings, PWA, integration

**Branch:** `feat/shell` (created from `main` after Tasks 1–5 are merged). **Files:** `src/app/*`,
`src/library/Library.tsx`, `src/library/library.css`, `src/sw.ts`, `public/manifest.webmanifest`,
`public/icons/*`, `index.html`, `vite.config.ts` (SW build only), `README.md`.

**Layout.** `App` renders one of: `Onboarding` (no client id → Settings; signed out →
"Connect Google Drive"; no root → root folder picker from `listMyDriveFolders()`),
`Library`, or `Reader`. Route in the URL hash: `#/` library (optionally `#/f/<folderId>`),
`#/p/<pdfId>` reader. Breakpoints: phone < 700 px (single pane, sheets), tablet/laptop ≥ 700 px
(sidebar + viewer + optional right panel).

**`src/app/settings.ts`** — `settings: Signal<Settings>`, `loadSettings()`, `saveSettings(patch)`
(idb `settings`). Defaults from `config.ts`. **`Settings.tsx`**: Google Client ID (prefilled from
`config.ts`), Anthropic API key (password field, "Test key" using `checkApiKey`, "Forget"),
models (Fast/Smart), night mode, invert images, finger draws, "Change root folder", "Sign out",
cache usage with "Clear cached PDFs", app version + "Update available → Reload" (from SW).

**`Library.tsx`**: breadcrumbs from `pathTo`, list from `childrenOf` (folders first), each PDF
row shows name, size, cached dot, and the status badge from its local sidecar (`reading.status`),
tap opens `#/p/<id>`; header: sync status (`syncState`), Sync now, Settings. Pull-to-refresh not
required. "Reconnect Drive" button when `authState.status === 'expired'`.

**`Reader.tsx`**: loads blob via `getPdfBlob` (progress bar), `openPdf`, `loadSidecar` →
`createAnnotationStore(sidecar, s => saveSidecar(id, s))`, then `refreshSidecar` in the
background → `replaceFromRemote` if it returns a merged sidecar. Marks status `reading` on first
open if `unread`. Wires: `Viewer` (highlights from store, `pageOverlay` → `InkLayer` with the
page's strokes and `store.addStroke/removeStroke`, `onSelection` → `SelectionBar`,
`onTapHighlight` → `SelectionBar` with `current`, `onLink` → `scrollTo` with a "← back to p.N"
chip, `onReadingPosition` → `store.setReading`), `Toolbar` (Library back, title, Area select
toggle, pen strip on pen-capable devices: Pen/Eraser/Select + colour + Draw latch on
mouse-only, Undo/Redo, Night, Sidebar, Ask-thread count, Export "Copy as Markdown" →
`sidecarToMarkdown` to clipboard), `Sidebar` (Outline → `scrollTo`; Highlights with colour
filter → `scrollTo(page, boxes[0])`; Threads → open `AskPanel`), `AskPanel` in a right panel
(≥ 700 px) or bottom sheet (phone). Selection bar actions: colour → `addHighlight` (kind from
selection), Ask → new `Thread` with the anchor (and `highlightId` when opened from a
highlight) → `AskPanel`; Note → inline textarea in the bar → `updateHighlight`; Copy → clipboard;
Delete → `removeHighlight`. Keyboard: ⌘/Ctrl-Z undo, ⇧⌘Z redo, Esc closes bar/panel/latch.
Night mode toggles `data-theme="night"` on `<html>` and passes `nightMode`/`invertImages` to
the viewer. `maybeRenew()` on every `pointerdown` at the app root.

**Detecting pen capability:** show the pen strip when a `pointerdown` with `pointerType === 'pen'`
has ever been seen on this device (persist in settings) or on iPadOS; otherwise show the Draw
latch for mouse.

**PWA:** `public/manifest.webmanifest` (`name`, `short_name: Marginalia`, `start_url: ./`,
`scope: ./`, `display: standalone`, `background_color`, `theme_color`, icons 192/512 PNG +
maskable, generated from a simple SVG "M" glyph — write the PNGs with a small node script or
commit hand-made ones), `index.html` metas (`viewport-fit=cover`, `apple-mobile-web-app-capable`,
`apple-mobile-web-app-status-bar-style=black-translucent`, `apple-touch-icon`, `theme-color`),
`src/sw.ts` hand-written: precache list injected at build (a tiny Vite plugin in
`vite.config.ts` that writes `dist/sw.js` with the asset list), cache-first for `/assets/*`,
network-first for navigations with cached `index.html` fallback, never touches
`googleapis.com`, `accounts.google.com`, `anthropic.com`. Registration in `main.tsx`; on
`updatefound` → when the new worker is `installed` and there is a controller, set an
`updateReady` signal that Settings/toolbar shows as "Update available — Reload"; never reload
automatically. Request `navigator.storage.persist()` once.

**README.md:** what it is, Google Cloud setup (project, Drive API, consent screen External + In
production, the two scopes, Web client with origins `https://purush-foundry.github.io` and
`http://localhost:5173` and redirect URIs `https://purush-foundry.github.io/marginalia/` +
`http://localhost:5173/`), the one-time "unverified app" click-through, installing on iPhone/iPad
(Safari → Share → Add to Home Screen, after signing in to Google in Safari), Claude key, dev
(`npm run dev`), deploy (`npm run deploy`).

**Tests:** `settings.test.ts`, `Library.test.tsx` (renders tree from a fixture index, badges,
navigation), `Reader` wiring smoke test with mocked modules (open → store created → selection
→ highlight added → persisted), SW plugin unit test (asset list written). Manual on-device test
list goes in `docs/testing.md` (iPad pencil, phone sheet, Drive reconnect).

**Done when:** `npm run build` yields a working app; `npm run dev` shows onboarding; tests
pass; README complete.

---

### Task 7: Final review, fix wave, deploy

Whole-branch review (most capable model) against the spec; one fix dispatch; re-review;
`npm run deploy`; hand the owner the Google Console steps and the on-device test list.
