import { readFileSync } from 'node:fs'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { IMAGE_MAX_EDGE_PX } from '../config'
import type { PdfDoc } from '../pdf/document'
import { previousTool, setTool, tool } from '../ink/tools'
import { emptyNotebook, type NotesDocV2, type TextObject } from '../notes/model'
import type { NotebookProps } from '../notes/Notebook'
import type { ViewerHandle, ViewerProps } from '../pdf/Viewer'
import { emptySidecar, type InkStroke, type Sidecar, type TextHighlight } from '../types'
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

const notebook = vi.hoisted(() => ({
  props: null as NotebookProps | null,
  currentPage: vi.fn<() => string | null>(),
  scrollToItem: vi.fn<(id: string) => void>(),
}))

vi.mock('../notes/Notebook', () => ({
  Notebook: (props: NotebookProps) => {
    notebook.props = props
    props.handle?.({ currentPage: notebook.currentPage, scrollToItem: notebook.scrollToItem })
    return <div class="fake-notebook" />
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
  loadNotebook: vi.fn(),
  saveNotebook: vi.fn(),
  refreshNotebook: vi.fn(),
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
  notebook.props = null
  settings.value = DEFAULT_SETTINGS
  tool.value = 'pen'
  previousTool.value = 'pen'
  stubMedia(true)
  vi.clearAllMocks()
  drive.getPdfBlob.mockImplementation(async (_id: string, onProgress?: (f: number) => void) => {
    onProgress?.(1)
    return blob
  })
  drive.loadSidecar.mockImplementation(async (id: string) => emptySidecar(id, 'attention.pdf', 1))
  drive.refreshSidecar.mockResolvedValue(null)
  drive.flushPendingWrites.mockResolvedValue(undefined)
  drive.loadNotebook.mockImplementation(async (id: string) => emptyNotebook(id, 'attention.pdf', 1))
  drive.refreshNotebook.mockResolvedValue(null)
  notebook.currentPage.mockReturnValue('page-1')
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
const lastSavedNotebook = (): NotesDocV2 => drive.saveNotebook.mock.calls.at(-1)![1] as NotesDocV2
const radios = () => [...root.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Layout"] [role="radio"]')]
const radio = (label: string) => radios().find((r) => r.textContent === label)!
const notesToggle = () => root.querySelector<HTMLButtonElement>('.mg-toolbar button[aria-label="Notes"]')
const pointerDown = (el: Element) => void el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))

async function showNotebook(layout: 'Notes' | 'Both' = 'Notes') {
  await act(async () => radio(layout).click())
  await vi.waitFor(() => expect(notebook.props).not.toBeNull())
  return notebook.props!.store
}

const textObject = (id: string, text: string, page = 'page-1'): TextObject => ({
  id, page, box: { x: 0.1, y: 0.1, w: 0.5 }, text, size: 'm', color: '#1c1c1a', z: 'V', createdAt: 2, updatedAt: 2,
})

const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }))
  })

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
  test('the notebook is not read on open; showing Notes loads it and merges the remote', async () => {
    let resolveNotes: (d: NotesDocV2) => void = () => undefined
    drive.loadNotebook.mockReturnValue(new Promise((resolve) => (resolveNotes = resolve)))
    const theirs = textObject('t1', 'from the iPad')
    drive.refreshNotebook.mockResolvedValue({ ...emptyNotebook('p1', 'attention.pdf', 1), texts: [theirs] })
    await open()
    expect(drive.loadNotebook).not.toHaveBeenCalled()
    expect(drive.refreshNotebook).not.toHaveBeenCalled()

    await act(async () => radio('Notes').click())
    expect(drive.loadNotebook).toHaveBeenCalledWith('p1')
    expect(settings.value.notesLayout).toBe('notes')
    expect(root.querySelector('.fake-viewer')).toBeNull()
    expect(root.querySelector('.mg-pane-notes')!.textContent).toContain('Loading notes…')

    await act(async () => resolveNotes(emptyNotebook('p1', 'attention.pdf', 1)))
    await vi.waitFor(() => expect(notebook.props).not.toBeNull())
    expect(drive.refreshNotebook).toHaveBeenCalledWith('p1')
    await vi.waitFor(() => expect(notebook.props!.store.doc.value.texts).toEqual([theirs]))

    act(() => render(null, root))
    expect(drive.saveNotebook).not.toHaveBeenCalled()
  })

  test('a failed notebook load offers Retry', async () => {
    drive.loadNotebook.mockRejectedValueOnce(new Error('offline'))
    await open()
    await act(async () => radio('Notes').click())
    const pane = () => root.querySelector('.mg-pane-notes')!
    await vi.waitFor(() => expect(pane().textContent).toContain('Could not open notes'))
    expect(pane().textContent).not.toContain('Loading notes…')
    expect(notebook.props).toBeNull()

    await act(async () => [...pane().querySelectorAll('button')].find((b) => b.textContent === 'Retry')!.click())
    await vi.waitFor(() => expect(notebook.props).not.toBeNull())
    expect(drive.loadNotebook).toHaveBeenCalledTimes(2)
    expect(pane().textContent).not.toContain('Could not open notes')
  })

  test('Both is offered only from 700 px', async () => {
    const setWide = stubMedia(true)
    await open()
    expect(radios().map((r) => r.textContent)).toEqual(['Paper', 'Both', 'Notes'])
    await showNotebook('Both')
    expect(root.querySelector('.mg-pane-paper .fake-viewer')).not.toBeNull()
    expect(root.querySelector('.mg-pane-notes .fake-notebook')).not.toBeNull()
    expect(root.querySelector('.mg-divider[role="separator"][aria-orientation="vertical"][aria-label="Resize panes"]')).not.toBeNull()

    await act(async () => setWide(false))
    expect(radios()).toEqual([])
    expect(notesToggle()!.getAttribute('aria-pressed')).toBe('false')
    expect(root.querySelector('.mg-pane-notes')).toBeNull()
    expect(root.querySelector('.mg-divider')).toBeNull()
  })

  test('at 390 px the toolbar shows Back and a Notes toggle; at 1024 px the title and the radiogroup', async () => {
    const setWide = stubMedia(false)
    await open()
    expect(radios()).toEqual([])
    expect(root.querySelector('.mg-title')).toBeNull()
    expect(notesToggle()!.getAttribute('aria-pressed')).toBe('false')

    await act(async () => setWide(true))
    expect(notesToggle()).toBeNull()
    expect(root.querySelector('.mg-title')!.textContent).toBe('attention')
    expect(radios().map((r) => r.textContent)).toEqual(['Paper', 'Both', 'Notes'])
  })

  test('the Notes toggle on a narrow window switches to the notes and back to the paper', async () => {
    stubMedia(false)
    await open()
    await act(async () => notesToggle()!.click())
    expect(settings.value.notesLayout).toBe('notes')
    await vi.waitFor(() => expect(notebook.props).not.toBeNull())
    expect(root.querySelector('.fake-viewer')).toBeNull()
    expect(notesToggle()!.getAttribute('aria-pressed')).toBe('true')

    await act(async () => notesToggle()!.click())
    expect(settings.value.notesLayout).toBe('paper')
    await vi.waitFor(() => expect(root.querySelector('.fake-viewer')).not.toBeNull())
    expect(notesToggle()!.getAttribute('aria-pressed')).toBe('false')
  })

  test('a stored Both on a narrow window shows the paper and keeps the setting', async () => {
    stubMedia(false)
    settings.value = { ...DEFAULT_SETTINGS, notesLayout: 'both' }
    await open()
    expect(root.querySelector('.fake-viewer')).not.toBeNull()
    expect(root.querySelector('.mg-pane-notes')).toBeNull()
    expect(notesToggle()!.getAttribute('aria-pressed')).toBe('false')
    expect(settings.value.notesLayout).toBe('both')
    expect(drive.loadNotebook).not.toHaveBeenCalled()
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

  test('the notes pane shows the notebook; To notes adds the crop to the current page at half width, linked to its page', async () => {
    const twoPages = emptyNotebook('p1', 'attention.pdf', 1)
    twoPages.pages.push({ ...twoPages.pages[0], id: 'page-2', order: 'z' })
    drive.loadNotebook.mockResolvedValue(twoPages)
    notebook.currentPage.mockReturnValue('page-2')
    settings.value = { ...DEFAULT_SETTINGS, notesLayout: 'both' }
    const props = await open()
    await vi.waitFor(() => expect(root.querySelector('.mg-pane-notes .fake-notebook')).not.toBeNull())
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.3 }
    await areaSelect(props, box)
    await act(async () => button('To notes')!.click())

    await vi.waitFor(() => expect(drive.saveNotebook).toHaveBeenCalled())
    expect(doc.renderCrop).toHaveBeenCalledWith(1, box, 1600)
    const image = lastSavedNotebook().images.at(-1)!
    expect(image).toMatchObject({ page: 'page-2', pdfPage: 1, src: 'data:image/jpeg;base64,AAAA', aspect: 0.5 })
    expect(image.box.w).toBe(0.5)
    expect(settings.value.notesLayout).toBe('both')
    await vi.waitFor(() => expect(notebook.scrollToItem).toHaveBeenCalledWith(image.id))
    expect(button('To notes')).toBeNull()
  })

  test('To notes from the paper alone adds to the first page and shows the notes', async () => {
    const props = await open()
    await areaSelect(props)
    await act(async () => button('To notes')!.click())

    await vi.waitFor(() => expect(drive.saveNotebook).toHaveBeenCalled())
    const image = lastSavedNotebook().images.at(-1)!
    expect(image).toMatchObject({ page: 'page-1', pdfPage: 1 })
    expect(notebook.currentPage).not.toHaveBeenCalled()
    expect(settings.value.notesLayout).toBe('both')
    await vi.waitFor(() => expect(notebook.scrollToItem).toHaveBeenCalledWith(image.id))
  })

  test('To notes on a narrow window switches to Notes; a failure says so', async () => {
    stubMedia(false)
    const props = await open()
    await areaSelect(props)
    await act(async () => button('To notes')!.click())
    await vi.waitFor(() => expect(settings.value.notesLayout).toBe('notes'))

    images.prepareImage.mockRejectedValueOnce(new Error('decode'))
    await act(async () => notesToggle()!.click())
    await areaSelect(viewer.props!)
    await act(async () => button('To notes')!.click())
    await vi.waitFor(() => expect(toast.value).toBe('Could not add to notes'))
  })

  test('Undo acts on the pane touched last', async () => {
    settings.value = { ...DEFAULT_SETTINGS, notesLayout: 'both' }
    const props = await open()
    await vi.waitFor(() => expect(notebook.props).not.toBeNull())
    const notes = notebook.props!.store
    const liveTexts = () => notes.doc.value.texts.filter((t) => !t.deleted)
    await act(async () =>
      props.onSelection({ page: 1, boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }], text: 'mine', endRect: new DOMRect(100, 300, 40, 16), kind: 'text' }),
    )
    await act(async () => button('Green')!.click())
    await act(async () => {
      notes.addText({ page: 'page-1', box: { x: 0.1, y: 0.1, w: 0.5 }, text: 'an idea', size: 'm', color: '#1c1c1a' })
    })

    await act(async () => pointerDown(root.querySelector('.mg-pane-notes .fake-notebook')!))
    await act(async () => button('Undo')!.click())
    expect(liveTexts()).toEqual([])
    expect(props.highlights.value).toHaveLength(1)

    await act(async () => pointerDown(root.querySelector('.mg-pane-paper .fake-viewer')!))
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
    })
    expect(props.highlights.value).toHaveLength(0)
    expect(liveTexts()).toEqual([])

    await act(async () => {
      document.dispatchEvent(new CustomEvent('marginalia:redo'))
    })
    expect(props.highlights.value).toHaveLength(1)
    expect(liveTexts()).toEqual([])
  })

  test('Copy as Markdown appends the notebook section', async () => {
    const writeText = vi.fn(async (_: string) => undefined)
    vi.stubGlobal('ClipboardItem', undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    drive.loadNotebook.mockResolvedValue({ ...emptyNotebook('p1', 'attention.pdf', 1), texts: [textObject('t1', 'my note')] })
    await open()
    await act(async () => button('Copy as Markdown')!.click())

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('# attention\n\n## Notes\n\n### Page 1\n\nmy note\n'))
  })

  test('closing after a notebook edit queues the notebook and flushes', async () => {
    let settle: (d: NotesDocV2 | null) => void = () => undefined
    drive.refreshNotebook.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    await open()
    const notes = await showNotebook()
    await act(async () => {
      notes.addText({ page: 'page-1', box: { x: 0.1, y: 0.1, w: 0.5 }, text: 'mine', size: 'm', color: '#1c1c1a' })
    })
    const mine = notes.doc.value.texts[0]
    await act(async () => settle({ ...emptyNotebook('p1', 'attention.pdf', 1), texts: [mine, textObject('theirs', 'theirs')] }))

    act(() => render(null, root))

    expect(lastSavedNotebook().texts.map((t) => t.id).sort()).toEqual([mine.id, 'theirs'].sort())
    expect(drive.saveNotebook.mock.calls.at(-1)![0]).toBe('p1')
    expect(drive.saveNotebook.mock.invocationCallOrder.at(-1)!).toBeLessThan(drive.flushPendingWrites.mock.invocationCallOrder.at(-1)!)
  })

  test('Notes and back returns the paper to where it was', async () => {
    const props = await open()
    await act(async () => {
      root.querySelector('.mg-pane-paper')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true }))
    })
    await act(async () => props.onReadingPosition({ page: 7, offset: 0.25, zoom: 0 }))
    await showNotebook()
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
    await vi.waitFor(() => expect(notebook.props).not.toBeNull())
    expect(root.querySelector('.fake-viewer')).toBeNull()

    await act(async () => notebook.props!.onJumpToPage(4))
    expect(settings.value.notesLayout).toBe('paper')
    expect(root.querySelector('.fake-viewer')).not.toBeNull()
    expect(scrollTo).toHaveBeenCalledWith(4, undefined, 'smooth')
    await act(async () => viewer.props!.onReadingPosition({ page: 4, offset: 0, zoom: 0 }))
    expect(lastSaved().reading).toMatchObject({ page: 4 })
  })
})

describe('Reader tools', () => {
  test.each([
    ['a laptop', {}],
    ['a pen device', { penSeen: true }],
  ])('on %s the tool menu sits over the active pane; the toolbar has no Draw button or pen strip', async (_, device) => {
    settings.value = { ...DEFAULT_SETTINGS, ...device, notesLayout: 'both' }
    await open()
    await vi.waitFor(() => expect(notebook.props).not.toBeNull())
    expect(root.querySelector('.mg-pane-paper > .mg-toolmenu')).not.toBeNull()
    expect(root.querySelector('.mg-pane-notes .mg-toolmenu')).toBeNull()
    expect(root.querySelector('.mg-toolbar button[aria-label="Draw"]')).toBeNull()
    expect(root.querySelector('.mg-toolbar button[aria-label="Pen"]')).toBeNull()

    await act(async () => {
      root.querySelector('.mg-toolmenu-main')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    })
    const tools = [...root.querySelectorAll('.mg-toolmenu [role="group"][aria-label="Tool"] button')]
    expect(tools.map((b) => b.getAttribute('aria-label'))).toEqual(['Lasso', 'Pen', 'Highlighter', 'Eraser'])

    await act(async () => pointerDown(root.querySelector('.mg-pane-notes')!))
    expect(root.querySelector('.mg-pane-notes > .mg-toolmenu')).not.toBeNull()
    expect(root.querySelector('.mg-pane-paper .mg-toolmenu')).toBeNull()
  })

  test('a tap on the tool menu is not a move: restore-time positions stay unsaved', async () => {
    settings.value = { ...DEFAULT_SETTINGS, penSeen: true }
    drive.loadSidecar.mockResolvedValue({
      ...emptySidecar('p1', 'attention.pdf', 1),
      reading: { page: 3, offset: 0.2, zoom: 0, status: 'reading', updatedAt: 5 },
    })
    const props = await open()
    await act(async () => pointerDown(root.querySelector('.mg-pane-paper .mg-toolmenu-main')!))
    await act(async () => props.onReadingPosition({ page: 1, offset: 0, zoom: 0 }))
    expect(drive.saveSidecar).not.toHaveBeenCalled()
  })

  test('on the laptop the reader opens in Lasso and a mouse drag selects text', async () => {
    const props = await open()
    expect(tool.value).toBe('lasso')
    expect(props.penDrawing!.value).toBe(false)

    const page = document.createElement('div')
    document.body.append(page)
    try {
      await act(async () => render(props.pageOverlay!(1, 600, 776), page))
      const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1 })
      page.dispatchEvent(down)
      expect(down.defaultPrevented).toBe(false)
    } finally {
      act(() => render(null, page))
      page.remove()
    }

    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.02 }
    await act(async () =>
      props.onSelection({ page: 1, boxes: [box], text: 'Attention', endRect: new DOMRect(100, 300, 40, 16), kind: 'text' }),
    )
    await act(async () => button('Yellow')!.click())
    expect(props.highlights.value).toMatchObject([{ kind: 'text', color: 'yellow', text: 'Attention' }])

    await act(async () => setTool('pen'))
    expect(props.penDrawing!.value).toBe(true)
    act(() => render(null, root))
    expect(tool.value).toBe('lasso')
  })

  test('a pen device keeps its tool when a paper opens', async () => {
    settings.value = { ...DEFAULT_SETTINGS, penSeen: true }
    const props = await open()
    expect(tool.value).toBe('pen')
    expect(props.penDrawing!.value).toBe(true)
  })

  test('L, P, H and E pick tools; Esc returns to Lasso', async () => {
    await open()
    expect(tool.value).toBe('lasso')
    await key('p')
    expect(tool.value).toBe('pen')
    await key('h')
    expect(tool.value).toBe('highlighter')
    await key('e')
    expect(tool.value).toBe('eraser')
    await key('l')
    expect(tool.value).toBe('lasso')

    await key('p', { metaKey: true })
    expect(tool.value).toBe('lasso')
    const field = document.createElement('textarea')
    root.append(field)
    await key('p', {}, field)
    expect(tool.value).toBe('lasso')
    field.remove()

    await key('h')
    await act(async () => button('Snip')!.click())
    await key('Escape')
    expect(button('Snip')!.getAttribute('aria-pressed')).toBe('false')
    expect(tool.value).toBe('highlighter')
    await key('Escape')
    expect(tool.value).toBe('lasso')
  })

  test('paper ink uses the page width in mm and night mode puts the highlighter below the ink', async () => {
    const ink = (id: string, t: 'pen' | 'highlighter'): InkStroke => ({
      kind: 'ink', id, page: 1, color: '#1c1c1a', width: 0.01, tool: t, points: [0.1, 0.1, 0.5, 0.2, 0.2, 0.5], createdAt: 1, updatedAt: 1,
    })
    drive.loadSidecar.mockResolvedValue({ ...emptySidecar('p1', 'attention.pdf', 1), inks: [ink('pen', 'pen'), ink('hl', 'highlighter')] })
    settings.value = { ...DEFAULT_SETTINGS, nightMode: true }
    await open()
    const page = document.createElement('div')
    document.body.append(page)
    const overlay = () => act(async () => render(viewer.props!.pageOverlay!(1, 600, 776), page))
    const layers = () => [...page.querySelectorAll('.ink-layer > svg')].map((el) => el.getAttribute('class'))
    try {
      await overlay()
      expect(layers()).toEqual(['ink-hl', 'ink-pen'])
      await act(async () => {
        settings.value = { ...settings.value, nightMode: false }
      })
      await overlay()
      expect(layers()).toEqual(['ink-pen', 'ink-hl mg-multiply'])

      await act(async () => setTool('pen'))
      const mouse = (type: string, x: number, y: number) =>
        page.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }))
      await act(async () => {
        mouse('pointerdown', 100, 100)
        mouse('pointermove', 200, 150)
        mouse('pointerup', 200, 150)
      })
      expect(lastSaved().inks.at(-1)!.width).toBeCloseTo(0.35 / (612 * 0.3528))
    } finally {
      act(() => render(null, page))
      page.remove()
    }
  })
})
