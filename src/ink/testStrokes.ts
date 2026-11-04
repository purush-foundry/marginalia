// Synthetic Pencil strokes and an outline wiggle measure for the renderer tests.

export interface Sample {
  x: number
  y: number
  p: number
}

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// Dense polyline of a curve f(t), t in [0, 1].
function dense(f: (t: number) => [number, number], n = 20000): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i <= n; i++) out.push(f(i / n))
  return out
}

// Samples a dense polyline at a fixed rate, with speed depending on curvature.
function sampleAtRate(
  poly: [number, number][],
  hz: number,
  speed: (curv: number) => number,
  seed: number,
  jitter: number,
  pressureBase: number,
  noise = 1,
): Sample[] {
  const r = rng(seed)
  const cum: number[] = [0]
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]))
  const total = cum[cum.length - 1]
  const curvAt = (i: number) => {
    const a = poly[Math.max(0, i - 20)]
    const b = poly[i]
    const c = poly[Math.min(poly.length - 1, i + 20)]
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1])
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1])
    const ac = Math.hypot(c[0] - a[0], c[1] - a[1])
    const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
    return ab * bc * ac > 1e-9 ? (2 * cross) / (ab * bc * ac) : 0
  }
  const out: Sample[] = []
  let s = 0
  let j = 0
  let t = 0
  const dt = 1 / hz
  // First pass measures the stroke duration for the pressure ramp-down.
  let duration = 0
  {
    let ss = 0
    let jj = 0
    while (ss < total) {
      while (jj < cum.length - 1 && cum[jj + 1] < ss) jj++
      ss += speed(curvAt(jj)) * dt
      duration += dt
    }
  }
  while (true) {
    while (j < cum.length - 1 && cum[j + 1] < s) j++
    const seg = cum[j + 1] - cum[j] || 1
    const u = Math.min(1, Math.max(0, (s - cum[j]) / seg))
    const a = poly[j]
    const b = poly[Math.min(poly.length - 1, j + 1)]
    const x = a[0] + (b[0] - a[0]) * u + (r() * 2 - 1) * jitter * noise
    const y = a[1] + (b[1] - a[1]) * u + (r() * 2 - 1) * jitter * noise
    const ramp = Math.min(1, t / 0.03, Math.max(0, duration - t) / 0.025 + 0.15)
    const p = Math.max(0.02, Math.min(1, (pressureBase + 0.12 * Math.sin(2 * Math.PI * 1.3 * t) + (r() * 2 - 1) * 0.05 * noise) * ramp))
    out.push({ x, y, p })
    if (s >= total) break
    s = Math.min(total, s + speed(curvAt(j)) * dt)
    t += dt
  }
  return out
}

// A slow deliberate curve in CSS px at 240 Hz; noise 0 removes the jitter and pressure noise.
export function slowCurveSamples(noise: number): Sample[] {
  return sampleAtRate(
    dense((t) => [40 + 220 * t, 60 + 22 * Math.sin(2 * Math.PI * t) - 8 * Math.sin(5 * Math.PI * t)]),
    240,
    () => 70,
    4,
    0.3,
    0.4,
    noise,
  )
}

// Absolute turning of the closed path, in full turns, after flattening its Q segments.
export function turning(d: string): number {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
  if (nums.length < 6) return 0
  const pts: number[][] = [[nums[0], nums[1]]]
  for (let i = 2; i + 3 < nums.length; i += 4) {
    const [x0, y0] = pts[pts.length - 1]
    const [cx, cy, x1, y1] = nums.slice(i, i + 4)
    for (let k = 1; k <= 6; k++) {
      const t = k / 6
      pts.push([(1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1])
    }
  }
  let sum = 0
  let prev: number | null = null
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0]
    const dy = pts[i][1] - pts[i - 1][1]
    if (dx * dx + dy * dy < 1e-6) continue
    const a = Math.atan2(dy, dx)
    if (prev !== null) {
      let da = a - prev
      while (da > Math.PI) da -= 2 * Math.PI
      while (da < -Math.PI) da += 2 * Math.PI
      sum += Math.abs(da)
    }
    prev = a
  }
  return sum / (2 * Math.PI)
}
