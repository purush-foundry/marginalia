// SVG layers of the map: topic hulls, links, nodes and labels, all in map units.
import { SYMMETRIC_RELS } from '../types'
import type { Positions } from './layout'
import { shortTitle, type MapGraph, type MapNode } from './model'
import { fillOf, nodeRadius, strokeOf, topicHue, type Hull } from './scene'

const HUB_DEGREE = 3
const LABEL_ZOOM = 0.8
const HULL_FONT = 28
const LABEL_FONT = 12

export interface Shade {
  opacity(id: string): number
}

export function ArrowMarker() {
  return (
    <defs>
      <marker id="mg-map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" class="mg-map-arrowhead" />
      </marker>
    </defs>
  )
}

export function HullLayer({ hulls, k }: { hulls: Hull[]; k: number }) {
  return (
    <g class="mg-map-hulls">
      {hulls.map((h) => (
        <g key={h.topic} data-hull={h.topic}>
          <circle cx={h.cx} cy={h.cy} r={h.r} fill={`hsl(${topicHue(h.topic)} 55% 55%)`} fill-opacity="0.08" />
          <text class="mg-map-hull-label" x={h.cx} y={h.cy - h.r + HULL_FONT / k} font-size={HULL_FONT / k} text-anchor="middle">
            {h.topic}
          </text>
        </g>
      ))}
    </g>
  )
}

export function EdgeLayer(props: {
  graph: MapGraph
  pos: Positions
  degree: Map<string, number>
  shade: Shade
  tip: string | null
  k: number
  onHover(id: string | null): void
}) {
  const { graph, pos, degree, shade, tip, k } = props
  const hover = (id: string | null) => (e: PointerEvent) => e.pointerType === 'mouse' && props.onHover(id)
  return (
    <g class="mg-map-edges">
      {graph.edges.map((e) => {
        const p = pos[e.from]
        const q = pos[e.to]
        if (!p || !q) return null
        const d = Math.hypot(q.x - p.x, q.y - p.y) || 1
        const ux = (q.x - p.x) / d
        const uy = (q.y - p.y) / d
        const r0 = nodeRadius(degree.get(e.from) ?? 0)
        const r1 = nodeRadius(degree.get(e.to) ?? 0) + 2
        const [x1, y1, x2, y2] = [p.x + ux * r0, p.y + uy * r0, q.x - ux * r1, q.y - uy * r1]
        return (
          <g
            key={e.id}
            data-edge={e.id}
            opacity={Math.min(shade.opacity(e.from), shade.opacity(e.to))}
            onPointerEnter={hover(e.id)}
            onPointerLeave={hover(null)}
          >
            <line
              class={`mg-map-edge mg-map-edge-${e.rel}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              marker-end={SYMMETRIC_RELS.has(e.rel) ? undefined : 'url(#mg-map-arrow)'}
            />
            <line class="mg-map-edge-hit" x1={x1} y1={y1} x2={x2} y2={y2} />
            {tip === e.id && e.note && (
              <text class="mg-map-tip" x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 6 / k} font-size={LABEL_FONT / k} text-anchor="middle">
                {e.note}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

function NodeMark({ n, x, y, r, years, selected, pulse }: { n: MapNode; x: number; y: number; r: number; years: { min: number; max: number } | null; selected: boolean; pulse: boolean }) {
  const fill = fillOf(n)
  return (
    <>
      {selected && <circle class="mg-map-sel" cx={x} cy={y} r={r + 5} />}
      <circle
        class={`mg-map-dot${pulse ? ' mg-map-pulse' : ''}`}
        data-id={n.pdfId}
        cx={x}
        cy={y}
        r={r}
        fill={n.status === 'done' ? fill : '#fff'}
        stroke={strokeOf(n, years)}
        stroke-width="2"
      />
      {n.status === 'reading' && <path d={`M${x - r} ${y}A${r} ${r} 0 0 0 ${x + r} ${y}Z`} fill={fill} pointer-events="none" />}
      {n.pin && (
        <g class="mg-map-pin" transform={`translate(${x + r * 0.7} ${y - r * 0.7})`} pointer-events="none">
          <line x1="0" y1="0" x2="-3" y2="3" />
          <circle cx="1" cy="-1" r="2.2" />
        </g>
      )}
    </>
  )
}

export function NodeLayer(props: {
  graph: MapGraph
  pos: Positions
  degree: Map<string, number>
  years: { min: number; max: number } | null
  shade: Shade
  selected: string | null
  pulse: string | null
}) {
  return (
    <g class="mg-map-nodes">
      {props.graph.nodes.map((n) => {
        const p = props.pos[n.pdfId]
        if (!p) return null
        return (
          <g key={n.pdfId} class="mg-map-node" data-node={n.pdfId} opacity={props.shade.opacity(n.pdfId)}>
            <NodeMark
              n={n}
              x={p.x}
              y={p.y}
              r={nodeRadius(props.degree.get(n.pdfId) ?? 0)}
              years={props.years}
              selected={props.selected === n.pdfId}
              pulse={props.pulse === n.pdfId}
            />
          </g>
        )
      })}
    </g>
  )
}

export function LabelLayer({ graph, pos, degree, shade, selected, k }: { graph: MapGraph; pos: Positions; degree: Map<string, number>; shade: Shade; selected: string | null; k: number }) {
  return (
    <g class="mg-map-labels" pointer-events="none">
      {graph.nodes.map((n) => {
        const p = pos[n.pdfId]
        const deg = degree.get(n.pdfId) ?? 0
        if (!p || (k < LABEL_ZOOM && n.pdfId !== selected && deg < HUB_DEGREE)) return null
        return (
          <text
            key={n.pdfId}
            class="mg-map-label"
            x={p.x}
            y={p.y + nodeRadius(deg) + (LABEL_FONT + 2) / k}
            font-size={LABEL_FONT / k}
            text-anchor="middle"
            opacity={shade.opacity(n.pdfId)}
          >
            {shortTitle(n.title)}
          </text>
        )
      })}
    </g>
  )
}
