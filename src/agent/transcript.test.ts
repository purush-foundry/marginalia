import { describe, expect, it } from 'vitest'
import type { HostEvent } from '../../host/src/protocol.ts'
import type { Thread } from '../types.ts'
import { EMPTY, append, fromThread, reduce, toolLabel, turnText, type Transcript } from './transcript.ts'

function run(events: HostEvent[], start: Transcript = EMPTY): Transcript {
  return events.reduce(reduce, start)
}

describe('reduce', () => {
  it('builds text, tool and turn lines from a scripted turn', () => {
    const t = run([
      { type: 'turn_start' },
      { type: 'text', delta: "I'll check " },
      { type: 'text', delta: 'both parts.' },
      { type: 'tool_start', id: 'a', name: 'Read', input: { file_path: '/papers/x/paper.txt' } },
      { type: 'status', text: 'Thinking…' },
      { type: 'tool_end', id: 'a', ok: true, summary: 'Read 412 lines' },
      { type: 'tool_start', id: 'b', name: 'Grep', input: { pattern: 'Section 5' } },
      { type: 'tool_end', id: 'b', ok: false, summary: 'No matches' },
      { type: 'text', delta: 'Equation 3 defines it.' },
      { type: 'turn_end', costUsd: 0.04, durationMs: 4200, numTurns: 3 },
    ])
    expect(t.lines).toEqual([
      { kind: 'text', md: "I'll check both parts.", done: true },
      { kind: 'tool', id: 'a', name: 'Read', input: { file_path: '/papers/x/paper.txt' }, summary: 'Read 412 lines', ok: true },
      { kind: 'tool', id: 'b', name: 'Grep', input: { pattern: 'Section 5' }, summary: 'No matches', ok: false },
      { kind: 'text', md: 'Equation 3 defines it.', done: true },
      { kind: 'turn', costUsd: 0.04, durationMs: 4200 },
    ])
    expect(t.busy).toBe(false)
    expect(t.sessionCostUsd).toBe(0.04)
  })

  it('keeps busy from turn_start until the turn ends', () => {
    const t = run([{ type: 'turn_start' }, { type: 'text', delta: 'Hi' }])
    expect(t.busy).toBe(true)
    expect(t.lines).toEqual([{ kind: 'text', md: 'Hi', done: false }])
  })

  it('shows each turn its cost as the delta of the session running total', () => {
    const t = run([
      { type: 'turn_start' },
      { type: 'turn_end', costUsd: 0.1, durationMs: 1, numTurns: 1 },
      { type: 'turn_start' },
      { type: 'turn_end', costUsd: 0.35, durationMs: 1, numTurns: 1 },
    ])
    const turns = t.lines.filter((l) => l.kind === 'turn').map((l) => l.costUsd)
    expect(turns[0]).toBeCloseTo(0.1)
    expect(turns[1]).toBeCloseTo(0.25)
    expect(t.sessionCostUsd).toBe(0.35)
  })

  it('a dropped stream ends the turn with an error', () => {
    const t = run([{ type: 'turn_start' }, { type: 'text', delta: 'Half' }, { type: 'error', message: 'Connection to the host was lost' }])
    expect(t.busy).toBe(false)
    expect(t.lines).toEqual([
      { kind: 'text', md: 'Half', done: true },
      { kind: 'error', message: 'Connection to the host was lost' },
    ])
  })
})

describe('turnText', () => {
  it('joins the assistant text after the last prompt with blank lines', () => {
    const start = append(append(EMPTY, { kind: 'prompt', text: 'old' }), { kind: 'text', md: 'Old answer.', done: true })
    const t = run(
      [
        { type: 'text', delta: 'First.' },
        { type: 'tool_start', id: 'a', name: 'Read', input: {} },
        { type: 'text', delta: 'Second.' },
        { type: 'turn_end', costUsd: 0, durationMs: 0, numTurns: 1 },
      ],
      append(start, { kind: 'prompt', text: 'new' }, true),
    )
    expect(turnText(t)).toBe('First.\n\nSecond.')
  })
})

describe('toolLabel', () => {
  it.each([
    ['Read', { file_path: '/a/b/paper.txt' }, 'Read(paper.txt)'],
    ['Grep', { pattern: 'x' }, 'Grep(pattern: "x")'],
    ['Glob', { pattern: '**/*.md' }, 'Glob(**/*.md)'],
    ['WebSearch', { query: 'q' }, 'WebSearch("q")'],
    ['WebFetch', { url: 'https://a.b/c' }, 'WebFetch(https://a.b/c)'],
    ['Write', { file_path: '/n/notes.md' }, 'Write(notes.md)'],
    ['Edit', { file_path: 'notes.md' }, 'Edit(notes.md)'],
    ['Skill', { skill: 'worth-reading' }, 'Skill(worth-reading)'],
    ['Bash', { command: 'ls' }, 'Bash(…)'],
  ])('%s', (name, input, label) => {
    expect(toolLabel(name, input)).toBe(label)
  })
})

describe('fromThread', () => {
  it('replays saved turns as prompt and finished text lines', () => {
    const thread: Thread = {
      kind: 'thread',
      id: 't',
      createdAt: 1,
      updatedAt: 1,
      anchor: { page: 0, boxes: [] },
      model: 'agent',
      session: 's1',
      messages: [
        { role: 'user', content: 'q1', createdAt: 1 },
        { role: 'assistant', content: 'a1', createdAt: 2 },
        { role: 'user', content: 'q2', createdAt: 3 },
        { role: 'assistant', content: 'a2', createdAt: 4 },
      ],
    }
    expect(fromThread(thread)).toEqual({
      busy: false,
      sessionCostUsd: 0,
      lines: [
        { kind: 'prompt', text: 'q1' },
        { kind: 'text', md: 'a1', done: true },
        { kind: 'prompt', text: 'q2' },
        { kind: 'text', md: 'a2', done: true },
      ],
    })
  })
})
