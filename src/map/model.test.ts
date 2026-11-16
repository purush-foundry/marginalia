import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryIndex, PaperLink, Sidecar } from '../types'
import { emptySidecar } from '../types'

const lib = vi.hoisted(() => ({ sidecars: {} as Record<string, unknown> }))
vi.mock('../drive/library', async () => {
  const { signal: sig } = await import('@preact/signals')
  return {
    library: sig(null),
    loadSidecar: async (id: string) => lib.sidecars[id],
  }
})

import { library } from '../drive/library'
import { canonicalLink, loadGraph, shortTitle, topicOrder, type MapEdge, type MapNode } from './model'

function link(id: string, to: string, rel: PaperLink['rel'] = 'related', deleted = false): PaperLink {
  return { id, kind: 'link', to, rel, createdAt: 1, updatedAt: 1, ...(deleted ? { deleted } : {}) }
}

function sc(id: string, patch: Partial<Sidecar> = {}): Sidecar {
  return { ...emptySidecar(id, `${id}.pdf`, 1), ...patch }
}

function setIndex(ids: string[]) {
  const papers: LibraryIndex['papers'] = {}
  for (const id of ids) {
    papers[id] = { id, name: `${id}.pdf`, mimeType: 'application/pdf', parents: [], modifiedTime: '', version: '1' }
  }
  ;(library as unknown as { value: LibraryIndex | null }).value = {
    rootId: 'r', rootName: 'r', folders: {}, papers, sidecars: {}, syncedAt: 0,
  }
}

beforeEach(() => {
  lib.sidecars = {}
  ;(library as unknown as { value: LibraryIndex | null }).value = null
})

describe('loadGraph', () => {
  it('returns an empty graph without an index', async () => {
    expect(await loadGraph()).toEqual({ nodes: [], edges: [], topics: [] })
  })

  it('drops edges to missing papers and deleted links', async () => {
    setIndex(['a', 'b'])
    lib.sidecars = {
      a: sc('a', { links: [link('l1', 'b'), link('l2', 'zzz'), link('l3', 'b', 'extends', true)] }),
      b: sc('b'),
    }
    const g = await loadGraph()
    expect(g.edges).toEqual([{ id: 'l1', from: 'a', to: 'b', rel: 'related', note: undefined }])
  })

  it('uses sidecar topics, else the verdict topics', async () => {
    setIndex(['a', 'b', 'c'])
    lib.sidecars = {
      a: sc('a', { topics: { ids: ['x'], updatedAt: 1 } }),
      b: sc('b'),
      c: sc('c'),
    }
    const g = await loadGraph(async id => (id === 'c' ? null : { topics: ['v1', 'v2'], year: 2020, verdict: 'read', oneLine: 'hi' }))
    const byId = Object.fromEntries(g.nodes.map(n => [n.pdfId, n]))
    expect(byId.a.topics).toEqual(['x'])
    expect(byId.b.topics).toEqual(['v1', 'v2'])
    expect(byId.b.year).toBe(2020)
    expect(byId.b.verdict).toBe('read')
    expect(byId.b.oneLine).toBe('hi')
    expect(byId.c.topics).toEqual([])
    expect(byId.a.title).toBe('a')
  })

  it('ignores a pin with a negative coordinate', async () => {
    setIndex(['a', 'b'])
    lib.sidecars = {
      a: sc('a', { pin: { x: 3, y: 4, updatedAt: 1 } }),
      b: sc('b', { pin: { x: -1, y: -1, updatedAt: 1 } }),
    }
    const g = await loadGraph()
    expect(g.nodes[0].pin).toEqual({ x: 3, y: 4 })
    expect(g.nodes[1].pin).toBeUndefined()
  })
})

function node(pdfId: string, topics: string[]): MapNode {
  return { pdfId, title: pdfId, status: 'unread', gist: '', topics }
}
function edge(id: string, from: string, to: string): MapEdge {
  return { id, from, to, rel: 'related' }
}

describe('topicOrder', () => {
  const nodes = [node('p1', ['a']), node('p2', ['b']), node('p3', ['c']), node('p4', ['d'])]

  it('chains topics by shared edges', () => {
    const edges = [edge('1', 'p1', 'p2'), edge('2', 'p2', 'p3'), edge('3', 'p2', 'p3'), edge('4', 'p3', 'p4')]
    expect(topicOrder(nodes, edges)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('extends the end with the strongest link', () => {
    const edges = [edge('1', 'p3', 'p4'), edge('2', 'p3', 'p4'), edge('3', 'p2', 'p3')]
    expect(topicOrder(nodes, edges)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('is id order without edges and puts unlinked topics last', () => {
    expect(topicOrder([node('p1', ['b', 'a']), node('p2', ['c'])], [])).toEqual(['a', 'b', 'c'])
    expect(topicOrder(nodes, [edge('1', 'p3', 'p4')])).toEqual(['c', 'd', 'a', 'b'])
  })
})

describe('canonicalLink', () => {
  it('keeps directed rels as given', () => {
    expect(canonicalLink('z', 'a', 'builds-on')).toEqual({ from: 'z', to: 'a' })
  })
  it('puts symmetric rels on the smaller id', () => {
    expect(canonicalLink('z', 'a', 'related')).toEqual({ from: 'a', to: 'z' })
  })
})

describe('shortTitle', () => {
  it('keeps the first four words', () => {
    expect(shortTitle('Attention Is All You Need')).toBe('Attention Is All You…')
    expect(shortTitle('Short one')).toBe('Short one')
  })
})
