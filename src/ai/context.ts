// Builds the Claude request for a question about an anchored passage or area, and reads citations back.
import type { Anchor, ChatMessage, PageText } from '../types.ts'
import { PAPER_CONTEXT_MAX_CHARS } from '../config.ts'
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
  paper: PageText[]
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
  'The whole paper is provided page by page, each page inside <page n="…"> tags. The selected passage is repeated in a separate content block with its page and marked between << and >>; when they selected a region instead, you are also given an image of it.',
  'References such as "Section 5", "Eq. 3" or "Fig. 2" must be resolved by reading that part of the paper, wherever it is.',
  'Support your answer by quoting the paper text verbatim in the form "quoted words" (p. N), where N is the page number. Quote only words that appear in the provided text, and keep quotes short.',
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

function renderPaper(pages: PageText[], title: string | null, truncatedFrom: number | null, total: number): string {
  const lines: string[] = []
  if (title) lines.push(`Paper: ${title}`)
  lines.push(`<paper pages="${total}">`)
  for (const p of pages) lines.push(`<page n="${p.page}">`, p.text, '</page>')
  lines.push('</paper>')
  if (truncatedFrom !== null) lines.push(`<truncated from_page="${truncatedFrom}"/>`)
  return lines.join('\n')
}

/** The page-tagged paper text, identical for every thread on the paper; drops trailing pages (never `keepPage`) past PAPER_CONTEXT_MAX_CHARS. */
export function paperBlock(paper: PageText[], title: string | null, keepPage?: number): { text: string; truncated: boolean; words: number } {
  let used = paper.find((p) => p.page === keepPage)?.text.length ?? 0
  let firstDropped: number | null = null
  const kept = paper.filter((p) => {
    if (p.page === keepPage) return true
    if (firstDropped === null && used + p.text.length <= PAPER_CONTEXT_MAX_CHARS) {
      used += p.text.length
      return true
    }
    firstDropped ??= p.page
    return false
  })
  const words = kept.reduce((n, p) => n + countWords(p.text), 0)
  return { text: renderPaper(kept, title, firstDropped, paper.length), truncated: firstDropped !== null, words }
}

/** The second block: the anchor page's text with the passage marked, or the not-found / area line. */
export function selectionBlock(anchor: Anchor, page: PageText | undefined, hasImage: boolean): string {
  if (isArea(anchor)) {
    return hasImage
      ? `The user selected a region on p.${anchor.page}; it is shown in the image below.`
      : `The user is asking about a selected area on p.${anchor.page}, which is not marked in the text.`
  }
  const marked = page ? markSelection(page.text, anchor.text!) : null
  if (!marked) return `Selected passage on p.${anchor.page} (not found verbatim in the page text): <<${anchor.text!.trim()}>>`
  return `Page ${anchor.page} again, with the selected passage marked between << and >>:\n<page_text page="${anchor.page}">\n${marked}\n</page_text>`
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
  summary: { pages: number; words: number; page: number; hasImage: boolean; truncated: boolean }
} {
  const turns = alternate([...input.history, { role: 'user', content: input.question }])
  if (turns.length === 0) throw new Error('buildRequest needs a question: both the question and the history are empty.')
  const { anchor, paper } = input
  const anchorPage = paper.find((p) => p.page === anchor.page)
  const block = paperBlock(paper, input.paperTitle, anchor.page)
  const first: ContentBlock[] = [
    { type: 'text', text: block.text, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: selectionBlock(anchor, anchorPage, Boolean(input.crop)) },
  ]
  if (input.crop) {
    first.push({ type: 'image', source: { type: 'base64', media_type: input.crop.mediaType, data: input.crop.dataBase64 } })
  }
  first.push({ type: 'text', text: turns[0].content })
  const messages: ApiMessage[] = [{ role: 'user', content: first }, ...turns.slice(1)]
  return {
    system: SYSTEM_PROMPT,
    messages,
    summary: { pages: paper.length, words: block.words, page: anchor.page, hasImage: Boolean(input.crop), truncated: block.truncated },
  }
}

/** Finds `"…" (p. N)` citations in an answer. */
export function extractCitations(answer: string): Citation[] {
  const re = new RegExp(CITATION.source, 'g')
  return Array.from(answer.matchAll(re), (m) => ({ quote: m[1], page: Number(m[2]) }))
}
