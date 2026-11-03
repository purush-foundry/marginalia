import type { PDFPageProxy } from 'pdfjs-dist'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { PdfDoc } from './document.ts'
import { PageView, type PageViewProps } from './PageView.tsx'

const never = <T,>() => new Promise<T>(() => {})

function fakeDoc(cleanup: () => boolean): PdfDoc {
  const proxy = {
    cleanup,
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: never(), cancel: () => {} }),
    getTextContent: () => never(),
  } as unknown as PDFPageProxy
  return {
    numPages: 1,
    title: null,
    pageSize: () => ({ w: 600, h: 800 }),
    getPage: async () => proxy,
    getOutline: async () => [],
    getPageText: () => never(),
    getLinks: async () => [],
    renderCrop: () => never(),
    destroy() {},
  }
}

const root = document.createElement('div')
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)))

afterEach(() => act(() => render(null, root)))

it('releases page resources when the page goes inactive and on unmount, not on zoom', async () => {
  const cleanup = vi.fn(() => true)
  const doc = fakeDoc(cleanup)
  const props = (extra: Partial<PageViewProps>): PageViewProps => ({
    doc,
    page: 1,
    scale: 1,
    renderScale: 1,
    top: 0,
    left: 0,
    crop: { left: 0, right: 0 },
    active: true,
    keepImages: false,
    highlights: [],
    area: null,
    onLink: () => {},
    ...extra,
  })

  act(() => render(<PageView {...props({})} />, root))
  await settle()
  act(() => render(<PageView {...props({ scale: 2, renderScale: 2 })} />, root))
  await settle()
  expect(cleanup).not.toHaveBeenCalled()

  act(() => render(<PageView {...props({ scale: 2, renderScale: 2, active: false })} />, root))
  await settle()
  expect(cleanup).toHaveBeenCalledOnce()

  act(() => render(<PageView {...props({ scale: 3, renderScale: 3, active: false })} />, root))
  await settle()
  expect(cleanup).toHaveBeenCalledOnce()

  act(() => render(null, root))
  await settle()
  expect(cleanup).toHaveBeenCalledTimes(2)
})

it('ignores a destroyed document on unmount', async () => {
  const doc = { ...fakeDoc(() => true), getPage: () => Promise.reject(new Error('Transport destroyed')) }
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  act(() => render(<PageView {...{ doc, page: 1, scale: 1, renderScale: 1, top: 0, left: 0, crop: { left: 0, right: 0 }, active: false, keepImages: false, highlights: [], area: null, onLink: () => {} }} />, root))
  act(() => render(null, root))
  await settle()
  expect(error).not.toHaveBeenCalled()
  error.mockRestore()
})
