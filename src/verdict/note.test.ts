import { describe, expect, it } from 'vitest'
import { isOutdated, isVerdictNote, parseNote, serializeNote, type VerdictNote } from './note'

const full: VerdictNote = {
  verdict: 'read',
  confidence: 'high',
  readTime: '45 min',
  oneLine: 'A thing: it works.',
  topics: ['vla', 'bimanual'],
  year: 2025,
  venue: 'CoRL',
  authors: 'Smith, Lee, Zhao',
  skill: 'abc123',
  model: 'm-1',
  generated: '2026-11-15T10:00:00Z',
  body: '## Verdict\nRead it.',
}

describe('note', () => {
  it('round trips a full note', () => {
    expect(parseNote(serializeNote(full))).toEqual(full)
  })

  it('serializes stably', () => {
    const once = serializeNote(parseNote('---\nverdict: "skim"\ntopics: a, b\n---\n\nhi\n')!)
    expect(serializeNote(parseNote(once)!)).toBe(once)
    expect(once.endsWith('hi\n')).toBe(true)
  })

  it('rejects bad verdicts and missing front matter', () => {
    expect(parseNote('---\nverdict: maybe\n---\nx')).toBeNull()
    expect(parseNote('# no front matter')).toBeNull()
    expect(parseNote('---\nverdict: read\n')).toBeNull()
  })

  it('is forgiving of what a model writes', () => {
    const n = parseNote(
      'Here you go:\r\n---\r\nverdict:  skim \r\nconfidence: sure\r\nyear: abc\r\nfoo: bar\r\none_line: \'quoted\'\r\ntopics: ["a", \'b\']\r\nskill: <filled by the app>\r\n---\r\nBody\r\n',
    )!
    expect(n.verdict).toBe('skim')
    expect(n.confidence).toBe('medium')
    expect(n.year).toBeUndefined()
    expect(n.oneLine).toBe('quoted')
    expect(n.topics).toEqual(['a', 'b'])
    expect(n.skill).toBe('')
    expect(n.readTime).toBe('')
    expect(n.body).toBe('Body')
  })

  it('parses empty topics and numeric year', () => {
    const n = parseNote('---\nverdict: skip\ntopics: []\nyear: 2024\n---\n')!
    expect(n.topics).toEqual([])
    expect(n.year).toBe(2024)
  })

  it('detects outdated skill', () => {
    expect(isOutdated(full, 'other')).toBe(true)
    expect(isOutdated(full, 'abc123')).toBe(false)
  })

  it('checks stored objects structurally', () => {
    expect(isVerdictNote(full)).toBe(true)
    expect(isVerdictNote({ ...full, verdict: 'x' })).toBe(false)
    expect(isVerdictNote({ ...full, topics: 'a' })).toBe(false)
    expect(isVerdictNote(null)).toBe(false)
  })
})
