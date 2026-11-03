import { describe, expect, it } from 'vitest'
import type { Anchor, ChatMessage, PageText } from '../types.ts'
import type { ContentBlock } from './claude.ts'
import { PRESET_LABELS, buildRequest, extractCitations, presetQuestion, type AskInput } from './context.ts'

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
  return { paperTitle: 'Attention Is All You Need', anchor: textAnchor, pageText, history: [], question: 'What is this?', ...over }
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
    const { messages, summary } = buildRequest(input({ anchor: areaAnchor, pageText: page('Equation 1 shows it.', 4), crop }))
    const b = blocks(messages[0].content)
    const imageAt = b.findIndex((x) => x.type === 'image')
    expect(imageAt).toBeGreaterThan(0)
    expect(b[imageAt]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } })
    expect(b[0].type === 'text' && b[0].text).toContain('Equation 1 shows it.')
    expect(b[b.length - 1]).toEqual({ type: 'text', text: 'What is this?' })
    expect(summary).toEqual({ words: 4, page: 4, hasImage: true })
  })

  it('does not mention an image for an area anchor sent without a crop', () => {
    const { messages, summary } = buildRequest(input({ anchor: areaAnchor, pageText: page('Equation 1 shows it.', 4) }))
    const text = allText(messages[0].content)
    expect(text).not.toMatch(/image/i)
    expect(text).toContain('the selected area on p.4')
    expect(summary.hasImage).toBe(false)
  })

  it('rejects an empty question with no history', () => {
    expect(() => buildRequest(input({ question: '  ' }))).toThrow(/question/i)
  })

  it('has no image block for text anchors and counts the page words', () => {
    const { messages, summary } = buildRequest(input())
    expect(blocks(messages[0].content).some((b) => b.type === 'image')).toBe(false)
    expect(summary).toEqual({ words: 21, page: 3, hasImage: false })
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
    expect(system).toMatch(/<< and >>/)
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
