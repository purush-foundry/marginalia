import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FOLDER_MIME } from '../types'
import { TEST_TOKEN, driveError, json, mockFetch, signIn } from './test-helpers'

type Api = typeof import('./api')
type Auth = typeof import('./auth')

const FIELDS = 'id,name,mimeType,parents,modifiedTime,version,size,md5Checksum,appProperties'

function rawFile(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: `${id}.pdf`, mimeType: 'application/pdf', parents: ['p'], modifiedTime: 't', version: '3', size: '1234', ...extra }
}

let api: Api
let auth: Auth

beforeEach(async () => {
  vi.resetModules()
  await signIn()
  api = await import('./api')
  auth = await import('./auth')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete window.google
})

describe('request shapes', () => {
  test('listChildren ors the parents, excludes trashed, uses the field mask and the bearer token', async () => {
    const calls = mockFetch(() => json({ files: [rawFile('f1')] }))

    const nodes = await api.listChildren(['a', 'b'])

    expect(calls).toHaveLength(1)
    const { url, headers } = calls[0]
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/files')
    expect(url.searchParams.get('q')).toBe("('a' in parents or 'b' in parents) and trashed = false")
    expect(url.searchParams.get('fields')).toBe(`nextPageToken,files(${FIELDS})`)
    expect(headers.authorization).toBe(`Bearer ${TEST_TOKEN}`)
    expect(url.search).not.toContain(TEST_TOKEN)
    expect(nodes).toEqual([{ id: 'f1', name: 'f1.pdf', mimeType: 'application/pdf', parents: ['p'], modifiedTime: 't', version: '3', size: 1234 }])
  })

  test('listChildren batches 20 parents per call and follows nextPageToken', async () => {
    const calls = mockFetch(({ url }) => {
      if (url.searchParams.get('pageToken') === 'page2') return json({ files: [rawFile('second')] })
      if (url.searchParams.get('q')!.includes("'p0' in parents")) return json({ files: [rawFile('first')], nextPageToken: 'page2' })
      return json({ files: [rawFile('third')] })
    })
    const parents = Array.from({ length: 25 }, (_, i) => `p${i}`)

    const nodes = await api.listChildren(parents)

    expect(nodes.map((n) => n.id)).toEqual(['first', 'second', 'third'])
    expect(calls).toHaveLength(3)
    expect(calls[0].url.searchParams.get('q')!.match(/ in parents/g)).toHaveLength(20)
    expect(calls[1].url.searchParams.get('q')).toBe(calls[0].url.searchParams.get('q'))
    expect(calls[2].url.searchParams.get('q')!.match(/ in parents/g)).toHaveLength(5)
  })

  test('listChildren with no parents makes no request', async () => {
    const calls = mockFetch(() => json({ files: [] }))
    expect(await api.listChildren([])).toEqual([])
    expect(calls).toHaveLength(0)
  })

  test('listMyDriveFolders asks for folders directly under My Drive', async () => {
    const calls = mockFetch(() => json({ files: [rawFile('d', { mimeType: FOLDER_MIME, size: undefined })] }))
    const nodes = await api.listMyDriveFolders()
    expect(calls[0].url.searchParams.get('q')).toBe(`'root' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`)
    expect(nodes[0].size).toBeUndefined()
  })

  test('getNode, downloadFile and downloadJson hit the file resource', async () => {
    const calls = mockFetch(({ url }) => {
      if (url.searchParams.get('alt') === 'media' && url.pathname.endsWith('/j')) return json({ hello: 1 })
      if (url.searchParams.get('alt') === 'media') return new Response('PDFBYTES')
      return json(rawFile('n'))
    })

    expect((await api.getNode('n')).version).toBe('3')
    expect(calls[0].url.pathname).toBe('/drive/v3/files/n')
    expect(calls[0].url.searchParams.get('fields')).toBe(FIELDS)

    expect(await (await api.downloadFile('n')).text()).toBe('PDFBYTES')
    expect(await api.downloadJson<{ hello: number }>('j')).toEqual({ hello: 1 })
  })

  test('downloadFile reports bytes received', async () => {
    mockFetch(() => new Response('0123456789'))
    const seen: number[] = []
    await api.downloadFile('n', (bytes) => seen.push(bytes))
    expect(seen.at(-1)).toBe(10)
  })

  test('createJsonFile sends a multipart POST with metadata and body', async () => {
    const calls = mockFetch(() => json(rawFile('new', { name: 'x.marginalia.json' })))

    const node = await api.createJsonFile('x.marginalia.json', 'folder', { a: 1 }, { marginalia: '1', pdf: 'pdf1' })

    const { url, method, headers, body } = calls[0]
    expect(method).toBe('POST')
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/upload/drive/v3/files')
    expect(url.searchParams.get('uploadType')).toBe('multipart')
    expect(url.searchParams.get('fields')).toBe(FIELDS)
    const boundary = headers['content-type'].match(/^multipart\/related; boundary=(.+)$/)![1]
    const parts = body!.split(`--${boundary}`)
    expect(parts.at(-1)!.trim()).toBe('--')
    const [metaPart, mediaPart] = parts.slice(1, 3).map((p) => p.split('\r\n\r\n')[1].trim())
    expect(JSON.parse(metaPart)).toEqual({
      name: 'x.marginalia.json',
      parents: ['folder'],
      mimeType: 'application/json',
      appProperties: { marginalia: '1', pdf: 'pdf1' },
    })
    expect(JSON.parse(mediaPart)).toEqual({ a: 1 })
    expect(node.id).toBe('new')
  })

  test('updateJsonFile PATCHes the media and returns the node fields', async () => {
    const calls = mockFetch(() => json(rawFile('s', { version: '9' })))

    const node = await api.updateJsonFile('s', { b: 2 })

    const { url, method, headers, body } = calls[0]
    expect(method).toBe('PATCH')
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/upload/drive/v3/files/s')
    expect(url.searchParams.get('uploadType')).toBe('media')
    expect(url.searchParams.get('fields')).toBe(FIELDS)
    expect(headers['content-type']).toBe('application/json')
    expect(JSON.parse(body!)).toEqual({ b: 2 })
    expect(node.version).toBe('9')
  })

  test('findSidecarFile looks up by appProperties.pdf, then by name in the parent', async () => {
    const calls = mockFetch(({ url }) =>
      url.searchParams.get('q')!.startsWith('name') ? json({ files: [rawFile('byName')] }) : json({ files: [] }),
    )

    const node = await api.findSidecarFile('pdf1', "O'Brien.marginalia.json", 'folder')

    expect(calls.map((c) => c.url.searchParams.get('q'))).toEqual([
      "appProperties has { key='pdf' and value='pdf1' } and trashed = false",
      "name = 'O\\'Brien.marginalia.json' and 'folder' in parents and trashed = false",
    ])
    expect(node?.id).toBe('byName')
  })

  test('findCompanionFile queries by the given PDF key and adds the marginalia tag', async () => {
    const calls = mockFetch(() => json({ files: [rawFile('n', { appProperties: { marginalia: 'notes', notesFor: 'pdf1' } })] }))

    const node = await api.findCompanionFile('pdf1', 'x.marginalia-notes.json', 'folder', 'notes', 'notesFor')

    expect(calls).toHaveLength(1)
    const q = calls[0].url.searchParams.get('q')!
    expect(q).toContain("key='notesFor' and value='pdf1'")
    expect(q).not.toContain("key='pdf'")
    expect(q).toContain("key='marginalia' and value='notes'")
    expect(node?.id).toBe('n')
  })

  test('getStartPageToken and listChanges', async () => {
    const calls = mockFetch(({ url }) => {
      if (url.pathname.endsWith('/startPageToken')) return json({ startPageToken: 'tok1' })
      return json({
        changes: [
          { fileId: 'a', removed: true },
          { fileId: 'b', removed: false, file: { ...rawFile('b'), trashed: true } },
        ],
        newStartPageToken: 'tok2',
      })
    })

    expect(await api.getStartPageToken()).toBe('tok1')
    const page = await api.listChanges('tok1')

    expect(calls[1].url.pathname).toBe('/drive/v3/changes')
    expect(calls[1].url.searchParams.get('pageToken')).toBe('tok1')
    expect(calls[1].url.searchParams.get('fields')).toBe(`nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS},trashed))`)
    expect(page.newStartPageToken).toBe('tok2')
    expect(page.changes[0]).toEqual({ fileId: 'a', removed: true })
    expect(page.changes[1].file).toMatchObject({ id: 'b', trashed: true, size: 1234 })
  })
})

describe('errors', () => {
  test('401 marks auth expired and throws', async () => {
    mockFetch(() => driveError(401, 'authError'))

    await expect(api.getNode('n')).rejects.toMatchObject({ status: 401, reason: 'authError' })
    expect(auth.authState.value.status).toBe('expired')
    expect(auth.getAccessToken()).toBeNull()
  })

  test('JSON errors become DriveError with status and reason, without retrying', async () => {
    const calls = mockFetch(() => driveError(404, 'notFound'))
    const err = await api.getNode('n').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(api.DriveError)
    expect(err).toMatchObject({ status: 404, reason: 'notFound' })
    expect(calls).toHaveLength(1)
  })

  test('without a token nothing is sent', async () => {
    await auth.signOut()
    const calls = mockFetch(() => json({}))
    await expect(api.getNode('n')).rejects.toMatchObject({ status: 401 })
    expect(calls).toHaveLength(0)
  })

  test('429 and 403 userRateLimitExceeded retry with backoff', async () => {
    vi.useFakeTimers()
    const replies = [driveError(429, 'rateLimitExceeded'), driveError(403, 'userRateLimitExceeded'), json(rawFile('n'))]
    const calls = mockFetch(() => replies.shift()!)

    const pending = api.getNode('n')
    await vi.runAllTimersAsync()

    expect((await pending).id).toBe('n')
    expect(calls).toHaveLength(3)
  })

  test('gives up after 3 retries', async () => {
    vi.useFakeTimers()
    const calls = mockFetch(() => driveError(429, 'rateLimitExceeded'))

    const pending = api.getNode('n').catch((e: unknown) => e)
    await vi.runAllTimersAsync()

    expect(await pending).toMatchObject({ status: 429 })
    expect(calls).toHaveLength(4)
  })
})
