// Pure helpers for drawing the map: sizes, colours, hulls, neighbourhoods, search and the cached layout.
import { idbGet, idbSet } from '../lib/idb'
import { anchoredTopics, hash32, layout, type Positions } from './layout'
import type { MapEdge, MapGraph, MapNode } from './model'

const HULL_PAD = 40
const LIGHT_NEW = 35
const LIGHT_OLD = 65
const LAYOUT_KEY = 'mapLayout'

export interface Hull {
  topic: string
  cx: number
  cy: number
  r: number
  members: string[]
}

// Number of edges touching each paper.
export function degrees(g: MapGraph): Map<string, number> {
  const out = new Map(g.nodes.map((n) => [n.pdfId, 0]))
  for (const e of g.edges) {
    out.set(e.from, (out.get(e.from) ?? 0) + 1)
    out.set(e.to, (out.get(e.to) ?? 0) + 1)
  }
  return out
}

export const nodeRadius = (degree: number): number => 6 + 2 * Math.sqrt(degree)

export const topicHue = (topic: string): number => hash32(topic) % 360

// Fill colour of a paper: its primary topic hue, grey without topics.
export function fillOf(n: MapNode): string {
  return n.topics[0] === undefined ? 'hsl(0 0% 60%)' : `hsl(${topicHue(n.topics[0])} 55% 55%)`
}

// Ring colour of a paper: its hue with lightness by year across the range, grey when the year is unknown.
export function strokeOf(n: MapNode, years: { min: number; max: number } | null): string {
  if (n.year === undefined || !years) return 'hsl(0 0% 60%)'
  const t = years.max === years.min ? 0 : (years.max - n.year) / (years.max - years.min)
  const hue = n.topics[0] === undefined ? 0 : topicHue(n.topics[0])
  const sat = n.topics[0] === undefined ? 0 : 55
  return `hsl(${hue} ${sat}% ${LIGHT_NEW + t * (LIGHT_OLD - LIGHT_NEW)}%)`
}

export function yearRange(g: MapGraph): { min: number; max: number } | null {
  const ys = g.nodes.flatMap((n) => (n.year === undefined ? [] : [n.year]))
  return ys.length ? { min: Math.min(...ys), max: Math.max(...ys) } : null
}

// One circle per anchored topic around the centroid of its primary members.
export function hulls(g: MapGraph, pos: Positions): Hull[] {
  return anchoredTopics(g).flatMap((topic) => {
    const members = g.nodes.filter((n) => n.topics[0] === topic && pos[n.pdfId]).map((n) => n.pdfId)
    if (!members.length) return []
    const pts = members.map((id) => pos[id])
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const r = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy))) + HULL_PAD
    return [{ topic, cx, cy, r, members }]
  })
}

// Ids of papers linked to the paper.
export function neighboursOf(g: MapGraph, id: string): string[] {
  return g.edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : []))
}

// The paper and every paper within the given number of link hops.
export function neighbourhood(g: MapGraph, id: string, hops = 2): Set<string> {
  const seen = new Set([id])
  let frontier = [id]
  for (let h = 0; h < hops; h++) {
    frontier = frontier.flatMap((f) => neighboursOf(g, f)).filter((n) => !seen.has(n))
    frontier.forEach((n) => seen.add(n))
  }
  return seen
}

// Whether the query appears in the paper's title, gist, topics or the phrases of its links.
export function matchesQuery(g: MapGraph, n: MapNode, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const notes = g.edges.filter((e) => e.from === n.pdfId || e.to === n.pdfId).map((e) => e.note ?? '')
  return [n.title, n.gist, ...n.topics, ...notes].some((s) => s.toLowerCase().includes(q))
}

// The linked paper whose direction from the paper is closest to (dx, dy), within a right angle.
export function nearestByAngle(g: MapGraph, pos: Positions, id: string, dx: number, dy: number): string | null {
  const from = pos[id]
  if (!from) return null
  let best: string | null = null
  let bestAngle = Math.PI / 2
  for (const nb of new Set(neighboursOf(g, id))) {
    const p = pos[nb]
    if (!p) continue
    const a = Math.abs(Math.atan2(dx * (p.y - from.y) - dy * (p.x - from.x), dx * (p.x - from.x) + dy * (p.y - from.y)))
    if (a < bestAngle) {
      bestAngle = a
      best = nb
    }
  }
  return best
}

// Hash of everything the layout depends on, over sorted inputs.
export function layoutHash(g: MapGraph): number {
  const nodes = [...g.nodes].sort((a, b) => (a.pdfId < b.pdfId ? -1 : 1))
  const edges = [...g.edges].sort((a, b) => (a.id < b.id ? -1 : 1)).map((e: MapEdge) => [e.id, e.from, e.to, e.rel])
  return hash32(
    JSON.stringify({
      ids: nodes.map((n) => n.pdfId),
      topics: nodes.map((n) => n.topics),
      edges,
      pins: nodes.map((n) => n.pin ?? null),
    }),
  )
}

// Positions from the cache when the inputs match, else a layout warm-started from the given or cached positions.
export async function placeGraph(g: MapGraph, warm?: Positions): Promise<Positions> {
  const hash = layoutHash(g)
  const cached = await idbGet<{ hash: number; positions: Positions }>('meta', LAYOUT_KEY)
  if (cached?.hash === hash) return cached.positions
  const start = warm && Object.keys(warm).length ? warm : cached?.positions
  const positions = layout(g, start ? { warm: start } : {})
  await idbSet('meta', LAYOUT_KEY, { hash, positions })
  return positions
}

