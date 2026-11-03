import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LIBRARY_SYNC_INTERVAL_MS, PDF_CACHE_LIMIT_BYTES, SIDECAR_SAVE_DEBOUNCE_MS } from '../config'
import { FOLDER_MIME, PDF_MIME, emptySidecar, type AreaHighlight, type Sidecar } from '../types'
import { FakeDrive, driveError, signIn } from './test-helpers'

type Library = typeof import('./library')
type Idb = typeof import('../lib/idb')

interface StoredSidecar {
  sidecar: Sidecar
  remoteId?: string
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

  test('changes drop a paper moved out of the tree, with its sidecar', async () => {
    folder('f1', 'root')
    paper('p1', 'f1')
    remoteSidecar('s1', 'p1', 'f1', withHighlights('p1'))
    await lib.setRootFolder(ROOT)

    drive.update('p1', { parents: ['elsewhere'] })
    await lib.syncLibrary()

    expect(lib.library.value!.papers).toEqual({})
    expect(lib.library.value!.sidecars).toEqual({})
    expect(lib.childrenOf('f1').papers).toEqual([])
  })

  test('syncLibrary resolves with an error state when local storage fails during the flush', async () => {
    vi.resetModules()
    vi.doMock('../lib/idb', async (importOriginal) => ({
      ...(await importOriginal<Idb>()),
      idbKeys: () => Promise.reject(new Error('storage unavailable')),
    }))
    try {
      await signIn()
      const mocked = await import('./library')
      await expect(mocked.setRootFolder(ROOT)).resolves.toBeUndefined()
      expect(mocked.syncState.value).toMatchObject({ status: 'error', message: 'storage unavailable' })
    } finally {
      vi.doUnmock('../lib/idb')
    }
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
    await idb.idbSet('sidecars', 'p1', { sidecar: withHighlights('p1', 'a'), remoteId: 's1', remoteVersion: '1', dirty: false })
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

  test.each([
    ['appProperties', true],
    ['name in the same folder', false],
  ])('flushQueue updates a sidecar already in Drive (found by %s) instead of creating one', async (_how, tagged) => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    remoteSidecar('other-device', 'p1', 'root', withHighlights('p1', 'theirs'), tagged)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    lib.saveSidecar('p1', withHighlights('p1', 'mine'))
    await vi.advanceTimersByTimeAsync(SIDECAR_SAVE_DEBOUNCE_MS)
    await lib.flushQueue()

    expect(drive.calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    expect(drive.calls.filter((c) => c.method === 'PATCH').map((c) => c.url.pathname)).toEqual([
      '/upload/drive/v3/files/other-device',
    ])
    expect(lib.library.value!.sidecars.p1.id).toBe('other-device')
    expect(drive.json<Sidecar>('other-device').highlights.map((h) => h.id).sort()).toEqual(['mine', 'theirs'])
  })

  test('flushPendingWrites stores a debounced edit right away, and pagehide triggers it', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })

    lib.saveSidecar('p1', withHighlights('p1', 'a'))
    await lib.flushPendingWrites()

    expect((await idb.idbGet<StoredSidecar>('sidecars', 'p1'))!.sidecar.highlights.map((h) => h.id)).toEqual(['a'])
    expect(await idb.idbKeys('queue')).toContain('p1')

    const stop = lib.startAutoSync()
    lib.saveSidecar('p2', withHighlights('p2', 'b'))
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(async () => expect(await idb.idbGet('sidecars', 'p2')).toBeDefined(), { interval: 1, timeout: 100 })
    stop()
  })

  test('a failed local write keeps the edit pending, reports it, and the retry stores it', async () => {
    vi.resetModules()
    let failNext = true
    vi.doMock('../lib/idb', async (importOriginal) => {
      const real = await importOriginal<Idb>()
      return {
        ...real,
        idbSet: (store: Parameters<Idb['idbSet']>[0], key: string, value: unknown) => {
          if (store === 'sidecars' && failNext) {
            failNext = false
            return Promise.reject(new Error('connection closed'))
          }
          return real.idbSet(store, key, value)
        },
      }
    })
    try {
      await signIn()
      const mocked = await import('./library')
      const mockedIdb = await import('../lib/idb')
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      mocked.saveSidecar('p1', withHighlights('p1', 'a'))
      await mocked.flushPendingWrites()

      expect(mocked.syncState.value.status).toBe('error')
      expect(await mockedIdb.idbGet('sidecars', 'p1')).toBeUndefined()
      expect((await mocked.loadSidecar('p1')).highlights.map((h) => h.id)).toEqual(['a'])

      await vi.advanceTimersByTimeAsync(SIDECAR_SAVE_DEBOUNCE_MS)
      await vi.waitFor(async () => expect(await mockedIdb.idbGet('sidecars', 'p1')).toBeDefined())
      expect((await mockedIdb.idbGet<StoredSidecar>('sidecars', 'p1'))!.sidecar.highlights.map((h) => h.id)).toEqual(['a'])
      expect(await mockedIdb.idbKeys('queue')).toEqual(['p1'])
    } finally {
      vi.doUnmock('../lib/idb')
    }
  })

  test('a label rename survives save and reload', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    const base = withHighlights('p1', 'a')

    lib.saveSidecar('p1', { ...base, colorLabels: { yellow: 'claims' } })
    await lib.flushPendingWrites()
    lib.saveSidecar('p1', { ...base, colorLabels: { yellow: 'key claims' } })
    await lib.flushPendingWrites()
    await lib.flushQueue()

    expect((await lib.loadSidecar('p1')).colorLabels).toEqual({ yellow: 'key claims' })
  })

  test('a different remote file with the same version still counts as moved', async () => {
    paper('p1', 'root')
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1', 'a'))
    await lib.setRootFolder(ROOT)
    await idb.idbSet('sidecars', 'p1', { sidecar: withHighlights('p1', 'a'), remoteId: 's1', remoteVersion: '1', dirty: false })
    drive.remove('s1')
    remoteSidecar('s2', 'p1', 'root', withHighlights('p1', 'a', 'replacement'))
    await lib.syncLibrary()
    expect(lib.library.value!.sidecars.p1.id).toBe('s2')

    const merged = await lib.refreshSidecar('p1')
    expect(merged!.highlights.map((h) => h.id).sort()).toEqual(['a', 'replacement'])

    await idb.idbSet('sidecars', 'p1', { sidecar: withHighlights('p1', 'a', 'local'), remoteId: 's1', remoteVersion: '1', dirty: true })
    await idb.idbSet('queue', 'p1', { queuedAt: 0 })
    await lib.flushQueue()
    expect(drive.json<Sidecar>('s2').highlights.map((h) => h.id).sort()).toEqual(['a', 'local', 'replacement'])
  })

  test('failed uploads surface in syncState while staying queued', async () => {
    paper('p1', 'root')
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1'))
    await lib.setRootFolder(ROOT)
    drive.failWhen.push((call) => (call.method === 'PATCH' ? driveError(403, 'insufficientFilePermissions') : undefined))
    await idb.idbSet('sidecars', 'p1', { sidecar: withHighlights('p1', 'a'), dirty: true })
    await idb.idbSet('queue', 'p1', { queuedAt: 0 })

    await lib.syncLibrary()

    expect(lib.syncState.value).toMatchObject({ status: 'error', message: '1 annotation upload(s) failed' })
    expect(lib.syncState.value.at).toBeTypeOf('number')
    expect(await idb.idbKeys('queue')).toEqual(['p1'])
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
    await idb.idbSet('sidecars', 'p1', { sidecar: withHighlights('p1', 'a', 'mine'), remoteId: 's1', remoteVersion: '1', dirty: true })

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

  test('pdfCacheBytes sums cached PDFs and clearPdfCache empties the cache but keeps sidecars', async () => {
    paper('p1', 'root', 'p1.pdf', '%PDF-one')
    paper('p2', 'root', 'p2.pdf', '%PDF-twelve')
    await lib.setRootFolder(ROOT)
    expect(await lib.pdfCacheBytes()).toBe(0)
    await lib.getPdfBlob('p1')
    await lib.getPdfBlob('p2')
    lib.saveSidecar('p1', withHighlights('p1', 'h1'))
    await lib.flushPendingWrites()

    expect(await lib.pdfCacheBytes()).toBe('%PDF-one'.length + '%PDF-twelve'.length)
    await lib.clearPdfCache()

    expect(await lib.pdfCacheBytes()).toBe(0)
    expect(await lib.isCached('p1')).toBe(false)
    expect((await lib.loadSidecar('p1')).highlights.map((h) => h.id)).toEqual(['h1'])
  })
})
