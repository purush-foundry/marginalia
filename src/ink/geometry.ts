import { getStroke } from 'perfect-freehand'

export type PenStyle = 'ball' | 'fountain' | 'brush'

/** Thinning and taper lengths (multiples of the size) per pen. */
export const PEN_STYLES: Record<PenStyle, { thinning: number; startTaper: number; endTaper: number }> = {
  ball: { thinning: 0, startTaper: 0, endTaper: 0 },
  fountain: { thinning: 0.35, startTaper: 2, endTaper: 3 },
  brush: { thinning: 0.85, startTaper: 4, endTaper: 6 },
}

const RESAMPLE_PX = 1
const SMOOTH_SIGMA_PX = 1.5
const PRESSURE_WINDOW = 5
const SIZE_SCALE = 0.96
const TAPER_MAX_FRACTION = 0.25
const TAPER_MIN_SIZES = 2

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100)
}

// Flat [x, y, pressure, ...] → triples with pressure averaged over PRESSURE_WINDOW neighbouring samples.
function toTriples(points: number[]): number[][] {
  const n = Math.floor(points.length / 3)
  const h = PRESSURE_WINDOW >> 1
  const out: number[][] = []
  for (let i = 0; i < n; i++) {
    let sum = 0
    let count = 0
    for (let k = Math.max(0, i - h); k <= Math.min(n - 1, i + h); k++, count++) sum += points[k * 3 + 2]
    out.push([points[i * 3], points[i * 3 + 1], sum / count])
  }
  return out
}

// Point at u in [0, 1] between p1 and p2 on the centripetal Catmull-Rom spline through p0..p3.
function catmullRom(p0: number[], p1: number[], p2: number[], p3: number[], u: number): number[] {
  const t1 = Math.max(1e-6, Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])))
  const t2 = t1 + Math.max(1e-6, Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])))
  const t3 = t2 + Math.max(1e-6, Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])))
  const t = t1 + (t2 - t1) * u
  const out = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const a1 = p0[c] + ((p1[c] - p0[c]) * t) / t1
    const a2 = p1[c] + ((p2[c] - p1[c]) * (t - t1)) / (t2 - t1)
    const a3 = p2[c] + ((p3[c] - p2[c]) * (t - t2)) / (t3 - t2)
    const b1 = a1 + ((a2 - a1) * t) / t2
    const b2 = a2 + ((a3 - a2) * (t - t1)) / (t3 - t1)
    out[c] = b1 + ((b2 - b1) * (t - t1)) / (t2 - t1)
  }
  return out
}

// Samples every `step` px of arc length along a Catmull-Rom spline through the points; keeps both ends.
function resample(pts: number[][], step: number): number[][] {
  const out: number[][] = [pts[0]]
  let carry = 0
  let prev = pts[0]
  for (let i = 0; i + 1 < pts.length; i++) {
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    if (len < 1e-6) continue
    const sub = Math.ceil((len * 2) / step)
    for (let k = 1; k <= sub; k++) {
      const q = catmullRom(pts[Math.max(0, i - 1)], p1, p2, pts[Math.min(pts.length - 1, i + 2)], k / sub)
      let seg = Math.hypot(q[0] - prev[0], q[1] - prev[1])
      while (carry + seg >= step) {
        const w = (step - carry) / seg
        prev = [prev[0] + (q[0] - prev[0]) * w, prev[1] + (q[1] - prev[1]) * w, prev[2] + (q[2] - prev[2]) * w]
        out.push(prev)
        seg -= step - carry
        carry = 0
      }
      carry += seg
      prev = q
    }
  }
  const last = pts[pts.length - 1]
  if (carry > step / 4) out.push(last)
  else out[out.length - 1] = last
  return out
}

// Gaussian blur of x, y and pressure along the stroke, narrowing at the ends so both endpoints stay put.
function blur(pts: number[][], sigma: number): number[][] {
  const r = Math.ceil(sigma * 2)
  const w: number[] = []
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)))
  return pts.map((_, i) => {
    const reach = Math.min(r, i, pts.length - 1 - i)
    const q = [0, 0, 0]
    let total = 0
    for (let k = -reach; k <= reach; k++) {
      const p = pts[i + k]
      const wk = w[k + r]
      q[0] += p[0] * wk
      q[1] += p[1] * wk
      q[2] += p[2] * wk
      total += wk
    }
    return [q[0] / total, q[1] / total, q[2] / total]
  })
}

// Pen samples respaced along a spline and smoothed, ready for the outline.
export function smoothStrokePoints(points: number[]): number[][] {
  const pts = toTriples(points)
  if (pts.length < 2) return pts
  return blur(resample(pts, RESAMPLE_PX), SMOOTH_SIGMA_PX / RESAMPLE_PX)
}

// Length of the polyline through flat [x, y, pressure, ...] samples.
export function polylineLength(points: number[]): number {
  let total = 0
  for (let i = 3; i + 1 < points.length; i += 3) total += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2])
  return total
}

// Taper length capped at a fraction of the stroke's length; 0 (a round cap) when the capped taper is too short.
function taperLength(multiple: number, widthPx: number, strokeLength: number): number {
  const taper = Math.min(multiple * widthPx, TAPER_MAX_FRACTION * strokeLength)
  return taper < TAPER_MIN_SIZES * widthPx ? 0 : taper
}

// Outline of a freehand stroke as a closed SVG path, in the same units as the points; tapers are sized from strokeLength.
export function strokeOutlinePath(
  points: number[],
  widthPx: number,
  pressureIsReal: boolean,
  pen: PenStyle = 'fountain',
  ends: { start: boolean; end: boolean } = { start: true, end: true },
  strokeLength: number = polylineLength(points),
): string {
  if (points.length < 3) return ''
  const { thinning, startTaper, endTaper } = PEN_STYLES[pen]
  const outline = getStroke(smoothStrokePoints(points), {
    size: widthPx * SIZE_SCALE,
    thinning,
    smoothing: 0.65,
    streamline: 0.35,
    last: true,
    easing: (t) => t,
    simulatePressure: !pressureIsReal,
    start: { cap: true, taper: ends.start ? taperLength(startTaper, widthPx, strokeLength) : 0 },
    end: { cap: true, taper: ends.end ? taperLength(endTaper, widthPx, strokeLength) : 0 },
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

// True when the stroke's recorded pressure varies, i.e. it came from a pressure-sensing pen.
export function pressureVaries(points: number[]): boolean {
  for (let i = 5; i < points.length; i += 3) if (points[i] !== points[2]) return true
  return false
}

// Outline of a stroke with normalised points and width, as an SVG path in CSS px.
export function inkOutlinePath(
  points: number[],
  width: number,
  cssW: number,
  cssH: number,
  pen: PenStyle = 'fountain',
): string {
  const px = points.slice()
  for (let i = 0; i + 1 < px.length; i += 3) {
    px[i] *= cssW
    px[i + 1] *= cssH
  }
  return strokeOutlinePath(px, width * cssW, pressureVaries(points), pen)
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
