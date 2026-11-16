// Map viewport: a translate-then-scale transform from map units to screen pixels.

export interface Viewport {
  x: number
  y: number
  k: number
}

export const MIN_K = 0.1
export const MAX_K = 8
const FIT_MAX_K = 2

const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k))

// Scales by factor around the screen point, keeping the map point under it fixed.
export function zoomAt(v: Viewport, factor: number, px: number, py: number): Viewport {
  const k = clampK(v.k * factor)
  const r = k / v.k
  return { x: px - (px - v.x) * r, y: py - (py - v.y) * r, k }
}

// Shifts the viewport by a screen-pixel delta.
export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { x: v.x + dx, y: v.y + dy, k: v.k }
}

// The viewport that centres the points' bounding box inside a width by height screen with padding.
export function fitTo(points: { x: number; y: number }[], width: number, height: number, pad = 40): Viewport {
  if (points.length === 0) return { x: 0, y: 0, k: 1 }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const availW = Math.max(1, width - 2 * pad)
  const availH = Math.max(1, height - 2 * pad)
  const k = clampK(Math.min(FIT_MAX_K, availW / Math.max(maxX - minX, 1e-9), availH / Math.max(maxY - minY, 1e-9)))
  return { x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k, k }
}

// Converts a screen point to map units.
export function toMap(v: Viewport, px: number, py: number): { x: number; y: number } {
  return { x: (px - v.x) / v.k, y: (py - v.y) / v.k }
}
