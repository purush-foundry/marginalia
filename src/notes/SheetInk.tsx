import { useMemo } from 'preact/hooks'
import { InkLayer } from '../ink/InkLayer.tsx'
import type { InkStroke, NoteStroke } from '../types.ts'

export interface SheetInkProps {
  width: number
  height: number
  strokes: NoteStroke[]
  onAddStroke(s: NoteStroke): void
  onEraseStroke(id: string): void
}

// Copy of flat [x, y, pressure] points with every y multiplied by k.
function scaleY(points: number[], k: number): number[] {
  const out = points.slice()
  for (let i = 1; i < out.length; i += 3) out[i] *= k
  return out
}

/** InkLayer over the whole sheet; maps sheet units (y / sheet width) to page-normalised y and back. */
export function SheetInk({ width, height, strokes, onAddStroke, onEraseStroke }: SheetInkProps) {
  const inks = useMemo<InkStroke[]>(
    () => strokes.map((s) => ({ ...s, page: 0, tool: 'pen', points: scaleY(s.points, width / height) })),
    [strokes, width, height],
  )
  return (
    <InkLayer
      page={0}
      cssW={width}
      cssH={height}
      strokes={inks}
      onAddStroke={({ page: _page, tool: _tool, ...s }) => onAddStroke({ ...s, points: scaleY(s.points, height / width) })}
      onEraseStroke={onEraseStroke}
    />
  )
}
