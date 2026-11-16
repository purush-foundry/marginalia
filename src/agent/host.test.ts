import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { json, mockFetch } from '../drive/test-helpers'
import { settings } from '../app/settings'
import type { HostEvent } from '../../host/src/protocol.ts'
import { forgetHost, HostRunError, hostState, hostVerdict, pairHost, probeHost, sessionEvents, uploadPaper, type PaperSource } from './host'

const INFO = { version: '0.1.0', model: 'm', skill: 'abc', auth: 'api-key', cwd: '/x' }

function stubPermission(state: string | 'throw'): void {
  vi.stubGlobal('navigator', {
    ...navigator,
    permissions: { query: vi.fn(async () => (state === 'throw' ? Promise.reject(new TypeError('bad name')) : { state })) },
  })
}

function sse(...events: unknown[]): Response {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({ start: (c) => { for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); c.close() } }), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

const source = (n = 'a'): PaperSource => ({ name: n + '.pdf', title: null, pages: [{ page: 1, text: 'hi' }] as never, bytes: new Uint8Array([1, 2, 3]).buffer })

beforeEach(async () => {
  stubPermission('granted')
  await pairHost('tok')
  hostState.value = { status: 'off' }
})

afterEach(() => vi.unstubAllGlobals())

describe('probeHost', () => {
  test('ready with the status body, sending bearer and loopback address space', async () => {
    const fetchMock = vi.fn(async () => json(INFO))
    vi.stubGlobal('fetch', fetchMock)
    const st = await probeHost()
    expect(st).toEqual({ status: 'ready', info: INFO })
    expect(hostState.value).toEqual(st)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { targetAddressSpace?: string }]
    expect(url).toBe('http://127.0.0.1:7700/status')
    expect(init.targetAddressSpace).toBe('loopback')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok')
  })

  test('unreachable on a network error, unauthorised on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('x') }))
    expect((await probeHost()).status).toBe('unreachable')
    mockFetch(() => json({ error: 'unauthorized' }, 401))
    expect((await probeHost()).status).toBe('unauthorised')
  })

  test('off without a token and no network call', async () => {
    await forgetHost()
    const calls = mockFetch(() => json(INFO))
    expect((await probeHost()).status).toBe('off')
    expect(calls).toHaveLength(0)
  })

  test('a non-gesture probe is skipped while the permission is prompt; a gesture probes', async () => {
    stubPermission('prompt')
    const calls = mockFetch(() => json(INFO))
    await probeHost(false)
    expect(calls).toHaveLength(0)
    await probeHost(true)
    expect(calls).toHaveLength(1)
  })

  test('a throwing permission query still attempts the probe', async () => {
    stubPermission('throw')
    const calls = mockFetch(() => json(INFO))
    expect((await probeHost(false)).status).toBe('ready')
    expect(calls).toHaveLength(1)
  })
})

describe('pairing', () => {
  test('pairHost stores token and url; forgetHost clears them', async () => {
    await pairHost('t2', 'http://127.0.0.1:9')
    expect(settings.value.hostToken).toBe('t2')
    expect(settings.value.hostUrl).toBe('http://127.0.0.1:9')
    expect(hostState.value.status).toBe('unreachable')
    await forgetHost()
    expect(settings.value.hostToken).toBe('')
    expect(hostState.value.status).toBe('off')
  })
})

describe('sessionEvents', () => {
  test('yields events from a streamed body and rejects on non-2xx', async () => {
    const evs: HostEvent[] = [{ type: 'turn_start' }, { type: 'text', delta: 'a' }]
    const calls = mockFetch(() => sse(...evs))
    const got: HostEvent[] = []
    for await (const e of sessionEvents('s1', new AbortController().signal)) got.push(e)
    expect(got).toEqual(evs)
    expect(calls[0].url.pathname).toBe('/sessions/s1/events')
    mockFetch(() => json({}, 404))
    await expect((async () => { for await (const _ of sessionEvents('s1', new AbortController().signal)); })()).rejects.toThrow('404')
  })
})

describe('papers and verdicts', () => {
  test('hostVerdict uploads, runs the job and resolves with the note; a second upload is a no-op', async () => {
    const calls = mockFetch((c) => {
      if (c.method === 'PUT') return new Response(null, { status: 204 })
      if (c.url.pathname === '/verdicts') return json({ jobId: 'j1' })
      return sse({ type: 'status', text: 'x' }, { type: 'note', markdown: '# Verdict' })
    })
    expect(await hostVerdict('p1', source())).toBe('# Verdict')
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url.pathname).toBe('/papers/p1')
    const body = JSON.parse(put.body!)
    expect(body.pdf).toBe(btoa('\x01\x02\x03'))
    expect(body.pages).toEqual([{ n: 1, text: 'hi' }])
    await uploadPaper('p1', source())
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
  })

  test('hostVerdict rejects with the error event and when the stream ends without a note', async () => {
    mockFetch((c) => (c.url.pathname === '/verdicts' ? json({ jobId: 'j' }) : sse({ type: 'error', message: 'boom' })))
    await expect(hostVerdict('p2', source())).rejects.toThrow('boom')
    mockFetch((c) => (c.url.pathname === '/verdicts' ? json({ jobId: 'j' }) : sse({ type: 'status', text: 'x' })))
    await expect(hostVerdict('p2', source())).rejects.toThrow(/without a note/)
  })

  test('only an error event from the host is a HostRunError; HTTP errors and a dropped stream are not', async () => {
    mockFetch((c) => (c.url.pathname === '/verdicts' ? json({ jobId: 'j' }) : sse({ type: 'error', message: 'max turns' })))
    await expect(hostVerdict('p3', source())).rejects.toBeInstanceOf(HostRunError)
    mockFetch((c) => (c.url.pathname === '/verdicts' ? json({ jobId: 'j' }) : sse({ type: 'status', text: 'x' })))
    await expect(hostVerdict('p3', source())).rejects.not.toBeInstanceOf(HostRunError)
    mockFetch((c) => (c.url.pathname === '/verdicts' ? new Response(null, { status: 500 }) : new Response(null, { status: 204 })))
    await expect(hostVerdict('p3', source())).rejects.not.toBeInstanceOf(HostRunError)
  })
})
