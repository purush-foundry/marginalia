// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { openPdf, type OutlineItem, type PdfDoc } from './document.ts'

vi.mock('pdfjs-dist', () => import('pdfjs-dist/legacy/build/pdf.mjs'))

function fixture(): ArrayBuffer {
  const bytes = readFileSync('test/fixtures/attention.pdf')
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function flatten(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap((i) => [i, ...flatten(i.items)])
}

describe('openPdf on attention.pdf', () => {
  let doc: PdfDoc
  beforeAll(async () => {
    doc = await openPdf(fixture())
  })
  afterAll(() => doc.destroy())

  it('reports the page count, title and every page size', () => {
    expect(doc.numPages).toBe(15)
    expect(doc.title).toBeNull()
    for (let p = 1; p <= 15; p++) expect(doc.pageSize(p)).toEqual({ w: 612, h: 792 })
  })

  it('leaves the caller buffer usable', async () => {
    const buf = fixture()
    const other = await openPdf(buf)
    expect(buf.byteLength).toBeGreaterThan(0)
    other.destroy()
  })

  it('opens a Blob', async () => {
    const other = await openPdf(new Blob([fixture()], { type: 'application/pdf' }))
    expect(other.numPages).toBe(15)
    other.destroy()
  })

  it('resolves the outline to page numbers', async () => {
    const outline = await doc.getOutline()
    expect(outline[0]).toMatchObject({ title: 'Introduction', page: 2 })
    expect(outline.find((o) => o.title === 'Model Architecture')?.page).toBe(2)
    const all = flatten(outline)
    expect(all.length).toBeGreaterThan(outline.length)
    for (const o of all) expect(o.page).toBeGreaterThanOrEqual(1)
    expect(all.find((o) => o.title === 'Scaled Dot-Product Attention')?.page).toBe(4)
  })

  it('resolves internal links to page numbers with normalised boxes', async () => {
    const links = await doc.getLinks(2)
    expect(links.length).toBe(30)
    for (const l of links) {
      expect(l.page ?? l.url).toBeDefined()
      expect(l.box.x).toBeGreaterThanOrEqual(0)
      expect(l.box.y).toBeGreaterThanOrEqual(0)
      expect(l.box.x + l.box.w).toBeLessThanOrEqual(1)
      expect(l.box.y + l.box.h).toBeLessThanOrEqual(1)
    }
    const first = links[0]
    expect(first.page).toBeGreaterThan(9)
    expect(first.box.x).toBeCloseTo(325.957 / 612, 3)
    expect(first.box.y).toBeCloseTo((792 - 693.105) / 792, 3)
  })

  it('caches page text', async () => {
    const a = await doc.getPageText(2)
    const b = await doc.getPageText(2)
    expect(a).toBe(b)
    expect(a.page).toBe(2)
    expect(a.text).toContain('Introduction')
  })

  it('returns a page proxy', async () => {
    const page = await doc.getPage(3)
    expect(page.pageNumber).toBe(3)
  })
})
