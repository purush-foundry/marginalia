import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LIBRARY_SYNC_INTERVAL_MS, PDF_CACHE_LIMIT_BYTES, SIDECAR_SAVE_DEBOUNCE_MS } from '../config'
import { FOLDER_MIME, PDF_MIME, emptySidecar, type AreaHighlight, type Sidecar } from '../types'
import { FakeDrive, driveError, signIn } from './test-helpers'

type Library = typeof import('./library')
type Idb = typeof import('../lib/idb')

interface StoredSidecar {
  sidecar: Sidecar
  remoteVersion?: string
  dirty: boolean
}

const ROOT = { id: 'root', name: 'Papers', mimeType: FOLDER_MIME, parents: ['mydrive'], modifiedTime: 't', version: '1' }

function hl(id: string, updatedAt: number): AreaHighlight {
  return { kind: 'area', id, createdAt: updatedAt, updatedAt, page: 1, color: 'yellow', box: { x: 0, y: 0, w: 0.1, h: 0.1 } }
}

function withHighlights(pdfId: string, ...ids: string[]): Sidecar {
  return { ...emptySidecar(pdfId, `${pdfId}.pdf`, 0), highlights: ids.map((id, i) => hl(id, i + 1)) }
}

let drive: FakeDrive
let lib: Library
let idb: Idb

beforeEach(async () => {
  vi.resetModules()
  await signIn()
  lib = await import('./library')
  idb = await import('../lib/idb')
  drive = new FakeDrive()
  drive.add({ ...ROOT })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete window.google
})

function folder(id: string, parent: string, name = id) {
  drive.add({ id, name, mimeType: FOLDER_MIME, parents: [parent] })
}

function paper(id: string, parent: string, name = `${id}.pdf`, content = '%PDF') {
  drive.add({ id, name, mimeType: PDF_MIME, parents: [parent], content })
}

function remoteSidecar(id: string, pdfId: string, parent: string, sidecar: Sidecar, appPdf = true) {
  drive.add({
    id,
    name: `${pdfId}.marginalia.json`,
    mimeType: 'application/json',
    parents: [parent],
    appProperties: appPdf ? { marginalia: '1', pdf: pdfId } : undefined,
    content: JSON.stringify(sidecar),
  })
}

describe('library mirror', () => {
  test('full walk builds the tree, keeps only folders, PDFs and sidecars, and maps sidecars to PDFs', async () => {
    folder('f1', 'root')
    folder('f2', 'f1')
    paper('p1', 'root')
    paper('p2', 'f2')
    drive.add({ id: 'txt', name: 'notes.txt', mimeType: 'text/plain', parents: ['root'] })
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1'), false)
    remoteSidecar('s2', 'p2', 'f2', withHighlights('p2'))
    remoteSidecar('orphan', 'gone', 'root', withHighlights('gone'))

    await lib.setRootFolder(ROOT)

    const index = lib.library.value!
    expect(Object.keys(index.folders).sort()).toEqual(['f1', 'f2', 'root'])
    expect(Object.keys(index.papers).sort()).toEqual(['p1', 'p2'])
    expect(index.sidecars.p1.id).toBe('s1')
    expect(index.sidecars.p2.id).toBe('s2')
    expect(Object.keys(index.sidecars)).toHaveLength(2)
    expect(index.changesToken).toBeDefined()
    expect(lib.syncState.value.status).toBe('idle')
    expect(lib.pathTo('p2').map((n) => n.id)).toEqual(['root', 'f1', 'f2', 'p2'])

    lib.library.value = null
    await lib.loadLibrary()
    expect(lib.library.value).toEqual(index)
  })

  test('childrenOf lists folders then papers, each by name', async () => {
    folder('fb', 'root', 'beta')
    folder('fa', 'root', 'Alpha')
    paper('p10', 'root', 'paper 10.pdf')
    paper('p9', 'root', 'paper 9.pdf')
    paper('deep', 'fa')

    await lib.setRootFolder(ROOT)

    const { folders, papers } = lib.childrenOf('root')
    expect(folders.map((n) => n.name)).toEqual(['Alpha', 'beta'])
    expect(papers.map((n) => n.name)).toEqual(['paper 9.pdf', 'paper 10.pdf'])
  })

  test('changes remove trashed and deleted files, drop descendants, walk new folders, ignore outsiders', async () => {
    folder('f1', 'root')
    paper('p1', 'root')
    paper('p2', 'f1')
    remoteSidecar('s2', 'p2', 'f1', withHighlights('p2'))
    await lib.setRootFolder(ROOT)

    drive.update('p1', { trashed: true })
    drive.remove('f1')
    folder('f3', 'root')
    paper('p3', 'f3')
    paper('outside', 'elsewhere')
    const listCallsBefore = drive.calls.filter((c) => c.url.pathname === '/drive/v3/files').length

    await lib.syncLibrary()

    const index = lib.library.value!
    expect(Object.keys(index.papers).sort()).toEqual(['p3'])
    expect(Object.keys(index.folders).sort()).toEqual(['f3', 'root'])
    expect(index.sidecars).toEqual({})
    const lists = drive.calls.filter((c) => c.url.pathname === '/drive/v3/files').slice(listCallsBefore)
    expect(lists.map((c) => c.url.searchParams.get('q'))).toEqual(["('f3' in parents) and trashed = false"])
  })

  test('syncLibrary never throws and reports offline when the network fails', async () => {
    await lib.setRootFolder(ROOT)
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    await expect(lib.syncLibrary()).resolves.toBeUndefined()
    expect(lib.syncState.value.status).toBe('offline')
  })

  test('startAutoSync syncs now, when the page becomes visible, and on an interval', async () => {
    await lib.setRootFolder(ROOT)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const changeCalls = () => drive.calls.filter((c) => c.url.pathname === '/drive/v3/changes').length
    const before = changeCalls()

    const stop = lib.startAutoSync()
    await vi.waitFor(() => expect(changeCalls()).toBe(before + 1))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(changeCalls()).toBe(before + 2))
    await vi.advanceTimersByTimeAsync(LIBRARY_SYNC_INTERVAL_MS)
    await vi.waitFor(() => expect(changeCalls()).toBe(before + 3))
    stop()
    await vi.advanceTimersByTimeAsync(LIBRARY_SYNC_INTERVAL_MS)
    expect(changeCalls()).toBe(before + 3)
  })
})

describe('sidecars', () => {
  test('sidecarNameFor swaps the .pdf extension for the sidecar suffix', () => {
    expect(lib.sidecarNameFor('Attention Is All You Need.pdf')).toBe('Attention Is All You Need.marginalia.json')
    expect(lib.sidecarNameFor('scan.PDF')).toBe('scan.marginalia.json')
  })

  test('loadSidecar returns an empty sidecar for an unseen paper', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    const sidecar = await lib.loadSidecar('p1')
    expect(sidecar).toMatchObject({ pdfId: 'p1', pdfName: 'p1.pdf', highlights: [] })
  })

  test('saveSidecar debounces into IndexedDB and flushQueue creates the sidecar, then updates it', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    lib.saveSidecar('p1', withHighlights('p1', 'a'))
    lib.saveSidecar('p1', withHighlights('p1', 'a', 'b'))
    expect(await idb.idbGet('sidecars', 'p1')).toBeUndefined()
    expect((await lib.loadSidecar('p1')).highlights).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(SIDECAR_SAVE_DEBOUNCE_MS)
    await lib.flushQueue()

    const posts = drive.calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(1)
    const sidecarId = lib.library.value!.sidecars.p1.id
    const created = drive.files.get(sidecarId)!
    expect(created).toMatchObject({ name: 'p1.marginalia.json', parents: ['root'], appProperties: { marginalia: '1', pdf: 'p1' } })
    expect(drive.json<Sidecar>(sidecarId).highlights.map((h) => h.id)).toEqual(['a', 'b'])
    expect(await idb.idbGet<StoredSidecar>('sidecars', 'p1')).toMatchObject({ dirty: false, remoteVersion: '1' })
    expect(await idb.idbKeys('queue')).toEqual([])

    lib.saveSidecar('p1', withHighlights('p1', 'a', 'b', 'c'))
    await vi.advanceTimersByTimeAsync(SIDECAR_SAVE_DEBOUNCE_MS)
    await lib.flushQueue()

    expect(drive.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    expect(drive.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
    expect(drive.json<Sidecar>(sidecarId).highlights.map((h) => h.id)).toEqual(['a', 'b', 'c'])
    expect(await idb.idbGet<StoredSidecar>('sidecars', 'p1')).toMatchObject({ dirty: false, remoteVersion: '2' })
  })

  test('flushQueue merges a remote that moved before uploading', async () => {
    paper('p1', 'root')
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1', 'a'))
    await lib.setRootFolder(ROOT)
    await idb.idbSet('sidecars', 'p1', { sidecar: withHighlights('p1', 'a'), remoteVersion: '1', dirty: false })
    drive.update('s1', { content: JSON.stringify(withHighlights('p1', 'a', 'remote')) })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    lib.saveSidecar('p1', { ...withHighlights('p1', 'a'), highlights: [hl('a', 1), hl('local', 5)] })
    await vi.advanceTimersByTimeAsync(SIDECAR_SAVE_DEBOUNCE_MS)
    await lib.flushQueue()

    expect(drive.json<Sidecar>('s1').highlights.map((h) => h.id).sort()).toEqual(['a', 'local', 'remote'])
    const stored = await idb.idbGet<StoredSidecar>('sidecars', 'p1')
    expect(stored!.sidecar.highlights.map((h) => h.id).sort()).toEqual(['a', 'local', 'remote'])
    expect(stored).toMatchObject({ dirty: false, remoteVersion: '3' })
  })

  test('a failed upload stays queued and dirty', async () => {
    paper('p1', 'root')
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1'))
    await lib.setRootFolder(ROOT)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    drive.failWhen.push((call) => (call.method === 'PATCH' ? driveError(500, 'backendError') : undefined))

    lib.saveSidecar('p1', withHighlights('p1', 'a'))
    await vi.advanceTimersByTimeAsync(SIDECAR_SAVE_DEBOUNCE_MS)
    await lib.flushQueue()

    expect(await idb.idbKeys('queue')).toEqual(['p1'])
    expect((await idb.idbGet<StoredSidecar>('sidecars', 'p1'))!.dirty).toBe(true)
    expect(drive.json<Sidecar>('s1').highlights).toEqual([])
  })

  test('refreshSidecar merges when the remote version moved and returns null otherwise', async () => {
    paper('p1', 'root')
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1', 'a'))
    await lib.setRootFolder(ROOT)
    await idb.idbSet('sidecars', 'p1', { sidecar: withHighlights('p1', 'a', 'mine'), remoteVersion: '1', dirty: true })

    expect(await lib.refreshSidecar('p1')).toBeNull()

    drive.update('s1', { content: JSON.stringify(withHighlights('p1', 'a', 'theirs')) })
    const merged = await lib.refreshSidecar('p1')

    expect(merged!.highlights.map((h) => h.id).sort()).toEqual(['a', 'mine', 'theirs'])
    const stored = await idb.idbGet<StoredSidecar>('sidecars', 'p1')
    expect(stored).toMatchObject({ remoteVersion: '2', dirty: true })
    expect(stored!.sidecar).toEqual(merged)
    expect(await lib.loadSidecar('p1')).toEqual(merged)
  })
})

describe('PDF cache', () => {
  test('downloads once, then serves the cached blob while the version is unchanged', async () => {
    paper('p1', 'root', 'p1.pdf', '%PDF-one')
    await lib.setRootFolder(ROOT)
    const progress: number[] = []

    expect(await lib.isCached('p1')).toBe(false)
    expect(await (await lib.getPdfBlob('p1', (f) => progress.push(f))).text()).toBe('%PDF-one')
    expect(progress.at(-1)).toBe(1)
    expect(await lib.isCached('p1')).toBe(true)

    const downloads = () => drive.calls.filter((c) => c.url.searchParams.get('alt') === 'media').length
    await lib.getPdfBlob('p1')
    expect(downloads()).toBe(1)

    drive.update('p1', { content: '%PDF-two' })
    await lib.syncLibrary()
    expect(await lib.isCached('p1')).toBe(false)
    expect(await (await lib.getPdfBlob('p1')).text()).toBe('%PDF-two')
    expect(downloads()).toBe(2)
  })

  test('evicts the least recently opened PDFs above the cache limit', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    const big = (openedAt: number, share: number) => ({
      version: '1',
      blob: new Blob(['x']),
      size: Math.floor(PDF_CACHE_LIMIT_BYTES * share),
      openedAt,
    })
    await idb.idbSet('files', 'oldest', big(1, 0.5))
    await idb.idbSet('files', 'older', big(2, 0.3))
    await idb.idbSet('files', 'recent', big(3, 0.3))

    await lib.getPdfBlob('p1')

    expect((await idb.idbKeys('files')).sort()).toEqual(['older', 'p1', 'recent'])
  })
})
