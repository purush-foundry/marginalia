// @vitest-environment node
import { mkdtemp, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HOST_VERSION } from './protocol'
import type { HostEvent, MessageBody } from './protocol'
import { createServer, type Runner, type Session } from './server'

const TOKEN = 'a'.repeat(64)
const ORIGIN = 'https://app.example'

function makeSession(events: HostEvent[], log: { sent: MessageBody[]; interrupted: number }, hold?: Promise<void>): Session {
  return {
    id: 's-1',
    events: (async function* () {
      for (const e of events) yield e
      if (hold) await hold
    })(),
    send: (b) => void log.sent.push(b),
    interrupt: async () => void log.interrupted++,
    close: () => {},
  }
}

let server: ReturnType<typeof createServer> | undefined
afterEach(() => new Promise<void>((r) => (server ? (server.closeAllConnections(), server.close(() => r())) : r())))

async function start(opts: { ready?: Set<string> } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'server-'))
  const log = { sent: [] as MessageBody[], interrupted: 0 }
  const ready = opts.ready ?? new Set<string>()
  const runner: Runner = {
    status: () => ({ model: 'm', skill: 's', auth: 'api-key', cwd: '/c' }),
    paperReady: async (id) => ready.has(id),
    openSession: async () => makeSession([{ type: 'turn_start' }, { type: 'text', delta: 'hi' }], log),
    verdict: async function* () {
      yield { type: 'note', markdown: 'verdict' } as HostEvent
    },
  }
  server = createServer({ runner, token: TOKEN, origins: [ORIGIN], root })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (p: string, init: RequestInit = {}) =>
    fetch(base + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) } })
  return { base, call, log, ready, root }
}

describe('server auth', () => {
  it('rejects missing/wrong tokens and foreign or absent origins', async () => {
    const { base } = await start()
    const h = (extra: Record<string, string>) => fetch(base + '/status', { headers: extra })
    expect((await h({ Origin: ORIGIN })).status).toBe(401)
    expect((await h({ Origin: ORIGIN, Authorization: 'Bearer nope' })).status).toBe(401)
    expect((await h({ Origin: ORIGIN, Authorization: `Bearer ${'b'.repeat(64)}` })).status).toBe(401)
    expect((await h({ Origin: 'https://evil.example', Authorization: `Bearer ${TOKEN}` })).status).toBe(403)
    expect((await h({ Authorization: `Bearer ${TOKEN}` })).status).toBe(403)
  })

  it('answers preflights with CORS headers', async () => {
    const { base } = await start()
    const ok = await fetch(base + '/sessions', { method: 'OPTIONS', headers: { Origin: ORIGIN } })
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(ok.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type')
    expect(ok.headers.get('access-control-allow-methods')).toBe('GET, POST, PUT, OPTIONS')
    expect(ok.headers.get('vary')).toBe('Origin')
    expect((await fetch(base + '/sessions', { method: 'OPTIONS', headers: { Origin: 'https://x.example' } })).status).toBe(403)
    expect((await fetch(base + '/sessions', { method: 'OPTIONS' })).status).toBe(403)
  })
})

describe('server routes', () => {
  it('serves status with the version and CORS headers', async () => {
    const { call } = await start()
    const r = await call('/status')
    expect(await r.json()).toEqual({ model: 'm', skill: 's', auth: 'api-key', cwd: '/c', version: HOST_VERSION })
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })

  it('404s unknown routes and 400s bad JSON', async () => {
    const { call } = await start()
    const nf = await call('/nope')
    expect(nf.status).toBe(404)
    expect(await nf.json()).toEqual({ error: 'not found' })
    expect((await call('/sessions', { method: 'POST', body: '{' })).status).toBe(400)
  })

  it('stores uploaded papers', async () => {
    const { call, root } = await start()
    const body = { name: 'a.pdf', title: null, pages: [{ n: 1, text: 'x' }], pdf: Buffer.from('p').toString('base64') }
    expect((await call('/papers/doc.1', { method: 'PUT', body: JSON.stringify(body) })).status).toBe(204)
    expect((await stat(path.join(root, 'papers', 'doc_1', 'paper.txt'))).isFile()).toBe(true)
  })

  it('refuses sessions for papers not uploaded, then streams events', async () => {
    const { call, ready, log } = await start()
    const no = await call('/sessions', { method: 'POST', body: JSON.stringify({ pdfId: 'p' }) })
    expect(no.status).toBe(404)
    expect(await no.json()).toEqual({ error: 'paper not uploaded' })
    ready.add('p')
    const { sessionId } = (await (await call('/sessions', { method: 'POST', body: JSON.stringify({ pdfId: 'p' }) })).json()) as { sessionId: string }
    expect((await call('/sessions/other/events')).status).toBe(404)
    const sse = await call(`/sessions/${sessionId}/events`)
    expect(sse.headers.get('content-type')).toBe('text/event-stream')
    expect(await sse.text()).toBe('data: {"type":"turn_start"}\n\ndata: {"type":"text","delta":"hi"}\n\n')

    const again = await call('/sessions', { method: 'POST', body: JSON.stringify({ pdfId: 'p' }) })
    const id2 = ((await again.json()) as { sessionId: string }).sessionId
    expect((await call(`/sessions/${id2}/messages`, { method: 'POST', body: JSON.stringify({ text: 'q' }) })).status).toBe(202)
    expect(log.sent).toEqual([{ text: 'q' }])
    expect((await call(`/sessions/${id2}/interrupt`, { method: 'POST' })).status).toBe(202)
    expect(log.interrupted).toBe(1)
  })

  it('streams a verdict job once', async () => {
    const { call, ready } = await start()
    expect((await call('/verdicts', { method: 'POST', body: JSON.stringify({ pdfId: 'p' }) })).status).toBe(404)
    ready.add('p')
    const { jobId } = (await (await call('/verdicts', { method: 'POST', body: JSON.stringify({ pdfId: 'p' }) })).json()) as { jobId: string }
    expect(await (await call(`/verdicts/${jobId}/events`)).text()).toBe('data: {"type":"note","markdown":"verdict"}\n\n')
    expect((await call(`/verdicts/${jobId}/events`)).status).toBe(404)
  })
})
