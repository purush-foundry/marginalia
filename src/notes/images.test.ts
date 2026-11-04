import { expect, test, vi } from 'vitest'
import { IMAGE_MAX_BYTES, ImageTooLargeError, prepareImage, type Raster } from './images.ts'

const MB = 1024 * 1024

// A fake raster whose encoded size is given by size(longEdge, type).
function fakeRaster(width: number, height: number, size: (edge: number, type: string) => number, hasAlpha = false) {
  const encode = vi.fn(async (edge: number, type: 'image/jpeg' | 'image/png') => new Blob([new Uint8Array(size(edge, type))], { type }))
  const raster: Raster = { width, height, hasAlpha, encode }
  return { decode: async () => raster, encode }
}

const input = new Blob(['x'], { type: 'image/jpeg' })

test('downscales the long edge to 1600 px and encodes JPEG at 0.82', async () => {
  const { decode, encode } = fakeRaster(4032, 3024, () => 1000)
  const out = await prepareImage(input, decode)
  expect(encode).toHaveBeenCalledExactlyOnceWith(1600, 'image/jpeg', 0.82)
  expect(out).toMatchObject({ width: 1600, height: 1200, bytes: 1000, mediaType: 'image/jpeg' })
  expect(out.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
})

test('keeps PNG when the image has transparency', async () => {
  const { decode, encode } = fakeRaster(800, 600, () => 10, true)
  const out = await prepareImage(input, decode)
  expect(encode).toHaveBeenCalledExactlyOnceWith(800, 'image/png', undefined)
  expect(out.mediaType).toBe('image/png')
  expect(out.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
})

test('steps the size down until it fits 1.5 MB', async () => {
  const { decode, encode } = fakeRaster(4032, 3024, (edge) => (edge >= 1600 ? 2 * MB : MB))
  const out = await prepareImage(input, decode)
  expect(encode.mock.calls.map((c) => c[0])).toEqual([1600, 1200])
  expect(out).toMatchObject({ width: 1200, height: 900, bytes: MB })
  expect(out.bytes).toBeLessThanOrEqual(IMAGE_MAX_BYTES)
})

test('gives up with ImageTooLargeError below 400 px', async () => {
  const { decode, encode } = fakeRaster(4032, 3024, () => 2 * MB)
  await expect(prepareImage(input, decode)).rejects.toBeInstanceOf(ImageTooLargeError)
  expect(encode.mock.calls.map((c) => c[0])).toEqual([1600, 1200, 900, 675, 506])
})

test('never upscales a small image', async () => {
  const { decode, encode } = fakeRaster(300, 200, () => 10)
  const out = await prepareImage(input, decode)
  expect(encode).toHaveBeenCalledExactlyOnceWith(300, 'image/jpeg', 0.82)
  expect(out).toMatchObject({ width: 300, height: 200 })
})
