import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { authState } from '../drive/auth'
import { flushPendingWrites, getPdfBlob, saveSidecar, saveVerdict, setRootFolder, syncLibrary } from '../drive/library'
import { FakeDrive, signIn } from '../drive/test-helpers'
import { FOLDER_MIME, PDF_MIME, emptySidecar } from '../types'
import { grading } from '../verdict/grader'
import { Library } from './Library'

const ROOT = { id: 'lib-root', name: 'Papers', mimeType: FOLDER_MIME, parents: ['mydrive'], modifiedTime: 't', version: '1' }

let drive: FakeDrive
let root: HTMLElement

beforeEach(async () => {
  await signIn()
  drive = new FakeDrive()
  drive.add({ ...ROOT })
  drive.add({ id: 'robotics', name: 'Robotics', mimeType: FOLDER_MIME, parents: ['lib-root'] })
  drive.add({ id: 'ml', name: 'ML', mimeType: FOLDER_MIME, parents: ['lib-root'] })
  drive.add({ id: 'attention', name: 'attention.pdf', mimeType: PDF_MIME, parents: ['lib-root'], content: '%PDF-attention' })
  drive.add({ id: 'adam', name: 'adam.pdf', mimeType: PDF_MIME, parents: ['lib-root'], content: '%PDF-adam' })
  drive.add({ id: 'resnet', name: 'resnet.pdf', mimeType: PDF_MIME, parents: ['ml'], content: '%PDF-resnet' })
  drive.add({ id: 'vision', name: 'Vision', mimeType: FOLDER_MIME, parents: ['ml'] })
  await setRootFolder(ROOT)
  root = document.createElement('div')
  document.body.append(root)
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
  vi.unstubAllGlobals()
})

const rows = () => [...root.querySelectorAll<HTMLAnchorElement>('.mg-row')]
const names = () => rows().map((r) => r.querySelector('.mg-row-name')!.textContent)
const row = (name: string) => rows().find((r) => r.querySelector('.mg-row-name')!.textContent === name)!

describe('Library', () => {
  test('the hero band sits above the library header', async () => {
    await act(async () => {
      render(<Library />, root)
    })
    const lib = root.querySelector('.mg-lib')!
    expect(lib.firstElementChild!.classList.contains('mg-hero')).toBe(true)
    expect(lib.querySelector('.mg-hero')!.compareDocumentPosition(lib.querySelector('.mg-lib-head')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('the header links to the map', async () => {
    await act(async () => render(<Library />, root))
    expect(root.querySelector('.mg-lib-sync a[aria-label="Map"]')!.getAttribute('href')).toBe('#/map')
  })

  test('lists the root folder: folders first, then papers, each by name, linking to their routes', async () => {
    await act(async () => render(<Library />, root))

    expect(names()).toEqual(['ML', 'Robotics', 'adam', 'attention'])
    expect(row('ML').getAttribute('href')).toBe('#/f/ml')
    expect(row('attention').getAttribute('href')).toBe('#/p/attention')
    expect(row('attention').textContent).toContain('14 B')
    expect(root.querySelector('.mg-crumbs')!.textContent).toBe('Papers')
  })

  test('shows each paper’s reading badge from its local sidecar and a dot when it is cached', async () => {
    saveSidecar('adam', { ...emptySidecar('adam', 'adam.pdf', 1), reading: { page: 3, offset: 0, zoom: 0, status: 'done', updatedAt: 1 } })
    await flushPendingWrites()
    await getPdfBlob('attention')

    await act(async () => render(<Library />, root))
    await vi.waitFor(() => expect(root.querySelectorAll('.mg-badge')).toHaveLength(2))

    expect(row('adam').querySelector('.mg-badge')!.textContent).toBe('Done')
    expect(row('attention').querySelector('.mg-badge')!.textContent).toBe('Unread')
    expect(row('attention').querySelector('.mg-cached')).not.toBeNull()
    expect(row('adam').querySelector('.mg-cached')).toBeNull()
  })

  test('a paper with a local verdict note shows its chip', async () => {
    saveVerdict('attention', {
      verdict: 'read',
      confidence: 'high',
      readTime: '10 min',
      oneLine: 'x',
      topics: [],
      skill: 'h',
      model: 'm',
      generated: '2026-01-01T00:00:00Z',
      body: 'b',
    })
    await act(async () => render(<Library />, root))
    await vi.waitFor(() => expect(row('attention').querySelector('.mg-verdict-read')!.textContent).toBe('Read'))
    expect(row('adam').querySelector('.mg-verdict')).toBeNull()
  })

  test('a grade that finishes while the library is open shows its chip', async () => {
    await act(async () => render(<Library />, root))
    await vi.waitFor(() => expect(row('adam').querySelector('.mg-badge')).not.toBeNull())
    await act(async () => {
      grading.value = 'adam'
    })
    expect(row('adam').querySelector('.mg-verdict-read')).toBeNull()
    saveVerdict('adam', {
      verdict: 'read',
      confidence: 'high',
      readTime: '10 min',
      oneLine: 'x',
      topics: [],
      skill: 'h',
      model: 'm',
      generated: '2026-01-01T00:00:00Z',
      body: 'b',
    })
    await act(async () => {
      grading.value = null
    })
    await vi.waitFor(() => expect(row('adam').querySelector('.mg-verdict-read')!.textContent).toBe('Read'))
  })

  test('a badge follows a reading state another device synced to Drive', async () => {
    await act(async () => render(<Library />, root))
    await vi.waitFor(() => expect(row('attention').querySelector('.mg-badge')!.textContent).toBe('Unread'))

    const sidecar = { ...emptySidecar('attention', 'attention.pdf', 1), reading: { page: 9, offset: 0, zoom: 0, status: 'done' as const, updatedAt: 5 } }
    drive.add({ id: 'attention-side', name: 'attention.marginalia.json', mimeType: 'application/json', parents: ['lib-root'], appProperties: { marginalia: '1', pdf: 'attention' }, content: JSON.stringify(sidecar) })
    await act(async () => syncLibrary())

    await vi.waitFor(() => expect(row('attention').querySelector('.mg-badge')!.textContent).toBe('Done'))
  })

  test('a subfolder shows its own children and breadcrumbs back to the root', async () => {
    await act(async () => render(<Library folderId="ml" />, root))

    expect(names()).toEqual(['Vision', 'resnet'])
    const crumbs = [...root.querySelectorAll('.mg-crumbs a')]
    expect(crumbs.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Papers', '#/']])
    expect(root.querySelector('.mg-crumbs [aria-current="page"]')!.textContent).toBe('ML')

    await act(async () => render(<Library folderId="vision" />, root))
    expect(names()).toEqual([])
    expect([...root.querySelectorAll('.mg-crumbs a')].map((a) => a.getAttribute('href'))).toEqual(['#/', '#/f/ml'])
  })

  test('offers Reconnect Drive only when the session has expired', async () => {
    await act(async () => render(<Library />, root))
    const reconnect = () => [...root.querySelectorAll('button')].find((b) => b.textContent === 'Reconnect Drive')
    expect(reconnect()).toBeUndefined()

    await act(async () => {
      authState.value = { status: 'expired', expiresAt: 0 }
    })
    expect(reconnect()).toBeDefined()
  })
})
