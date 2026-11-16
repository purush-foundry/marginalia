// Reads `data:` payloads from an SSE body with getReader(), yielding each one parsed.
export async function* sseEvents<T>(body: ReadableStream<Uint8Array>, parse: (data: string) => T): AsyncGenerator<T> {
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
        if (data) yield parse(data)
      }
    }
  } finally {
    reader.releaseLock()
  }
}
