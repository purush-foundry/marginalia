// Mirror of the chosen Drive folder tree, the PDF blob cache, and companion file (sidecar, notes) load/save/sync.
import { signal } from '@preact/signals'
import {
  HOME_ART_FILE,
  LIBRARY_SYNC_INTERVAL_MS,
  NOTES_SUFFIX,
  PDF_CACHE_LIMIT_BYTES,
  SIDECAR_SAVE_DEBOUNCE_MS,
  SIDECAR_SUFFIX,
} from '../config'
import { idbDel, idbGet, idbGetAll, idbKeys, idbSet } from '../lib/idb'
import { convertV1, emptyNotebook, isNotebookDoc, type NotesDocV2 } from '../notes/model'
import {
  FOLDER_MIME,
  PDF_MIME,
  emptySidecar,
  isNotesDoc,
  type DriveNode,
  type HomeArtSlot,
  type LibraryIndex,
  type NotesDoc,
  type Sidecar,
} from '../types'
import {
  DriveError,
  createJsonFile,
  downloadFile,
  downloadJson,
  findCompanionFile,
  getNode,
  getStartPageToken,
  listChanges,
  listChildren,
  updateJsonFile,
} from './api'
import { getAccessToken } from './auth'
import { mergeNotebooks, mergeSidecars } from './merge'

interface CachedFile {
  version: string
  bytes: ArrayBuffer
  size: number
  openedAt: number
}

/** A cache record written before PDFs were stored as bytes. */
interface LegacyCachedFile {
  version: string
  blob: Blob
  size: number
  openedAt: number
}

/** A local companion record; the document lives under `sidecar` for both kinds. */
interface StoredCompanion<T> {
  sidecar: T
  remoteId?: string
  remoteVersion?: string
  dirty: boolean
}

/** One kind of per-PDF companion file and how it is named, stored, indexed, merged, validated and upgraded. */
interface Companion<T> {
  kind: 'annotations' | 'notes'
  store: 'sidecars' | 'notes'
  tag: '1' | 'notes'
  pdfKey: 'pdf' | 'notesFor'
  nameFor(pdfName: string): string
  queueKey(pdfId: string): string
  map(index: LibraryIndex): Record<string, DriveNode>
  empty(pdfId: string, pdfName: string): T
  merge(a: T, b: T): T
  accepts(remote: unknown): boolean
  upgrade(doc: unknown): T
  unparseableIsForeign: boolean
  newer(remote: unknown): boolean
  label: string
}

/** A downloaded companion file: a document to merge, a foreign file to replace, or a newer-schema document to leave alone. */
type Download<T> = { status: 'ok'; doc: T; upgraded: boolean } | { status: 'foreign' } | { status: 'newer' }

interface SyncState {
  status: 'idle' | 'syncing' | 'offline' | 'error'
  message?: string
  at?: number
}

export const library = signal<LibraryIndex | null>(null)
export const syncState = signal<SyncState>({ status: 'idle' })
/** Increments whenever a sync merges sidecars or notes from Drive into local records. */
export const sidecarRevision = signal(0)

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sidecarNameFor(pdfName: string): string {
  return pdfName.replace(/\.pdf$/i, '') + SIDECAR_SUFFIX
}

export function notesNameFor(pdfName: string): string {
  return pdfName.replace(/\.pdf$/i, '') + NOTES_SUFFIX
}

const NOTES_QUEUE_PREFIX = 'notes:'

// True for a notes document written by a client with a newer schema.
function isNewerNotes(remote: unknown): boolean {
  if (typeof remote !== 'object' || remote === null) return false
  const { kind, schema } = remote as { kind?: unknown; schema?: unknown }
  return kind === 'notes' && typeof schema === 'number' && schema > 2
}

// True for an annotations document: an object with a highlights array.
function isSidecarDoc(x: unknown): x is Sidecar {
  return typeof x === 'object' && x !== null && Array.isArray((x as Partial<Sidecar>).highlights)
}

const ANNOTATIONS: Companion<Sidecar> = {
  kind: 'annotations',
  store: 'sidecars',
  tag: '1',
  pdfKey: 'pdf',
  nameFor: sidecarNameFor,
  queueKey: (pdfId) => pdfId,
  map: (index) => index.sidecars,
  empty: (pdfId, pdfName) => emptySidecar(pdfId, pdfName, 0),
  merge: mergeSidecars,
  accepts: isSidecarDoc,
  upgrade: (doc) => doc as Sidecar,
  unparseableIsForeign: false,
  newer: () => false,
  label: 'annotation',
}

const NOTEBOOK: Companion<NotesDocV2> = {
  kind: 'notes',
  store: 'notes',
  tag: 'notes',
  pdfKey: 'notesFor',
  nameFor: notesNameFor,
  queueKey: (pdfId) => NOTES_QUEUE_PREFIX + pdfId,
  map: (index) => index.notes ?? {},
  empty: (pdfId, pdfName) => emptyNotebook(pdfId, pdfName, 0),
  merge: mergeNotebooks,
  accepts: (x) => isNotesDoc(x) || isNotebookDoc(x),
  upgrade: (x) => (isNotebookDoc(x) ? x : convertV1(x as NotesDoc)),
  unparseableIsForeign: true,
  newer: isNewerNotes,
  label: 'notes',
}

const COMPANIONS: readonly Companion<unknown>[] = [ANNOTATIONS, NOTEBOOK]

// The companion kind and PDF id a queue key stands for.
function fromQueueKey(key: string): [Companion<unknown>, string] {
  return key.startsWith(NOTES_QUEUE_PREFIX) ? [NOTEBOOK, key.slice(NOTES_QUEUE_PREFIX.length)] : [ANNOTATIONS, key]
}

interface PendingSave {
  companion: Companion<unknown>
  pdfId: string
  doc: unknown
  timer: ReturnType<typeof setTimeout>
  writing?: Promise<void>
}

/** Debounced edits keyed by the companion's queue key. */
const pendingSaves = new Map<string, PendingSave>()
let syncing: Promise<void> | null = null

// Returns a runner that executes tasks one at a time in call order.
function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return (task) => {
    const run = tail.then(task)
    tail = run.catch(() => undefined)
    return run
  }
}

/** Serialises Drive-side work that reads or rewrites the index (walks, uploads). */
const driveLane = serial()
/** Serialises read-modify-write of local sidecar records. */
const localLane = serial()

const has = (record: Record<string, unknown>, id: string): boolean => Object.hasOwn(record, id)

// True when the remote file or its version differs from the one last merged locally.
function remoteMoved(stored: StoredCompanion<unknown> | undefined, remote: DriveNode): boolean {
  return stored?.remoteId !== remote.id || stored.remoteVersion !== remote.version
}

async function commit(index: LibraryIndex): Promise<void> {
  library.value = index
  await idbSet('meta', 'library', index)
}

// The companion kind of a file: by its marginalia tag, else by its name suffix.
function companionOf(node: DriveNode): Companion<unknown> | undefined {
  const tag = node.appProperties?.marginalia
  return COMPANIONS.find((c) => c.tag === tag) ?? COMPANIONS.find((c) => node.name.endsWith(c.nameFor('')))
}

// Maps a companion file to its PDF by its kind's appProperties key, else by expected name in a shared parent.
function attachCompanion(index: LibraryIndex, node: DriveNode): void {
  const c = companionOf(node)
  if (!c) return
  const tagged = node.appProperties?.[c.pdfKey]
  const pdfId =
    tagged && has(index.papers, tagged)
      ? tagged
      : Object.values(index.papers).find(
          (p) => c.nameFor(p.name) === node.name && p.parents.some((id) => node.parents.includes(id)),
        )?.id
  if (pdfId) (index[c.store] ??= {})[pdfId] = node
}

// The home picture slot of a file directly in the root folder, if its name is one.
function homeArtSlot(index: LibraryIndex, node: DriveNode): HomeArtSlot | undefined {
  if (!node.parents.includes(index.rootId)) return undefined
  const match = HOME_ART_FILE.exec(node.name)
  if (!match) return undefined
  return (match[1]?.toLowerCase() as HomeArtSlot | undefined) ?? 'generic'
}

// Records a home picture under its slot; of two files for one slot the lowest name by code units wins.
function attachHomeArt(index: LibraryIndex, node: DriveNode): void {
  const slot = homeArtSlot(index, node)
  if (!slot) return
  const art = (index.homeArt ??= {})
  const seen = art[slot]
  if (!seen || seen.id === node.id || node.name < seen.name) art[slot] = node
}

// Clears any home picture slot held by the file.
function detachHomeArt(index: LibraryIndex, id: string): void {
  const art = index.homeArt ?? {}
  for (const slot of Object.keys(art) as HomeArtSlot[]) if (art[slot]?.id === id) delete art[slot]
}

// Files a node as a folder, companion (collected to attach after the walk), paper or home picture.
function classify(index: LibraryIndex, node: DriveNode, companions: DriveNode[], newFolders: string[]): void {
  if (node.mimeType === FOLDER_MIME) {
    if (!has(index.folders, node.id)) newFolders.push(node.id)
    index.folders[node.id] = node
  } else if (companionOf(node)) companions.push(node)
  else if (node.mimeType === PDF_MIME) index.papers[node.id] = node
  else attachHomeArt(index, node)
}

// Breadth-first walk from the given folders, adding folders, PDFs, companion files and home pictures to the index.
async function walkInto(index: LibraryIndex, start: string[]): Promise<void> {
  const companions: DriveNode[] = []
  let frontier = start
  while (frontier.length) {
    const children = await listChildren(frontier)
    frontier = []
    for (const node of children) classify(index, node, companions, frontier)
  }
  for (const node of companions) attachCompanion(index, node)
}

async function fullWalk(index: LibraryIndex): Promise<LibraryIndex> {
  const changesToken = await getStartPageToken()
  const root = await getNode(index.rootId)
  const next: LibraryIndex = {
    rootId: root.id,
    rootName: root.name,
    folders: { [root.id]: root },
    papers: {},
    sidecars: {},
    notes: {},
    syncedAt: 0,
    changesToken,
  }
  await walkInto(next, [root.id])
  next.syncedAt = Date.now()
  return next
}

function removeNode(index: LibraryIndex, id: string): void {
  if (id !== index.rootId) delete index.folders[id]
  delete index.papers[id]
  for (const c of COMPANIONS) {
    const nodes = c.map(index)
    for (const [pdfId, node] of Object.entries(nodes)) if (node.id === id) delete nodes[pdfId]
  }
  detachHomeArt(index, id)
}

// Drops folders and papers no longer reachable from a known folder, companions of missing papers, and an empty homeArt.
function prune(index: LibraryIndex): void {
  const attached = (node: DriveNode) => node.parents.some((p) => has(index.folders, p))
  for (let changed = true; changed; ) {
    changed = false
    for (const [id, node] of Object.entries(index.folders)) {
      if (id !== index.rootId && !attached(node)) {
        delete index.folders[id]
        changed = true
      }
    }
  }
  for (const [id, node] of Object.entries(index.papers)) if (!attached(node)) delete index.papers[id]
  for (const c of COMPANIONS) {
    const nodes = c.map(index)
    for (const pdfId of Object.keys(nodes)) if (!has(index.papers, pdfId)) delete nodes[pdfId]
  }
  if (index.homeArt && !Object.keys(index.homeArt).length) delete index.homeArt
}

async function applyChanges(index: LibraryIndex, startToken: string): Promise<LibraryIndex> {
  const next: LibraryIndex = {
    ...index,
    folders: { ...index.folders },
    papers: { ...index.papers },
    sidecars: { ...index.sidecars },
    notes: { ...index.notes },
    homeArt: { ...index.homeArt },
  }
  const newFolders: string[] = []
  const companions: DriveNode[] = []
  let pageToken = startToken
  for (;;) {
    const page = await listChanges(pageToken)
    for (const { fileId, removed, file } of page.changes) {
      if (removed || !file || file.trashed) {
        removeNode(next, fileId)
        continue
      }
      const { trashed, ...node } = file
      if (node.id === next.rootId) {
        next.folders[node.id] = node
        next.rootName = node.name
      } else if (!node.parents.some((p) => has(next.folders, p))) {
        removeNode(next, node.id)
      } else {
        detachHomeArt(next, node.id)
        classify(next, node, companions, newFolders)
      }
    }
    if (!page.nextPageToken) {
      next.changesToken = page.newStartPageToken ?? pageToken
      break
    }
    pageToken = page.nextPageToken
  }
  if (newFolders.length) await walkInto(next, newFolders)
  for (const node of companions) attachCompanion(next, node)
  prune(next)
  next.syncedAt = Date.now()
  return next
}

// Applies changes since the token; walks in full when there is no token, the token is rejected, or the index predates notes files.
async function refreshIndex(): Promise<void> {
  const index = library.peek()
  if (!index) return
  let next: LibraryIndex
  if (index.changesToken && index.notes) {
    try {
      next = await applyChanges(index, index.changesToken)
    } catch (err) {
      if (!(err instanceof DriveError) || ![400, 404, 410].includes(err.status)) throw err
      next = await fullWalk(index)
    }
  } else {
    next = await fullWalk(index)
  }
  if (library.peek()?.rootId === index.rootId) await commit(next)
}

function failureState(err: unknown): SyncState {
  if (!navigator.onLine || err instanceof TypeError) return { status: 'offline', message: 'Offline' }
  return { status: 'error', message: err instanceof Error ? err.message : String(err) }
}

export async function loadLibrary(): Promise<void> {
  library.value = (await idbGet<LibraryIndex>('meta', 'library')) ?? null
}

/** Makes `node` the library root: resets the index, then syncs. */
export async function setRootFolder(node: DriveNode): Promise<void> {
  await syncing
  await commit({
    rootId: node.id,
    rootName: node.name,
    folders: { [node.id]: node },
    papers: {},
    sidecars: {},
    notes: {},
    syncedAt: 0,
  })
  await syncLibrary()
}

/** Updates the index via changes.list when a changes token exists, else a full walk, then flushes the queue; never throws. */
export function syncLibrary(): Promise<void> {
  syncing ??= (async () => {
    if (!library.peek()) return
    if (!getAccessToken()) {
      syncState.value = { status: 'offline', message: 'Not connected to Drive' }
      return
    }
    syncState.value = { status: 'syncing' }
    try {
      await driveLane(refreshIndex)
      syncState.value = { status: 'idle', at: Date.now() }
      await flushQueue()
      await pullSidecars()
    } catch (err) {
      syncState.value = failureState(err)
    }
  })().finally(() => {
    syncing = null
  })
  return syncing
}

/** Syncs now, on becoming visible and every LIBRARY_SYNC_INTERVAL_MS while visible; writes pending edits on hide/pagehide; returns a stop function. */
export function startAutoSync(): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void syncLibrary()
    else void flushPendingWrites()
  }
  const onPageHide = () => void flushPendingWrites()
  const onInterval = () => {
    if (document.visibilityState === 'visible') void syncLibrary()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  const timer = setInterval(onInterval, LIBRARY_SYNC_INTERVAL_MS)
  void syncLibrary()
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
    clearInterval(timer)
  }
}

/** Subfolders and papers of a folder: folders first, each sorted by name. */
export function childrenOf(folderId: string): { folders: DriveNode[]; papers: DriveNode[] } {
  const index = library.value
  if (!index) return { folders: [], papers: [] }
  const inFolder = (node: DriveNode) => node.id !== index.rootId && node.parents.includes(folderId)
  const sorted = (nodes: DriveNode[]) => nodes.filter(inFolder).sort((a, b) => byName.compare(a.name, b.name))
  return { folders: sorted(Object.values(index.folders)), papers: sorted(Object.values(index.papers)) }
}

/** Breadcrumbs from the root folder down to and including the node. */
export function pathTo(nodeId: string): DriveNode[] {
  const index = library.value
  if (!index) return []
  const path: DriveNode[] = []
  let node: DriveNode | undefined = index.folders[nodeId] ?? index.papers[nodeId]
  while (node && !path.includes(node)) {
    path.unshift(node)
    if (node.id === index.rootId) break
    node = node.parents.map((id) => index.folders[id]).find(Boolean)
  }
  return path
}

function isFresh(entry: CachedFile | undefined, pdfId: string): entry is CachedFile {
  const node = library.peek()?.papers[pdfId]
  return Boolean(entry && (!node || entry.version === node.version))
}

export async function isCached(pdfId: string): Promise<boolean> {
  return isFresh(await idbGet<CachedFile>('files', pdfId), pdfId)
}

/** Total bytes of PDFs in the local cache. */
export async function pdfCacheBytes(): Promise<number> {
  return (await idbGetAll<CachedFile>('files')).reduce((sum, e) => sum + e.value.size, 0)
}

/** Deletes every cached PDF; annotations are untouched. */
export async function clearPdfCache(): Promise<void> {
  for (const key of await idbKeys('files')) await idbDel('files', key)
}

// Records the open time best-effort and returns the cached PDF as a Blob.
async function touch(pdfId: string, entry: CachedFile): Promise<Blob> {
  await idbSet('files', pdfId, { ...entry, openedAt: Date.now() }).catch(() => undefined)
  return new Blob([entry.bytes], { type: PDF_MIME })
}

// The cached PDF as bytes; rewrites a legacy Blob record as bytes, and drops one whose Blob can no longer be read.
async function readCached(pdfId: string): Promise<CachedFile | undefined> {
  const entry = await idbGet<CachedFile | LegacyCachedFile>('files', pdfId)
  if (!entry || 'bytes' in entry) return entry
  try {
    const bytes = await entry.blob.arrayBuffer()
    const migrated: CachedFile = { version: entry.version, bytes, size: bytes.byteLength, openedAt: entry.openedAt }
    await idbSet('files', pdfId, migrated)
    return migrated
  } catch {
    await idbDel('files', pdfId).catch(() => undefined)
    return undefined
  }
}

// Deletes least recently opened PDFs, except `keep`, until the cache fits the limit.
async function evict(keep: string): Promise<void> {
  const entries = (await idbGetAll<CachedFile>('files')).sort((a, b) => a.value.openedAt - b.value.openedAt)
  let total = entries.reduce((sum, e) => sum + e.value.size, 0)
  for (const { key, value } of entries) {
    if (total <= PDF_CACHE_LIMIT_BYTES) break
    if (key === keep) continue
    await idbDel('files', key)
    total -= value.size
  }
}

/** Returns the PDF from cache when its version matches, else downloads and caches it; falls back to a stale copy when the download fails. `fresh` skips the cache and replaces it once the download succeeds. */
export async function getPdfBlob(pdfId: string, onProgress?: (frac: number) => void, opts: { fresh?: boolean } = {}): Promise<Blob> {
  const entry = opts.fresh ? undefined : await readCached(pdfId)
  if (isFresh(entry, pdfId)) {
    onProgress?.(1)
    return touch(pdfId, entry)
  }
  let node: DriveNode
  let blob: Blob
  try {
    node = library.peek()?.papers[pdfId] ?? (await getNode(pdfId))
    const total = node.size
    blob = await downloadFile(pdfId, onProgress && total ? (bytes) => onProgress(Math.min(1, bytes / total)) : undefined)
  } catch (err) {
    if (entry) return touch(pdfId, entry)
    throw err
  }
  try {
    const bytes = await blob.arrayBuffer()
    const record: CachedFile = { version: node.version, bytes, size: bytes.byteLength, openedAt: Date.now() }
    await idbSet('files', pdfId, record)
    await evict(pdfId)
  } catch {
    // Returns the downloaded blob even when it cannot be cached.
  }
  onProgress?.(1)
  return blob
}

// An empty document of the kind, named after the paper when the index knows it.
function emptyFor<T>(c: Companion<T>, pdfId: string): T {
  return c.empty(pdfId, library.peek()?.papers[pdfId]?.name ?? '')
}

// The stored record of the kind with its document upgraded and whether upgrading changed it; undefined when there is none or it is not of the kind.
async function readUpgraded<T>(c: Companion<T>, pdfId: string): Promise<{ stored: StoredCompanion<T>; upgraded: boolean } | undefined> {
  const stored = await idbGet<StoredCompanion<unknown>>(c.store, pdfId)
  if (!stored || !c.accepts(stored.sidecar)) return undefined
  const sidecar = c.upgrade(stored.sidecar)
  return { stored: { ...stored, sidecar }, upgraded: sidecar !== stored.sidecar }
}

// The stored record of the kind with its document upgraded, or undefined when there is none or its document is not of the kind.
async function readStored<T>(c: Companion<T>, pdfId: string): Promise<StoredCompanion<T> | undefined> {
  return (await readUpgraded(c, pdfId))?.stored
}

// Stores the upgraded document of a record that upgrading changed, dirty and queued for upload.
function keepUpgraded<T>(c: Companion<T>, pdfId: string): Promise<void> {
  return localLane(async () => {
    const latest = await readUpgraded(c, pdfId)
    if (!latest?.upgraded) return
    await idbSet(c.store, pdfId, { ...latest.stored, dirty: true })
    await idbSet('queue', c.queueKey(pdfId), { queuedAt: Date.now() })
  })
}

// Deletes the stored record of the kind when its document is not of the kind.
function dropInvalid<T>(c: Companion<T>, pdfId: string): Promise<void> {
  return localLane(async () => {
    const stored = await idbGet<StoredCompanion<T>>(c.store, pdfId)
    if (stored && !c.accepts(stored.sidecar)) await idbDel(c.store, pdfId)
  })
}

// The latest local document of the kind: the pending edit, else the valid stored record (stored back when upgraded), else an empty one.
async function load<T>(c: Companion<T>, pdfId: string): Promise<T> {
  const pending = pendingSaves.get(c.queueKey(pdfId))
  if (pending) return pending.doc as T
  const found = await readUpgraded(c, pdfId)
  if (found?.upgraded) await keepUpgraded(c, pdfId)
  if (found) return found.stored.sidecar
  await dropInvalid(c, pdfId)
  return emptyFor(c, pdfId)
}

/** The latest local sidecar (including an unsaved debounced edit), or an empty one. */
export function loadSidecar(pdfId: string): Promise<Sidecar> {
  return load(ANNOTATIONS, pdfId)
}

/** The latest local notebook (including an unsaved debounced edit), converted from schema 1 when needed, or an empty notebook. */
export function loadNotebook(pdfId: string): Promise<NotesDocV2> {
  return load(NOTEBOOK, pdfId)
}

async function persist<T>(c: Companion<T>, pdfId: string, doc: T): Promise<void> {
  await localLane(async () => {
    const stored = await readStored(c, pdfId)
    const merged = stored ? c.merge(doc, stored.sidecar) : doc
    const record: StoredCompanion<T> = { ...stored, sidecar: merged, dirty: true }
    await idbSet(c.store, pdfId, record)
    await idbSet('queue', c.queueKey(pdfId), { queuedAt: Date.now() })
  })
  if (getAccessToken()) {
    flushQueue().catch((err: unknown) => {
      syncState.value = failureState(err)
    })
  }
}

// Persists a debounced edit now and forgets it once stored; on failure keeps it and retries after the debounce.
function writePending(entry: PendingSave): Promise<void> {
  const { companion: c, pdfId } = entry
  const key = c.queueKey(pdfId)
  clearTimeout(entry.timer)
  entry.writing ??= persist(c, pdfId, entry.doc).then(
    () => {
      if (pendingSaves.get(key) === entry) pendingSaves.delete(key)
    },
    (err: unknown) => {
      entry.writing = undefined
      if (pendingSaves.get(key) === entry) {
        entry.timer = setTimeout(() => void writePending(entry), SIDECAR_SAVE_DEBOUNCE_MS)
      }
      const message = err instanceof Error ? err.message : String(err)
      syncState.value = { status: 'error', message: `Could not save ${c.kind} on this device: ${message}`, at: Date.now() }
    },
  )
  return entry.writing
}

// Replaces the kind's pending edit for the paper and restarts its debounce.
function save<T>(c: Companion<T>, pdfId: string, doc: T): void {
  const key = c.queueKey(pdfId)
  const previous = pendingSaves.get(key)
  if (previous) clearTimeout(previous.timer)
  const entry: PendingSave = {
    companion: c,
    pdfId,
    doc,
    timer: setTimeout(() => void writePending(entry), SIDECAR_SAVE_DEBOUNCE_MS),
  }
  pendingSaves.set(key, entry)
}

/** Debounced by SIDECAR_SAVE_DEBOUNCE_MS: merges into the local copy, marks it dirty and queues an upload. */
export function saveSidecar(pdfId: string, sidecar: Sidecar): void {
  save(ANNOTATIONS, pdfId, sidecar)
}

/** Debounced by SIDECAR_SAVE_DEBOUNCE_MS with its own pending entry and queue key: merges into the local notebook, marks it dirty and queues an upload. */
export function saveNotebook(pdfId: string, doc: NotesDocV2): void {
  save(NOTEBOOK, pdfId, doc)
}

/** Writes every debounced sidecar and notes edit to IndexedDB and the upload queue immediately. */
export async function flushPendingWrites(): Promise<void> {
  await Promise.all([...pendingSaves.values()].map((entry) => writePending(entry)))
}

// The folder in the tree that holds the paper.
function parentOf(index: LibraryIndex, paper: DriveNode): string | undefined {
  return paper.parents.find((id) => has(index.folders, id)) ?? paper.parents[0]
}

// The index with `node` recorded as the paper's companion file of the kind.
function withCompanion(index: LibraryIndex, c: Companion<unknown>, pdfId: string, node: DriveNode): LibraryIndex {
  return { ...index, [c.store]: { ...c.map(index), [pdfId]: node } }
}

// The paper's companion node of the kind from the index, else found in Drive and recorded in the index.
async function locate<T>(c: Companion<T>, pdfId: string): Promise<DriveNode | undefined> {
  const index = library.peek()
  const known = index ? c.map(index)[pdfId] : undefined
  const paper = index?.papers[pdfId]
  const parent = index && paper && parentOf(index, paper)
  if (known || !paper || !parent) return known
  const found = await findCompanionFile(pdfId, c.nameFor(paper.name), parent, c.tag, c.pdfKey)
  const current = library.peek()
  if (!found || !current || !has(current.papers, pdfId)) return found ?? undefined
  await commit(withCompanion(current, c, pdfId, found))
  return found
}

// Downloads a companion file and sorts it into an upgraded document of the kind, a newer-schema document or a foreign file.
async function download<T>(c: Companion<T>, id: string): Promise<Download<T>> {
  let remote: unknown
  try {
    remote = await downloadJson<unknown>(id)
  } catch (err) {
    if (err instanceof SyntaxError && c.unparseableIsForeign) return { status: 'foreign' }
    throw err
  }
  if (c.newer(remote)) return { status: 'newer' }
  if (!c.accepts(remote)) return { status: 'foreign' }
  const doc = c.upgrade(remote)
  return { status: 'ok', doc, upgraded: doc !== remote }
}

// Merges the remote file into the local record and returns the result, dirty and queued when the remote was upgraded; a foreign remote leaves the local document dirty and queued, a newer-schema one leaves it untouched; both return null.
async function mergeRemote<T>(c: Companion<T>, pdfId: string, remoteNode: DriveNode): Promise<T | null> {
  const remote = await download(c, remoteNode.id)
  if (remote.status === 'newer') return null
  return localLane(async () => {
    const latest = await readStored(c, pdfId)
    const seen = { remoteId: remoteNode.id, remoteVersion: remoteNode.version }
    if (remote.status === 'foreign') {
      const record: StoredCompanion<T> = { sidecar: latest?.sidecar ?? emptyFor(c, pdfId), ...seen, dirty: true }
      await idbSet(c.store, pdfId, record)
      await idbSet('queue', c.queueKey(pdfId), { queuedAt: Date.now() })
      return null
    }
    const doc = latest ? c.merge(latest.sidecar, remote.doc) : remote.doc
    const record: StoredCompanion<T> = { sidecar: doc, ...seen, dirty: remote.upgraded || (latest?.dirty ?? false) }
    await idbSet(c.store, pdfId, record)
    if (remote.upgraded) await idbSet('queue', c.queueKey(pdfId), { queuedAt: Date.now() })
    return doc
  })
}

// If the remote file's version differs from the one last merged: download, merge, store and return it; else null.
async function refresh<T>(c: Companion<T>, pdfId: string): Promise<T | null> {
  if (!getAccessToken()) return null
  const known = await locate(c, pdfId)
  if (!known) return null
  const remoteNode = await getNode(known.id)
  const stored = await readStored(c, pdfId)
  if (!remoteMoved(stored, remoteNode)) return null
  const merged = await mergeRemote(c, pdfId, remoteNode)
  const pending = pendingSaves.get(c.queueKey(pdfId))
  return merged !== null && pending ? c.merge(merged, pending.doc as T) : merged
}

/** If the remote sidecar's version differs from the one last merged: download, merge, store and return it; else null. */
export function refreshSidecar(pdfId: string): Promise<Sidecar | null> {
  return refresh(ANNOTATIONS, pdfId)
}

/** If the remote notes file's version differs from the one last merged: download, convert from schema 1 when needed, merge, store and return the notebook; else null, also when the remote is not a notes document. */
export function refreshNotebook(pdfId: string): Promise<NotesDocV2 | null> {
  return refresh(NOTEBOOK, pdfId)
}

// One message for the per-kind failure counts, joined with ' · '.
function failureMessage(failed: Map<Companion<unknown>, number>, action: 'download' | 'upload'): string {
  return COMPANIONS.filter((c) => failed.has(c))
    .map((c) => `${failed.get(c)} ${c.label} ${action}(s) failed`)
    .join(' · ')
}

// Merges every indexed companion of the kind whose Drive version differs from the local record and returns the failure count; rethrows an offline failure.
async function pull<T>(c: Companion<T>, index: LibraryIndex): Promise<number> {
  let pulled = 0
  let failed = 0
  try {
    for (const [pdfId, node] of Object.entries(c.map(index))) {
      try {
        if (!remoteMoved(await readStored(c, pdfId), node)) continue
        if ((await mergeRemote(c, pdfId, node)) !== null) pulled++
      } catch (err) {
        if (failureState(err).status === 'offline') throw err
        failed++
      }
    }
  } finally {
    if (pulled) sidecarRevision.value++
  }
  return failed
}

// Pulls every changed sidecar and notes file, so badges and notes reflect other devices.
async function pullSidecars(): Promise<void> {
  const index = library.peek()
  if (!index) return
  const failed = new Map<Companion<unknown>, number>()
  for (const c of COMPANIONS) {
    try {
      const count = await pull(c, index)
      if (count) failed.set(c, count)
    } catch (err) {
      syncState.value = { ...failureState(err), at: Date.now() }
      return
    }
  }
  if (failed.size) syncState.value = { status: 'error', message: failureMessage(failed, 'download'), at: Date.now() }
}

// Uploads one queued companion file, merging first if the remote moved, and records the new remote version; leaves it queued when the remote has a newer schema.
async function flushOne<T>(c: Companion<T>, pdfId: string): Promise<void> {
  const key = c.queueKey(pdfId)
  const stored = await readStored(c, pdfId)
  const index = library.peek()
  const paper = index?.papers[pdfId]
  if (!stored || (index && index.syncedAt > 0 && !paper)) {
    await idbDel('queue', key)
    return
  }
  const parent = index && paper && parentOf(index, paper)
  const known = await locate(c, pdfId)
  let body = stored.sidecar
  let node: DriveNode | undefined
  if (known) {
    try {
      const remote = await getNode(known.id)
      if (remoteMoved(stored, remote)) {
        const theirs = await download(c, known.id)
        if (theirs.status === 'newer') return
        if (theirs.status === 'ok') body = c.merge(body, theirs.doc)
      }
      node = await updateJsonFile(known.id, body)
    } catch (err) {
      if (!(err instanceof DriveError) || err.status !== 404) throw err
    }
  }
  if (!node) {
    if (!paper || !parent) return
    node = await createJsonFile(c.nameFor(paper.name), parent, body, { marginalia: c.tag, [c.pdfKey]: pdfId })
  }
  const current = library.peek()
  if (current) await commit(withCompanion(current, c, pdfId, node))
  const uploaded = node
  await localLane(async () => {
    const latest = await readStored(c, pdfId)
    if (latest && JSON.stringify(latest.sidecar) !== JSON.stringify(stored.sidecar)) {
      const record: StoredCompanion<T> = { sidecar: c.merge(latest.sidecar, body), remoteId: uploaded.id, remoteVersion: uploaded.version, dirty: true }
      await idbSet(c.store, pdfId, record)
    } else {
      const record: StoredCompanion<T> = { sidecar: body, remoteId: uploaded.id, remoteVersion: uploaded.version, dirty: false }
      await idbSet(c.store, pdfId, record)
      await idbDel('queue', key)
    }
  })
}

/** Uploads every queued sidecar and notes file; failures stay queued and are reported in syncState. */
export function flushQueue(): Promise<void> {
  return driveLane(async () => {
    if (!getAccessToken()) return
    const failed = new Map<Companion<unknown>, number>()
    for (const key of await idbKeys('queue')) {
      const [c, pdfId] = fromQueueKey(key)
      try {
        await flushOne(c, pdfId)
      } catch (err) {
        if (failureState(err).status === 'offline') {
          syncState.value = { ...failureState(err), at: Date.now() }
          return
        }
        failed.set(c, (failed.get(c) ?? 0) + 1)
        if (err instanceof DriveError && err.status === 401) break
      }
    }
    if (failed.size) syncState.value = { status: 'error', message: failureMessage(failed, 'upload'), at: Date.now() }
  })
}
