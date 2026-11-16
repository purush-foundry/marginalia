import { describe, expect, test } from 'vitest'
import { sseEvents } from './sse'

function body(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
}

async function collect(b: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const ev of sseEvents(b, JSON.parse)) out.push(ev)
  return out
}

describe('sseEvents', () => {
  test('parses data frames split across chunks', async () => {
    expect(await collect(body('data: {"a":1}\n\ndata: {"b"', ':2}\n\n'))).toEqual([{ a: 1 }, { b: 2 }])
  })

  test('ignores comment lines and frames without data', async () => {
    expect(await collect(body(': ping\n\ndata: {"a":1}\n\n: keepalive\n\n'))).toEqual([{ a: 1 }])
  })

  test('accepts CRLF line endings', async () => {
    expect(await collect(body('data: {"a":1}\r\n\r\ndata: {"a":2}\r\n\r\n'))).toEqual([{ a: 1 }, { a: 2 }])
  })
})
