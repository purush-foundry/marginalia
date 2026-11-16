import type { ServerResponse } from 'node:http'
import type { HostEvent } from './protocol'

// Starts an event-stream response with the given extra headers.
export function sseStart(res: ServerResponse, headers: Record<string, string> = {}): void {
  res.writeHead(200, {
    ...headers,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.flushHeaders()
}

export function sseSend(res: ServerResponse, ev: HostEvent): void {
  res.write(`data: ${JSON.stringify(ev)}\n\n`)
}

// Writes a comment line every `ms` until stopped or the response closes.
export function sseKeepAlive(res: ServerResponse, ms: number): () => void {
  const timer = setInterval(() => res.write(': keep-alive\n\n'), ms)
  const stop = () => clearInterval(timer)
  res.on('close', stop)
  return stop
}
