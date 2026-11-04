import { render } from 'preact'
import { act } from 'preact/test-utils'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { library } from '../drive/library'
import { FakeDrive, signIn } from '../drive/test-helpers'
import { FOLDER_MIME, type DriveNode } from '../types'
import { Hero } from './Hero'
import { homeArtUrl } from './homeArt'
import { idbGet, idbSet } from '../lib/idb'
import { QUOTES } from './quotes'

let root: HTMLElement
let listeners: Array<(e: { matches: boolean }) => void>
let urls: Record<string, string>

const node = (id: string, name: string): DriveNode => ({ id, name, mimeType: 'image/jpeg', parents: ['r'], modifiedTime: 't', version: '1' })
const rec = (id: string) => ({ id, version: '1', type: 'image/jpeg', bytes: new TextEncoder().encode(id).buffer })

function stubOrientation(startLandscape: boolean) {
  listeners = []
  vi.stubGlobal('matchMedia', () => ({
    matches: startLandscape,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => (listeners = listeners.filter((l) => l !== fn)),
  }))
}

beforeEach(async () => {
  await signIn()
  new FakeDrive()
  urls = {}
  let n = 0
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (b: Blob) => {
      const u = `blob:${++n}`
      urls[u] = String(b.size)
      return u
    },
    revokeObjectURL: () => undefined,
  }))
  homeArtUrl.value = null
  library.value = null
  root = document.createElement('div')
  document.body.append(root)
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
  vi.unstubAllGlobals()
  library.value = null
})

test('shows the fallback drawing when there is no picture', () => {
  stubOrientation(true)
  act(() => render(<Hero />, root))
  expect(root.querySelector('img.mg-hero-fallback')).not.toBeNull()
  expect(root.querySelector('img.mg-hero-photo')).toBeNull()
})

test('shows the owner picture when one is cached', () => {
  stubOrientation(true)
  homeArtUrl.value = 'blob:1'
  act(() => render(<Hero />, root))
  expect(root.querySelector('img.mg-hero-photo')!.getAttribute('src')).toBe('blob:1')
  expect(root.querySelector('img.mg-hero-fallback')).toBeNull()
})

test('switches picture when the device rotates', async () => {
  stubOrientation(false)
  await idbSet('meta', 'homeArt:P', rec('P'))
  await idbSet('meta', 'homeArt:L', rec('LL'))
  library.value = {
    rootId: 'r', rootName: 'R', folders: { r: { id: 'r', name: 'R', mimeType: FOLDER_MIME, parents: [], modifiedTime: 't', version: '1' } },
    papers: {}, sidecars: {}, syncedAt: 1,
    homeArt: { landscape: node('L', 'landscape.jpg'), portrait: node('P', 'portrait.jpg') },
  }
  await act(async () => {
    render(<Hero />, root)
  })
  await vi.waitFor(() => expect(root.querySelector('img.mg-hero-photo')).not.toBeNull())
  const portrait = root.querySelector('img.mg-hero-photo')!.getAttribute('src')!
  expect(urls[portrait]).toBe('1')
  await act(async () => {
    listeners.forEach((l) => l({ matches: true }))
  })
  await vi.waitFor(() => expect(urls[root.querySelector('img.mg-hero-photo')!.getAttribute('src')!]).toBe('2'))
  expect(await idbGet('meta', 'homeArt:L')).toBeDefined()
})

test('shows one quotation with its attribution', () => {
  stubOrientation(true)
  act(() => render(<Hero />, root))
  const text = root.querySelector('blockquote')!.textContent
  const q = QUOTES.find((x) => x.text === text)
  expect(q).toBeDefined()
  expect(root.querySelector('figcaption')!.textContent).toContain(q!.author)
})

test('the fallback drawing has no text and stays under 40 KB', () => {
  const svg = readFileSync('src/library/hero.svg', 'utf8')
  expect(svg).not.toMatch(/<text|<foreignObject/)
  expect(Buffer.byteLength(svg)).toBeLessThanOrEqual(40 * 1024)
})

test('the band never shrinks inside the onboarding flex column', () => {
  const css = readFileSync('src/library/hero.css', 'utf8')
  expect(css).toMatch(/\.mg-hero\s*\{[^}]*flex-shrink:\s*0/)
})
