// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PageText } from '../types.ts'
import { buildPageText, columnAt, fixLigatures, joinLines, linesIntersecting } from './text.ts'

const W = 612
const H = 792

function item(str: string, x: number, baseline: number, width: number, size = 10): TextItem {
  return {
    str,
    dir: 'ltr',
    transform: [size, 0, 0, size, x, baseline],
    width,
    height: size,
    fontName: 'f',
    hasEOL: true,
  }
}

function twoColumnPage(): TextItem[] {
  const items = [item('A Two Column Paper With A Long Title Across The Page', 72, 740, 468, 14)]
  const left = ['left line 1', 'left line two transduc-', 'tion models continue here', 'left line 4']
  left.forEach((text, i) => {
    items.push(item(text, 72, 700 - 12 * i, 225))
    items.push(item(`right line ${i + 1}`, 315, 703 - 12 * i, 225))
  })
  items.push(item('Figure 1: a caption that bridges both of the columns', 100, 600, 400))
  items.push(item('left after figure', 72, 560, 225))
  items.push(item('right after figure', 315, 560, 225))
  items.push(item('7', 303, 40, 6))
  return items
}

async function fixturePages(pages: number[], file = 'attention.pdf'): Promise<Map<number, PageText>> {
  const data = new Uint8Array(readFileSync(`test/fixtures/${file}`))
  const task = getDocument({ data, verbosity: 0 })
  const doc = await task.promise
  const out = new Map<number, PageText>()
  for (const n of pages) {
    const page = await doc.getPage(n)
    const [x0, y0, x1, y1] = page.view
    const tc = await page.getTextContent()
    const items = tc.items.filter((i): i is TextItem => 'str' in i)
    out.set(n, buildPageText(n, items, x1 - x0, y1 - y0))
  }
  await task.destroy()
  return out
}

describe('buildPageText on a synthetic two-column page', () => {
  const pt = buildPageText(3, twoColumnPage(), W, H)
  const col = (text: string) => pt.lines.find((l) => l.text === text)?.column

  it('finds two columns plus the full-width column', () => {
    expect(pt.page).toBe(3)
    expect(pt.columns).toHaveLength(3)
    expect(pt.columns[1].x).toBeCloseTo(72 / W)
    expect(pt.columns[2].x).toBeCloseTo(315 / W)
  })

  it('puts wide titles and bridging captions in column 0 and body lines in their column', () => {
    expect(col('A Two Column Paper With A Long Title Across The Page')).toBe(0)
    expect(col('Figure 1: a caption that bridges both of the columns')).toBe(0)
    expect(col('left line 1')).toBe(1)
    expect(col('right line 1')).toBe(2)
    expect(col('left after figure')).toBe(1)
    expect(col('7')).not.toBe(0)
  })

  it('reads column-major between full-width lines', () => {
    const order = pt.lines.map((l) => l.text)
    const at = (t: string) => order.indexOf(t)
    expect(at('A Two Column Paper With A Long Title Across The Page')).toBe(0)
    expect(at('left line 4')).toBeLessThan(at('right line 1'))
    expect(at('right line 4')).toBeLessThan(at('Figure 1: a caption that bridges both of the columns'))
    expect(at('Figure 1: a caption that bridges both of the columns')).toBeLessThan(at('left after figure'))
    expect(at('left after figure')).toBeLessThan(at('right after figure'))
  })

  it('joins hyphenated line breaks and separates columns into paragraphs', () => {
    expect(pt.text).toContain('left line two transduction models continue here')
    expect(pt.text).toContain('left line 4\n\nright line 1')
  })

  it('columnAt returns the column under a box and 0 on full-width lines', () => {
    expect(columnAt(pt, { x: 0.2, y: 0.1, w: 0.01, h: 0.01 })).toBe(1)
    expect(columnAt(pt, { x: 0.7, y: 0.1, w: 0, h: 0 })).toBe(2)
    const title = pt.lines[0].box
    expect(columnAt(pt, { x: title.x + 0.01, y: title.y + 0.001, w: 0, h: 0 })).toBe(0)
    expect(columnAt(pt, { x: 0.01, y: 0.5, w: 0, h: 0 })).toBe(0)
  })

  it('linesIntersecting returns lines under a box in reading order', () => {
    const left = pt.columns[1]
    const hits = linesIntersecting(pt, { x: left.x, y: 0, w: left.w, h: 118 / H })
    expect(hits.map((l) => l.text)).toEqual([
      'A Two Column Paper With A Long Title Across The Page',
      'left line 1',
      'left line two transduc-',
      'tion models continue here',
    ])
  })
})

describe('buildPageText on attention.pdf', () => {
  let pages: Map<number, PageText>
  beforeAll(async () => {
    pages = await fixturePages([1, 2])
  })

  it('page 2 is one body column read top to bottom', () => {
    const pt = pages.get(2)!
    expect(pt.columns).toHaveLength(2)
    expect(pt.lines.every((l) => l.column === 1)).toBe(true)
    expect(pt.text.startsWith('1 Introduction\n\nRecurrent neural networks')).toBe(true)
    const t = pt.text
    expect(t.indexOf('2 Background')).toBeGreaterThan(t.indexOf('1 Introduction'))
    expect(t.indexOf('3 Model Architecture')).toBeGreaterThan(t.indexOf('2 Background'))
  })

  it('page 2 joins the hyphenated "transduc-tion" across lines', () => {
    expect(pages.get(2)!.text).toContain('sequence modeling and transduction models in various tasks')
  })

  it('page 1 reads title, authors, abstract in order and drops the rotated margin stamp', () => {
    const t = pages.get(1)!.text
    expect(t.indexOf('Attention Is All You Need')).toBeGreaterThan(-1)
    expect(t.indexOf('Ashish Vaswani')).toBeGreaterThan(t.indexOf('Attention Is All You Need'))
    expect(t.indexOf('Abstract')).toBeGreaterThan(t.indexOf('Illia Polosukhin'))
    expect(t.indexOf('The dominant sequence transduction')).toBeGreaterThan(t.indexOf('Abstract'))
    expect(t).not.toContain('arXiv:1706')
  })

  it('normalises line boxes to the page', () => {
    for (const l of pages.get(2)!.lines) {
      expect(l.box.x).toBeGreaterThanOrEqual(0)
      expect(l.box.x + l.box.w).toBeLessThanOrEqual(1)
      expect(l.box.y).toBeGreaterThanOrEqual(0)
      expect(l.box.y + l.box.h).toBeLessThanOrEqual(1)
    }
  })
})

describe('buildPageText on resnet.pdf (two columns)', () => {
  let pages: Map<number, PageText>
  beforeAll(async () => {
    pages = await fixturePages([1, 2], 'resnet.pdf')
  })
  const line = (pt: PageText, start: string) => pt.lines.find((l) => l.text.startsWith(start))

  it('page 1 has a full-width title and header above two columns', () => {
    const pt = pages.get(1)!
    expect(pt.columns).toHaveLength(3)
    expect(line(pt, 'Deep Residual Learning for Image Recognition')?.column).toBe(0)
    expect(line(pt, '{kahe, v-xiangz')?.column).toBe(0)
    expect(line(pt, 'Deeper neural networks are more difficult')?.column).toBe(1)
    expect(line(pt, 'problem of vanishing/exploding gradients')?.column).toBe(2)
  })

  it('page 1 reads the left column before the right one', () => {
    const t = pages.get(1)!.text
    expect(t.indexOf('Deep Residual Learning')).toBe(0)
    expect(t.indexOf('Abstract')).toBeGreaterThan(t.indexOf('microsoft.com'))
    expect(t.indexOf('COCO segmentation.')).toBeLessThan(t.indexOf('Figure 1. Training error'))
    expect(t).toContain('layers as learning residual functions')
  })

  it('page 2 is two columns read column-major', () => {
    const pt = pages.get(2)!
    expect(pt.columns).toHaveLength(3)
    expect(pt.columns[1].x + pt.columns[1].w).toBeLessThan(pt.columns[2].x)
    expect(line(pt, 'In this paper, we address the degradation')?.column).toBe(1)
    const t = pt.text
    expect(t.indexOf('without modifying the solvers.')).toBeLessThan(t.indexOf('2. Related Work'))
  })
})

describe('column detection on every fixture page', () => {
  const all = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
  let resnet: Map<number, PageText>
  let attention: Map<number, PageText>
  beforeAll(async () => {
    resnet = await fixturePages(all(12), 'resnet.pdf')
    attention = await fixturePages(all(15))
  })

  it('finds exactly two real columns on every resnet.pdf page', () => {
    expect(resnet.size).toBe(12)
    for (const [n, pt] of resnet) expect([n, pt.columns.length - 1]).toEqual([n, 2])
  })

  it('finds exactly one column on every attention.pdf page', () => {
    for (const [n, pt] of attention) expect([n, pt.columns.length - 1]).toEqual([n, 1])
  })

  it('keeps the resnet.pdf page 4 Figure 3 caption contiguous and before the right column', () => {
    const lines = resnet.get(4)!.lines
    const first = lines.findIndex((l) => l.text.startsWith('Figure 3. Example network architectures'))
    const last = lines.findIndex((l) => l.text.startsWith('more details and other variants.'))
    expect(first).toBeGreaterThan(-1)
    expect(last - first).toBe(5)
    expect(lines.slice(first, last + 1).every((l) => l.column === 1)).toBe(true)
    const right = lines.findIndex((l) => l.text.startsWith('Residual Network. Based on the above'))
    expect(right).toBe(last + 1)
  })

  it('reads the resnet.pdf page 11 body below the tables left column then right column', () => {
    const pt = resnet.get(11)!
    const body = pt.lines.filter((l) => l.box.y > 0.47 && l.column > 0)
    const columns = body.map((l) => l.column)
    expect(columns.indexOf(2)).toBeGreaterThan(0)
    expect(columns.slice(columns.indexOf(2)).every((c) => c === 2)).toBe(true)
    const t = pt.text
    const order = [
      'We select two adjacent scales',
      'Ensemble. In Faster R-CNN',
      'won the 1st place in the detection task in COCO 2015.',
      'Table 12. Our results',
      'The ImageNet Detection (DET) task involves 200 object',
    ].map((s) => t.indexOf(s))
    expect(order.every((i) => i > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})

describe('text helpers', () => {
  it('fixLigatures expands ligature code points', () => {
    expect(fixLigatures('ﬁnd eﬃcient ﬂow')).toBe('find efficient flow')
  })

  it('joinLines drops end-of-line hyphens only before lowercase', () => {
    expect(joinLines('transduc-', 'tion')).toBe('transduction')
    expect(joinLines('Multi-', 'Head')).toBe('Multi- Head')
    expect(joinLines('end', 'start')).toBe('end start')
  })
})
