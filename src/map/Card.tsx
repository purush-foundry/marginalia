// Side card for the selected paper: gist, topics, links and the map actions.
import { useEffect, useRef, useState } from 'preact/hooks'
import { paperHash, navigate } from '../app/route'
import type { LinkRel } from '../types'
import type { MapEdge, MapGraph, MapNode, MapVerdict } from './model'

const GIST_MAX = 140

const STATUS_LABEL = { unread: 'Unread', reading: 'Reading', done: 'Done' } as const
const VERDICT_LABEL: Record<MapVerdict, string> = { read: 'Read', skim: 'Skim', skip: 'Skip' }

const OUTGOING: Record<LinkRel, string> = {
  'builds-on': 'builds on',
  extends: 'extends',
  baseline: 'uses as a baseline',
  contradicts: 'contradicts',
  'same-problem': 'tackles the same problem as',
  related: 'is related to',
}

const INCOMING: Record<LinkRel, string> = {
  ...OUTGOING,
  'builds-on': 'is built on by',
  extends: 'is extended by',
  baseline: 'is the baseline of',
}

export interface CardProps {
  node: MapNode
  graph: MapGraph
  onGist(text: string): void
  onTopics(ids: string[]): void
  onLink(): void
  onPin(): void
  onUnpin(): void
  onNeighbours(): void
  onEditLink(id: string, note: string): void
  onRemoveLink(id: string): void
  onClose(): void
}

function VerdictChip({ verdict }: { verdict: MapVerdict }) {
  return <span class={`mg-map-verdict mg-map-verdict-${verdict}`}>{VERDICT_LABEL[verdict]}</span>
}

// A text field's draft that saves its trimmed text on blur and on unmount when it differs from the last saved text.
function useDraft(initial: string, save: (text: string) => void) {
  const [value, setValue] = useState(initial)
  const text = useRef(initial)
  const saved = useRef(initial)
  const onSave = useRef(save)
  onSave.current = save
  const commit = () => {
    const t = text.current.trim()
    if (t === saved.current) return
    saved.current = t
    onSave.current(t)
  }
  useEffect(() => commit, [])
  return {
    value,
    onInput: (e: { currentTarget: { value: string } }) => {
      text.current = e.currentTarget.value
      setValue(text.current)
    },
    onBlur: (e: { currentTarget: { value: string } }) => {
      text.current = e.currentTarget.value
      commit()
    },
  }
}

function LinkRow({ edge, self, graph, onEdit, onRemove }: { edge: MapEdge; self: string; graph: MapGraph; onEdit(note: string): void; onRemove(): void }) {
  const note = useDraft(edge.note ?? '', onEdit)
  const out = edge.from === self
  const other = graph.nodes.find((n) => n.pdfId === (out ? edge.to : edge.from))
  return (
    <li class="mg-map-link">
      <p>
        {(out ? OUTGOING : INCOMING)[edge.rel]} <em>{other?.title ?? 'a missing paper'}</em>
        {edge.note ? ` — ${edge.note}` : ''}
      </p>
      <div class="mg-map-link-edit">
        <input
          type="text"
          aria-label="Link phrase"
          placeholder="Linking phrase"
          {...note}
        />
        <button type="button" class="btn" aria-label="Delete link" onClick={onRemove}>
          Delete
        </button>
      </div>
    </li>
  )
}

export function Card(props: CardProps) {
  const { node, graph } = props
  const gist = useDraft(node.gist, props.onGist)
  const [topic, setTopic] = useState('')
  const links = graph.edges.filter((e) => e.from === node.pdfId || e.to === node.pdfId)

  const addTopic = () => {
    const t = topic.trim()
    setTopic('')
    if (t && !node.topics.includes(t)) props.onTopics([...node.topics, t])
  }

  return (
    <aside class="mg-map-card" aria-label="Paper">
      <header class="mg-map-card-head">
        <h2>{node.title}</h2>
        <button type="button" class="btn" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </header>
      <p class="mg-map-meta">
        {node.year !== undefined && <span>{node.year}</span>}
        {node.verdict && <VerdictChip verdict={node.verdict} />}
        <span class={`mg-badge mg-badge-${node.status}`}>{STATUS_LABEL[node.status]}</span>
      </p>
      <textarea
        class="mg-map-gist"
        aria-label="Gist"
        placeholder="Your one line on this paper"
        maxLength={GIST_MAX}
        rows={2}
        {...gist}
      />
      {node.oneLine && <p class="mg-muted">{node.oneLine}</p>}
      <div class="mg-map-topics">
        {node.topics.map((t) => (
          <span key={t} class="mg-map-chip">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => props.onTopics(node.topics.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          aria-label="Add topic"
          placeholder="Add topic"
          value={topic}
          onInput={(e) => setTopic(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTopic()}
          onBlur={addTopic}
        />
      </div>
      {links.length > 0 && (
        <ul class="mg-map-links">
          {links.map((e) => (
            <LinkRow
              key={e.id}
              edge={e}
              self={node.pdfId}
              graph={graph}
              onEdit={(note) => props.onEditLink(e.id, note)}
              onRemove={() => props.onRemoveLink(e.id)}
            />
          ))}
        </ul>
      )}
      <div class="mg-map-actions">
        <button type="button" class="btn primary" onClick={() => navigate(paperHash(node.pdfId))}>
          Open paper
        </button>
        <button type="button" class="btn" onClick={props.onNeighbours}>
          Neighbours
        </button>
        <button type="button" class="btn" onClick={props.onLink}>
          Link
        </button>
        <button type="button" class="btn" onClick={node.pin ? props.onUnpin : props.onPin}>
          {node.pin ? 'Unpin' : 'Pin'}
        </button>
      </div>
    </aside>
  )
}
