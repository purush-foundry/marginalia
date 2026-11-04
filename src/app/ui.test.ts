import { afterEach, describe, expect, test, vi } from 'vitest'
import { copyImage } from './ui'

const png = new Blob(['png'], { type: 'image/png' })

class FakeClipboardItem {
  readonly items: Record<string, Blob | Promise<Blob>>
  constructor(items: Record<string, Blob | Promise<Blob>>) {
    this.items = items
  }
  get types() {
    return Object.keys(this.items)
  }
}

function stubClipboard(write: (items: FakeClipboardItem[]) => Promise<void>) {
  vi.stubGlobal('ClipboardItem', FakeClipboardItem)
  vi.stubGlobal('navigator', { ...navigator, clipboard: { write: vi.fn(write) } })
  return navigator.clipboard.write as unknown as ReturnType<typeof vi.fn>
}

function watchDownloads() {
  const clicked: { download: string; href: string }[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href })
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:snip')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  return clicked
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('copyImage', () => {
  test('copyImage writes a PNG ClipboardItem', async () => {
    const write = stubClipboard(async () => undefined)
    const clicked = watchDownloads()
    await expect(copyImage(Promise.resolve(png), 'x.png')).resolves.toBe('copied')
    const [item] = write.mock.calls[0][0] as FakeClipboardItem[]
    expect(item.types).toEqual(['image/png'])
    await expect(Promise.resolve(item.items['image/png'])).resolves.toBe(png)
    expect(clicked).toEqual([])
  })

  test('copyImage downloads when the clipboard refuses', async () => {
    stubClipboard(async () => Promise.reject(new Error('denied')))
    const clicked = watchDownloads()
    await expect(copyImage(png, 'x.png')).resolves.toBe('downloaded')
    expect(clicked).toEqual([{ download: 'x.png', href: 'blob:snip' }])
  })

  test('copyImage downloads when ClipboardItem is missing', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    const clicked = watchDownloads()
    await expect(copyImage(png, 'x.png')).resolves.toBe('downloaded')
    expect(clicked).toEqual([{ download: 'x.png', href: 'blob:snip' }])
  })
})
