// Sheet for choosing a link's relation, direction and phrase between two papers.
import { useState } from 'preact/hooks'
import { SYMMETRIC_RELS, type LinkRel } from '../types'
import { shortTitle, type MapNode } from './model'

export const RELS: readonly LinkRel[] = ['builds-on', 'extends', 'baseline', 'contradicts', 'same-problem', 'related']

export const REL_LABEL: Record<LinkRel, string> = {
  'builds-on': 'builds on',
  extends: 'extends',
  baseline: 'baseline',
  contradicts: 'contradicts',
  'same-problem': 'same problem',
  related: 'related',
}

export function LinkSheet(props: { a: MapNode; b: MapNode; onSave(rel: LinkRel, note: string, from: string, to: string): void; onCancel(): void }) {
  const [rel, setRel] = useState<LinkRel | null>(null)
  const [swapped, setSwapped] = useState(false)
  const [note, setNote] = useState('')
  const [from, to] = swapped ? [props.b, props.a] : [props.a, props.b]
  return (
    <div class="mg-sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div class="mg-sheet mg-map-linksheet" role="dialog" aria-label="Link papers">
        <h2>Link papers</h2>
        <div class="mg-map-rels">
          {RELS.map((r) => (
            <button key={r} type="button" class="btn" aria-pressed={rel === r} onClick={() => setRel(r)}>
              {REL_LABEL[r]}
            </button>
          ))}
        </div>
        {rel && !SYMMETRIC_RELS.has(rel) && (
          <div class="mg-map-direction">
            <span>
              {shortTitle(from.title)} → {shortTitle(to.title)}
            </span>
            <button type="button" class="btn" onClick={() => setSwapped(!swapped)}>
              Swap
            </button>
          </div>
        )}
        <input
          type="text"
          placeholder="Linking phrase"
          aria-label="Linking phrase"
          value={note}
          onInput={(e) => setNote(e.currentTarget.value)}
        />
        <div class="mg-map-actions">
          <button type="button" class="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" class="btn primary" disabled={!rel} onClick={() => rel && props.onSave(rel, note.trim(), from.pdfId, to.pdfId)}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
