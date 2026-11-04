// Segment-eraser geometry on flat [x, y, pressure, ...] strokes in isotropic units.

// Parameters in (0, 1) where segment a → b enters and leaves the circle, in that order; [] when it does not cross.
function crossings(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number[] {
  const dx = bx - ax
  const dy = by - ay
  const fx = ax - cx
  const fy = ay - cy
  const a = dx * dx + dy * dy
  if (a === 0) return []
  const b = fx * dx + fy * dy
  const disc = b * b - a * (fx * fx + fy * fy - r * r)
  if (disc <= 0) return []
  const root = Math.sqrt(disc)
  return [(-b - root) / a, (-b + root) / a]
}

/** Pieces of the stroke outside the circle, in order and cut at its edge; null when the circle misses, [] when nothing survives. */
export function splitStrokeAt(points: number[], cx: number, cy: number, radius: number): number[][] | null {
  const n = Math.floor(points.length / 3)
  const pieces: number[][] = []
  let cur: number[] = []
  let hit = false
  for (let i = 0; i < n; i++) {
    const x = points[i * 3]
    const y = points[i * 3 + 1]
    if (i > 0) {
      const [px, py, pp] = [points[i * 3 - 3], points[i * 3 - 2], points[i * 3 - 1]]
      const [enter, leave] = crossings(px, py, x, y, cx, cy, radius)
      const at = (t: number) => [px + (x - px) * t, py + (y - py) * t, pp + (points[i * 3 + 2] - pp) * t]
      if (enter > 0 && enter < 1) {
        cur.push(...at(enter))
        pieces.push(cur)
        cur = []
        hit = true
      }
      if (leave > 0 && leave < 1) {
        cur = at(leave)
        hit = true
      }
    }
    if (Math.hypot(x - cx, y - cy) <= radius) {
      hit = true
      if (cur.length) pieces.push(cur)
      cur = []
    } else {
      cur.push(x, y, points[i * 3 + 2])
    }
  }
  pieces.push(cur)
  return hit ? pieces.filter((p) => p.length >= 6) : null
}
