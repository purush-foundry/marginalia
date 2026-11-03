import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { Box, PageText } from '../types.ts'
import { canvasPixelCap } from './platform.ts'
import { buildPageText } from './text.ts'

const WORKER_SRC = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
const SIZE_CONCURRENCY = 4
const MAX_CROP_SCALE = 4

export interface OutlineItem {
  title: string
  page: number | null
  items: OutlineItem[]
}
export interface PageLink {
  box: Box
  page?: number
  url?: string
}
export interface PdfDoc {
  numPages: number
  title: string | null
  pageSize(page: number): { w: number; h: number }
  getPage(page: number): Promise<PDFPageProxy>
  getOutline(): Promise<OutlineItem[]>
  getPageText(page: number): Promise<PageText>
  getLinks(page: number): Promise<PageLink[]>
  renderCrop(page: number, box: Box, maxEdgePx: number): Promise<{ blob: Blob; mediaType: 'image/png' }>
  destroy(): void
}

interface RawOutline {
  title: string
  dest: string | unknown[] | null
  items: RawOutline[]
}

interface RawAnnotation {
  subtype?: string
  rect?: number[]
  dest?: string | unknown[] | null
  url?: string
}

type View = [number, number, number, number]

async function pageViews(pdf: PDFDocumentProxy): Promise<View[]> {
  const views: View[] = new Array(pdf.numPages)
  let next = 1
  const worker = async () => {
    while (next <= pdf.numPages) {
      const n = next++
      const page = await pdf.getPage(n)
      views[n - 1] = page.view as View
    }
  }
  await Promise.all(Array.from({ length: Math.min(SIZE_CONCURRENCY, pdf.numPages) }, worker))
  return views
}

async function readTitle(pdf: PDFDocumentProxy): Promise<string | null> {
  try {
    const { info, metadata } = await pdf.getMetadata()
    const fromInfo = (info as { Title?: unknown } | null)?.Title
    const title = typeof fromInfo === 'string' && fromInfo.trim() ? fromInfo : metadata?.get('dc:title')
    return typeof title === 'string' && title.trim() ? title.trim() : null
  } catch {
    return null
  }
}

async function resolveDest(pdf: PDFDocumentProxy, dest: string | unknown[] | null | undefined): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    const target = explicit[0]
    if (typeof target === 'number') return target + 1
    if (target && typeof target === 'object') {
      return (await pdf.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
    }
    return null
  } catch {
    return null
  }
}

function normalise(view: View, rect: number[]): Box {
  const [vx0, vy0, vx1, vy1] = view
  const w = vx1 - vx0
  const h = vy1 - vy0
  const x0 = Math.max(Math.min(rect[0], rect[2]), vx0)
  const x1 = Math.min(Math.max(rect[0], rect[2]), vx1)
  const y0 = Math.max(Math.min(rect[1], rect[3]), vy0)
  const y1 = Math.min(Math.max(rect[1], rect[3]), vy1)
  return { x: (x0 - vx0) / w, y: (vy1 - y1) / h, w: Math.max(0, x1 - x0) / w, h: Math.max(0, y1 - y0) / h }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png'),
  )
}

function memo<T>(cache: Map<number, Promise<T>>, key: number, load: () => Promise<T>): Promise<T> {
  let hit = cache.get(key)
  if (!hit) {
    hit = load()
    cache.set(key, hit)
    hit.catch(() => cache.delete(key))
  }
  return hit
}

export async function openPdf(data: ArrayBuffer | Blob): Promise<PdfDoc> {
  if (!GlobalWorkerOptions.workerSrc) GlobalWorkerOptions.workerSrc = WORKER_SRC
  const bytes = data instanceof Blob ? await data.arrayBuffer() : data.slice(0)
  const task = getDocument({ data: new Uint8Array(bytes), disableAutoFetch: false })
  const pdf = await task.promise
  const [views, title] = await Promise.all([pageViews(pdf), readTitle(pdf)])
  const texts = new Map<number, Promise<PageText>>()
  const links = new Map<number, Promise<PageLink[]>>()

  const size = (n: number) => {
    const [x0, y0, x1, y1] = views[n - 1]
    return { w: x1 - x0, h: y1 - y0 }
  }

  const mapOutline = (items: RawOutline[]): Promise<OutlineItem[]> =>
    Promise.all(
      items.map(async (i) => ({
        title: i.title,
        page: await resolveDest(pdf, i.dest),
        items: await mapOutline(i.items ?? []),
      })),
    )

  return {
    numPages: pdf.numPages,
    title,
    pageSize: size,
    getPage: (n) => pdf.getPage(n),
    async getOutline() {
      const raw = (await pdf.getOutline()) as RawOutline[] | null
      return raw ? mapOutline(raw) : []
    },
    getPageText: (n) =>
      memo(texts, n, async () => {
        const page = await pdf.getPage(n)
        const [x0, y0] = views[n - 1]
        const { w, h } = size(n)
        const content = await page.getTextContent()
        const items = content.items
          .filter((i): i is TextItem => 'str' in i)
          .map((i) => {
            const [a, b, c, d, e, f] = i.transform as number[]
            return { ...i, transform: [a, b, c, d, e - x0, f - y0] }
          })
        return buildPageText(n, items, w, h)
      }),
    getLinks: (n) =>
      memo(links, n, async () => {
        const page = await pdf.getPage(n)
        const annots = (await page.getAnnotations({ intent: 'display' })) as RawAnnotation[]
        const out: PageLink[] = []
        for (const a of annots) {
          if (a.subtype !== 'Link' || !a.rect) continue
          const box = normalise(views[n - 1], a.rect)
          if (a.url) out.push({ box, url: a.url })
          else if (a.dest) {
            const target = await resolveDest(pdf, a.dest)
            if (target !== null) out.push({ box, page: target })
          }
        }
        return out
      }),
    async renderCrop(n, box, maxEdgePx) {
      const page = await pdf.getPage(n)
      const { w, h } = size(n)
      const bw = Math.max(box.w * w, 1)
      const bh = Math.max(box.h * h, 1)
      const scale = Math.min(
        maxEdgePx / Math.max(bw, bh),
        MAX_CROP_SCALE,
        Math.sqrt(canvasPixelCap() / (bw * bh)),
      )
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bw * scale))
      canvas.height = Math.max(1, Math.round(bh * scale))
      const viewport = page.getViewport({ scale, rotation: 0 })
      await page.render({
        canvas,
        viewport,
        transform: [1, 0, 0, 1, -box.x * w * scale, -box.y * h * scale],
      }).promise
      const blob = await toBlob(canvas)
      canvas.width = canvas.height = 0
      return { blob, mediaType: 'image/png' }
    },
    destroy() {
      void task.destroy()
    },
  }
}
