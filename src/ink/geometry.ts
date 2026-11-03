import { getStroke } from 'perfect-freehand'

// Flat [x, y, pressure, ...] → [x, y, pressure] tuples for perfect-freehand.
function toTriples(points: number[]): number[][] {
  const out: number[][] = []
  for (let i = 0; i + 2 < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2]])
  return out
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100)
}

// Outline of a freehand stroke as a closed SVG path, in the same units as the points.
export function strokeOutlinePath(points: number[], widthPx: number, pressureIsReal: boolean): string {
  if (points.length < 3) return ''
  const outline = getStroke(toTriples(points), {
    size: widthPx,
    thinning: 0.35,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: !pressureIsReal,
    last: true,
  })
  if (outline.length < 2) return ''
  const [x0, y0] = outline[0]
  let d = `M${fmt(x0)},${fmt(y0)} Q`
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i]
    const [bx, by] = outline[(i + 1) % outline.length]
    d += `${fmt(ax)},${fmt(ay)} ${fmt((ax + bx) / 2)},${fmt((ay + by) / 2)} `
  }
  return d.trimEnd() + ' Z'
}

function segmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const cx = ax + t * dx - px
  const cy = ay + t * dy - py
  return cx * cx + cy * cy
}

// True when any segment (or the lone point) of the stroke lies within radius of (x, y).
export function strokeHitsPoint(points: number[], x: number, y: number, radius: number): boolean {
  const r2 = radius * radius
  if (points.length < 3) return false
  if (points.length < 6) return segmentDistanceSq(x, y, points[0], points[1], points[0], points[1]) <= r2
  for (let i = 0; i + 5 < points.length; i += 3) {
    if (segmentDistanceSq(x, y, points[i], points[i + 1], points[i + 3], points[i + 4]) <= r2) return true
  }
  return false
}

// Drops samples within tolerance of the previously kept one; always keeps the first and last.
export function simplifyPoints(points: number[], tolerance: number): number[] {
  const n = Math.floor(points.length / 3)
  if (n <= 1) return points.slice(0, n * 3)
  const t2 = tolerance * tolerance
  const out = [points[0], points[1], points[2]]
  let lx = points[0]
  let ly = points[1]
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 3]
    const y = points[i * 3 + 1]
    if ((x - lx) ** 2 + (y - ly) ** 2 > t2) {
      out.push(x, y, points[i * 3 + 2])
      lx = x
      ly = y
    }
  }
  const last = (n - 1) * 3
  out.push(points[last], points[last + 1], points[last + 2])
  return out
}
