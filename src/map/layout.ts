import { MAP_SIZE } from '../config'
import type { LinkRel } from '../types'
import type { MapGraph } from './model'

export type Positions = Record<string, { x: number; y: number }>
type Pt = { x: number; y: number }

const RING_RADIUS = 0.36
const K_SCALE = 0.9
const K_CAP = 0.06
const REPULSION_RANGE = 2
const TOPIC_GRAVITY = 0.3
const CENTRE_GRAVITY = 0.05
const DEFAULT_ITERATIONS = 200
const WARM_ITERATIONS = 40
const COOL_ITERATIONS = 120
const START_TEMP_FRACTION = 0.1
const END_TEMP_DIVISOR = 8
const START_SPREAD = 0.12
const MARGIN = 10
const EPSILON = 1e-6
const SECONDARY_WEIGHT = 2
const REL_WEIGHT: Record<LinkRel, number> = {
  'builds-on': 1,
  extends: 1,
  baseline: 0.8,
  'same-problem': 0.6,
  contradicts: 0.6,
  related: 0.4,
}

// FNV-1a 32-bit hash over UTF-16 code units.
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Mulberry32 pseudo-random generator returning floats in [0, 1).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Topics that are some paper's primary topic, in `graph.topics` order. */
export function anchoredTopics(graph: MapGraph): string[] {
  const primary = new Set(graph.nodes.map(n => n.topics[0]).filter((t): t is string => t !== undefined))
  return graph.topics.filter(t => primary.has(t))
}

/** Places topics on a circle around the centre, the first at the top, then clockwise. */
export function anchors(topics: string[], size = MAP_SIZE): Record<string, Pt> {
  const out: Record<string, Pt> = {}
  topics.forEach((t, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / topics.length
    out[t] = { x: size / 2 + RING_RADIUS * size * Math.cos(a), y: size / 2 + RING_RADIUS * size * Math.sin(a) }
  })
  return out
}

export interface LayoutOptions {
  warm?: Positions
  iterations?: number
  size?: number
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Deterministic topic-anchored Fruchterman–Reingold; pinned nodes stay put. */
export function layout(graph: MapGraph, opts: LayoutOptions = {}): Positions {
  const size = opts.size ?? MAP_SIZE
  const nodes = [...graph.nodes].sort((a, b) => (a.pdfId < b.pdfId ? -1 : a.pdfId > b.pdfId ? 1 : 0))
  const n = nodes.length
  if (n === 0) return {}
  const k = Math.min(K_SCALE * Math.sqrt((size * size) / n), K_CAP * size)
  const centre: Pt = { x: size / 2, y: size / 2 }
  const ring = anchors(anchoredTopics(graph), size)
  const lo = MARGIN
  const hi = size - MARGIN

  const targets: (Pt | null)[] = nodes.map(nd => {
    const first = ring[nd.topics[0]]
    if (first) return first
    const hit = nd.topics.filter(t => ring[t]).map(t => ring[t])
    if (hit.length === 0) return null
    if (hit.length === 1) return hit[0]
    const rest = hit.slice(1)
    const mx = rest.reduce((s, p) => s + p.x, 0) / rest.length
    const my = rest.reduce((s, p) => s + p.y, 0) / rest.length
    const w = SECONDARY_WEIGHT + 1
    return { x: (SECONDARY_WEIGHT * hit[0].x + mx) / w, y: (SECONDARY_WEIGHT * hit[0].y + my) / w }
  })

  const rngs = nodes.map(nd => mulberry32(hash32(nd.pdfId)))
  const pos: Pt[] = nodes.map((nd, i) => {
    const rng = rngs[i]
    const r = rng() * START_SPREAD * size
    const theta = rng() * 2 * Math.PI
    const base = targets[i] ?? centre
    const start = { x: base.x + r * Math.cos(theta), y: base.y + r * Math.sin(theta) }
    if (nd.pin) return { x: nd.pin.x, y: nd.pin.y }
    const w = opts.warm?.[nd.pdfId]
    return w ? { x: w.x, y: w.y } : start
  })

  const index = new Map(nodes.map((nd, i) => [nd.pdfId, i]))
  const edges = graph.edges.flatMap(e => {
    const a = index.get(e.from)
    const b = index.get(e.to)
    return a === undefined || b === undefined || a === b ? [] : [{ a, b, w: REL_WEIGHT[e.rel] ?? REL_WEIGHT.related }]
  })

  const warm = opts.warm !== undefined
  const total = opts.iterations ?? (warm ? WARM_ITERATIONS : DEFAULT_ITERATIONS)
  const floor = k / END_TEMP_DIVISOR
  const range = REPULSION_RANGE * k

  for (let it = 0; it < total; it++) {
    const temp = warm ? floor : Math.max(floor, size * START_TEMP_FRACTION * (1 - it / COOL_ITERATIONS))
    const dx = new Array<number>(n).fill(0)
    const dy = new Array<number>(n).fill(0)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = pos[i].x - pos[j].x
        let ey = pos[i].y - pos[j].y
        let d = Math.hypot(ex, ey)
        if (d < EPSILON) {
          if (!nodes[i].pin) pos[i] = { x: pos[i].x + (rngs[i]() - 0.5), y: pos[i].y + (rngs[i]() - 0.5) }
          else pos[j] = { x: pos[j].x + (rngs[j]() - 0.5), y: pos[j].y + (rngs[j]() - 0.5) }
          ex = pos[i].x - pos[j].x
          ey = pos[i].y - pos[j].y
          d = Math.hypot(ex, ey)
        }
        if (d === 0 || d > range) continue
        const f = (k * k) / d / d
        dx[i] += ex * f
        dy[i] += ey * f
        dx[j] -= ex * f
        dy[j] -= ey * f
      }
    }
    for (const { a, b, w } of edges) {
      const ex = pos[a].x - pos[b].x
      const ey = pos[a].y - pos[b].y
      const d = Math.hypot(ex, ey)
      if (d === 0) continue
      const f = (w * d) / k
      dx[a] -= ex * f
      dy[a] -= ey * f
      dx[b] += ex * f
      dy[b] += ey * f
    }
    for (let i = 0; i < n; i++) {
      const t = targets[i]
      if (t) {
        dx[i] += TOPIC_GRAVITY * (t.x - pos[i].x)
        dy[i] += TOPIC_GRAVITY * (t.y - pos[i].y)
      }
      dx[i] += CENTRE_GRAVITY * (centre.x - pos[i].x)
      dy[i] += CENTRE_GRAVITY * (centre.y - pos[i].y)
    }
    for (let i = 0; i < n; i++) {
      if (nodes[i].pin) continue
      const len = Math.hypot(dx[i], dy[i])
      const s = len > temp ? temp / len : 1
      pos[i] = { x: clamp(pos[i].x + dx[i] * s, lo, hi), y: clamp(pos[i].y + dy[i] * s, lo, hi) }
    }
  }

  const out: Positions = {}
  nodes.forEach((nd, i) => {
    out[nd.pdfId] = nd.pin ? { x: nd.pin.x, y: nd.pin.y } : { x: round3(clamp(pos[i].x, lo, hi)), y: round3(clamp(pos[i].y, lo, hi)) }
  })
  return out
}
