import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PdfDoc } from '../pdf/document'
import type { ViewerHandle, ViewerProps } from '../pdf/Viewer'
import { emptySidecar, type Sidecar, type TextHighlight } from '../types'
import { Reader } from './Reader'

const viewer: { props: ViewerProps | null } = { props: null }
const clearSelection = vi.fn()

vi.mock('../pdf/Viewer', () => ({
  Viewer: (props: ViewerProps) => {
    viewer.props = props
    props.handle({ clearSelection } as unknown as ViewerHandle)
    return <div class="fake-viewer" />
  },
}))

const doc = {
  numPages: 2,
  title: 'Attention Is All You Need',
  pageSize: () => ({ w: 612, h: 792 }),
  getPage: vi.fn(),
  getOutline: vi.fn(async () => []),
  getPageText: vi.fn(async (page: number) => ({
    page,
    lines: [],
    columns: [
      { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      { x: 0.1, y: 0.1, w: 0.38, h: 0.8 },
      { x: 0.52, y: 0.1, w: 0.38, h: 0.8 },
    ],
    text: '',
  })),
  getLinks: vi.fn(async () => []),
  renderCrop: vi.fn(),
  destroy: vi.fn(),
} satisfies PdfDoc

const blob = new Blob(['%PDF'])

vi.mock('../pdf/document', () => ({ openPdf: vi.fn(async () => doc) }))

const drive = vi.hoisted(() => ({
  getPdfBlob: vi.fn(),
  loadSidecar: vi.fn(),
  saveSidecar: vi.fn(),
  refreshSidecar: vi.fn(),
  flushPendingWrites: vi.fn(),
}))

vi.mock('../drive/library', async () => {
  const { signal } = await import('@preact/signals')
  return { ...drive, library: signal(null) }
})

const { openPdf } = await import('../pdf/document')

let root: HTMLElement

beforeEach(() => {
  viewer.props = null
  vi.clearAllMocks()
  drive.getPdfBlob.mockImplementation(async (_id: string, onProgress?: (f: number) => void) => {
    onProgress?.(1)
    return blob
  })
  drive.loadSidecar.mockImplementation(async (id: string) => emptySidecar(id, 'attention.pdf', 1))
  drive.refreshSidecar.mockResolvedValue(null)
  drive.flushPendingWrites.mockResolvedValue(undefined)
  root = document.createElement('div')
  document.body.append(root)
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
})

async function open(): Promise<ViewerProps> {
  await act(async () => render(<Reader pdfId="p1" />, root))
  await vi.waitFor(() => expect(viewer.props).not.toBeNull())
  return viewer.props!
}

const lastSaved = (): Sidecar => drive.saveSidecar.mock.calls.at(-1)![1] as Sidecar
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

describe('Reader', () => {
  test('opens the paper, creates the store, and persists a highlight made from a selection', async () => {
    const props = await open()

    expect(drive.getPdfBlob).toHaveBeenCalledWith('p1', expect.any(Function))
    expect(openPdf).toHaveBeenCalledWith(blob)
    expect(drive.loadSidecar).toHaveBeenCalledWith('p1')
    expect(drive.refreshSidecar).toHaveBeenCalledWith('p1')
    expect(props.initial).toEqual({ page: 1, offset: 0, zoom: 0 })
    expect(props.highlights.value).toEqual([])
    expect(lastSaved().reading.status).toBe('reading')
    expect(root.querySelector('.mg-title')!.textContent).toBe('attention')

    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.02 }
    await act(async () =>
      props.onSelection({ page: 1, boxes: [box], text: 'Attention', endRect: new DOMRect(100, 300, 40, 16), kind: 'text' }),
    )
    expect(button('Green')).not.toBeNull()
    await act(async () => button('Green')!.click())

    expect(button('Green')).toBeNull()
    expect(clearSelection).toHaveBeenCalledOnce()
    expect(props.highlights.value).toMatchObject([{ kind: 'text', page: 1, color: 'green', boxes: [box], text: 'Attention' }])
    expect(lastSaved().highlights).toMatchObject([{ kind: 'text', color: 'green', text: 'Attention' }])
    await vi.waitFor(() => expect(doc.getPageText).toHaveBeenCalledWith(1))
  })

  test('a tapped highlight gets a note through the bar, and Delete removes it', async () => {
    const existing: TextHighlight = {
      kind: 'text', id: 'h1', page: 1, color: 'yellow', boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }], text: 'scaled dot-product', createdAt: 1, updatedAt: 1,
    }
    drive.loadSidecar.mockResolvedValue({ ...emptySidecar('p1', 'attention.pdf', 1), highlights: [existing] })
    const props = await open()

    await act(async () => props.onTapHighlight('h1', new DOMRect(100, 300, 40, 16)))
    expect(button('Yellow')!.getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('Note')!.click())
    const textarea = root.querySelector<HTMLTextAreaElement>('.mg-note textarea')!
    await act(async () => {
      textarea.value = 'the core trick'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => [...root.querySelectorAll<HTMLButtonElement>('.mg-note button')].find((b) => b.textContent === 'Save')!.click())

    expect(lastSaved().highlights[0]).toMatchObject({ id: 'h1', note: 'the core trick' })

    await act(async () => props.onTapHighlight('h1', new DOMRect(100, 300, 40, 16)))
    await act(async () => button('Delete')!.click())
    expect(props.highlights.value).toEqual([])
    expect(lastSaved().highlights[0]).toMatchObject({ id: 'h1', deleted: true })
  })

  test('dismissing the bar clears the viewer selection', async () => {
    const props = await open()
    await act(async () =>
      props.onSelection({ page: 1, boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.3 }], text: '', endRect: new DOMRect(100, 300, 40, 16), kind: 'area' }),
    )
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(button('Ask')).toBeNull()
    expect(clearSelection).toHaveBeenCalledOnce()
  })

  test('closing the reader flushes pending writes and releases the document', async () => {
    await open()
    act(() => render(null, root))
    expect(drive.flushPendingWrites).toHaveBeenCalled()
    expect(doc.destroy).toHaveBeenCalled()
  })

  test('closing after an edit queues the store state, including a remote merge that arrived later', async () => {
    let settle: (s: Sidecar | null) => void = () => undefined
    drive.refreshSidecar.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    const props = await open()
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.02 }
    await act(async () =>
      props.onSelection({ page: 1, boxes: [box], text: 'mine', endRect: new DOMRect(100, 300, 40, 16), kind: 'text' }),
    )
    await act(async () => button('Green')!.click())
    const mine = props.highlights.value[0] as TextHighlight
    const theirs: TextHighlight = { ...mine, id: 'theirs', text: 'theirs', createdAt: 2, updatedAt: 2 }
    await act(async () => settle({ ...emptySidecar('p1', 'attention.pdf', 1), highlights: [mine, theirs] }))

    act(() => render(null, root))

    expect(lastSaved().highlights.map((h) => h.id).sort()).toEqual([mine.id, 'theirs'].sort())
    expect(drive.saveSidecar.mock.invocationCallOrder.at(-1)!).toBeLessThan(drive.flushPendingWrites.mock.invocationCallOrder.at(-1)!)
  })

  test('closing without an edit queues nothing', async () => {
    drive.loadSidecar.mockResolvedValue({ ...emptySidecar('p1', 'attention.pdf', 1), reading: { page: 1, offset: 0, zoom: 0, status: 'reading', updatedAt: 1 } })
    await open()
    act(() => render(null, root))
    expect(drive.saveSidecar).not.toHaveBeenCalled()
  })
})
