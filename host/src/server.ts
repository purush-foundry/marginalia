import { randomUUID, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import { savePaper } from './papers'
import { HOST_VERSION } from './protocol'
import type { HostEvent, MessageBody, PaperUpload, StatusResponse } from './protocol'
import { sseKeepAlive, sseSend, sseStart } from './sse'

export interface Session {
  id: string
  events: AsyncIterable<HostEvent>
  send(body: MessageBody): void
  interrupt(): Promise<void>
  close(): void
}

export interface Runner {
  status(): Omit<StatusResponse, 'version'>
  openSession(pdfId: string, sessionId: string | null, fresh: boolean): Promise<Session>
  verdict(pdfId: string): AsyncIterable<HostEvent>
  paperReady(pdfId: string): Promise<boolean>
}

export interface ServerOptions {
  runner: Runner
  token: string
  origins: string[]
  root: string
}

const MAX_BODY = 64 * 1024 * 1024
const KEEP_ALIVE_MS = 15000

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function corsHeaders(req: http.IncomingMessage, origins: string[]): Record<string, string> {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !origins.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    Vary: 'Origin',
  }
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header || !header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7))
  const want = Buffer.from(token)
  return given.length === want.length && timingSafeEqual(given, want)
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'body too large')
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch {
    throw new HttpError(400, 'malformed JSON')
  }
}

export function createServer(opts: ServerOptions): http.Server {
  const { runner, token, origins } = opts
  const sessions = new Map<string, Session>()
  const jobs = new Map<string, string>()

  async function stream(res: http.ServerResponse, headers: Record<string, string>, events: AsyncIterable<HostEvent>, onEnd: () => void) {
    sseStart(res, headers)
    const stop = sseKeepAlive(res, KEEP_ALIVE_MS)
    const closed = new Promise<'closed'>((resolve) => res.on('close', () => resolve('closed')))
    const it = events[Symbol.asyncIterator]()
    try {
      for (;;) {
        const next = await Promise.race([it.next(), closed])
        if (next === 'closed') return
        if (next.done) break
        sseSend(res, next.value)
      }
      onEnd()
    } catch (err) {
      sseSend(res, { type: 'error', message: err instanceof Error ? err.message : String(err) })
      onEnd()
    } finally {
      stop()
      res.end()
    }
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const cors = corsHeaders(req, origins)
    const allowed = 'Access-Control-Allow-Origin' in cors
    const json = (status: number, body?: unknown) => {
      if (body === undefined) {
        res.writeHead(status, cors)
        res.end()
        return
      }
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (req.method === 'OPTIONS') return allowed ? json(204) : json(403, { error: 'forbidden origin' })
    if (!tokenMatches(req.headers.authorization, token)) return json(401, { error: 'unauthorized' })
    if (!allowed) return json(403, { error: 'forbidden origin' })

    const url = new URL(req.url ?? '/', 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const method = req.method ?? 'GET'

    if (method === 'GET' && parts.length === 1 && parts[0] === 'status') {
      return json(200, { ...runner.status(), version: HOST_VERSION })
    }
    if (method === 'PUT' && parts.length === 2 && parts[0] === 'papers') {
      const upload = await readJson<PaperUpload>(req)
      await savePaper(opts.root, parts[1], upload)
      return json(204)
    }
    if (method === 'POST' && parts.length === 1 && parts[0] === 'sessions') {
      const body = await readJson<{ pdfId?: string; sessionId?: string; fresh?: boolean }>(req)
      if (typeof body.pdfId !== 'string') return json(400, { error: 'pdfId required' })
      if (!(await runner.paperReady(body.pdfId))) return json(404, { error: 'paper not uploaded' })
      const session = await runner.openSession(body.pdfId, body.sessionId ?? null, body.fresh === true)
      sessions.set(session.id, session)
      return json(200, { sessionId: session.id })
    }
    if (parts[0] === 'sessions' && parts.length === 3) {
      const session = sessions.get(parts[1])
      if (!session) return json(404, { error: 'unknown session' })
      if (method === 'GET' && parts[2] === 'events') {
        return stream(res, cors, session.events, () => {
          sessions.delete(session.id)
        })
      }
      if (method === 'POST' && parts[2] === 'messages') {
        const body = await readJson<MessageBody>(req)
        if (typeof body.text !== 'string') return json(400, { error: 'text required' })
        session.send(body)
        return json(202)
      }
      if (method === 'POST' && parts[2] === 'interrupt') {
        await session.interrupt()
        return json(202)
      }
    }
    if (method === 'POST' && parts.length === 1 && parts[0] === 'verdicts') {
      const body = await readJson<{ pdfId?: string }>(req)
      if (typeof body.pdfId !== 'string') return json(400, { error: 'pdfId required' })
      if (!(await runner.paperReady(body.pdfId))) return json(404, { error: 'paper not uploaded' })
      const jobId = randomUUID()
      jobs.set(jobId, body.pdfId)
      return json(200, { jobId })
    }
    if (method === 'GET' && parts.length === 3 && parts[0] === 'verdicts' && parts[2] === 'events') {
      const pdfId = jobs.get(parts[1])
      if (pdfId === undefined) return json(404, { error: 'unknown job' })
      jobs.delete(parts[1])
      return stream(res, cors, runner.verdict(pdfId), () => {})
    }
    return json(404, { error: 'not found' })
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.end()
        return
      }
      const status = err instanceof HttpError ? err.status : 500
      const message = err instanceof HttpError ? err.message : 'internal error'
      res.writeHead(status, { ...corsHeaders(req, origins), 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: message }))
    })
  })
}
