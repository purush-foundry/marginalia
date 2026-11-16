// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sseKeepAlive, sseSend } from './sse'

afterEach(() => vi.useRealTimers())

function fakeRes() {
  const res = new EventEmitter() as EventEmitter & { chunks: string[]; write(s: string): void }
  res.chunks = []
  res.write = (s: string) => void res.chunks.push(s)
  return res
}

describe('sse', () => {
  it('frames events and sends keep-alives until close', () => {
    vi.useFakeTimers()
    const res = fakeRes()
    sseSend(res as unknown as ServerResponse, { type: 'turn_start' })
    sseKeepAlive(res as unknown as ServerResponse, 1000)
    vi.advanceTimersByTime(2500)
    res.emit('close')
    vi.advanceTimersByTime(5000)
    expect(res.chunks).toEqual(['data: {"type":"turn_start"}\n\n', ': keep-alive\n\n', ': keep-alive\n\n'])
  })
})
