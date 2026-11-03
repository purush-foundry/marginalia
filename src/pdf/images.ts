import { OPS, Util } from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { Box } from '../types.ts'

const MIN_AREA = 0.0005
const LUMA = [0.213, 0.715, 0.072]
const cache = new WeakMap<PDFPageProxy, Promise<Box[]>>()

type Matrix = number[]

function unitSquareBox(ctm: Matrix, view: number[]): Box {
  const [vx0, vy0, vx1, vy1] = view
  const xs: number[] = []
  const ys: number[] = []
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    xs.push(ctm[0] * u + ctm[2] * v + ctm[4])
    ys.push(ctm[1] * u + ctm[3] * v + ctm[5])
  }
  const w = vx1 - vx0
  const h = vy1 - vy0
  const x0 = Math.max(Math.min(...xs), vx0)
  const x1 = Math.min(Math.max(...xs), vx1)
  const y0 = Math.max(Math.min(...ys), vy0)
  const y1 = Math.min(Math.max(...ys), vy1)
  return { x: (x0 - vx0) / w, y: (vy1 - y1) / h, w: Math.max(0, x1 - x0) / w, h: Math.max(0, y1 - y0) / h }
}

async function scan(page: PDFPageProxy): Promise<Box[]> {
  const { fnArray, argsArray } = await page.getOperatorList()
  const stack: Matrix[] = []
  let ctm: Matrix = [1, 0, 0, 1, 0, 0]
  const boxes: Box[] = []
  for (let i = 0; i < fnArray.length; i++) {
    const args = argsArray[i] as unknown[]
    switch (fnArray[i]) {
      case OPS.save:
        stack.push(ctm)
        break
      case OPS.restore:
        ctm = stack.pop() ?? ctm
        break
      case OPS.transform:
        ctm = Util.transform(ctm, args as Matrix)
        break
      case OPS.paintFormXObjectBegin:
        stack.push(ctm)
        if (Array.isArray(args[0])) ctm = Util.transform(ctm, args[0] as Matrix)
        break
      case OPS.beginGroup: {
        stack.push(ctm)
        const matrix = (args[0] as { matrix?: Matrix } | undefined)?.matrix
        if (matrix) ctm = Util.transform(ctm, matrix)
        break
      }
      case OPS.paintFormXObjectEnd:
      case OPS.endGroup:
        ctm = stack.pop() ?? ctm
        break
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject: {
        const b = unitSquareBox(ctm, page.view)
        if (b.w * b.h >= MIN_AREA) boxes.push(b)
        break
      }
    }
  }
  return boxes
}

/** Page-normalised bounding boxes of the raster images drawn on a page. */
export function imageRegions(page: PDFPageProxy): Promise<Box[]> {
  let hit = cache.get(page)
  if (!hit) {
    hit = scan(page).catch(() => [])
    cache.set(page, hit)
  }
  return hit
}

/** Pre-inverts image regions of a rendered canvas so the night-mode CSS filter shows them in original colours. */
export function preinvertRegions(canvas: HTMLCanvasElement, regions: Box[]): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  for (const r of regions) {
    const x = Math.floor(r.x * canvas.width)
    const y = Math.floor(r.y * canvas.height)
    const w = Math.min(canvas.width - x, Math.ceil(r.w * canvas.width))
    const h = Math.min(canvas.height - y, Math.ceil(r.h * canvas.height))
    if (w <= 0 || h <= 0) continue
    const img = ctx.getImageData(x, y, w, h)
    const d = img.data
    for (let p = 0; p < d.length; p += 4) {
      const r0 = 255 - d[p]
      const g0 = 255 - d[p + 1]
      const b0 = 255 - d[p + 2]
      const twoLuma = 2 * (LUMA[0] * r0 + LUMA[1] * g0 + LUMA[2] * b0)
      d[p] = twoLuma - r0
      d[p + 1] = twoLuma - g0
      d[p + 2] = twoLuma - b0
    }
    ctx.putImageData(img, x, y)
  }
}
