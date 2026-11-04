// Image pipeline for the notes sheet: decode, downscale, encode, and cap the size.

export const IMAGE_LONG_EDGE_PX = 1600
export const JPEG_QUALITY = 0.82
export const IMAGE_MAX_BYTES = 1.5 * 1024 * 1024

const MIN_LONG_EDGE_PX = 400
const STEP_DOWN = 0.75
const ALPHA_PROBE_PX = 64

export interface Raster {
  width: number
  height: number
  hasAlpha: boolean
  encode(longEdge: number, type: 'image/jpeg' | 'image/png', quality?: number): Promise<Blob>
}

export interface PreparedImage {
  dataUrl: string
  width: number
  height: number
  bytes: number
  mediaType: 'image/jpeg' | 'image/png'
}

export class ImageTooLargeError extends Error {}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

// True when any pixel of a small draw of the bitmap is not fully opaque.
function bitmapHasAlpha(bitmap: ImageBitmap): boolean {
  const scale = Math.min(1, ALPHA_PROBE_PX / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvasOf(w, h).getContext('2d')
  if (!ctx) return false
  ctx.drawImage(bitmap, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

/** Decodes an image blob into a raster that encodes downscaled copies through a canvas. */
export async function decodeImage(blob: Blob): Promise<Raster> {
  const bitmap = await createImageBitmap(blob)
  const hasAlpha = /^image\/(png|webp|gif)$/.test(blob.type) && bitmapHasAlpha(bitmap)
  return {
    width: bitmap.width,
    height: bitmap.height,
    hasAlpha,
    encode(longEdge, type, quality) {
      const scale = longEdge / Math.max(bitmap.width, bitmap.height)
      const canvas = canvasOf(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
      const ctx = canvas.getContext('2d')
      if (!ctx) return Promise.reject(new Error('Canvas 2D is unavailable'))
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      return new Promise((resolve, reject) =>
        canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('Image encoding failed'))), type, quality),
      )
    },
  }
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Downscales to a long edge of at most 1600 px and steps down until the encoding fits 1.5 MB. */
export async function prepareImage(blob: Blob, decode: (blob: Blob) => Promise<Raster> = decodeImage): Promise<PreparedImage> {
  const raster = await decode(blob)
  const type = raster.hasAlpha ? 'image/png' : 'image/jpeg'
  const long = Math.max(raster.width, raster.height)
  let edge = Math.min(IMAGE_LONG_EDGE_PX, long)
  for (;;) {
    const out = await raster.encode(edge, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined)
    if (out.size <= IMAGE_MAX_BYTES) {
      return {
        dataUrl: await dataUrlOf(out),
        width: Math.round((raster.width * edge) / long),
        height: Math.round((raster.height * edge) / long),
        bytes: out.size,
        mediaType: type,
      }
    }
    edge = Math.floor(edge * STEP_DOWN)
    if (edge < MIN_LONG_EDGE_PX) throw new ImageTooLargeError('Image too large')
  }
}
