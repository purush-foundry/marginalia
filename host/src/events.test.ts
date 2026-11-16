// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createNormalizer, type SdkMsg } from './events'

const delta = (text: string): SdkMsg => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })

describe('createNormalizer', () => {
  it('normalises a scripted turn', () => {
    const n = createNormalizer()
    const msgs: SdkMsg[] = [
      { type: 'system', subtype: 'init' },
      delta('Hello '),
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'Read' } } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello ' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'paper.txt' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'line one\nline two\nline three' }] } },
      delta('done'),
      { type: 'result', total_cost_usd: 0.5, duration_ms: 10, num_turns: 2 },
    ]
    expect(msgs.flatMap((m) => n.push(m))).toEqual([
      { type: 'text', delta: 'Hello ' },
      { type: 'tool_start', id: 't1', name: 'Read', input: { file_path: 'paper.txt' } },
      { type: 'tool_end', id: 't1', ok: true, summary: '3 lines' },
      { type: 'text', delta: 'done' },
      { type: 'turn_end', costUsd: 0.5, durationMs: 10, numTurns: 2 },
    ])
    expect(n.finalText()).toBe('Hello done')
  })

  it('emits assistant text once when no deltas arrived', () => {
    const n = createNormalizer()
    expect(n.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })).toEqual([{ type: 'text', delta: 'hi' }])
    expect(n.finalText()).toBe('hi')
  })

  it('reports tool errors and truncates single-line summaries', () => {
    const n = createNormalizer()
    const out = n.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true, content: [{ type: 'text', text: 'a'.repeat(100) }] }] } })
    expect(out).toEqual([{ type: 'tool_end', id: 'x', ok: false, summary: 'a'.repeat(80) }])
  })

  it('maps system subtypes to status', () => {
    const n = createNormalizer()
    expect(n.push({ type: 'system', subtype: 'compact_boundary' })).toEqual([{ type: 'status', text: 'Compacting…' }])
  })

  it('yields an error event for an error result and resets between turns', () => {
    const n = createNormalizer()
    n.push(delta('old'))
    expect(n.push({ type: 'result', is_error: true, errors: ['a', 'b'] })).toEqual([{ type: 'error', message: 'a; b' }])
    n.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'new' }] } })
    expect(n.finalText()).toBe('new')
  })
})
