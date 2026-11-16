import { describe, expect, it } from 'vitest'
import { MAP_SIZE } from '../config'
import type { MapEdge, MapGraph, MapNode } from './model'
import { anchoredTopics, anchors, hash32, layout, mulberry32 } from './layout'

function node(id: string, topics: string[], pin?: { x: number; y: number }): MapNode {
  return { pdfId: id, title: id, status: 'unread', gist: '', topics, pin }
}

function fixture(): MapGraph {
  const nodes: MapNode[] = []
  const edges: MapEdge[] = []
  for (let i = 0; i < 10; i++) {
    nodes.push(node(`a${i}`, ['alpha']), node(`b${i}`, ['beta']))
    if (i > 0) {
      edges.push({ id: `ea${i}`, from: `a${i - 1}`, to: `a${i}`, rel: 'builds-on' })
      edges.push({ id: `eb${i}`, from: `b${i - 1}`, to: `b${i}`, rel: 'extends' })
    }
  }
  return { nodes, edges, topics: ['alpha', 'beta'] }
}

const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y)

describe('layout', () => {
  it('hash32 and mulberry32 are deterministic', () => {
    expect(hash32('abc')).toBe(hash32('abc'))
    expect(hash32('abc')).not.toBe(hash32('abd'))
    const a = mulberry32(7)
    const b = mulberry32(7)
    expect([a(), a()]).toEqual([b(), b()])
  })

  it('same input gives identical output', () => {
    expect(layout(fixture())).toEqual(layout(fixture()))
  })

  it('adding a node moves no other start position', () => {
    const g = fixture()
    const before = layout(g, { iterations: 0 })
    const after = layout({ ...g, nodes: [...g.nodes, node('zz', ['alpha'])] }, { iterations: 0 })
    for (const n of g.nodes) expect(after[n.pdfId]).toEqual(before[n.pdfId])
  })

  it('pins a node exactly', () => {
    const g = fixture()
    g.nodes[0] = node('a0', ['alpha'], { x: 123, y: 456 })
    expect(layout(g).a0).toEqual({ x: 123, y: 456 })
  })

  it('keeps every node within bounds', () => {
    for (const p of Object.values(layout(fixture()))) {
      expect(p.x).toBeGreaterThanOrEqual(10)
      expect(p.x).toBeLessThanOrEqual(MAP_SIZE - 10)
      expect(p.y).toBeGreaterThanOrEqual(10)
      expect(p.y).toBeLessThanOrEqual(MAP_SIZE - 10)
    }
  })

  it('separates topic clusters', () => {
    const g = fixture()
    const pos = layout(g)
    const A = g.nodes.filter(n => n.topics[0] === 'alpha').map(n => pos[n.pdfId])
    const B = g.nodes.filter(n => n.topics[0] === 'beta').map(n => pos[n.pdfId])
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
    const within = (S: typeof A) => mean(S.flatMap((p, i) => S.slice(i + 1).map(q => dist(p, q))))
    const between = mean(A.flatMap(p => B.map(q => dist(p, q))))
    expect(between).toBeGreaterThan(within(A))
    expect(between).toBeGreaterThan(within(B))
  })

  it('a secondary-only tag adds no anchor', () => {
    const g: MapGraph = { nodes: [node('x', ['alpha', 'beta']), node('y', ['alpha'])], edges: [], topics: ['alpha', 'beta'] }
    expect(anchoredTopics(g)).toEqual(['alpha'])
  })

  it('places anchors on a circle with the first at the top', () => {
    const a = anchors(['p', 'q'])
    expect(a.p.x).toBeCloseTo(MAP_SIZE / 2)
    expect(a.p.y).toBeCloseTo(MAP_SIZE / 2 - 0.36 * MAP_SIZE)
    expect(a.q.y).toBeCloseTo(MAP_SIZE / 2 + 0.36 * MAP_SIZE)
  })

  it('an untagged paper with no edges ends near the centre', () => {
    const g = fixture()
    g.nodes.push(node('lone', []))
    const p = layout(g).lone
    expect(dist(p, { x: MAP_SIZE / 2, y: MAP_SIZE / 2 })).toBeLessThan(MAP_SIZE / 4)
  })

  it('tagged papers stay near their primary anchor', () => {
    const g = fixture()
    const ring = anchors(anchoredTopics(g))
    const pos = layout(g)
    for (const n of g.nodes) expect(dist(pos[n.pdfId], ring[n.topics[0]])).toBeLessThan(0.3 * MAP_SIZE)
  })

  it('a warm start barely moves a settled layout', () => {
    const g = fixture()
    const cold = layout(g)
    const warm = layout(g, { warm: cold, iterations: 40 })
    const ids = Object.keys(cold)
    const avg = ids.reduce((s, id) => s + dist(cold[id], warm[id]), 0) / ids.length
    expect(avg).toBeLessThan(0.05 * MAP_SIZE)
  })

  it('returns an empty layout for an empty graph', () => {
    expect(layout({ nodes: [], edges: [], topics: [] })).toEqual({})
  })
})
