// Fits a held stroke to a line, rectangle, ellipse, triangle or arrow; points are flat [x, y, pressure] in isotropic units.

export type ShapeKind = 'line' | 'rectangle' | 'ellipse' | 'triangle' | 'arrow'
export interface Shape {
  kind: ShapeKind
  points: number[]
  /** Tail for line and arrow, centre otherwise. */
  anchor: [number, number]
}

export const HOLD_MS = 500
export const HOLD_SLOP_PX = 4

type Pt = [number, number]

const MIN_SAMPLES = 8
const MIN_LENGTH = 10
const RESAMPLE = 2
const CORNER_WINDOW = 4
const CORNER_TURN = (50 * Math.PI) / 180
const CORNER_MERGE = 8
const CLOSED_GAP = 0.2
const ARROW_SHAFT = 0.6
const BARB = 0.2
const BARB_ANGLE = Math.PI / 6
const ELLIPSE_SAMPLES = 65
const PRESSURE = 0.5

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1])

function length(pts: Pt[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i])
  return total
}

// Points every `step` units of arc along the polyline, plus its last point.
function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]]
  let prev = pts[0]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const next = pts[i]
    let seg = dist(prev, next)
    while (carry + seg >= step) {
      const t = (step - carry) / seg
      prev = [prev[0] + (next[0] - prev[0]) * t, prev[1] + (next[1] - prev[1]) * t]
      out.push(prev)
      seg = dist(prev, next)
      carry = 0
    }
    carry += seg
    prev = next
  }
  if (carry > 0) out.push(pts[pts.length - 1])
  return out
}

// Turning angle at b between the directions a→b and b→c.
function turn(a: Pt, b: Pt, c: Pt): number {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const vx = c[0] - b[0]
  const vy = c[1] - b[1]
  return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy))
}

// Indices of corners, each the sharpest sample of a run of sharp samples no more than CORNER_MERGE apart; cyclic for a closed path.
function corners(r: Pt[], closed: boolean): number[] {
  const n = r.length
  const w = CORNER_WINDOW
  if (n <= 2 * w) return []
  const sharp: { i: number; a: number }[] = []
  for (let i = closed ? 0 : w; i < (closed ? n : n - w); i++) {
    const a = turn(r[(i - w + n) % n], r[i], r[(i + w) % n])
    if (a > CORNER_TURN) sharp.push({ i, a })
  }
  const runs: { i: number; a: number }[][] = []
  for (const s of sharp) {
    const run = runs[runs.length - 1]
    if (run && s.i - run[run.length - 1].i <= CORNER_MERGE) run.push(s)
    else runs.push([s])
  }
  if (closed && runs.length > 1 && runs[0][0].i + n - runs[runs.length - 1].at(-1)!.i <= CORNER_MERGE) {
    runs[0].push(...runs.pop()!)
  }
  return runs.map((run) => run.reduce((best, s) => (s.a > best.a ? s : best)).i).sort((a, b) => a - b)
}

// The path cut at its sample nearest the start within its second half, dropping any overshoot past the start.
function trimOvershoot(pts: Pt[]): Pt[] {
  const half = length(pts) / 2
  let arc = 0
  let cut = pts.length - 1
  for (let i = 1; i < pts.length; i++) {
    arc += dist(pts[i - 1], pts[i])
    if (arc >= half && dist(pts[i], pts[0]) < dist(pts[cut], pts[0])) cut = i
  }
  return pts.slice(0, cut + 1)
}

function flat(pts: Pt[]): number[] {
  return pts.flatMap(([x, y]) => [x, y, PRESSURE])
}

// Bounding box [minX, minY, maxX, maxY].
function bbox(pts: Pt[]): [number, number, number, number] {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function centre(pts: Pt[]): Pt {
  const [x0, y0, x1, y1] = bbox(pts)
  return [(x0 + x1) / 2, (y0 + y1) / 2]
}

function polygon(kind: ShapeKind, at: Pt[]): Shape {
  return { kind, points: flat([...at, at[0]]), anchor: centre(at) }
}

function ellipse(pts: Pt[]): Shape {
  const [x0, y0, x1, y1] = bbox(pts)
  const [cx, cy, rx, ry] = [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2]
  const ring: Pt[] = []
  for (let k = 0; k < ELLIPSE_SAMPLES - 1; k++) {
    const a = (k / (ELLIPSE_SAMPLES - 1)) * 2 * Math.PI
    ring.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return polygon('ellipse', ring)
}

// Arrow along tail→tip with two barbs BARB of the shaft long at ±BARB_ANGLE, drawn tail, tip, barb, tip, barb.
function arrow(tail: Pt, tip: Pt): Shape {
  const shaft = dist(tail, tip)
  const back = Math.atan2(tail[1] - tip[1], tail[0] - tip[0])
  const barb = (side: number): Pt => [
    tip[0] + BARB * shaft * Math.cos(back + side * BARB_ANGLE),
    tip[1] + BARB * shaft * Math.sin(back + side * BARB_ANGLE),
  ]
  return { kind: 'arrow', points: flat([tail, tip, barb(1), tip, barb(-1)]), anchor: tail }
}

/** The shape a stroke was meant to be, or null when it is too short or nothing fits. */
export function fitShape(points: number[]): Shape | null {
  const pts: Pt[] = []
  for (let i = 0; i + 2 < points.length; i += 3) pts.push([points[i], points[i + 1]])
  if (pts.length < MIN_SAMPLES || length(pts) < MIN_LENGTH) return null
  const first = pts[0]
  const last = pts[pts.length - 1]
  const [x0, y0, x1, y1] = bbox(pts)
  if (dist(first, last) < CLOSED_GAP * Math.hypot(x1 - x0, y1 - y0)) {
    const drawn = trimOvershoot(pts)
    const loop = resample([...drawn, first], RESAMPLE)
    if (dist(loop[0], loop[loop.length - 1]) < 1e-9) loop.pop()
    const at = corners(loop, true).map((i) => loop[i])
    if (at.length === 3) return polygon('triangle', at)
    if (at.length === 4) return polygon('rectangle', at)
    if (at.length <= 2) return ellipse(drawn)
    return null
  }
  const r = resample(pts, RESAMPLE)
  const at = corners(r, false)
  if (at.length === 0) return { kind: 'line', points: flat([first, last]), anchor: first }
  const tip = r[at[0]]
  if (length(r.slice(0, at[0] + 1)) >= ARROW_SHAFT * length(r)) return arrow(first, tip)
  return null
}

/** The shape rotated and scaled about its anchor so that `from` lands on `to`. */
export function adjustShape(shape: Shape, from: [number, number], to: [number, number]): Shape {
  const [ax, ay] = shape.anchor
  const fx = from[0] - ax
  const fy = from[1] - ay
  const tx = to[0] - ax
  const ty = to[1] - ay
  const f2 = fx * fx + fy * fy
  if (f2 < 1e-12) return shape
  const cos = (tx * fx + ty * fy) / f2
  const sin = (ty * fx - tx * fy) / f2
  const points = shape.points.slice()
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = shape.points[i] - ax
    const y = shape.points[i + 1] - ay
    points[i] = ax + cos * x - sin * y
    points[i + 1] = ay + sin * x + cos * y
  }
  return { ...shape, points }
}
