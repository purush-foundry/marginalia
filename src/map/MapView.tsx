// The brain map screen: papers as nodes grouped by topic, typed links between them, and the side card.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Icon } from '../app/icons'
import { navigate, paperHash } from '../app/route'
import { showToast } from '../app/ui'
import { MAP_SIZE } from '../config'
import { library, sidecarRevision } from '../drive/library'
import { newId, now } from '../lib/ids'
import type { LinkRel, ReadStatus, Sidecar } from '../types'
import { Card } from './Card'
import { updateSidecar, withGist, withLink, withoutLink, withPin, withTopics } from './data'
import { useGestures } from './gestures'
import { ArrowMarker, EdgeLayer, HullLayer, LabelLayer, NodeLayer, type Shade } from './Layers'
import { anchoredTopics, type Positions } from './layout'
import { LinkSheet } from './LinkSheet'
import { canonicalLink, loadGraph, type MapGraph } from './model'
import { degrees, hulls, matchesQuery, nearestByAngle, neighbourhood, placeGraph, yearRange } from './scene'
import { fitTo, toMap, type Viewport } from './viewport'
import './map.css'

const STATUSES: readonly ReadStatus[] = ['unread', 'reading', 'done']
const DIM = 0.15
const LINK_DIM = 0.4
const FIT_PAD = 40

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
  const next = new Set(set)
  if (!next.delete(v)) next.add(v)
  return next
}

const clampMap = (v: number) => Math.min(MAP_SIZE, Math.max(0, v))

// Loads the graph and its positions on mount, on sync and on demand; reloads warm-start from the current positions.
function useMapData() {
  const [data, setData] = useState<{ graph: MapGraph; pos: Positions } | null>(null)
  const pos = useRef<Positions>({})
  const live = useRef(true)
  const seq = useRef(0)
  const reload = async () => {
    const n = ++seq.current
    const graph = await loadGraph()
    const next = await placeGraph(graph, pos.current)
    if (!live.current || n !== seq.current) return
    pos.current = next
    setData({ graph, pos: next })
  }
  const revision = sidecarRevision.value
  const index = library.value
  useEffect(() => {
    live.current = true
    void reload()
    return () => {
      live.current = false
    }
  }, [revision, index])
  return { data, reload }
}

export function MapView() {
  const { data, reload } = useMapData()
  const svg = useRef<SVGSVGElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<Viewport | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [linkTo, setLinkTo] = useState<string | null>(null)
  const [topicFilter, setTopicFilter] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<Set<ReadStatus>>(new Set())
  const [query, setQuery] = useState('')
  const [hood, setHood] = useState<{ ids: Set<string>; back: Viewport } | null>(null)
  const [tip, setTip] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)

  const graph = data?.graph ?? null
  const pos = useMemo(() => (data && drag ? { ...data.pos, [drag.id]: { x: drag.x, y: drag.y } } : (data?.pos ?? {})), [data, drag])
  const degree = useMemo(() => (graph ? degrees(graph) : new Map<string, number>()), [graph])
  const years = useMemo(() => (graph ? yearRange(graph) : null), [graph])
  const topics = useMemo(() => (graph ? anchoredTopics(graph) : []), [graph])
  const hullList = useMemo(() => (graph && data ? hulls(graph, data.pos) : []), [graph, data])
  const node = (id: string | null) => (id ? graph?.nodes.find((n) => n.pdfId === id) : undefined)

  const size = () => ({ w: svg.current?.clientWidth || window.innerWidth, h: svg.current?.clientHeight || window.innerHeight })
  const fitIds = (ids: Iterable<string>) => {
    const pts = [...ids].flatMap((id) => (pos[id] ? [pos[id]] : []))
    if (!pts.length) return
    const { w, h } = size()
    setView(fitTo(pts, w, h, FIT_PAD))
  }
  const fitAll = () => graph && fitIds(graph.nodes.map((n) => n.pdfId))

  useEffect(() => {
    if (!view && graph?.nodes.length) fitAll()
  }, [data])

  const visible = useMemo(() => {
    if (!graph) return new Set<string>()
    const pass = graph.nodes.filter(
      (n) =>
        (topicFilter.size === 0 || n.topics.some((t) => topicFilter.has(t))) &&
        (statusFilter.size === 0 || statusFilter.has(n.status)) &&
        matchesQuery(graph, n, query) &&
        (!hood || hood.ids.has(n.pdfId)),
    )
    return new Set(pass.map((n) => n.pdfId))
  }, [graph, topicFilter, statusFilter, query, hood])

  const shade: Shade = { opacity: (id) => (!visible.has(id) ? DIM : linkFrom && id !== linkFrom ? LINK_DIM : 1) }

  const edit = async (id: string, fn: (s: Sidecar, t: number) => Sidecar) => {
    try {
      await updateSidecar(id, (s) => fn(s, now()))
      await reload()
    } catch (err) {
      showToast(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const startLink = () => {
    if (!selected) return
    setLinkFrom(selected)
    setLinkTo(null)
  }
  const cancelLink = () => {
    setLinkFrom(null)
    setLinkTo(null)
  }
  const saveLink = (rel: LinkRel, note: string, from: string, to: string) => {
    const c = canonicalLink(from, to, rel)
    cancelLink()
    void edit(c.from, (s, t) => withLink(s, { kind: 'link', id: newId(), createdAt: t, updatedAt: t, to: c.to, rel, ...(note ? { note } : {}) }))
  }
  const editLink = (id: string, note: string) => {
    const e = graph?.edges.find((x) => x.id === id)
    if (!e) return
    void edit(e.from, (s, t) => {
      const l = s.links?.find((x) => x.id === id)
      if (!l) return s
      const { note: _old, ...rest } = l
      return withLink(s, { ...rest, ...(note ? { note } : {}), updatedAt: t })
    })
  }
  const removeLink = (id: string) => {
    const e = graph?.edges.find((x) => x.id === id)
    if (e) void edit(e.from, (s, t) => withoutLink(s, id, t))
  }
  const pinAt = (id: string, at: { x: number; y: number } | null) =>
    edit(id, (s, t) => withPin(s, at && { x: clampMap(at.x), y: clampMap(at.y) }, t)).then(() => setDrag(null))

  const showNeighbours = () => {
    if (!graph || !selected || !view) return
    const ids = neighbourhood(graph, selected)
    setHood({ ids, back: hood?.back ?? view })
    fitIds(ids)
  }
  const back = () => {
    if (hood) setView(hood.back)
    setHood(null)
  }

  const gestures = useGestures(svg, {
    view: () => view,
    setView,
    tapNode: (id) => {
      setTip(null)
      if (linkFrom) {
        if (id !== linkFrom) setLinkTo(id)
      } else setSelected(id)
    },
    tapEdge: setTip,
    tapEmpty: () => {
      setTip(null)
      if (!linkFrom) setSelected(null)
    },
    doubleTapHull: (topic) => {
      const h = hullList.find((x) => x.topic === topic)
      if (h) fitIds(h.members)
    },
    dragNode: (id, by) => data?.pos[id] && setDrag({ id, x: data.pos[id].x + by.x, y: data.pos[id].y + by.y }),
    dropNode: (id, by) => data?.pos[id] && void pinAt(id, { x: data.pos[id].x + by.x, y: data.pos[id].y + by.y }),
    cancelDrag: () => setDrag(null),
  })

  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const el = e.target instanceof HTMLElement ? e.target : null
    if (el && (el.matches('input, textarea, select') || el.isContentEditable)) {
      if (e.key === 'Escape') el.blur()
      return
    }
    if (el?.closest('button, a') && e.key !== 'Escape') return
    if (e.key === '/') {
      e.preventDefault()
      search.current?.focus()
    } else if (e.key === 'Escape') {
      if (linkFrom) cancelLink()
      else setSelected(null)
    } else if (ARROWS[e.key] && graph && view) {
      e.preventDefault()
      const [dx, dy] = ARROWS[e.key]
      if (selected) {
        const next = nearestByAngle(graph, pos, selected, dx, dy)
        if (next) setSelected(next)
        return
      }
      const { w, h } = size()
      const c = toMap(view, w / 2, h / 2)
      const near = [...graph.nodes].sort((a, b) => dist(pos[a.pdfId], c) - dist(pos[b.pdfId], c))[0]
      if (near) setSelected(near.pdfId)
    } else if (selected && e.key === 'Enter') navigate(paperHash(selected))
    else if (selected && (e.key === 'l' || e.key === 'L')) startLink()
  }
  useEffect(() => {
    const fn = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  const onSearch = (e: Event) => {
    e.preventDefault()
    if (graph && query.trim()) fitIds(graph.nodes.filter((n) => matchesQuery(graph, n, query)).map((n) => n.pdfId))
  }

  const sel = node(selected)
  const k = view?.k ?? 1
  return (
    <div class="mg-map">
      <header class="mg-map-bar">
        <a class="btn" href="#/" aria-label="Library">
          <Icon name="back" />
        </a>
        <form class="mg-map-search" onSubmit={onSearch}>
          <input ref={search} type="search" placeholder="Search the map" aria-label="Search the map" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        </form>
        <div class="mg-map-chips">
          {topics.map((t) => (
            <button key={t} type="button" class="mg-map-chip" aria-pressed={topicFilter.has(t)} onClick={() => setTopicFilter(toggle(topicFilter, t))}>
              {t}
            </button>
          ))}
          {STATUSES.map((s) => (
            <button key={s} type="button" class="mg-map-chip" aria-pressed={statusFilter.has(s)} onClick={() => setStatusFilter(toggle(statusFilter, s))}>
              {s}
            </button>
          ))}
        </div>
        {hood && (
          <button type="button" class="btn" onClick={back}>
            Back
          </button>
        )}
        <button type="button" class="btn" onClick={fitAll}>
          Fit
        </button>
      </header>
      {linkFrom && (
        <p class="mg-map-hint" role="status">
          Tap the paper this links to · Esc cancels
          <button type="button" class="btn" onClick={cancelLink}>
            Cancel
          </button>
        </p>
      )}
      <svg ref={svg} class={`mg-map-canvas${linkFrom ? ' mg-map-linking' : ''}`} {...gestures}>
        <ArrowMarker />
        {graph && view && (
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <HullLayer hulls={hullList} k={k} />
            <EdgeLayer graph={graph} pos={pos} degree={degree} shade={shade} tip={tip} k={k} onHover={setTip} />
            <NodeLayer graph={graph} pos={pos} degree={degree} years={years} shade={shade} selected={selected} pulse={linkFrom} />
            <LabelLayer graph={graph} pos={pos} degree={degree} shade={shade} selected={selected} k={k} />
          </g>
        )}
      </svg>
      {graph && graph.nodes.length === 0 && <p class="mg-muted mg-map-empty">No papers in the library yet.</p>}
      {sel && graph && !linkFrom && (
        <Card
          key={sel.pdfId}
          node={sel}
          graph={graph}
          onGist={(text) => void edit(sel.pdfId, (s, t) => withGist(s, text, t))}
          onTopics={(ids) => void edit(sel.pdfId, (s, t) => withTopics(s, ids, t))}
          onLink={startLink}
          onPin={() => pos[sel.pdfId] && void pinAt(sel.pdfId, pos[sel.pdfId])}
          onUnpin={() => void pinAt(sel.pdfId, null)}
          onNeighbours={showNeighbours}
          onEditLink={editLink}
          onRemoveLink={removeLink}
          onClose={() => setSelected(null)}
        />
      )}
      {linkFrom && linkTo && node(linkFrom) && node(linkTo) && (
        <LinkSheet a={node(linkFrom)!} b={node(linkTo)!} onSave={saveLink} onCancel={cancelLink} />
      )}
    </div>
  )
}

const dist = (p: { x: number; y: number } | undefined, c: { x: number; y: number }) => (p ? Math.hypot(p.x - c.x, p.y - c.y) : Infinity)
