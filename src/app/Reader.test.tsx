import { readFileSync } from 'node:fs'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { IMAGE_MAX_EDGE_PX } from '../config'
import type { PdfDoc } from '../pdf/document'
import type { NotesSheetProps } from '../notes/NotesSheet'
import type { ViewerHandle, ViewerProps } from '../pdf/Viewer'
import { emptyNotes, emptySidecar, type NotesDoc, type Sidecar, type TextBlock, type TextHighlight } from '../types'
import { Reader } from './Reader'
import { DEFAULT_SETTINGS, settings } from './settings'
import { toast } from './ui'

const viewer: { props: ViewerProps | null } = { props: null }
const clearSelection = vi.fn()
const scrollTo = vi.fn()

vi.mock('../pdf/Viewer', () => ({
  Viewer: (props: ViewerProps) => {
    viewer.props = props
    props.handle({ clearSelection, scrollTo } as unknown as ViewerHandle)
    return <div class="fake-viewer" />
  },
}))

const sheet = vi.hoisted(() => ({ props: null as NotesSheetProps | null, scrollToBlock: vi.fn() }))

vi.mock('../notes/NotesSheet', () => ({
  NotesSheet: (props: NotesSheetProps) => {
    sheet.props = props
    props.handle?.({ scrollToBlock: sheet.scrollToBlock })
    return <div class="fake-sheet" />
  },
}))

const images = vi.hoisted(() => ({
  IMAGE_LONG_EDGE_PX: 1600,
  prepareImage: vi.fn(),
}))

vi.mock('../notes/images', () => images)

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
  loadNotes: vi.fn(),
  saveNotes: vi.fn(),
  refreshNotes: vi.fn(),
}))

vi.mock('../drive/library', async () => {
  const { signal } = await import('@preact/signals')
  return { ...drive, library: signal(null) }
})

const { openPdf } = await import('../pdf/document')

let root: HTMLElement

// Answers the width query live and every other media query with `fine`.
function stubMedia(wide: boolean, fine = true) {
  const listeners = new Set<() => void>()
  const media = { wide }
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return query === '(min-width: 700px)' ? media.wide : fine
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }))
  return (next: boolean) => {
    media.wide = next
    for (const fn of listeners) fn()
  }
}

beforeEach(() => {
  viewer.props = null
  sheet.props = null
  settings.value = DEFAULT_SETTINGS
  stubMedia(true)
  vi.clearAllMocks()
  drive.getPdfBlob.mockImplementation(async (_id: string, onProgress?: (f: number) => void) => {
    onProgress?.(1)
    return blob
  })
  drive.loadSidecar.mockImplementation(async (id: string) => emptySidecar(id, 'attention.pdf', 1))
  drive.refreshSidecar.mockResolvedValue(null)
  drive.flushPendingWrites.mockResolvedValue(undefined)
  drive.loadNotes.mockImplementation(async (id: string) => emptyNotes(id, 'attention.pdf', 1))
  drive.refreshNotes.mockResolvedValue(null)
  images.prepareImage.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,AAAA', width: 800, height: 400, bytes: 3, mediaType: 'image/jpeg' })
  doc.renderCrop.mockResolvedValue({ blob: new Blob(['jpg']), mediaType: 'image/png' })
  root = document.createElement('div')
  document.body.append(root)
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
  vi.unstubAllGlobals()
})

async function open(): Promise<ViewerProps> {
  await act(async () => render(<Reader pdfId="p1" />, root))
  await vi.waitFor(() => expect(viewer.props).not.toBeNull())
  return viewer.props!
}

const lastSaved = (): Sidecar => drive.saveSidecar.mock.calls.at(-1)![1] as Sidecar
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
const lastSavedNotes = (): NotesDoc => drive.saveNotes.mock.calls.at(-1)![1] as NotesDoc
const radios = () => [...root.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Layout"] [role="radio"]')]
const radio = (label: string) => radios().find((r) => r.textContent === label)!
const pointerDown = (el: Element) => void el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))

async function showSheet(layout: 'Notes' | 'Both' = 'Notes') {
  await act(async () => radio(layout).click())
  await vi.waitFor(() => expect(sheet.props).not.toBeNull())
  return sheet.props!.store
}

async function areaSelect(props: ViewerProps, box = { x: 0.1, y: 0.2, w: 0.3, h: 0.3 }) {
  await act(async () => props.onSelection({ page: 1, boxes: [box], text: '', endRect: new DOMRect(100, 300, 40, 16), kind: 'area' }))
}

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

  test('an area selection offers Copy image and To notes; Copy image renders the crop', async () => {
    const png = new Blob(['png'], { type: 'image/png' })
    doc.renderCrop.mockResolvedValue({ blob: png, mediaType: 'image/png' })
    const write = vi.fn(async () => undefined)
    vi.stubGlobal('ClipboardItem', class {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write } })
    try {
      const props = await open()
      const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.3 }
      await act(async () =>
        props.onSelection({ page: 1, boxes: [box], text: 'words', endRect: new DOMRect(100, 300, 40, 16), kind: 'area' }),
      )
      expect(button('To notes')).not.toBeNull()
      expect(button('Copy')).toBeNull()
      await act(async () => button('Copy image')!.click())

      expect(doc.renderCrop).toHaveBeenCalledWith(1, box, IMAGE_MAX_EDGE_PX)
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(toast.value).toBe('Image copied'))
      expect(button('Copy image')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
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

  test('a newer remote reading state wins on open: the viewer goes there and nothing is stamped until the user scrolls', async () => {
    const remote: Sidecar = {
      ...emptySidecar('p1', 'attention.pdf', 1),
      reading: { page: 7, offset: 0.4, zoom: 0, status: 'done', updatedAt: 50 },
    }
    drive.refreshSidecar.mockResolvedValue(remote)
    const props = await open()
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled())
    expect(scrollTo.mock.calls[0][0]).toBe(7)

    await act(async () => props.onReadingPosition({ page: 1, offset: 0, zoom: 0 }))
    expect(drive.saveSidecar).not.toHaveBeenCalled()

    await act(async () => {
      root.querySelector('.mg-pane-paper')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true }))
    })
    await act(async () => props.onReadingPosition({ page: 7, offset: 0.5, zoom: 0 }))
    expect(lastSaved().reading).toMatchObject({ page: 7, offset: 0.5, status: 'done' })
    expect(lastSaved().reading.updatedAt).toBeGreaterThan(50)
  })

  test('restore-time positions from the viewer are not persisted', async () => {
    drive.loadSidecar.mockResolvedValue({
      ...emptySidecar('p1', 'attention.pdf', 1),
      reading: { page: 3, offset: 0.2, zoom: 0, status: 'reading', updatedAt: 5 },
    })
    const props = await open()
    await act(async () => props.onReadingPosition({ page: 3, offset: 0.2, zoom: 0 }))
    expect(drive.saveSidecar).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()
  })
})

describe('Reader draw latch', () => {
  test('closing a paper turns the mouse Draw latch off', async () => {
    const { mouseDraws } = await import('../ink/tools')
    await open()
    mouseDraws.value = true
    act(() => render(null, root))
    expect(mouseDraws.value).toBe(false)
  })
})

describe('Reader open retry', () => {
  test('a cached copy pdf.js cannot open is replaced by a fresh download before any error shows', async () => {
    vi.mocked(openPdf).mockRejectedValueOnce(new Error('Invalid PDF structure'))
    await open()

    expect(drive.getPdfBlob).toHaveBeenCalledTimes(2)
    expect(drive.getPdfBlob.mock.calls[1][2]).toEqual({ fresh: true })
    expect(openPdf).toHaveBeenCalledTimes(2)
    expect(root.querySelector('.mg-error')).toBeNull()
  })

  test('shows the original error when the fresh download fails too', async () => {
    vi.mocked(openPdf).mockRejectedValueOnce(new Error('Invalid PDF structure'))
    drive.getPdfBlob.mockResolvedValueOnce(blob).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await act(async () => render(<Reader pdfId="p1" />, root))

    await vi.waitFor(() => expect(root.querySelector('.mg-error')?.textContent).toContain('Invalid PDF structure'))
  })
})

describe('Reader notes', () => {
  test('the notes file is not read on open; showing Notes loads it', async () => {
    let resolveNotes: (d: NotesDoc) => void = () => undefined
    drive.loadNotes.mockReturnValue(new Promise((resolve) => (resolveNotes = resolve)))
    const theirs: TextBlock = { kind: 'text', id: 'b1', order: 'a', text: 'from the iPad', createdAt: 2, updatedAt: 2 }
    drive.refreshNotes.mockResolvedValue({ ...emptyNotes('p1', 'attention.pdf', 1), blocks: [theirs] })
    await open()
    expect(drive.loadNotes).not.toHaveBeenCalled()
    expect(drive.refreshNotes).not.toHaveBeenCalled()

    await act(async () => radio('Notes').click())
    expect(drive.loadNotes).toHaveBeenCalledWith('p1')
    expect(settings.value.notesLayout).toBe('notes')
    expect(root.querySelector('.fake-viewer')).toBeNull()
    expect(root.querySelector('.mg-pane-notes')!.textContent).toContain('Loading notes…')

    await act(async () => resolveNotes(emptyNotes('p1', 'attention.pdf', 1)))
    await vi.waitFor(() => expect(sheet.props).not.toBeNull())
    expect(drive.refreshNotes).toHaveBeenCalledWith('p1')
    await vi.waitFor(() => expect(sheet.props!.store.blocks.value).toEqual([theirs]))

    act(() => render(null, root))
    expect(drive.saveNotes).not.toHaveBeenCalled()
  })

  test('Both is offered only from 700 px', async () => {
    const setWide = stubMedia(true)
    await open()
    expect(radios().map((r) => r.textContent)).toEqual(['Paper', 'Both', 'Notes'])
    await showSheet('Both')
    expect(root.querySelector('.mg-pane-paper .fake-viewer')).not.toBeNull()
    expect(root.querySelector('.mg-pane-notes .fake-sheet')).not.toBeNull()
    expect(root.querySelector('.mg-divider[role="separator"][aria-orientation="vertical"][aria-label="Resize panes"]')).not.toBeNull()

    await act(async () => setWide(false))
    expect(radios().map((r) => r.textContent)).toEqual(['Paper', 'Notes'])
    expect(root.querySelector('.mg-pane-notes')).toBeNull()
    expect(root.querySelector('.mg-divider')).toBeNull()
  })

  test('a stored Both on a narrow window shows the paper and keeps the setting', async () => {
    stubMedia(false)
    settings.value = { ...DEFAULT_SETTINGS, notesLayout: 'both' }
    await open()
    expect(root.querySelector('.fake-viewer')).not.toBeNull()
    expect(root.querySelector('.mg-pane-notes')).toBeNull()
    expect(radios().map((r) => r.textContent)).toEqual(['Paper', 'Notes'])
    expect(radio('Paper').getAttribute('aria-checked')).toBe('true')
    expect(settings.value.notesLayout).toBe('both')
    expect(drive.loadNotes).not.toHaveBeenCalled()
  })

  test('dragging the divider stores the split ratio', async () => {
    settings.value = { ...DEFAULT_SETTINGS, notesLayout: 'both' }
    await open()
    const panes = root.querySelector<HTMLElement>('.mg-panes')!
    panes.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 800)
    expect(panes.style.getPropertyValue('--split')).toBe('0.5')
    const divider = root.querySelector<HTMLElement>('.mg-divider')!
    const drag = (type: string, x: number) =>
      divider.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, button: 0 }))

    await act(async () => {
      drag('pointerdown', 500)
      drag('pointermove', 600)
    })
    expect(Number(panes.style.getPropertyValue('--split'))).toBeCloseTo(0.6)
    expect(settings.value.splitRatio).toBe(0.5)
    await act(async () => {
      drag('pointerup', 600)
    })
    expect(settings.value.splitRatio).toBeCloseTo(0.6)

    await act(async () => {
      drag('pointerdown', 600)
      drag('pointermove', 0)
      drag('pointerup', 0)
    })
    expect(settings.value.splitRatio).toBeCloseTo(0.32)

    await act(async () => {
      divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(settings.value.splitRatio).toBeCloseTo(0.37)
  })

  test('the divider is a 44 px wide pointer target that takes no layout width', async () => {
    const style = document.createElement('style')
    style.textContent = readFileSync('src/app/reader.css', 'utf8')
    document.head.append(style)
    settings.value = { ...DEFAULT_SETTINGS, notesLayout: 'both' }
    await open()
    const css = getComputedStyle(root.querySelector<HTMLElement>('.mg-divider')!)
    const [width, left, right] = [css.width, css.marginLeft, css.marginRight].map(parseFloat)
    style.remove()
    expect(width).toBeGreaterThanOrEqual(44)
    expect(width + left + right).toBe(0)
  })

  test('To notes appends the crop as an image block linked to its page and shows the sheet', async () => {
    const props = await open()
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.3 }
    await areaSelect(props, box)
    await act(async () => button('To notes')!.click())

    await vi.waitFor(() => expect(drive.saveNotes).toHaveBeenCalled())
    expect(doc.renderCrop).toHaveBeenCalledWith(1, box, 1600)
    const block = lastSavedNotes().blocks.at(-1)!
    expect(block).toMatchObject({ kind: 'image', page: 1, src: 'data:image/jpeg;base64,AAAA', aspect: 0.5 })
    expect(settings.value.notesLayout).toBe('both')
    await vi.waitFor(() => expect(sheet.scrollToBlock).toHaveBeenCalledWith(block.id))
    expect(button('To notes')).toBeNull()
  })

  test('To notes on a narrow window switches to Notes; a failure says so', async () => {
    stubMedia(false)
    const props = await open()
    await areaSelect(props)
    await act(async () => button('To notes')!.click())
    await vi.waitFor(() => expect(settings.value.notesLayout).toBe('notes'))

    images.prepareImage.mockRejectedValueOnce(new Error('decode'))
    await act(async () => radio('Paper').click())
    await areaSelect(viewer.props!)
    await act(async () => button('To notes')!.click())
    await vi.waitFor(() => expect(toast.value).toBe('Could not add to notes'))
  })

  test('Undo acts on the pane touched last', async () => {
    settings.value = { ...DEFAULT_SETTINGS, notesLayout: 'both' }
    const props = await open()
    await vi.waitFor(() => expect(sheet.props).not.toBeNull())
    const notes = sheet.props!.store
    await act(async () =>
      props.onSelection({ page: 1, boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }], text: 'mine', endRect: new DOMRect(100, 300, 40, 16), kind: 'text' }),
    )
    await act(async () => button('Green')!.click())
    await act(async () => {
      notes.addTextBlock('an idea')
    })

    await act(async () => pointerDown(root.querySelector('.mg-pane-notes .fake-sheet')!))
    await act(async () => button('Undo')!.click())
    expect(notes.blocks.value).toEqual([])
    expect(props.highlights.value).toHaveLength(1)

    await act(async () => pointerDown(root.querySelector('.mg-pane-paper .fake-viewer')!))
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
    })
    expect(props.highlights.value).toHaveLength(0)
    expect(notes.blocks.value).toEqual([])

    await act(async () => {
      document.dispatchEvent(new CustomEvent('marginalia:redo'))
    })
    expect(props.highlights.value).toHaveLength(1)
    expect(notes.blocks.value).toEqual([])
  })

  test('Copy as Markdown appends the Notes section', async () => {
    const writeText = vi.fn(async (_: string) => undefined)
    vi.stubGlobal('ClipboardItem', undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const note: TextBlock = { kind: 'text', id: 'b1', order: 'a', text: 'my note', createdAt: 1, updatedAt: 1 }
    drive.loadNotes.mockResolvedValue({ ...emptyNotes('p1', 'attention.pdf', 1), blocks: [note] })
    await open()
    await act(async () => button('Copy as Markdown')!.click())

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('# attention\n\n## Notes\n\nmy note\n'))
  })

  test('closing after a notes edit queues the notes and flushes', async () => {
    let settle: (d: NotesDoc | null) => void = () => undefined
    drive.refreshNotes.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    await open()
    const notes = await showSheet()
    await act(async () => {
      notes.addTextBlock('mine')
    })
    const theirs: TextBlock = { kind: 'text', id: 'theirs', order: 'z', text: 'theirs', createdAt: 2, updatedAt: 2 }
    await act(async () => settle({ ...emptyNotes('p1', 'attention.pdf', 1), blocks: [notes.blocks.value[0], theirs] }))

    act(() => render(null, root))

    expect(lastSavedNotes().blocks.map((b) => b.id).sort()).toEqual([notes.blocks.value[0].id, 'theirs'].sort())
    expect(drive.saveNotes.mock.calls.at(-1)![0]).toBe('p1')
    expect(drive.saveNotes.mock.invocationCallOrder.at(-1)!).toBeLessThan(drive.flushPendingWrites.mock.invocationCallOrder.at(-1)!)
  })

  test('Notes and back returns the paper to where it was', async () => {
    const props = await open()
    await act(async () => {
      root.querySelector('.mg-pane-paper')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true }))
    })
    await act(async () => props.onReadingPosition({ page: 7, offset: 0.25, zoom: 0 }))
    await showSheet()
    expect(root.querySelector('.fake-viewer')).toBeNull()
    await act(async () => radio('Paper').click())

    expect(viewer.props).not.toBe(props)
    expect(viewer.props!.initial).toEqual({ page: 7, offset: 0.25, zoom: 0 })
    await act(async () => viewer.props!.onReadingPosition({ page: 1, offset: 0, zoom: 0 }))
    expect(lastSaved().reading).toMatchObject({ page: 7, offset: 0.25 })
  })

  test('a p.N chip in the Notes layout shows the paper at that page', async () => {
    stubMedia(false)
    settings.value = { ...DEFAULT_SETTINGS, notesLayout: 'notes' }
    await act(async () => render(<Reader pdfId="p1" />, root))
    await vi.waitFor(() => expect(sheet.props).not.toBeNull())
    expect(root.querySelector('.fake-viewer')).toBeNull()

    await act(async () => sheet.props!.onJumpToPage(4))
    expect(settings.value.notesLayout).toBe('paper')
    expect(root.querySelector('.fake-viewer')).not.toBeNull()
    expect(scrollTo).toHaveBeenCalledWith(4, undefined, 'smooth')
    await act(async () => viewer.props!.onReadingPosition({ page: 4, offset: 0, zoom: 0 }))
    expect(lastSaved().reading).toMatchObject({ page: 4 })
  })

  test('pen devices get the puck over the active pane and no pen strip in the toolbar', async () => {
    settings.value = { ...DEFAULT_SETTINGS, penSeen: true, notesLayout: 'both' }
    await open()
    expect(root.querySelector('.mg-pane-paper .mg-puck')).not.toBeNull()
    expect(root.querySelector('.mg-pane-notes .mg-puck')).toBeNull()
    expect(root.querySelector('.mg-toolbar button[aria-label="Pen"]')).toBeNull()

    await act(async () => pointerDown(root.querySelector('.mg-pane-notes')!))
    expect(root.querySelector('.mg-pane-notes .mg-puck')).not.toBeNull()
    expect(root.querySelector('.mg-pane-paper .mg-puck')).toBeNull()
  })

  test('a tap on the puck is not a move: restore-time positions stay unsaved', async () => {
    settings.value = { ...DEFAULT_SETTINGS, penSeen: true }
    drive.loadSidecar.mockResolvedValue({
      ...emptySidecar('p1', 'attention.pdf', 1),
      reading: { page: 3, offset: 0.2, zoom: 0, status: 'reading', updatedAt: 5 },
    })
    const props = await open()
    await act(async () => pointerDown(root.querySelector('.mg-pane-paper .mg-puck')!))
    await act(async () => props.onReadingPosition({ page: 1, offset: 0, zoom: 0 }))
    expect(drive.saveSidecar).not.toHaveBeenCalled()
  })

  test('a laptop gets no puck', async () => {
    await open()
    expect(root.querySelector('.mg-puck')).toBeNull()
    expect(button('Draw')).not.toBeNull()
  })
})
