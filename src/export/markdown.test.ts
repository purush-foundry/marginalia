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

  it('orders highlights by column when columns are given', () => {
    const s = emptySidecar('p', 'paper.pdf', 1)
    const mk = (id: string, x: number, y: number) => ({
      id, kind: 'text' as const, page: 1, color: 'yellow' as const, boxes: [{ x, y, w: 0.1, h: 0.02 }], text: id, createdAt: 1, updatedAt: 1,
    })
    s.highlights = [mk('col1', 0.6, 0.1), mk('col0-lower', 0.1, 0.8), mk('col0-top', 0.1, 0.1)]
    const columns = { 1: [{ x: 0.05, y: 0, w: 0.4, h: 1 }, { x: 0.55, y: 0, w: 0.4, h: 1 }] }
    const md = sidecarToMarkdown(s, { title: 'T', columns })
    const at = (k: string) => md.indexOf(`> ${k}`)
    expect(at('col0-top')).toBeLessThan(at('col0-lower'))
    expect(at('col0-lower')).toBeLessThan(at('col1'))
  })

  it('quotes multi-line thread anchor text per line', () => {
    const s = sample()
    s.threads[0].anchor.text = 'one\ntwo'
    expect(sidecarToMarkdown(s, { title: 'T' })).toContain('> one\n> two')
  })
})
