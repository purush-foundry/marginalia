// Builds the Claude request for a question about an anchored passage or area, and reads citations back.
import type { Anchor, ChatMessage, PageText } from '../types.ts'
import type { ApiMessage, ContentBlock } from './claude.ts'

export type Preset = 'explain' | 'define' | 'math' | 'why'

export const PRESET_LABELS: Record<Preset, string> = {
  explain: 'Explain',
  define: 'Define here',
  math: 'Unpack the maths',
  why: 'Why does it matter',
}

export interface AskInput {
  paperTitle: string | null
  anchor: Anchor
  pageText: PageText
  crop?: { mediaType: 'image/png'; dataBase64: string }
  history: ChatMessage[]
  question: string
}

export interface Citation {
  quote: string
  page: number
}

/** A quoted passage followed by its page, e.g. `"…" (p. 3)`; group 1 is the quote, group 2 the page. */
export const CITATION = /["“]([^"“”\n]{1,800}?)["”]\s*\(p\.\s*(\d+)\)/

const SYSTEM_PROMPT = [
  'You are reading a research paper together with the user. They have selected a passage, equation or figure on one page and are asking about it.',
  'You are given the text of that page with the selected passage marked between << and >>. When they selected a region instead, you are also given an image of it.',
  'Answer about the selection, in the context of the page text provided.',
  'Support your answer by quoting the page text verbatim in the form "quoted words" (p. N), where N is the page number. Quote only words that appear in the provided text, and keep quotes short.',
  'If the answer is not supported by the provided text, say so plainly. If you then add background from general knowledge, label it as such.',
  'Be concise. Use plain Markdown: short paragraphs, lists, **bold**, *italic*, `code`. No tables, no HTML. Write maths inline in plain text or `code`.',
].join('\n')

function isArea(anchor: Anchor): boolean {
  return !anchor.text?.trim()
}

export function presetQuestion(preset: Preset, anchor: Anchor): string {
  const it = isArea(anchor) ? 'the selected region' : 'the selected passage'
  switch (preset) {
    case 'explain':
      return `Explain ${it} in plain terms.`
    case 'define':
      return `Define the key terms in ${it} as this paper uses them here.`
    case 'math':
      return `Unpack the maths in ${it}: what each symbol means and what the expression does, step by step.`
    case 'why':
      return `Why does ${it} matter for the paper's argument?`
  }
}

// Wraps `selection` in << >> inside `text`, matching across any whitespace differences; null when absent.
function markSelection(text: string, selection: string): string | null {
  const needle = selection.trim().replace(/\s+/g, ' ')
  if (!needle) return null
  let flat = ''
  const origin: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (flat.endsWith(' ')) continue
      flat += ' '
    } else {
      flat += text[i]
    }
    origin.push(i)
  }
  const at = flat.indexOf(needle)
  if (at < 0) return null
  const start = origin[at]
  const end = origin[at + needle.length - 1] + 1
  return `${text.slice(0, start)}<<${text.slice(start, end)}>>${text.slice(end)}`
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

// Describes the page for the first user turn: title, selection handling, then the page text.
function contextText(input: AskInput): string {
  const { anchor, pageText, paperTitle } = input
  const lines: string[] = []
  if (paperTitle) lines.push(`Paper: ${paperTitle}`)
  let body = pageText.text
  if (isArea(anchor) && input.crop) {
    lines.push(`Text of page ${anchor.page}. The user selected a region of this page; it is shown in the image below.`)
  } else if (isArea(anchor)) {
    lines.push(`Text of page ${anchor.page}. The user is asking about the selected area on p.${anchor.page}, which is not marked in this text.`)
  } else {
    const marked = markSelection(pageText.text, anchor.text!)
    if (marked) {
      body = marked
      lines.push(`Text of page ${anchor.page}, with the selected passage marked between << and >>.`)
    } else {
      lines.push(`Selected passage (not found verbatim in the page text): <<${anchor.text!.trim()}>>`)
      lines.push(`Text of page ${anchor.page}:`)
    }
  }
  lines.push(`<page_text page="${anchor.page}">`, body, '</page_text>')
  return lines.join('\n')
}

// Drops empty turns, merges consecutive same-role turns and drops a leading assistant turn.
function alternate(turns: { role: ChatMessage['role']; content: string }[]): { role: ChatMessage['role']; content: string }[] {
  const out: { role: ChatMessage['role']; content: string }[] = []
  for (const t of turns) {
    if (!t.content.trim()) continue
    const last = out[out.length - 1]
    if (last?.role === t.role) last.content += `\n\n${t.content}`
    else if (out.length > 0 || t.role === 'user') out.push({ role: t.role, content: t.content })
  }
  return out
}

export function buildRequest(input: AskInput): {
  system: string
  messages: ApiMessage[]
  summary: { words: number; page: number; hasImage: boolean }
} {
  const turns = alternate([...input.history, { role: 'user', content: input.question }])
  if (turns.length === 0) throw new Error('buildRequest needs a question: both the question and the history are empty.')
  const first: ContentBlock[] = [{ type: 'text', text: contextText(input) }]
  if (input.crop) {
    first.push({ type: 'image', source: { type: 'base64', media_type: input.crop.mediaType, data: input.crop.dataBase64 } })
  }
  first.push({ type: 'text', text: turns[0].content })
  const messages: ApiMessage[] = [{ role: 'user', content: first }, ...turns.slice(1)]
  return {
    system: SYSTEM_PROMPT,
    messages,
    summary: { words: countWords(input.pageText.text), page: input.anchor.page, hasImage: Boolean(input.crop) },
  }
}

/** Finds `"…" (p. N)` citations in an answer. */
export function extractCitations(answer: string): Citation[] {
  const re = new RegExp(CITATION.source, 'g')
  return Array.from(answer.matchAll(re), (m) => ({ quote: m[1], page: Number(m[2]) }))
}
