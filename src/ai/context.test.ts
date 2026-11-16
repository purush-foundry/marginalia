import { describe, expect, it } from 'vitest'
import type { Anchor, ChatMessage, PageText } from '../types.ts'
import type { ContentBlock } from './claude.ts'
import { PRESET_LABELS, buildRequest, paperBlock, extractCitations, presetQuestion, type AskInput } from './context.ts'

const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.02 }

function page(text: string, n = 3): PageText {
  return { page: n, lines: [], columns: [], text }
}

const pageText = page(
  'The Transformer follows this overall architecture.\nWe call our particular attention "Scaled Dot-Product\nAttention". The input consists of queries and keys.',
)

const textAnchor: Anchor = { page: 3, boxes: [box], text: 'We call our particular attention "Scaled Dot-Product Attention".' }
const areaAnchor: Anchor = { page: 4, boxes: [box] }
const crop = { mediaType: 'image/png' as const, dataBase64: 'iVBORw0KGgo=' }

function input(over: Partial<AskInput> = {}): AskInput {
  return { paperTitle: 'Attention Is All You Need', anchor: textAnchor, paper: [page('Intro.', 1), page('Methods.', 2), pageText], history: [], question: 'What is this?', ...over }
}

function blocks(content: string | ContentBlock[]): ContentBlock[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

function allText(content: string | ContentBlock[]): string {
  return blocks(content)
    .map((b) => (b.type === 'text' ? b.text : '[image]'))
    .join('\n')
}

const msg = (role: ChatMessage['role'], content: string): ChatMessage => ({ role, content, createdAt: 1 })

describe('presets', () => {
  it('labels the four presets', () => {
    expect(PRESET_LABELS).toEqual({
      explain: 'Explain',
      define: 'Define here',
      math: 'Unpack the maths',
      why: 'Why does it matter',
    })
  })

  it('words the question for passages and for areas', () => {
    expect(presetQuestion('explain', textAnchor)).toMatch(/passage/)
    expect(presetQuestion('explain', areaAnchor)).toMatch(/region/)
  })
})

describe('buildRequest', () => {
  it('marks the selected passage inside the page text across line breaks', () => {
    const { messages } = buildRequest(input())
    expect(messages).toHaveLength(1)
    const text = allText(messages[0].content)
    expect(text).toContain('<<We call our particular attention "Scaled Dot-Product\nAttention".>>')
    expect(text).toContain('The Transformer follows this overall architecture.')
    expect(text).toContain('Attention Is All You Need')
  })

  it('still sends the selection when it cannot be found in the page text', () => {
    const { messages } = buildRequest(input({ anchor: { ...textAnchor, text: 'not on this page' } }))
    expect(allText(messages[0].content)).toContain('<<not on this page>>')
  })

  it('orders page text, then image, then the question for area anchors', () => {
    const { messages, summary } = buildRequest(input({ anchor: areaAnchor, paper: [page('Equation 1 shows it.', 4)], crop }))
    const b = blocks(messages[0].content)
    const imageAt = b.findIndex((x) => x.type === 'image')
    expect(imageAt).toBeGreaterThan(0)
    expect(b[imageAt]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } })
    expect(b[0].type === 'text' && b[0].text).toContain('Equation 1 shows it.')
    expect(b[b.length - 1]).toEqual({ type: 'text', text: 'What is this?' })
    expect(summary).toEqual({ pages: 1, words: 4, page: 4, hasImage: true, truncated: false })
  })

  it('does not mention an image for an area anchor sent without a crop', () => {
    const { messages, summary } = buildRequest(input({ anchor: areaAnchor, paper: [page('Equation 1 shows it.', 4)] }))
    const text = allText(messages[0].content)
    expect(text).not.toMatch(/image/i)
    expect(text).toContain('selected area on p.4')
    expect(summary.hasImage).toBe(false)
  })

  it('rejects an empty question with no history', () => {
    expect(() => buildRequest(input({ question: '  ' }))).toThrow(/question/i)
  })

  it('has no image block for text anchors and counts the paper words', () => {
    const { messages, summary } = buildRequest(input())
    expect(blocks(messages[0].content).some((b) => b.type === 'image')).toBe(false)
    expect(summary).toEqual({ pages: 3, words: 23, page: 3, hasImage: false, truncated: false })
  })

  it('keeps the page context on the first turn and appends history before the new question', () => {
    const history = [msg('user', 'First?'), msg('assistant', 'First answer.'), msg('user', 'Second?'), msg('assistant', 'Second answer.')]
    const { messages } = buildRequest(input({ history, question: 'Third?' }))
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    const first = allText(messages[0].content)
    expect(first).toContain('<<')
    expect(first.trim().endsWith('First?')).toBe(true)
    expect(messages.slice(1).map((m) => allText(m.content))).toEqual(['First answer.', 'Second?', 'Second answer.', 'Third?'])
  })

  it('keeps turns alternating when history holds an unanswered question', () => {
    const history = [msg('user', 'First?'), msg('assistant', '')]
    const { messages } = buildRequest(input({ history, question: 'Again?' }))
    expect(messages).toHaveLength(1)
    expect(allText(messages[0].content)).toMatch(/First\?[\s\S]*Again\?$/)
  })

  it('tells Claude to quote with page numbers and admit gaps', () => {
    const { system } = buildRequest(input())
    expect(system).toContain('(p. N)')
    expect(system).toMatch(/not supported by the provided text/)
    expect(system).toMatch(/<page n=/)
    expect(system).toMatch(/Section 5/)
  })
})

describe('whole-paper request', () => {
  it('tags every page in a cached first block and marks the selection in a second block', () => {
    const { messages } = buildRequest(input({ paper: [page('Intro.', 1), page('Methods.', 2), pageText] }))
    const first = blocks(messages[0].content)
    expect(first[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } })
    expect(first[0].type === 'text' && first[0].text).toMatch(/<paper pages="3">\n<page n="1">\nIntro\.\n<\/page>/)
    expect(first[0].type === 'text' && first[0].text).not.toContain('<<')
    expect(first[1].type === 'text' && first[1].text).toContain('<<We call our particular attention')
    expect(first[1]).not.toHaveProperty('cache_control')
    expect(first[first.length - 1]).toEqual({ type: 'text', text: 'What is this?' })
  })

  it('keeps the paper block byte-identical across follow-ups and across threads', () => {
    const a = buildRequest(input())
    const b = buildRequest(input({ history: [msg('user', 'q1'), msg('assistant', 'a1')], question: 'q2' }))
    const c = buildRequest(input({ anchor: areaAnchor, crop }))
    expect(blocks(b.messages[0].content)[0]).toEqual(blocks(a.messages[0].content)[0])
    expect(blocks(c.messages[0].content)[0]).toEqual(blocks(a.messages[0].content)[0])
  })

  it('drops trailing pages past the cap but never the selected page', () => {
    const big = Array.from({ length: 5 }, (_, i) => page('x'.repeat(200_000), i + 1))
    const { text, truncated } = paperBlock(big, null, 5)
    expect(truncated).toBe(true)
    expect(text).toContain('<page n="5">')
    expect(text).not.toContain('<page n="4">')
    expect(text).toContain('<truncated from_page="4"/>')
    expect(text).toContain('<paper pages="5">')
  })

  it('empty pages stay tagged', () => {
    expect(paperBlock([page('', 1), page('', 2)], 'T').text).toContain('<page n="2">\n\n</page>')
  })

  it('reports pages and truncation in the summary', () => {
    expect(buildRequest(input()).summary).toMatchObject({ pages: 3, page: 3, hasImage: false, truncated: false })
  })
})

describe('extractCitations', () => {
  it('finds straight and curly quoted citations with page numbers', () => {
    const answer =
      'It is "an attention function" (p. 3). Also “queries and keys” (p.4), but not "this" alone or (p. 9) alone.'
    expect(extractCitations(answer)).toEqual([
      { quote: 'an attention function', page: 3 },
      { quote: 'queries and keys', page: 4 },
    ])
  })
})
