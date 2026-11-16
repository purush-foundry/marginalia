import { library, loadSidecar, loadVerdict } from '../drive/library'
import { SYMMETRIC_RELS, type LinkRel, type ReadStatus } from '../types'

export type MapVerdict = 'read' | 'skim' | 'skip'

export interface VerdictInfo {
  verdict?: MapVerdict
  oneLine?: string
  topics: string[]
  year?: number
}

export interface MapNode {
  pdfId: string
  title: string
  year?: number
  status: ReadStatus
  verdict?: MapVerdict
  oneLine?: string
  gist: string
  topics: string[]
  pin?: { x: number; y: number }
}

export interface MapEdge {
  id: string
  from: string
  to: string
  rel: LinkRel
  note?: string
}

export interface MapGraph {
  nodes: MapNode[]
  edges: MapEdge[]
  topics: string[]
}

// Builds the graph from the library index, every sidecar and every verdict; edges to missing papers are dropped.
export async function loadGraph(verdictOf: (pdfId: string) => Promise<VerdictInfo | null> = async () => null): Promise<MapGraph> {
  const index = library.peek()
  if (!index) return { nodes: [], edges: [], topics: [] }
  const papers = Object.values(index.papers).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const known = new Set(papers.map(p => p.id))
  const nodes: MapNode[] = []
  const edges: MapEdge[] = []
  const loaded = await Promise.all(papers.map(async p => ({ p, sc: await loadSidecar(p.id), v: await verdictOf(p.id) })))
  for (const { p, sc, v } of loaded) {
    const pin = sc.pin && sc.pin.x >= 0 && sc.pin.y >= 0 ? { x: sc.pin.x, y: sc.pin.y } : undefined
    nodes.push({
      pdfId: p.id,
      title: p.name.replace(/\.pdf$/i, ''),
      year: v?.year,
      status: sc.reading.status,
      verdict: v?.verdict,
      oneLine: v?.oneLine,
      gist: sc.gist?.text ?? '',
      topics: sc.topics ? sc.topics.ids : (v?.topics ?? []),
      pin,
    })
    for (const l of sc.links ?? []) {
      if (l.deleted || !known.has(l.to)) continue
      edges.push({ id: l.id, from: p.id, to: l.to, rel: l.rel, note: l.note })
    }
  }
  return { nodes, edges, topics: topicOrder(nodes, edges) }
}

/** Reads a paper's worth-reading note as the map's verdict info. */
export async function verdictInfo(pdfId: string): Promise<VerdictInfo | null> {
  const note = await loadVerdict(pdfId)
  return note && { verdict: note.verdict, oneLine: note.oneLine || undefined, topics: note.topics, year: note.year }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`
}

// Greedy chain: start with the topic pair sharing the most edges, then append the topic with most edges to either end.
export function topicOrder(nodes: MapNode[], edges: MapEdge[]): string[] {
  const byId = new Map(nodes.map(n => [n.pdfId, n.topics]))
  const all = [...new Set(nodes.flatMap(n => n.topics))].sort()
  const counts = new Map<string, number>()
  for (const e of edges) {
    for (const a of byId.get(e.from) ?? []) {
      for (const b of byId.get(e.to) ?? []) {
        if (a === b) continue
        const k = pairKey(a, b)
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
    }
  }
  const weight = (a: string, b: string) => counts.get(pairKey(a, b)) ?? 0

  let best: [string, string] | null = null
  let bestCount = 0
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const c = weight(all[i], all[j])
      if (c > bestCount) {
        bestCount = c
        best = [all[i], all[j]]
      }
    }
  }
  if (!best) return all

  const chain = [...best]
  const used = new Set(chain)
  for (;;) {
    let pick: { t: string; atHead: boolean } | null = null
    let pickCount = 0
    const head = chain[0]
    const tail = chain[chain.length - 1]
    for (const t of all) {
      if (used.has(t)) continue
      for (const [end, atHead] of [[head, true], [tail, false]] as const) {
        const c = weight(t, end)
        if (c > pickCount) {
          pickCount = c
          pick = { t, atHead }
        }
      }
    }
    if (!pick) break
    if (pick.atHead) chain.unshift(pick.t)
    else chain.push(pick.t)
    used.add(pick.t)
  }
  for (const t of all) if (!used.has(t)) chain.push(t)
  return chain
}

// The paper a link is stored on and its direction: directed rels keep a to b; symmetric rels go on the smaller id.
export function canonicalLink(a: string, b: string, rel: LinkRel): { from: string; to: string } {
  if (!SYMMETRIC_RELS.has(rel)) return { from: a, to: b }
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

// First four words of a title, with an ellipsis when cut.
export function shortTitle(title: string): string {
  const words = title.split(/\s+/).filter(Boolean)
  return words.slice(0, 4).join(' ') + (words.length > 4 ? '…' : '')
}
