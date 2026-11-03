import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeError, checkApiKey, streamMessage, type StreamOptions } from './claude.ts'

type Call = { url: string; init: RequestInit }

function sse(events: object[]): string {
  return events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
}

function textAnswer(parts: string[], stopReason = 'end_turn'): string {
  return sse([
    { type: 'message_start', message: { id: 'msg_1' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...parts.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ])
}

/** Response-like object whose body streams `chunks`; an aborted signal errors the body like real fetch. */
function streamResponse(chunks: string[], signal?: AbortSignal | null, keepOpen = false): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      if (!keepOpen) controller.close()
      signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
    },
  })
  return { ok: true, status: 200, body, text: async () => '' } as unknown as Response
}

function errorResponse(status: number, type: string, message: string): Response {
  const payload = JSON.stringify({ type: 'error', error: { type, message } })
  return { ok: false, status, body: null, text: async () => payload } as unknown as Response
}

function mockFetch(...responses: ((init: RequestInit) => Response)[]): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      const next = responses.shift()
      if (!next) throw new Error('unexpected fetch')
      return next(init)
    }),
  )
  return calls
}

const base: StreamOptions = {
  apiKey: 'sk-ant-test',
  model: 'claude-haiku-5-5',
  system: 'Be brief.',
  messages: [{ role: 'user', content: 'Hi' }],
}

async function drain(gen: AsyncGenerator<string, { stopReason: string | null }, void>) {
  const parts: string[] = []
  for (;;) {
    const r = await gen.next()
    if (r.done) return { parts, result: r.value }
    parts.push(r.value)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('streamMessage', () => {
  it('yields text deltas in order and returns the stop reason', async () => {
    mockFetch(() => streamResponse([textAnswer(['Hel', 'lo', ' there'])]))
    const { parts, result } = await drain(streamMessage(base))
    expect(parts.join('')).toBe('Hello there')
    expect(result).toEqual({ stopReason: 'end_turn' })
  })

  it('reassembles events split across arbitrary chunk boundaries and CRLF line endings', async () => {
    const full = textAnswer(['α', 'β'], 'refusal').replace(/\n/g, '\r\n')
    const chunks = full.match(/[\s\S]{1,7}/g)!
    mockFetch(() => streamResponse(chunks))
    const { parts, result } = await drain(streamMessage(base))
    expect(parts.join('')).toBe('αβ')
    expect(result.stopReason).toBe('refusal')
  })

  it('sends the documented headers and a streaming body', async () => {
    const calls = mockFetch(() => streamResponse([textAnswer(['ok'])]))
    await drain(streamMessage({ ...base, maxTokens: 500 }))
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBeTruthy()
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 500,
      stream: true,
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Hi' }],
    })
    expect(calls[0].url).not.toContain('sk-ant-test')
  })

  it('throws ClaudeError with status and type on a 401', async () => {
    mockFetch(() => errorResponse(401, 'authentication_error', 'invalid x-api-key'))
    const err = await drain(streamMessage(base)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ClaudeError)
    expect(err).toMatchObject({ status: 401, type: 'authentication_error', message: 'invalid x-api-key' })
  })

  it('throws ClaudeError on an error event inside the stream', async () => {
    const events = sse([{ type: 'error', error: { type: 'api_error', message: 'boom' } }])
    mockFetch(() => streamResponse([events]))
    const err = await drain(streamMessage(base)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ClaudeError)
    expect(err).toMatchObject({ type: 'api_error', message: 'boom' })
  })

  it('throws ClaudeError when the stream closes before message_stop', async () => {
    mockFetch(() => streamResponse([sse([{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } }])]))
    await expect(drain(streamMessage(base))).rejects.toBeInstanceOf(ClaudeError)
  })

  it('retries once after 2 s when overloaded', async () => {
    vi.useFakeTimers()
    const calls = mockFetch(
      () => errorResponse(529, 'overloaded_error', 'Overloaded'),
      () => streamResponse([textAnswer(['fine'])]),
    )
    const done = drain(streamMessage(base))
    await vi.advanceTimersByTimeAsync(1999)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    const { parts } = await done
    expect(calls).toHaveLength(2)
    expect(parts.join('')).toBe('fine')
  })

  it('gives up after one overloaded retry', async () => {
    vi.useFakeTimers()
    mockFetch(
      () => errorResponse(529, 'overloaded_error', 'Overloaded'),
      () => errorResponse(529, 'overloaded_error', 'Overloaded'),
    )
    const done = drain(streamMessage(base)).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await done).toMatchObject({ status: 529, type: 'overloaded_error' })
  })

  it('stops reading when the signal aborts', async () => {
    const ctrl = new AbortController()
    const first = sse([{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } }])
    mockFetch((init) => streamResponse([first], init.signal, true))
    const gen = streamMessage({ ...base, signal: ctrl.signal })
    expect(await gen.next()).toEqual({ done: false, value: 'partial' })
    const pending = gen.next()
    ctrl.abort()
    const err = await pending.catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(ClaudeError)
    expect((err as Error).name).toBe('AbortError')
  })
})

describe('checkApiKey', () => {
  it('reports ok for an accepted key without sending it in the URL', async () => {
    const calls = mockFetch(() => ({ ok: true, status: 200, text: async () => '{}' }) as unknown as Response)
    expect(await checkApiKey('sk-ant-good')).toEqual({ ok: true })
    expect(calls[0].url).not.toContain('sk-ant-good')
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-good')
  })

  it('reports a rejected key', async () => {
    mockFetch(() => errorResponse(401, 'authentication_error', 'invalid x-api-key'))
    const r = await checkApiKey('sk-ant-bad')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).not.toContain('sk-ant-bad')
  })
})
