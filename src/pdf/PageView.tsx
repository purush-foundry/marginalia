import { OutputScale, RenderingCancelledException, TextLayer } from 'pdfjs-dist'
import type { RenderTask } from 'pdfjs-dist'
import type { ComponentChildren } from 'preact'
import { memo } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import { HighlightLayer } from '../annot/HighlightLayer.tsx'
import type { Box, Highlight } from '../types.ts'
import type { PageLink, PdfDoc } from './document.ts'
import { imageRegions, preinvertRegions } from './images.ts'
import type { Crop } from './layout.ts'
import { MAX_CANVAS_DIM, canvasPixelCap } from './platform.ts'

export interface PageViewProps {
  doc: PdfDoc
  page: number
  /** Layout scale in CSS px per PDF point. */
  scale: number
  /** Scale the canvas is drawn at; trails `scale` while zooming. */
  renderScale: number
  top: number
  left: number
  crop: Crop
  active: boolean
  keepImages: boolean
  highlights: Highlight[]
  area: Box | null
  overlay?: ComponentChildren
  onTapHighlight(id: string, rect: DOMRect): void
  onLink(link: PageLink): void
}

const pct = (v: number) => `${v * 100}%`

function freeCanvas(c: HTMLCanvasElement | null | undefined) {
  if (!c) return
  c.width = 0
  c.height = 0
  c.remove()
}

function reportError(e: unknown) {
  if (e instanceof RenderingCancelledException) return
  if ((e as { name?: string })?.name === 'AbortException') return
  console.error(e)
}

/** One page: placeholder sized from the page, with canvas, text layer, highlights, links and overlay while active. */
export const PageView = memo(function PageView(props: PageViewProps) {
  const { doc, page, scale, renderScale, crop, active, keepImages } = props
  const { w, h } = doc.pageSize(page)
  const paintRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const textLayerRef = useRef<TextLayer | null>(null)
  const [links, setLinks] = useState<PageLink[]>([])

  useEffect(() => {
    const paint = paintRef.current!
    if (!active) {
      freeCanvas(paint.querySelector('canvas'))
      return
    }
    let cancelled = false
    let task: RenderTask | null = null
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    ;(async () => {
      const proxy = await doc.getPage(page)
      if (cancelled) return
      const viewport = proxy.getViewport({ scale: renderScale, rotation: 0 })
      const out = new OutputScale()
      out.limitCanvas(viewport.width, viewport.height, canvasPixelCap(), MAX_CANVAS_DIM)
      canvas.width = Math.max(1, Math.floor(viewport.width * out.sx))
      canvas.height = Math.max(1, Math.floor(viewport.height * out.sy))
      task = proxy.render({
        canvas,
        viewport,
        transform: out.scaled ? [out.sx, 0, 0, out.sy, 0, 0] : undefined,
      })
      await task.promise
      if (keepImages) preinvertRegions(canvas, await imageRegions(proxy))
      if (cancelled) return
      freeCanvas(paint.querySelector('canvas'))
      paint.prepend(canvas)
    })().catch(reportError)
    return () => {
      cancelled = true
      task?.cancel()
      if (!canvas.isConnected) freeCanvas(canvas)
    }
  }, [doc, page, active, renderScale, keepImages])

  useEffect(() => {
    const container = textRef.current!
    if (!active) return
    let cancelled = false
    ;(async () => {
      const proxy = await doc.getPage(page)
      const textContentSource = await proxy.getTextContent()
      if (cancelled) return
      const layer = new TextLayer({
        textContentSource,
        container,
        viewport: proxy.getViewport({ scale: renderScale, rotation: 0 }),
      })
      textLayerRef.current = layer
      await layer.render()
      if (cancelled) return
      const end = document.createElement('div')
      end.className = 'endOfContent'
      container.append(end)
    })().catch(reportError)
    return () => {
      cancelled = true
      textLayerRef.current?.cancel()
      textLayerRef.current = null
      container.replaceChildren()
    }
  }, [doc, page, active])

  useEffect(() => {
    const layer = textLayerRef.current
    if (!layer) return
    doc
      .getPage(page)
      .then((proxy) => layer.update({ viewport: proxy.getViewport({ scale: renderScale, rotation: 0 }) }))
      .catch(reportError)
  }, [doc, page, renderScale])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    doc
      .getLinks(page)
      .then((l) => !cancelled && setLinks(l))
      .catch(reportError)
    return () => {
      cancelled = true
    }
  }, [doc, page, active])

  const fullW = w * scale
  const fullH = h * scale
  const visibleW = w * Math.max(0.05, 1 - crop.left - crop.right) * scale

  return (
    <div
      class="mg-page"
      data-page={page}
      style={{
        top: `${props.top}px`,
        left: `${props.left}px`,
        width: `${visibleW}px`,
        height: `${fullH}px`,
        '--scale-factor': scale,
      }}
    >
      <div
        class="mg-page-inner"
        style={{ width: `${fullW}px`, height: `${fullH}px`, transform: `translateX(${-crop.left * fullW}px)` }}
      >
        <div class="mg-paint" ref={paintRef} />
        <div class="textLayer" ref={textRef} />
        {active && <HighlightLayer highlights={props.highlights} onTap={props.onTapHighlight} />}
        {active && links.length > 0 && (
          <div class="mg-links">
            {links.map((l, i) => (
              <button
                key={i}
                type="button"
                class="mg-link"
                aria-label={l.url ?? `Go to page ${l.page}`}
                style={{ left: pct(l.box.x), top: pct(l.box.y), width: pct(l.box.w), height: pct(l.box.h) }}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onLink(l)
                }}
              />
            ))}
          </div>
        )}
        {active && props.overlay !== undefined && <div class="mg-overlay">{props.overlay}</div>}
        {props.area && (
          <div
            class="mg-area"
            style={{
              left: pct(props.area.x),
              top: pct(props.area.y),
              width: pct(props.area.w),
              height: pct(props.area.h),
            }}
          />
        )}
      </div>
    </div>
  )
})
