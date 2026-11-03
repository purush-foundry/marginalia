// Markdown-lite to Preact nodes: paragraphs, headings, lists, fenced code, bold, italic, inline code, page citations.
import { h, type ComponentChildren } from 'preact'
import { CITATION } from './context.ts'

export type OnCite = (page: number, quote: string) => void

// Groups: 1 inline code, 2 citation (3 quote, 4 page), 5 bold, 6 italic.
const INLINE = new RegExp(
  ['(`[^`\\n]+`)', `(${CITATION.source})`, '(\\*\\*[^\\n]+?\\*\\*)', '(\\*[^*\\s](?:[^*\\n]*[^*\\s])?\\*)'].join('|'),
)

const FENCE = /^\s*```/
const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/

function inline(text: string, onCite: OnCite): ComponentChildren[] {
  const out: ComponentChildren[] = []
  const re = new RegExp(INLINE.source, 'g')
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = out.length
    if (m[1]) out.push(h('code', { key }, m[1].slice(1, -1)))
    else if (m[2]) {
      const quote = m[3]
      const page = Number(m[4])
      out.push(
        h('button', { key, type: 'button', class: 'cite', title: `Go to page ${page}`, onClick: () => onCite(page, quote) }, `“${quote}” (p. ${page})`),
      )
    } else if (m[5]) out.push(h('strong', { key }, inline(m[5].slice(2, -2), onCite)))
    else out.push(h('em', { key }, inline(m[6].slice(1, -1), onCite)))
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || NUMBERED.test(line)
}

// Collects consecutive items of one list kind, folding indented continuation lines into the previous item.
function list(lines: string[], i: number, marker: RegExp, textGroup: number): { items: string[]; next: number } {
  const items: string[] = []
  while (i < lines.length) {
    const m = marker.exec(lines[i])
    if (m) items.push(m[textGroup])
    else if (items.length && /^\s+\S/.test(lines[i]) && !startsBlock(lines[i])) items[items.length - 1] += ` ${lines[i].trim()}`
    else break
    i++
  }
  return { items, next: i }
}

export function renderMarkdown(src: string, onCite: OnCite): ComponentChildren[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ComponentChildren[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const key = blocks.length
    if (!line.trim()) {
      i++
    } else if (FENCE.test(line)) {
      const code: string[] = []
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) code.push(lines[i])
      i++
      blocks.push(h('pre', { key }, h('code', null, code.join('\n'))))
    } else if (HEADING.test(line)) {
      const [, hashes, text] = HEADING.exec(line)!
      blocks.push(h(`h${Math.min(hashes.length + 2, 6)}`, { key }, inline(text, onCite)))
      i++
    } else if (BULLET.test(line)) {
      const { items, next } = list(lines, i, BULLET, 1)
      blocks.push(h('ul', { key }, items.map((t, n) => h('li', { key: n }, inline(t, onCite)))))
      i = next
    } else if (NUMBERED.test(line)) {
      const start = Number(NUMBERED.exec(line)![1])
      const { items, next } = list(lines, i, NUMBERED, 2)
      blocks.push(h('ol', { key, start }, items.map((t, n) => h('li', { key: n }, inline(t, onCite)))))
      i = next
    } else {
      const para: string[] = []
      for (; i < lines.length && lines[i].trim() && !startsBlock(lines[i]); i++) para.push(lines[i].trim())
      blocks.push(h('p', { key }, inline(para.join(' '), onCite)))
    }
  }
  return blocks
}
