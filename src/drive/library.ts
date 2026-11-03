// Mirror of the chosen Drive folder tree, the PDF blob cache, and sidecar load/save/sync.
import { signal } from '@preact/signals'
import {
  LIBRARY_SYNC_INTERVAL_MS,
  PDF_CACHE_LIMIT_BYTES,
  SIDECAR_SAVE_DEBOUNCE_MS,
  SIDECAR_SUFFIX,
} from '../config'
import { idbDel, idbGet, idbGetAll, idbKeys, idbSet } from '../lib/idb'
import { FOLDER_MIME, PDF_MIME, emptySidecar, type DriveNode, type LibraryIndex, type Sidecar } from '../types'
import {
  DriveError,
  createJsonFile,
  downloadFile,
  downloadJson,
  getNode,
  getStartPageToken,
  listChanges,
  listChildren,
  updateJsonFile,
} from './api'
import { getAccessToken } from './auth'
import { mergeSidecars } from './merge'

interface CachedFile {
  version: string
  blob: Blob
  size: number
  openedAt: number
}

interface StoredSidecar {
  sidecar: Sidecar
  remoteVersion?: string
  dirty: boolean
}

interface SyncState {
  status: 'idle' | 'syncing' | 'offline' | 'error'
  message?: string
  at?: number
}

export const library = signal<LibraryIndex | null>(null)
export const syncState = signal<SyncState>({ status: 'idle' })

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const pendingSaves = new Map<string, { sidecar: Sidecar; timer: ReturnType<typeof setTimeout> }>()
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

async function commit(index: LibraryIndex): Promise<void> {
  library.value = index
  await idbSet('meta', 'library', index)
}

export function sidecarNameFor(pdfName: string): string {
  return pdfName.replace(/\.pdf$/i, '') + SIDECAR_SUFFIX
}

function isSidecarNode(node: DriveNode): boolean {
  return node.name.endsWith(SIDECAR_SUFFIX) || node.appProperties?.marginalia === '1'
}

// Maps a sidecar to its PDF by appProperties.pdf, else by expected name in a shared parent.
function attachSidecar(index: LibraryIndex, node: DriveNode): void {
  const tagged = node.appProperties?.pdf
  const pdfId =
    tagged && has(index.papers, tagged)
      ? tagged
      : Object.values(index.papers).find(
          (p) => sidecarNameFor(p.name) === node.name && p.parents.some((id) => node.parents.includes(id)),
        )?.id
  if (pdfId) index.sidecars[pdfId] = node
}

// Breadth-first walk from the given folders, adding folders, PDFs and sidecars to the index.
async function walkInto(index: LibraryIndex, start: string[]): Promise<void> {
  const sidecars: DriveNode[] = []
  let frontier = start
  while (frontier.length) {
    const children = await listChildren(frontier)
    frontier = []
    for (const node of children) {
      if (node.mimeType === FOLDER_MIME) {
        if (!has(index.folders, node.id)) frontier.push(node.id)
        index.folders[node.id] = node
      } else if (isSidecarNode(node)) sidecars.push(node)
      else if (node.mimeType === PDF_MIME) index.papers[node.id] = node
    }
  }
  for (const node of sidecars) attachSidecar(index, node)
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
  for (const [pdfId, node] of Object.entries(index.sidecars)) {
    if (node.id === id) delete index.sidecars[pdfId]
  }
}

// Drops folders and papers no longer reachable from a known folder, and sidecars of missing papers.
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
  for (const pdfId of Object.keys(index.sidecars)) if (!has(index.papers, pdfId)) delete index.sidecars[pdfId]
}

async function applyChanges(index: LibraryIndex, startToken: string): Promise<LibraryIndex> {
  const next: LibraryIndex = {
    ...index,
    folders: { ...index.folders },
    papers: { ...index.papers },
    sidecars: { ...index.sidecars },
  }
  const newFolders: string[] = []
  const sidecars: DriveNode[] = []
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
      } else if (node.mimeType === FOLDER_MIME) {
        if (!has(next.folders, node.id)) newFolders.push(node.id)
        next.folders[node.id] = node
      } else if (isSidecarNode(node)) sidecars.push(node)
      else if (node.mimeType === PDF_MIME) next.papers[node.id] = node
    }
    if (!page.nextPageToken) {
      next.changesToken = page.newStartPageToken ?? pageToken
      break
    }
    pageToken = page.nextPageToken
  }
  if (newFolders.length) await walkInto(next, newFolders)
  for (const node of sidecars) attachSidecar(next, node)
  prune(next)
  next.syncedAt = Date.now()
  return next
}

async function refreshIndex(): Promise<void> {
  const index = library.peek()
  if (!index) return
  let next: LibraryIndex
  if (index.changesToken) {
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
    } catch (err) {
      syncState.value = failureState(err)
    }
    await flushQueue()
  })().finally(() => {
    syncing = null
  })
  return syncing
}

/** Syncs now, whenever the page becomes visible, and every LIBRARY_SYNC_INTERVAL_MS while visible; returns a stop function. */
export function startAutoSync(): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncLibrary()
  }
  document.addEventListener('visibilitychange', onVisible)
  const timer = setInterval(onVisible, LIBRARY_SYNC_INTERVAL_MS)
  void syncLibrary()
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
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

async function touch(pdfId: string, entry: CachedFile): Promise<Blob> {
  await idbSet('files', pdfId, { ...entry, openedAt: Date.now() })
  return entry.blob
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

/** Returns the PDF from cache when its version matches, else downloads and caches it; falls back to a stale copy when the download fails. */
export async function getPdfBlob(pdfId: string, onProgress?: (frac: number) => void): Promise<Blob> {
  const entry = await idbGet<CachedFile>('files', pdfId)
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
    await idbSet('files', pdfId, { version: node.version, blob, size: blob.size, openedAt: Date.now() })
    await evict(pdfId)
  } catch {
    // Returns the downloaded blob even when it cannot be cached.
  }
  onProgress?.(1)
  return blob
}

/** The latest local sidecar (including an unsaved debounced edit), or an empty one. */
export async function loadSidecar(pdfId: string): Promise<Sidecar> {
  const pending = pendingSaves.get(pdfId)
  if (pending) return pending.sidecar
  const stored = await idbGet<StoredSidecar>('sidecars', pdfId)
  return stored?.sidecar ?? emptySidecar(pdfId, library.peek()?.papers[pdfId]?.name ?? '', 0)
}

async function persist(pdfId: string, sidecar: Sidecar): Promise<void> {
  await localLane(async () => {
    const stored = await idbGet<StoredSidecar>('sidecars', pdfId)
    const merged = stored ? mergeSidecars(stored.sidecar, sidecar) : sidecar
    await idbSet('sidecars', pdfId, { sidecar: merged, remoteVersion: stored?.remoteVersion, dirty: true })
    await idbSet('queue', pdfId, { queuedAt: Date.now() })
  })
  if (getAccessToken()) void flushQueue()
}

/** Debounced by SIDECAR_SAVE_DEBOUNCE_MS: merges into the local copy, marks it dirty and queues an upload. */
export function saveSidecar(pdfId: string, sidecar: Sidecar): void {
  const previous = pendingSaves.get(pdfId)
  if (previous) clearTimeout(previous.timer)
  const timer = setTimeout(() => {
    void persist(pdfId, sidecar).finally(() => {
      if (pendingSaves.get(pdfId)?.timer === timer) pendingSaves.delete(pdfId)
    })
  }, SIDECAR_SAVE_DEBOUNCE_MS)
  pendingSaves.set(pdfId, { sidecar, timer })
}

/** If the remote sidecar's version differs from the one last merged: download, merge, store and return it; else null. */
export async function refreshSidecar(pdfId: string): Promise<Sidecar | null> {
  const known = library.peek()?.sidecars[pdfId]
  if (!known || !getAccessToken()) return null
  const remoteNode = await getNode(known.id)
  const stored = await idbGet<StoredSidecar>('sidecars', pdfId)
  if (stored?.remoteVersion === remoteNode.version) return null
  const remote = await downloadJson<Sidecar>(known.id)
  const merged = await localLane(async () => {
    const latest = await idbGet<StoredSidecar>('sidecars', pdfId)
    const sidecar = latest ? mergeSidecars(latest.sidecar, remote) : remote
    await idbSet('sidecars', pdfId, { sidecar, remoteVersion: remoteNode.version, dirty: latest?.dirty ?? false })
    return sidecar
  })
  const pending = pendingSaves.get(pdfId)
  return pending ? mergeSidecars(merged, pending.sidecar) : merged
}

// Uploads one queued sidecar, merging first if the remote moved, and records the new remote version.
async function flushOne(pdfId: string): Promise<void> {
  const stored = await idbGet<StoredSidecar>('sidecars', pdfId)
  if (!stored) {
    await idbDel('queue', pdfId)
    return
  }
  const index = library.peek()
  const known = index?.sidecars[pdfId]
  let body = stored.sidecar
  let node: DriveNode
  if (known) {
    const remote = await getNode(known.id)
    if (remote.version !== stored.remoteVersion) body = mergeSidecars(body, await downloadJson<Sidecar>(known.id))
    node = await updateJsonFile(known.id, body)
  } else {
    const paper = index?.papers[pdfId]
    if (!paper) return
    const parent = paper.parents.find((id) => has(index.folders, id)) ?? paper.parents[0]
    node = await createJsonFile(sidecarNameFor(paper.name), parent, body, { marginalia: '1', pdf: pdfId })
  }
  const current = library.peek()
  if (current) await commit({ ...current, sidecars: { ...current.sidecars, [pdfId]: node } })
  await localLane(async () => {
    const latest = await idbGet<StoredSidecar>('sidecars', pdfId)
    if (latest && JSON.stringify(latest.sidecar) !== JSON.stringify(stored.sidecar)) {
      await idbSet('sidecars', pdfId, { sidecar: mergeSidecars(latest.sidecar, body), remoteVersion: node.version, dirty: true })
    } else {
      await idbSet('sidecars', pdfId, { sidecar: body, remoteVersion: node.version, dirty: false })
      await idbDel('queue', pdfId)
    }
  })
}

/** Uploads every queued sidecar; failures stay queued. */
export function flushQueue(): Promise<void> {
  return driveLane(async () => {
    if (!getAccessToken()) return
    for (const pdfId of await idbKeys('queue')) {
      try {
        await flushOne(pdfId)
      } catch (err) {
        if (err instanceof DriveError && err.status === 401) return
      }
    }
  })
}
