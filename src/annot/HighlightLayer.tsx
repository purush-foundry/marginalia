import type { Box, Highlight } from '../types.ts'
import './annot.css'

const pct = (v: number) => `${v * 100}%`

export interface HighlightLayerProps {
  highlights: Highlight[]
}

function boxesOf(h: Highlight): Box[] {
  return h.kind === 'area' ? [h.box] : h.boxes
}

/** Topmost live highlight with a box containing the page-normalised point, and that box. */
export function highlightAt(highlights: Highlight[], x: number, y: number): { id: string; box: Box } | null {
  for (let i = highlights.length - 1; i >= 0; i--) {
    const h = highlights[i]
    if (h.deleted) continue
    const box = boxesOf(h).find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)
    if (box) return { id: h.id, box }
  }
  return null
}

/** SVG of one page's highlights in page-normalised coordinates; it never takes pointer input. */
export function HighlightLayer({ highlights }: HighlightLayerProps) {
  return (
    <svg class="mg-hl" aria-hidden="true">
      {highlights.flatMap((h) =>
        h.deleted
          ? []
          : boxesOf(h).map((b, i) => (
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
              />
            )),
      )}
    </svg>
  )
}
