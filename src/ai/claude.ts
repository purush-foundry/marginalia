// Minimal streaming client for the Claude Messages API, called directly from the browser.

const API_BASE = 'https://api.anthropic.com/v1'
const API_VERSION = '2026-10-21'
const DEFAULT_MAX_TOKENS = 16_000
const OVERLOAD_RETRY_MS = 2_000

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } }

export interface ApiMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface StreamOptions {
  apiKey: string
  model: string
  system: string
  messages: ApiMessage[]
  maxTokens?: number
  signal?: AbortSignal
}

export class ClaudeError extends Error {
  status?: number
  type?: string

  constructor(message: string, status?: number, type?: string) {
    super(message)
    this.name = 'ClaudeError'
    this.status = status
    this.type = type
  }
}

function headers(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  }
}

function isAbort(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'AbortError'
}

function isOverloaded(err: unknown): boolean {
  return err instanceof ClaudeError && (err.status === 529 || err.type === 'overloaded_error')
}

// Calls fetch, turning network failures into ClaudeError and leaving aborts untouched.
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    if (isAbort(err)) throw err
    throw new ClaudeError('Could not reach Claude. Check your connection.')
  }
}

// Builds a ClaudeError from a non-2xx response's `{ error: { type, message } }` body.
async function httpError(res: Response): Promise<ClaudeError> {
  let type: string | undefined
  let message = `Claude returned HTTP ${res.status}`
  try {
    const body = JSON.parse(await res.text()) as { error?: { type?: string; message?: string } }
    type = body.error?.type
    if (body.error?.message) message = body.error.message
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  return new ClaudeError(message, res.status, type)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

interface SseEvent {
  type: string
  delta?: { type?: string; text?: string; stop_reason?: string | null }
  error?: { type?: string; message?: string }
}

// Reads `data:` payloads from an SSE body with getReader(), one parsed event at a time.
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
      let end: number
      while ((end = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, end)
        buf = buf.slice(end + 2)
        const data = raw
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n')
        if (data) yield JSON.parse(data) as SseEvent
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// One request: yields text deltas, returns the stop reason once message_stop arrives.
async function* attempt(opts: StreamOptions): AsyncGenerator<string, { stopReason: string | null }, void> {
  const res = await send(`${API_BASE}/messages`, {
    method: 'POST',
    headers: headers(opts.apiKey),
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: true,
      system: opts.system,
      messages: opts.messages,
    }),
    signal: opts.signal,
  })
  if (!res.ok) throw await httpError(res)
  if (!res.body) throw new ClaudeError('Claude sent an empty response.')

  let stopReason: string | null = null
  for await (const ev of sseEvents(res.body)) {
    switch (ev.type) {
      case 'content_block_delta':
        if (ev.delta?.type === 'text_delta' && ev.delta.text) yield ev.delta.text
        break
      case 'message_delta':
        if (ev.delta && 'stop_reason' in ev.delta) stopReason = ev.delta.stop_reason ?? null
        break
      case 'error':
        throw new ClaudeError(ev.error?.message ?? 'Claude reported an error.', undefined, ev.error?.type)
      case 'message_stop':
        return { stopReason }
    }
  }
  throw new ClaudeError('The connection closed before the answer finished.')
}

/** Yields text deltas; throws ClaudeError on HTTP/stream errors; resolves when message_stop arrives. Sets stopReason on the returned iterator's final value. */
export async function* streamMessage(opts: StreamOptions): AsyncGenerator<string, { stopReason: string | null }, void> {
  let yielded = false
  try {
    const gen = attempt(opts)
    for (;;) {
      const r = await gen.next()
      if (r.done) return r.value
      yielded = true
      yield r.value
    }
  } catch (err) {
    if (yielded || !isOverloaded(err)) throw err
  }
  await sleep(OVERLOAD_RETRY_MS, opts.signal)
  return yield* attempt(opts)
}

/** Validates a key with a free metadata request; never sends the key anywhere but the header. */
export async function checkApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await send(`${API_BASE}/models?limit=1`, { method: 'GET', headers: headers(apiKey) })
    if (res.ok) return { ok: true }
    if (res.status === 401) return { ok: false, message: 'Claude rejected this key. Check that it is complete and not revoked.' }
    return { ok: false, message: (await httpError(res)).message }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not check the key.' }
  }
}
