import { describe, expect, it } from 'vitest'
import { sidecarToMarkdown } from './markdown'
import { emptySidecar } from '../types'

const b = { x: 0.1, y: 0.1, w: 0.2, h: 0.02 }

function sample() {
  const s = emptySidecar('p', 'paper.pdf', 1)
  s.highlights = [
    { id: '1', kind: 'text', page: 2, color: 'yellow', boxes: [b], text: 'Attention is all you need', note: 'key idea', createdAt: 1, updatedAt: 1 },
    { id: '2', kind: 'area', page: 3, color: 'blue', box: b, createdAt: 1, updatedAt: 1 },
    { id: '3', kind: 'text', page: 4, color: 'pink', boxes: [b], text: 'gone', createdAt: 1, updatedAt: 1, deleted: true },
  ]
  s.threads = [
    { id: 't', kind: 'thread', anchor: { page: 2, boxes: [b] }, model: 'm', createdAt: 1, updatedAt: 1,
      messages: [
        { role: 'user', content: 'What?', createdAt: 1 },
        { role: 'assistant', content: 'This.', createdAt: 2 },
      ] },
  ]
  return s
}

describe('sidecarToMarkdown', () => {
  it('writes title, quote, page, colour and note', () => {
    const md = sidecarToMarkdown(sample(), { title: 'My Paper' })
    expect(md.startsWith('# My Paper\n')).toBe(true)
    expect(md).toContain('> Attention is all you need')
    expect(md).toContain('— p.2 · yellow')
    expect(md).toContain('key idea')
    expect(md).toContain('[Area on p.3]')
    expect(md).not.toContain('gone')
  })

  it('uses colour labels', () => {
    const md = sidecarToMarkdown(sample(), { title: 'T', colorLabels: { yellow: 'Claim' } })
    expect(md).toContain('— p.2 · Claim')
    expect(md).toContain('[Area on p.3] · blue')
  })

  it('writes threads as Q/A', () => {
    const md = sidecarToMarkdown(sample(), { title: 'T' })
    expect(md).toContain('**Q:** What?')
    expect(md).toContain('**A:** This.')
  })

  it('links pages when pageLink is given', () => {
    const md = sidecarToMarkdown(sample(), { title: 'T', pageLink: (p) => `https://x/#page=${p}` })
    expect(md).toContain('[p.2](https://x/#page=2)')
    expect(md).toContain('[Area on p.3](https://x/#page=3)')
  })
})
