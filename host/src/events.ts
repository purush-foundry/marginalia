import type { HostEvent } from './protocol'

export interface SdkMsg {
  type: string
  subtype?: string
  event?: {
    type: string
    index?: number
    delta?: { type: string; text?: string }
    content_block?: { type: string; id?: string; name?: string }
  }
  message?: { content: Array<Record<string, unknown>> }
  total_cost_usd?: number
  duration_ms?: number
  num_turns?: number
  is_error?: boolean
  errors?: string[]
  result?: string
}

const STATUS_TEXT: Record<string, string> = {
  compact_boundary: 'Compacting…',
  status: 'Working…',
}

function resultSummary(content: unknown): string {
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    text = content
      .map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .join('')
  }
  const lines = text.split('\n').filter((l, i, a) => l.length > 0 || i < a.length - 1)
  if (lines.length > 1) return `${lines.length} lines`
  const first = lines[0] ?? ''
  return first.length > 80 ? first.slice(0, 80) : first
}

// Turns SDK stream messages into host events and tracks the last turn's assistant text.
export function createNormalizer(): { push(msg: SdkMsg): HostEvent[]; finalText(): string } {
  let deltaSeen = false
  let turnText = ''
  let ended = false
  const pending = new Map<string, string>()
  const emitted = new Set<string>()

  function push(msg: SdkMsg): HostEvent[] {
    if (ended) {
      ended = false
      deltaSeen = false
      turnText = ''
      pending.clear()
      emitted.clear()
    }
    const out: HostEvent[] = []
    if (msg.type === 'stream_event' && msg.event) {
      const ev = msg.event
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use' && ev.content_block.id) {
        pending.set(ev.content_block.id, ev.content_block.name ?? '')
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        deltaSeen = true
        turnText += ev.delta.text
        out.push({ type: 'text', delta: ev.delta.text })
      }
    } else if (msg.type === 'assistant' && msg.message) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          if (!deltaSeen) {
            turnText += block.text
            if (block.text) out.push({ type: 'text', delta: block.text })
          }
        } else if (block.type === 'tool_use' && typeof block.id === 'string' && !emitted.has(block.id)) {
          emitted.add(block.id)
          const name = typeof block.name === 'string' ? block.name : (pending.get(block.id) ?? '')
          const input = block.input && typeof block.input === 'object' ? (block.input as Record<string, unknown>) : {}
          out.push({ type: 'tool_start', id: block.id, name, input })
        }
      }
    } else if (msg.type === 'user' && msg.message) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          out.push({ type: 'tool_end', id: block.tool_use_id, ok: !block.is_error, summary: resultSummary(block.content) })
        }
      }
    } else if (msg.type === 'system') {
      if (msg.subtype && msg.subtype !== 'init') out.push({ type: 'status', text: STATUS_TEXT[msg.subtype] ?? msg.subtype.replace(/_/g, ' ') })
    } else if (msg.type === 'result') {
      ended = true
      if (msg.is_error) out.push({ type: 'error', message: (msg.errors ?? []).join('; ') || msg.result || 'error' })
      else out.push({ type: 'turn_end', costUsd: msg.total_cost_usd ?? 0, durationMs: msg.duration_ms ?? 0, numTurns: msg.num_turns ?? 0 })
    }
    return out
  }

  return { push, finalText: () => turnText }
}
