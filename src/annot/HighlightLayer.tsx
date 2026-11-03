import type { Box, Highlight } from '../types.ts'
import './annot.css'

const pct = (v: number) => `${v * 100}%`

export interface HighlightLayerProps {
  highlights: Highlight[]
  onTap(id: string, rect: DOMRect): void
}

/** SVG of one page's highlights in page-normalised coordinates; rects are the only hit targets. */
export function HighlightLayer({ highlights, onTap }: HighlightLayerProps) {
  const tap = (id: string) => (e: MouseEvent) => {
    e.stopPropagation()
    onTap(id, (e.currentTarget as Element).getBoundingClientRect())
  }
  const rect = (h: Highlight, b: Box, i: number) => (
    <rect
      key={`${h.id}:${i}`}
      class={h.kind === 'area' ? 'area' : undefined}
      data-id={h.id}
      x={pct(b.x)}
      y={pct(b.y)}
      width={pct(b.w)}
      height={pct(b.h)}
      fill={`var(--hl-${h.color})`}
      stroke={h.kind === 'area' ? `var(--hl-${h.color})` : undefined}
      onClick={tap(h.id)}
    />
  )
  return (
    <svg class="mg-hl" aria-hidden="true">
      {highlights.flatMap((h) =>
        h.deleted ? [] : h.kind === 'area' ? [rect(h, h.box, 0)] : h.boxes.map((b, i) => rect(h, b, i)),
      )}
    </svg>
  )
}
