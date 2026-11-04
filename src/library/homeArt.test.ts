import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DriveNode, HomeArtFiles } from '../types'
import { FakeDrive, mockFetch, signIn } from '../drive/test-helpers'

type HomeArt = typeof import('./homeArt')
type Idb = typeof import('../lib/idb')

let drive: FakeDrive
let art: HomeArt
let idb: Idb
let urls = 0

const node = (id: string, name = `${id}.jpg`, version = '1'): DriveNode => ({ id, name, mimeType: 'image/jpeg', parents: ['root'], modifiedTime: 't', version })
const mediaCalls = (calls: { url: URL }[]) => calls.filter((c) => c.url.searchParams.get('alt') === 'media')

beforeEach(async () => {
  vi.resetModules()
  urls = 0
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:${++urls}`, revokeObjectURL: () => undefined }))
  await signIn()
  art = await import('./homeArt')
  idb = await import('../lib/idb')
  for (const k of await idb.idbKeys('meta')) if (k.startsWith('homeArt:')) await idb.idbDel('meta', k)
  drive = new FakeDrive()
  drive.add({ id: 'L', name: 'L.jpg', mimeType: 'image/jpeg', parents: ['root'], content: 'land' })
  drive.add({ id: 'P', name: 'P.png', mimeType: 'image/png', parents: ['root'], content: 'port' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.google
})

const f = (...ids: string[]): HomeArtFiles => {
  const slot = { L: 'landscape', P: 'portrait', G: 'generic' } as const
  return Object.fromEntries(ids.map((i) => [slot[i as 'L' | 'P' | 'G'], node(i)]))
}
const idOf = (n: DriveNode | undefined) => n?.id

test.each([
  [['L', 'P', 'G'], true, 'L'], [['L', 'P', 'G'], false, 'P'],
  [['L', 'P'], true, 'L'], [['L', 'P'], false, 'P'],
  [['L', 'G'], true, 'L'], [['L', 'G'], false, 'G'],
  [['P', 'G'], true, 'G'], [['P', 'G'], false, 'P'],
  [['L'], false, 'L'], [['P'], true, 'P'],
  [['G'], true, 'G'], [['G'], false, 'G'],
  [[], true, undefined], [[], false, undefined],
])('pickHomeArt(%j, landscape=%s) -> %s', (present, landscape, expected) => {
  expect(idOf(art.pickHomeArt(f(...present), landscape))).toBe(expected)
})

test('pickHomeArt with no files shows the drawing', () => {
  expect(art.pickHomeArt(undefined, true)).toBeUndefined()
})

test('downloads a picture once and serves the cached bytes while its version is unchanged', async () => {
  const calls = drive.calls
  await art.refreshHomeArt(node('L', 'L.jpg', '1'), ['L'])
  await art.refreshHomeArt(node('L', 'L.jpg', '1'), ['L'])
  expect(mediaCalls(calls)).toHaveLength(1)
  expect(art.homeArtUrl.value).toBe('blob:2')
  const rec = await idb.idbGet<{ id: string; version: string; type: string; bytes: ArrayBuffer }>('meta', 'homeArt:L')
  expect(rec).toMatchObject({ id: 'L', version: '1', type: 'image/jpeg' })
  expect(rec!.bytes).toBeInstanceOf(ArrayBuffer)
})

test('downloads again when the Drive version changes', async () => {
  const calls = drive.calls
  await art.refreshHomeArt(node('L', 'L.jpg', '1'), ['L'])
  drive.update('L', { content: 'land2' })
  await art.refreshHomeArt(node('L', 'L.jpg', '2'), ['L'])
  expect(mediaCalls(calls)).toHaveLength(2)
  expect((await idb.idbGet<{ version: string }>('meta', 'homeArt:L'))!.version).toBe('2')
})

test('caches each file separately and drops records of files no longer in the index', async () => {
  await art.refreshHomeArt(node('L'), ['L', 'P'])
  await art.refreshHomeArt(node('P', 'P.png'), ['L', 'P'])
  expect(await idb.idbGet('meta', 'homeArt:L')).toBeDefined()
  expect((await idb.idbGet<{ type: string }>('meta', 'homeArt:P'))!.type).toBe('image/png')
  await art.refreshHomeArt(node('P', 'P.png'), ['P'])
  expect(await idb.idbGet('meta', 'homeArt:L')).toBeUndefined()
})

test('no picture shows the drawing and forgets every cached picture', async () => {
  await art.refreshHomeArt(node('L'), ['L'])
  expect(art.homeArtUrl.value).not.toBeNull()
  await art.refreshHomeArt(undefined, [])
  expect(art.homeArtUrl.value).toBeNull()
  expect((await idb.idbKeys('meta')).filter((k) => k.startsWith('homeArt:'))).toEqual([])
})

test('offline keeps the cached picture', async () => {
  await art.refreshHomeArt(node('L', 'L.jpg', '1'), ['L'])
  mockFetch(() => {
    throw new TypeError('Failed to fetch')
  })
  await art.refreshHomeArt(node('L', 'L.jpg', '2'), ['L'])
  expect(art.homeArtUrl.value).not.toBeNull()
})

test('a later call wins over a slower earlier one', async () => {
  let release!: (r: Response) => void
  mockFetch(() => new Promise<Response>((r) => (release = r)))
  const first = art.refreshHomeArt(node('L'), ['L'])
  await vi.waitFor(() => expect(release).toBeDefined())
  await art.refreshHomeArt(undefined, [])
  release(new Response('late'))
  await first
  expect(art.homeArtUrl.value).toBeNull()
  expect(await idb.idbGet('meta', 'homeArt:L')).toBeUndefined()
})
