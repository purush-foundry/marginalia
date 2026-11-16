export type VerdictKind = 'read' | 'skim' | 'skip'
export const VERDICT_KINDS: readonly VerdictKind[] = ['read', 'skim', 'skip']

export interface VerdictNote {
  verdict: VerdictKind
  confidence: 'high' | 'medium' | 'low'
  readTime: string
  oneLine: string
  topics: string[]
  year?: number
  venue?: string
  authors?: string
  skill: string
  model: string
  generated: string
  body: string
}

const CONFIDENCES = ['high', 'medium', 'low'] as const
const PLACEHOLDER = '<filled by the app>'

// Removes one pair of matching surrounding quotes, decoding JSON-style double-quoted strings.
function unquote(s: string): string {
  const t = s.trim()
  if (t.length < 2 || (t[0] !== '"' && t[0] !== "'") || t[t.length - 1] !== t[0]) return t
  if (t[0] === '"') {
    try {
      const v: unknown = JSON.parse(t)
      if (typeof v === 'string') return v
    } catch {
      // not valid JSON; fall through to the plain slice
    }
  }
  const inner = t.slice(1, -1)
  return inner.includes(t[0]) ? t : inner.trim()
}

// Writes a scalar value, JSON-quoting it when plain text would not read back unchanged.
function scalar(v: string): string {
  return /^["']|["']$|^\s|\s$|[\r\n]/.test(v) || v === PLACEHOLDER ? JSON.stringify(v) : v
}

// Reads a `[a, b]` or bare comma list into trimmed items.
function parseList(raw: string): string[] {
  let t = raw.trim()
  if (t.startsWith('[') && t.endsWith(']')) t = t.slice(1, -1)
  return t
    .split(',')
    .map(unquote)
    .filter((x) => x !== '')
}

/** Parses a note; null when the front matter is missing or `verdict` is not read/skim/skip. */
export function parseNote(markdown: string): VerdictNote | null {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex((l) => l.trim() === '---')
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && l.trim() === '---')
  if (end < 0) return null

  const fields = new Map<string, string>()
  for (const line of lines.slice(start + 1, end)) {
    const m = /^\s*([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line)
    if (m) fields.set(m[1], m[2].trim())
  }
  const str = (key: string): string => {
    const v = unquote(fields.get(key) ?? '')
    return v === PLACEHOLDER ? '' : v
  }

  const verdict = str('verdict')
  if (!(VERDICT_KINDS as readonly string[]).includes(verdict)) return null
  const confidence = str('confidence')
  const yearText = str('year')
  const venue = str('venue')
  const authors = str('authors')

  const note: VerdictNote = {
    verdict: verdict as VerdictKind,
    confidence: (CONFIDENCES as readonly string[]).includes(confidence)
      ? (confidence as VerdictNote['confidence'])
      : 'medium',
    readTime: str('read_time'),
    oneLine: str('one_line'),
    topics: fields.get('topics') === PLACEHOLDER ? [] : parseList(fields.get('topics') ?? ''),
    skill: str('skill'),
    model: str('model'),
    generated: str('generated'),
    body: lines.slice(end + 1).join('\n').trim(),
  }
  if (/^\d+$/.test(yearText)) note.year = parseInt(yearText, 10)
  if (venue) note.venue = venue
  if (authors) note.authors = authors
  return note
}

export function serializeNote(note: VerdictNote): string {
  const out = [
    '---',
    `verdict: ${note.verdict}`,
    `confidence: ${note.confidence}`,
    `read_time: ${scalar(note.readTime)}`,
    `one_line: ${scalar(note.oneLine)}`,
    `topics: [${note.topics.join(', ')}]`,
  ]
  if (note.year !== undefined) out.push(`year: ${note.year}`)
  if (note.venue !== undefined) out.push(`venue: ${scalar(note.venue)}`)
  if (note.authors !== undefined) out.push(`authors: ${scalar(note.authors)}`)
  out.push(`skill: ${scalar(note.skill)}`, `model: ${scalar(note.model)}`, `generated: ${scalar(note.generated)}`, '---', '')
  const head = out.join('\n')
  return note.body === '' ? head : `${head}\n${note.body}\n`
}

// Structural check for a stored note object.
export function isVerdictNote(x: unknown): x is VerdictNote {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.verdict === 'string' &&
    (VERDICT_KINDS as readonly string[]).includes(o.verdict) &&
    typeof o.body === 'string' &&
    Array.isArray(o.topics)
  )
}

export function isOutdated(note: VerdictNote, currentSkill: string): boolean {
  return note.skill !== currentSkill
}
