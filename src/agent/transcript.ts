// Terminal transcript model: folds host events into display lines, labels tool calls, replays saved Threads.
import type { HostEvent } from '../../host/src/protocol.ts'
import type { Thread } from '../types.ts'

export type Line =
  | { kind: 'prompt'; text: string }
  | { kind: 'text'; md: string; done: boolean }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown>; summary?: string; ok?: boolean }
  | { kind: 'status'; text: string }
  | { kind: 'turn'; costUsd: number; durationMs: number }
  | { kind: 'error'; message: string }

export interface Transcript {
  lines: Line[]
  busy: boolean
  sessionCostUsd: number
}

export const EMPTY: Transcript = { lines: [], busy: false, sessionCostUsd: 0 }

export function append(t: Transcript, line: Line, busy = t.busy): Transcript {
  return { ...t, lines: [...t.lines, line], busy }
}

// Marks a trailing streaming text line as finished.
function closeText(lines: Line[]): Line[] {
  const last = lines.at(-1)
  return last?.kind === 'text' && !last.done ? [...lines.slice(0, -1), { ...last, done: true }] : lines
}

export function reduce(t: Transcript, ev: HostEvent): Transcript {
  switch (ev.type) {
    case 'turn_start':
      return { ...t, busy: true }
    case 'text': {
      const last = t.lines.at(-1)
      if (last?.kind === 'text' && !last.done) return { ...t, lines: [...t.lines.slice(0, -1), { ...last, md: last.md + ev.delta }] }
      return { ...t, lines: [...t.lines, { kind: 'text', md: ev.delta, done: false }] }
    }
    case 'tool_start':
      return { ...t, lines: [...closeText(t.lines), { kind: 'tool', id: ev.id, name: ev.name, input: ev.input }] }
    case 'tool_end':
      return { ...t, lines: t.lines.map((l) => (l.kind === 'tool' && l.id === ev.id ? { ...l, summary: ev.summary, ok: ev.ok } : l)) }
    case 'turn_end': {
      const costUsd = ev.costUsd >= t.sessionCostUsd ? ev.costUsd - t.sessionCostUsd : ev.costUsd
      return { lines: [...closeText(t.lines), { kind: 'turn', costUsd, durationMs: ev.durationMs }], busy: false, sessionCostUsd: ev.costUsd }
    }
    case 'error':
      return { ...t, lines: [...closeText(t.lines), { kind: 'error', message: ev.message }], busy: false }
    default:
      return t
  }
}

/** The assistant text after the last prompt, joined by blank lines. */
export function turnText(t: Transcript): string {
  const from = t.lines.findLastIndex((l) => l.kind === 'prompt')
  return t.lines
    .slice(from + 1)
    .flatMap((l) => (l.kind === 'text' && l.md.trim() ? [l.md.trim()] : []))
    .join('\n\n')
}

function basename(path: unknown): string {
  return String(path ?? '').split('/').pop() ?? ''
}

export function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return `${name}(${basename(input.file_path)})`
    case 'Grep':
      return `Grep(pattern: "${String(input.pattern ?? '')}")`
    case 'Glob':
      return `Glob(${String(input.pattern ?? '')})`
    case 'WebSearch':
      return `WebSearch("${String(input.query ?? '')}")`
    case 'WebFetch':
      return `WebFetch(${String(input.url ?? '')})`
    case 'Skill':
      return `Skill(${String(input.skill ?? '')})`
    default:
      return `${name}(…)`
  }
}

export function fromThread(thread: Thread): Transcript {
  const lines = thread.messages.map((m): Line => (m.role === 'user' ? { kind: 'prompt', text: m.content } : { kind: 'text', md: m.content, done: true }))
  return { ...EMPTY, lines }
}
