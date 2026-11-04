// Segment-eraser geometry on flat [x, y, pressure, ...] strokes in isotropic units.

// Fraction of the radius treated as the circle's edge: samples and chords within it are not erased.
const EDGE = 1e-6

// Parameters where the line through a → b enters and leaves the circle; null when it does not cross.
function crossings(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): [number, number] | null {
  const dx = bx - ax
  const dy = by - ay
  const fx = ax - cx
  const fy = ay - cy
  const a = dx * dx + dy * dy
  if (a === 0) return null
  const b = fx * dx + fy * dy
  const disc = b * b - a * (fx * fx + fy * fy - r * r)
  if (disc <= 0) return null
  const root = Math.sqrt(disc)
  return [(-b - root) / a, (-b + root) / a]
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/** Pieces of the stroke outside the circle, in order and cut at its edge; null when the circle misses, [] when nothing survives. */
export function splitStrokeAt(points: number[], cx: number, cy: number, radius: number): number[][] | null {
  const n = Math.floor(points.length / 3)
  const edge = radius * EDGE
  const pieces: number[][] = []
  let cur: number[] = []
  let hit = false
  let wasIn = false
  for (let i = 0; i < n; i++) {
    const [x, y, p] = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]]
    const d = Math.hypot(x - cx, y - cy)
    const isIn = d <= radius
    if (d < radius - edge) hit = true
    if (i > 0) {
      const [px, py, pp] = [points[i * 3 - 3], points[i * 3 - 2], points[i * 3 - 1]]
      const at = (t: number) => [px + (x - px) * t, py + (y - py) * t, pp + (p - pp) * t]
      const c = crossings(px, py, x, y, cx, cy, radius)
      if (!wasIn && isIn) {
        cur.push(...at(clamp01(c ? c[0] : 1)))
        pieces.push(cur)
        cur = []
      } else if (wasIn && !isIn) {
        cur = at(clamp01(c ? c[1] : 0))
      } else if (!wasIn && !isIn && c && c[0] > 0 && c[1] < 1) {
        cur.push(...at(c[0]))
        pieces.push(cur)
        cur = at(c[1])
        if ((c[1] - c[0]) * Math.hypot(x - px, y - py) > edge) hit = true
      }
    }
    if (isIn) {
      if (cur.length) pieces.push(cur)
      cur = []
    } else {
      cur.push(x, y, p)
    }
    wasIn = isIn
  }
  pieces.push(cur)
  return hit ? pieces.filter((piece) => piece.length >= 6) : null
}
