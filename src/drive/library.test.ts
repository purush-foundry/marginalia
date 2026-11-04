import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LIBRARY_SYNC_INTERVAL_MS, PDF_CACHE_LIMIT_BYTES, SIDECAR_SAVE_DEBOUNCE_MS } from '../config'
import { FIRST_PAGE_ID, convertV1, emptyNotebook, isNotebookDoc, type ImageObject, type NotesDocV2, type TextObject } from '../notes/model'
import { FOLDER_MIME, PDF_MIME, emptyNotes, emptySidecar, type AreaHighlight, type NotesDoc, type Sidecar, type TextBlock } from '../types'
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

interface StoredNotes {
  sidecar: NotesDocV2
  remoteId?: string
  remoteVersion?: string
  dirty: boolean
}

function block(id: string, updatedAt: number): TextBlock {
  return { kind: 'text', id, createdAt: updatedAt, updatedAt, order: `k${updatedAt}`, text: id }
}

function withBlocks(pdfId: string, ...ids: string[]): NotesDoc {
  return { ...emptyNotes(pdfId, `${pdfId}.pdf`, 0), blocks: ids.map((id, i) => block(id, i + 1)) }
}

function note(id: string, updatedAt: number): TextObject {
  return { id, createdAt: updatedAt, updatedAt, page: FIRST_PAGE_ID, box: { x: 0.1, y: 0.1, w: 0.5 }, text: id, size: 'm', color: '#000', z: `k${updatedAt}` }
}

function withTexts(pdfId: string, ...ids: string[]): NotesDocV2 {
  return { ...emptyNotebook(pdfId, `${pdfId}.pdf`, 0), texts: ids.map((id, i) => note(id, i + 1)) }
}

const textIds = (doc: NotesDocV2) => doc.texts.map((t) => t.id).sort()

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

function remoteNotes(id: string, pdfId: string, parent: string, doc: NotesDoc | NotesDocV2, tagged = true) {
  drive.add({
    id,
    name: `${pdfId}.marginalia-notes.json`,
    mimeType: 'application/json',
    parents: [parent],
    appProperties: tagged ? { marginalia: 'notes', notesFor: pdfId } : undefined,
    content: JSON.stringify(doc),
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

  test('the first sync after upgrading from a v1 index walks once to find existing notes files and home pictures', async () => {
    paper('p1', 'root')
    remoteNotes('n1', 'p1', 'root', withTexts('p1', 'a'))
    drive.add({ id: 'art', name: 'marginalia-home.png', mimeType: 'image/png', parents: ['root'] })
    const p1 = { id: 'p1', name: 'p1.pdf', mimeType: PDF_MIME, parents: ['root'], modifiedTime: '2026-01-01T00:00:00Z', version: '1', size: 4 }
    await idb.idbSet('meta', 'library', {
      rootId: 'root',
      rootName: 'Papers',
      folders: { root: { ...ROOT } },
      papers: { p1 },
      sidecars: {},
      syncedAt: 1,
      changesToken: String(drive.changeLog.length),
    })
    await lib.loadLibrary()

    await lib.syncLibrary()

    const index = lib.library.value!
    expect(index.notes!.p1.id).toBe('n1')
    expect(index.homeArt!.generic!.id).toBe('art')
    expect(textIds(await lib.loadNotebook('p1'))).toEqual(['a'])

    const lists = () => drive.calls.filter((c) => c.url.pathname === '/drive/v3/files').length
    const before = lists()
    await lib.syncLibrary()
    expect(lists()).toBe(before)
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
    expect((await lib.loadSidecar('p1')).highlights.map((h) => h.id).sort()).toEqual(['a', 'replacement'])

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

  test('refreshSidecar finds a sidecar the index has not seen yet and records it', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    remoteSidecar('other-device', 'p1', 'root', withHighlights('p1', 'theirs'))

    const merged = await lib.refreshSidecar('p1')

    expect(merged!.highlights.map((h) => h.id)).toEqual(['theirs'])
    expect(lib.library.value!.sidecars.p1.id).toBe('other-device')
  })

  test('syncLibrary merges sidecars another device created or changed, and bumps sidecarRevision', async () => {
    paper('p1', 'root')
    const done: Sidecar = { ...withHighlights('p1', 'a'), reading: { page: 4, offset: 0, zoom: 0, status: 'done', updatedAt: 9 } }
    remoteSidecar('s1', 'p1', 'root', done)
    await lib.setRootFolder(ROOT)

    expect((await lib.loadSidecar('p1')).reading.status).toBe('done')
    expect(await idb.idbGet<StoredSidecar>('sidecars', 'p1')).toMatchObject({ remoteId: 's1', remoteVersion: '1', dirty: false })
    const revision = lib.sidecarRevision.value

    drive.update('s1', { content: JSON.stringify({ ...done, highlights: [hl('a', 1), hl('b', 2)] }) })
    await lib.syncLibrary()

    expect((await lib.loadSidecar('p1')).highlights.map((h) => h.id)).toEqual(['a', 'b'])
    expect(lib.sidecarRevision.value).toBe(revision + 1)
    const downloads = () => drive.calls.filter((c) => c.url.pathname === '/drive/v3/files/s1' && c.url.searchParams.get('alt') === 'media').length
    const before = downloads()
    await lib.syncLibrary()
    expect(downloads()).toBe(before)
  })

  test('a sidecar that fails to download does not stop the others from being pulled', async () => {
    paper('p1', 'root')
    paper('p2', 'root')
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1', 'a'))
    remoteSidecar('s2', 'p2', 'root', withHighlights('p2', 'b'))
    drive.failWhen.push((call) => (call.url.pathname === '/drive/v3/files/s1' && call.url.searchParams.get('alt') === 'media' ? driveError(500, 'backendError') : undefined))

    await lib.setRootFolder(ROOT)

    expect((await lib.loadSidecar('p2')).highlights.map((h) => h.id)).toEqual(['b'])
    expect(await idb.idbGet('sidecars', 'p1')).toBeUndefined()
    expect(lib.syncState.value).toMatchObject({ status: 'error', message: '1 annotation download(s) failed' })
  })

  test('an offline sidecar download reports offline', async () => {
    paper('p1', 'root')
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1', 'a'))
    drive.failWhen.push((call) => {
      if (call.url.pathname === '/drive/v3/files/s1' && call.url.searchParams.get('alt') === 'media') throw new TypeError('Failed to fetch')
      return undefined
    })

    await lib.setRootFolder(ROOT)

    expect(lib.syncState.value.status).toBe('offline')
  })

  test('an offline upload failure reports offline, not an error', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    await idb.idbSet('sidecars', 'p1', { sidecar: withHighlights('p1', 'a'), dirty: true })
    await idb.idbSet('queue', 'p1', { queuedAt: 0 })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    await lib.flushQueue()

    expect(lib.syncState.value.status).toBe('offline')
    expect(await idb.idbKeys('queue')).toEqual(['p1'])
  })

  test('flushQueue recreates a sidecar deleted in Drive instead of failing on it', async () => {
    paper('p1', 'root')
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1'))
    await lib.setRootFolder(ROOT)
    drive.remove('s1')
    await idb.idbSet('sidecars', 'p1', { sidecar: withHighlights('p1', 'a'), remoteId: 's1', remoteVersion: '1', dirty: true })
    await idb.idbSet('queue', 'p1', { queuedAt: 0 })

    await lib.flushQueue()

    const id = lib.library.value!.sidecars.p1.id
    expect(id).not.toBe('s1')
    expect(drive.json<Sidecar>(id).highlights.map((h) => h.id)).toEqual(['a'])
    expect(await idb.idbKeys('queue')).toEqual([])
    expect(lib.syncState.value.status).not.toBe('error')
  })

  test('flushQueue drops queue entries for papers outside the library', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    await idb.idbSet('sidecars', 'elsewhere', { sidecar: withHighlights('elsewhere', 'a'), dirty: true })
    await idb.idbSet('queue', 'elsewhere', { queuedAt: 0 })

    await lib.flushQueue()

    expect(await idb.idbKeys('queue')).toEqual([])
    expect(drive.calls.filter((c) => c.method !== 'GET')).toEqual([])
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

  test('a stored sidecar record holding a notes document opens as an empty sidecar and is replaced on the next save', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    await idb.idbSet('sidecars', 'p1', { sidecar: withBlocks('p1', 'stray'), remoteId: 'n1', remoteVersion: '1', dirty: false })

    expect(await lib.loadSidecar('p1')).toEqual(emptySidecar('p1', 'p1.pdf', 0))
    expect(await idb.idbGet('sidecars', 'p1')).toBeUndefined()

    await idb.idbSet('sidecars', 'p1', { sidecar: withBlocks('p1', 'stray'), remoteId: 'n1', remoteVersion: '1', dirty: false })
    lib.saveSidecar('p1', withHighlights('p1', 'a'))
    await lib.flushPendingWrites()
    expect(await idb.idbGet<StoredSidecar>('sidecars', 'p1')).toEqual({ sidecar: withHighlights('p1', 'a'), dirty: true })

    await lib.flushQueue()
    const sidecarId = lib.library.value!.sidecars.p1.id
    expect(drive.json<Sidecar>(sidecarId)).toEqual(withHighlights('p1', 'a'))
    expect(await idb.idbGet<StoredSidecar>('sidecars', 'p1')).toMatchObject({ sidecar: withHighlights('p1', 'a'), dirty: false })
  })

  test('a queued sidecar record without highlights is never uploaded', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    await idb.idbSet('sidecars', 'p1', { sidecar: withBlocks('p1', 'stray'), dirty: true })
    await idb.idbSet('queue', 'p1', { queuedAt: 0 })

    await lib.flushQueue()

    expect(drive.calls.filter((c) => c.method !== 'GET')).toEqual([])
    expect(await idb.idbKeys('queue')).toEqual([])
    expect(lib.syncState.value.status).toBe('idle')
  })

  test.each([
    ['refreshSidecar', (l: Library) => l.refreshSidecar('p1')],
    ['syncLibrary', (l: Library) => l.syncLibrary()],
  ])('a downloaded sidecar body without highlights is never merged (%s)', async (_path, run) => {
    paper('p1', 'root')
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1', 'theirs'))
    await lib.setRootFolder(ROOT)
    const local = withHighlights('p1', 'mine')
    await idb.idbSet('sidecars', 'p1', { sidecar: local, remoteId: 's1', remoteVersion: '1', dirty: false })
    const revision = lib.sidecarRevision.value
    drive.update('s1', { content: JSON.stringify(withBlocks('p1', 'stray')) })

    await run(lib)

    expect(lib.sidecarRevision.value).toBe(revision)
    expect(await lib.loadSidecar('p1')).toEqual(local)
    await lib.flushQueue()
    expect(drive.json<Sidecar>('s1')).toEqual(local)
  })

})

describe('notes', () => {
  test('notesNameFor swaps .pdf for .marginalia-notes.json', () => {
    expect(lib.notesNameFor('Attention.pdf')).toBe('Attention.marginalia-notes.json')
    expect(lib.notesNameFor('scan.PDF')).toBe('scan.marginalia-notes.json')
  })

  test('loadNotebook returns an empty notebook for an unseen paper', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    expect(await lib.loadNotebook('p1')).toEqual(emptyNotebook('p1', 'p1.pdf', 0))
  })

  test('saveNotebook debounces into IndexedDB and flushQueue creates the notes file, then updates it', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    lib.saveNotebook('p1', withTexts('p1', 'a'))
    lib.saveNotebook('p1', withTexts('p1', 'a', 'b'))
    expect(await idb.idbGet('notes', 'p1')).toBeUndefined()
    expect(textIds(await lib.loadNotebook('p1'))).toEqual(['a', 'b'])
    await vi.advanceTimersByTimeAsync(SIDECAR_SAVE_DEBOUNCE_MS)
    await lib.flushQueue()

    expect(drive.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    const notesId = lib.library.value!.notes!.p1.id
    expect(drive.files.get(notesId)).toMatchObject({
      name: 'p1.marginalia-notes.json',
      parents: ['root'],
      appProperties: { marginalia: 'notes', notesFor: 'p1' },
    })
    expect(textIds(drive.json<NotesDocV2>(notesId))).toEqual(['a', 'b'])
    expect(lib.library.value!.sidecars).toEqual({})
    expect(await idb.idbGet<StoredNotes>('notes', 'p1')).toMatchObject({ dirty: false, remoteVersion: '1' })
    expect(await idb.idbKeys('queue')).toEqual([])

    lib.saveNotebook('p1', withTexts('p1', 'a', 'b', 'c'))
    await vi.advanceTimersByTimeAsync(SIDECAR_SAVE_DEBOUNCE_MS)
    await lib.flushQueue()

    expect(drive.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    expect(drive.calls.filter((c) => c.method === 'PATCH').map((c) => c.url.pathname)).toEqual([`/upload/drive/v3/files/${notesId}`])
    expect(textIds(drive.json<NotesDocV2>(notesId))).toEqual(['a', 'b', 'c'])
    expect(await idb.idbGet<StoredNotes>('notes', 'p1')).toMatchObject({ dirty: false, remoteVersion: '2' })
    expect(await idb.idbKeys('queue')).toEqual([])
  })

  test('the full walk maps notes files to index.notes and never to index.sidecars', async () => {
    paper('p1', 'root')
    paper('p2', 'root')
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1'))
    remoteNotes('n1', 'p1', 'root', withTexts('p1'))
    remoteNotes('n2', 'p2', 'root', withTexts('p2'), false)

    await lib.setRootFolder(ROOT)

    const index = lib.library.value!
    expect(Object.fromEntries(Object.entries(index.notes!).map(([pdfId, node]) => [pdfId, node.id]))).toEqual({ p1: 'n1', p2: 'n2' })
    expect(Object.fromEntries(Object.entries(index.sidecars).map(([pdfId, node]) => [pdfId, node.id]))).toEqual({ p1: 's1' })
  })

  test('changes add new notes files to index.notes and drop trashed ones', async () => {
    paper('p1', 'root')
    remoteNotes('n1', 'p1', 'root', withTexts('p1'))
    await lib.setRootFolder(ROOT)

    paper('p2', 'root')
    remoteNotes('n2', 'p2', 'root', withTexts('p2'))
    drive.update('n1', { trashed: true })
    await lib.syncLibrary()

    expect(Object.keys(lib.library.value!.notes!)).toEqual(['p2'])
    expect(lib.library.value!.notes!.p2.id).toBe('n2')
    expect(lib.library.value!.sidecars).toEqual({})
  })

  test('refreshNotebook finds an unindexed notes file by tag without matching the sidecar', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1', 'h'))
    remoteNotes('n1', 'p1', 'root', withTexts('p1', 'theirs'))

    const merged = await lib.refreshNotebook('p1')

    expect(textIds(merged!)).toEqual(['theirs'])
    expect(lib.library.value!.notes!.p1.id).toBe('n1')
    expect(lib.library.value!.sidecars.p1).toBeUndefined()
  })

  test('refreshSidecar finds an unindexed sidecar by tag without matching the notes file', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    remoteNotes('n1', 'p1', 'root', withTexts('p1', 'b'))
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1', 'theirs'))

    const merged = await lib.refreshSidecar('p1')

    expect(merged!.highlights.map((h) => h.id)).toEqual(['theirs'])
    expect(lib.library.value!.sidecars.p1.id).toBe('s1')
  })

  test('flushQueue merges a notes file that moved remotely before uploading', async () => {
    paper('p1', 'root')
    remoteNotes('n1', 'p1', 'root', withTexts('p1', 'a'))
    await lib.setRootFolder(ROOT)
    drive.update('n1', { content: JSON.stringify(withTexts('p1', 'a', 'remote')) })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    lib.saveNotebook('p1', { ...withTexts('p1'), texts: [note('a', 1), note('local', 5)] })
    await vi.advanceTimersByTimeAsync(SIDECAR_SAVE_DEBOUNCE_MS)
    await lib.flushQueue()

    expect(textIds(drive.json<NotesDocV2>('n1'))).toEqual(['a', 'local', 'remote'])
    const stored = await idb.idbGet<StoredNotes>('notes', 'p1')
    expect(textIds(stored!.sidecar)).toEqual(['a', 'local', 'remote'])
    expect(stored).toMatchObject({ dirty: false, remoteVersion: '3' })
  })

  test('notes saved offline stay queued in IndexedDB and upload after sign-in', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    const auth = await import('./auth')
    await auth.signOut()

    lib.saveNotebook('p1', withTexts('p1', 'a'))
    await lib.flushPendingWrites()

    expect(await idb.idbGet<StoredNotes>('notes', 'p1')).toMatchObject({ dirty: true })
    expect(await idb.idbKeys('queue')).toEqual(['notes:p1'])
    expect(drive.calls.filter((c) => c.method !== 'GET')).toEqual([])

    await signIn()
    await lib.syncLibrary()

    expect(textIds(drive.json<NotesDocV2>(lib.library.value!.notes!.p1.id))).toEqual(['a'])
    expect(await idb.idbKeys('queue')).toEqual([])
    expect(await idb.idbGet<StoredNotes>('notes', 'p1')).toMatchObject({ dirty: false })
  })

  test('a sidecar edit never re-uploads the notes file', async () => {
    paper('p1', 'root')
    remoteNotes('n1', 'p1', 'root', withTexts('p1', 'a'))
    await lib.setRootFolder(ROOT)
    lib.saveNotebook('p1', withTexts('p1', 'a', 'b'))
    await lib.flushPendingWrites()
    await lib.flushQueue()
    const writes = () => drive.calls.filter((c) => c.method !== 'GET')
    const before = writes().length

    lib.saveSidecar('p1', withHighlights('p1', 'h'))
    await lib.flushPendingWrites()
    await lib.flushQueue()

    const after = writes().slice(before)
    expect(after.map((c) => c.method)).toEqual(['POST'])
    expect(after.some((c) => c.url.pathname.includes('n1'))).toBe(false)
    expect(drive.json<Sidecar>(lib.library.value!.sidecars.p1.id).highlights.map((h) => h.id)).toEqual(['h'])
  })

  test('syncLibrary pulls a notes file another device changed', async () => {
    paper('p1', 'root')
    remoteNotes('n1', 'p1', 'root', withTexts('p1', 'a'))
    await lib.setRootFolder(ROOT)
    expect(textIds(await lib.loadNotebook('p1'))).toEqual(['a'])
    expect(await idb.idbGet<StoredNotes>('notes', 'p1')).toMatchObject({ remoteId: 'n1', remoteVersion: '1', dirty: false })

    const theirs = withTexts('p1', 'a', 'b')
    theirs.pages = [{ ...theirs.pages[0], template: 'grid', updatedAt: 4 }]
    drive.update('n1', { content: JSON.stringify(theirs) })
    await lib.syncLibrary()

    const doc = await lib.loadNotebook('p1')
    expect(textIds(doc)).toEqual(['a', 'b'])
    expect(doc.pages[0].template).toBe('grid')
  })

  test('a failed notes download does not stop sidecar pulls and is counted', async () => {
    paper('p1', 'root')
    remoteNotes('n1', 'p1', 'root', withTexts('p1', 'a'))
    remoteSidecar('s1', 'p1', 'root', withHighlights('p1', 'h'))
    drive.failWhen.push((call) => (call.url.pathname === '/drive/v3/files/n1' && call.url.searchParams.get('alt') === 'media' ? driveError(500, 'backendError') : undefined))

    await lib.setRootFolder(ROOT)

    expect((await lib.loadSidecar('p1')).highlights.map((h) => h.id)).toEqual(['h'])
    expect(await idb.idbGet('notes', 'p1')).toBeUndefined()
    expect(lib.syncState.value.message).toContain('1 notes download(s) failed')
  })

  test('failures of both kinds are reported together', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    drive.failWhen.push((call) => (call.method === 'POST' ? driveError(500, 'backendError') : undefined))
    await idb.idbSet('sidecars', 'p1', { sidecar: withHighlights('p1', 'a'), dirty: true })
    await idb.idbSet('queue', 'p1', { queuedAt: 0 })
    await idb.idbSet('notes', 'p1', { sidecar: withTexts('p1', 'a'), dirty: true })
    await idb.idbSet('queue', 'notes:p1', { queuedAt: 0 })

    await lib.flushQueue()

    expect(lib.syncState.value.message).toBe('1 annotation upload(s) failed · 1 notes upload(s) failed')
    expect((await idb.idbKeys('queue')).sort()).toEqual(['notes:p1', 'p1'])
  })

  test('a v1 queue entry keyed by the bare PDF id still flushes as a sidecar', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    await idb.idbSet('sidecars', 'p1', { sidecar: withHighlights('p1', 'a'), dirty: true })
    await idb.idbSet('queue', 'p1', { queuedAt: 0 })

    await lib.flushQueue()

    const created = drive.files.get(lib.library.value!.sidecars.p1.id)!
    expect(created).toMatchObject({ name: 'p1.marginalia.json', appProperties: { marginalia: '1', pdf: 'p1' } })
    expect(lib.library.value!.notes ?? {}).toEqual({})
    expect(await idb.idbKeys('queue')).toEqual([])
  })

  test('a notes file carries notesFor and no pdf key, so a v1 sidecar lookup by the pdf key never returns it', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    lib.saveNotebook('p1', withTexts('p1', 'a'))
    await lib.flushPendingWrites()
    await lib.flushQueue()

    const notesId = lib.library.value!.notes!.p1.id
    expect(drive.files.get(notesId)!.appProperties).toEqual({ marginalia: 'notes', notesFor: 'p1' })
    const q = "appProperties has { key='pdf' and value='p1' } and trashed = false"
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q })}`)
    expect(((await res.json()) as { files: unknown[] }).files).toEqual([])
    const api = await import('./api')
    expect(await api.findSidecarFile('p1', 'p1.marginalia.json', 'root')).toBeNull()
  })

  test.each([
    ['a sidecar body', '{"schema":1,"pdfId":"p1","highlights":[]}'],
    ['invalid JSON', '{"kind":"no'],
  ])('a remote notes file that is not a notes document (%s) is never merged and gets the local notes', async (_what, content) => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    const local = withTexts('p1', 'mine')
    await idb.idbSet('notes', 'p1', { sidecar: local, dirty: false })
    drive.add({ id: 'n1', name: 'p1.marginalia-notes.json', mimeType: 'application/json', parents: ['root'], appProperties: { marginalia: 'notes', notesFor: 'p1' }, content })

    expect(await lib.refreshNotebook('p1')).toBeNull()
    expect(await idb.idbGet<StoredNotes>('notes', 'p1')).toMatchObject({ sidecar: local, dirty: true })
    expect(await idb.idbKeys('queue')).toEqual(['notes:p1'])

    await lib.flushQueue()

    expect(drive.json<NotesDocV2>('n1')).toEqual(local)
    expect(await idb.idbKeys('queue')).toEqual([])
    expect(await lib.loadNotebook('p1')).toEqual(local)
  })

  test('a notes file in a newer schema with no local notes creates nothing and uploads nothing', async () => {
    paper('p1', 'root')
    const newer = JSON.stringify({ ...withTexts('p1', 'future'), schema: 3 })
    drive.add({ id: 'n1', name: 'p1.marginalia-notes.json', mimeType: 'application/json', parents: ['root'], appProperties: { marginalia: 'notes', notesFor: 'p1' }, content: newer })

    await lib.setRootFolder(ROOT)
    expect(await lib.refreshNotebook('p1')).toBeNull()
    await lib.flushQueue()

    expect(await idb.idbGet('notes', 'p1')).toBeUndefined()
    expect(await idb.idbKeys('queue')).toEqual([])
    expect(drive.calls.filter((c) => c.method !== 'GET')).toEqual([])
    expect(drive.files.get('n1')!.content).toBe(newer)
    expect(lib.syncState.value.status).toBe('idle')
  })

  test('a notes file in a newer schema is never overwritten by dirty local notes, which stay queued', async () => {
    paper('p1', 'root')
    remoteNotes('n1', 'p1', 'root', withTexts('p1', 'a'))
    await lib.setRootFolder(ROOT)
    const newer = JSON.stringify({ ...withTexts('p1', 'a', 'future'), schema: 3 })
    drive.update('n1', { content: newer })

    lib.saveNotebook('p1', withTexts('p1', 'a', 'mine'))
    await lib.flushPendingWrites()
    await lib.flushQueue()
    await lib.syncLibrary()

    expect(drive.files.get('n1')!.content).toBe(newer)
    expect(drive.calls.filter((c) => c.method !== 'GET')).toEqual([])
    expect(await idb.idbKeys('queue')).toEqual(['notes:p1'])
    const stored = await idb.idbGet<StoredNotes>('notes', 'p1')
    expect(stored).toMatchObject({ dirty: true, remoteVersion: '1' })
    expect(textIds(stored!.sidecar)).toEqual(['a', 'mine'])
    expect(lib.syncState.value.status).toBe('idle')
  })

  test('notes over the simple-upload limit go up through a resumable session', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    const image: ImageObject = {
      id: 'img', createdAt: 1, updatedAt: 1, page: FIRST_PAGE_ID, z: 'V', box: { x: 0, y: 0, w: 1 }, src: `data:image/jpeg;base64,${'A'.repeat(6 * 1024 * 1024)}`, aspect: 0.5,
    }
    const doc = { ...withTexts('p1'), images: [image] }
    const isResumable = (c: { url: URL }) => c.url.searchParams.get('uploadType') === 'resumable'
    const sessionPuts = () => drive.calls.filter((c) => c.method === 'PUT' && c.url.origin === 'https://upload.fake')

    lib.saveNotebook('p1', doc)
    await lib.flushPendingWrites()
    await lib.flushQueue()

    expect(drive.calls.filter((c) => c.method === 'POST').map(isResumable)).toEqual([true])
    expect(sessionPuts()).toHaveLength(1)
    expect(JSON.parse(sessionPuts()[0].body!)).toEqual(doc)
    const notesId = lib.library.value!.notes!.p1.id
    expect(drive.files.get(notesId)).toMatchObject({ name: 'p1.marginalia-notes.json', appProperties: { marginalia: 'notes', notesFor: 'p1' } })
    expect(drive.json<NotesDocV2>(notesId)).toEqual(doc)
    expect(await idb.idbKeys('queue')).toEqual([])

    const edited = { ...doc, texts: [note('caption', 2)] }
    lib.saveNotebook('p1', edited)
    await lib.flushPendingWrites()
    await lib.flushQueue()

    expect(drive.calls.filter((c) => c.method === 'PATCH').map(isResumable)).toEqual([true])
    expect(sessionPuts()).toHaveLength(2)
    const uploaded = drive.json<NotesDocV2>(notesId)
    expect([textIds(uploaded), uploaded.images.map((i) => i.id)]).toEqual([['caption'], ['img']])
    expect(await idb.idbKeys('queue')).toEqual([])
  })

  test('a stored schema-1 notes record loads converted and is queued for upload as schema 2', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    const v1 = { ...withBlocks('p1', 'a', 'b'), background: 'grid' as const }
    await idb.idbSet('notes', 'p1', { sidecar: v1, dirty: false })

    expect(await lib.loadNotebook('p1')).toEqual(convertV1(v1))
    expect(await idb.idbKeys('queue')).toEqual(['notes:p1'])
    expect(await idb.idbGet<StoredNotes>('notes', 'p1')).toMatchObject({ sidecar: convertV1(v1), dirty: true })

    await lib.flushQueue()

    const uploaded = drive.json<unknown>(lib.library.value!.notes!.p1.id)
    expect(isNotebookDoc(uploaded)).toBe(true)
    expect(uploaded).toEqual(convertV1(v1))
    expect(await idb.idbKeys('queue')).toEqual([])
    expect(await idb.idbGet<StoredNotes>('notes', 'p1')).toMatchObject({ sidecar: convertV1(v1), dirty: false })
  })

  test('a schema-1 remote is converted, merged and uploaded as schema 2', async () => {
    paper('p1', 'root')
    const v1 = withBlocks('p1', 'a', 'b')
    remoteNotes('n1', 'p1', 'root', v1)
    await idb.idbSet('notes', 'p1', { sidecar: { ...withTexts('p1'), texts: [note('mine', 9)] }, dirty: false })

    await lib.setRootFolder(ROOT)

    const stored = await idb.idbGet<StoredNotes>('notes', 'p1')
    expect(stored).toMatchObject({ remoteId: 'n1', remoteVersion: '1', dirty: true })
    expect(textIds(stored!.sidecar)).toEqual(['a', 'b', 'mine'])
    expect(await idb.idbKeys('queue')).toEqual(['notes:p1'])

    await lib.flushQueue()

    const uploaded = drive.json<NotesDocV2>('n1')
    expect(isNotebookDoc(uploaded)).toBe(true)
    expect(textIds(uploaded)).toEqual(['a', 'b', 'mine'])
    expect(uploaded.pages.map((p) => p.id)).toEqual([FIRST_PAGE_ID])
    expect(await idb.idbKeys('queue')).toEqual([])
    expect(await idb.idbGet<StoredNotes>('notes', 'p1')).toMatchObject({ dirty: false, remoteVersion: '2' })
  })

  test('a schema-2 remote merges into local notes', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    await idb.idbSet('notes', 'p1', { sidecar: withTexts('p1', 'mine'), dirty: true })
    await idb.idbSet('queue', 'notes:p1', { queuedAt: 0 })
    const theirs = { ...withTexts('p1'), texts: [note('theirs', 7)] }
    remoteNotes('n1', 'p1', 'root', theirs)

    const merged = await lib.refreshNotebook('p1')

    expect(textIds(merged!)).toEqual(['mine', 'theirs'])
    expect(isNotebookDoc(merged)).toBe(true)
    expect(await idb.idbGet<StoredNotes>('notes', 'p1')).toMatchObject({ remoteId: 'n1', remoteVersion: '1', dirty: true })
    await lib.flushQueue()
    expect(textIds(drive.json<NotesDocV2>('n1'))).toEqual(['mine', 'theirs'])
  })

  test('queued schema-1 notes edits from a v2 client merge into a schema-2 remote after the update', async () => {
    paper('p1', 'root')
    const base: NotesDoc = {
      ...withBlocks('p1', 't1', 't2'),
      strokes: [{ kind: 'ink', id: 's1', color: '#000', width: 0.004, points: [0.1, 0.5, 0.5, 0.2, 0.6, 0.5], createdAt: 3, updatedAt: 3 }],
    }
    remoteNotes('n1', 'p1', 'root', base)
    await lib.setRootFolder(ROOT)
    const remote = convertV1(base)
    remote.texts = remote.texts.map((t) => (t.id === 't1' ? { ...t, text: 'edited elsewhere', updatedAt: 50 } : t))
    drive.update('n1', { content: JSON.stringify(remote) })
    const local: NotesDoc = { ...base, blocks: [...base.blocks, { ...block('local', 40), order: 'z' }] }
    await idb.idbSet('notes', 'p1', { sidecar: local, remoteId: 'n1', remoteVersion: '1', dirty: true })
    await idb.idbSet('queue', 'notes:p1', { queuedAt: 0 })

    await lib.flushQueue()

    const uploaded = drive.json<NotesDocV2>('n1')
    expect(isNotebookDoc(uploaded)).toBe(true)
    expect(uploaded.pages.map((p) => p.id)).toEqual([FIRST_PAGE_ID])
    expect(uploaded.texts.map((t) => t.id)).toEqual(['t1', 't2', 'local'])
    expect(uploaded.texts.find((t) => t.id === 't1')!.text).toBe('edited elsewhere')
    expect(uploaded.texts.find((t) => t.id === 'local')!.text).toBe('local')
    expect(uploaded.strokes.map((s) => s.id)).toEqual(['s1'])
    expect(await idb.idbKeys('queue')).toEqual([])
    expect(await lib.loadNotebook('p1')).toEqual(uploaded)
  })
})

describe('home pictures', () => {
  function picture(id: string, name: string, parent = 'root') {
    drive.add({ id, name, mimeType: 'image/png', parents: [parent] })
  }

  test('records the landscape, portrait and generic home pictures in the root folder only, and clears a slot when trashed', async () => {
    folder('f1', 'root')
    picture('land', 'marginalia-home-landscape.jpg')
    picture('land2', 'marginalia-home-landscape.png')
    picture('port', 'marginalia-home-portrait.webp')
    picture('gen', 'marginalia-home.png')
    picture('square', 'marginalia-home-square.png')
    picture('nested', 'marginalia-home-portrait.png', 'f1')

    await lib.setRootFolder(ROOT)

    const ids = () => Object.fromEntries(Object.entries(lib.library.value!.homeArt ?? {}).map(([slot, node]) => [slot, node!.id]))
    expect(ids()).toEqual({ landscape: 'land', portrait: 'port', generic: 'gen' })
    expect(lib.library.value!.papers).toEqual({})

    drive.update('port', { trashed: true })
    await lib.syncLibrary()
    expect(ids()).toEqual({ landscape: 'land', generic: 'gen' })

    drive.update('gen', { parents: ['f1'] })
    await lib.syncLibrary()
    expect(ids()).toEqual({ landscape: 'land' })

    drive.remove('land')
    drive.remove('land2')
    await lib.syncLibrary()
    expect(lib.library.value!.homeArt).toBeUndefined()
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

  const isArrayBuffer = (x: unknown) => Object.prototype.toString.call(x) === '[object ArrayBuffer]'
  const mediaDownloads = () => drive.calls.filter((c) => c.url.searchParams.get('alt') === 'media').length

  test('stores cached PDFs as bytes, not Blobs', async () => {
    paper('p1', 'root', 'p1.pdf', '%PDF-bytes')
    await lib.setRootFolder(ROOT)

    await lib.getPdfBlob('p1')

    const record = await idb.idbGet<Record<string, unknown>>('files', 'p1')
    expect(isArrayBuffer(record!.bytes)).toBe(true)
    expect(record!.blob).toBeUndefined()
    expect(await (await lib.getPdfBlob('p1')).text()).toBe('%PDF-bytes')
    expect(mediaDownloads()).toBe(1)
  })

  test('migrates a legacy Blob record to bytes without downloading', async () => {
    paper('p1', 'root')
    await lib.setRootFolder(ROOT)
    await idb.idbSet('files', 'p1', { version: '1', blob: new Blob(['%PDF-legacy']), size: 11, openedAt: 1 })

    expect(await (await lib.getPdfBlob('p1')).text()).toBe('%PDF-legacy')

    expect(mediaDownloads()).toBe(0)
    const record = await idb.idbGet<Record<string, unknown>>('files', 'p1')
    expect(isArrayBuffer(record!.bytes)).toBe(true)
    expect(record!.blob).toBeUndefined()
  })

  test('a cached Blob that can no longer be read is dropped and the PDF downloaded again', async () => {
    paper('p1', 'root', 'p1.pdf', '%PDF-drive')
    await lib.setRootFolder(ROOT)
    const unreadable = { arrayBuffer: () => Promise.reject(new DOMException('The object can not be found here.', 'NotFoundError')) }
    await idb.idbSet('files', 'p1', { version: '1', blob: unreadable, size: 10, openedAt: 1 })

    expect(await (await lib.getPdfBlob('p1')).text()).toBe('%PDF-drive')

    expect(mediaDownloads()).toBe(1)
    expect(isArrayBuffer((await idb.idbGet<Record<string, unknown>>('files', 'p1'))!.bytes)).toBe(true)
  })

  test('getPdfBlob with fresh: true downloads even when a cached copy exists, and replaces it', async () => {
    paper('p1', 'root', 'p1.pdf', '%PDF-drive')
    await lib.setRootFolder(ROOT)
    await idb.idbSet('files', 'p1', { version: '1', bytes: new TextEncoder().encode('%PDF-bad').buffer, size: 8, openedAt: 1 })

    expect(await (await lib.getPdfBlob('p1', undefined, { fresh: true })).text()).toBe('%PDF-drive')

    expect(mediaDownloads()).toBe(1)
    expect(await (await lib.getPdfBlob('p1')).text()).toBe('%PDF-drive')
  })

  test('a failed openedAt rewrite still returns the cached PDF', async () => {
    vi.resetModules()
    vi.doMock('../lib/idb', async (importOriginal) => {
      const real = await importOriginal<Idb>()
      return {
        ...real,
        idbSet: (store: Parameters<Idb['idbSet']>[0], key: string, value: unknown) =>
          store === 'files' && (value as { openedAt?: number }).openedAt !== 1 ? Promise.reject(new Error('connection closed')) : real.idbSet(store, key, value),
      }
    })
    try {
      await signIn()
      const mocked = await import('./library')
      const mockedIdb = await import('../lib/idb')
      await mockedIdb.idbSet('files', 'p1', { version: '1', bytes: new TextEncoder().encode('%PDF-cached').buffer, size: 11, openedAt: 1 })

      expect(await (await mocked.getPdfBlob('p1')).text()).toBe('%PDF-cached')
    } finally {
      vi.doUnmock('../lib/idb')
    }
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
