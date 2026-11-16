// Library-row pill: Read, Skim or Skip, a pulse while grading, nothing without a note.
import type { VerdictKind, VerdictNote } from './note'
import './verdict.css'

const LABEL: Record<VerdictKind, string> = { read: 'Read', skim: 'Skim', skip: 'Skip' }

export function VerdictChip({ note, grading }: { note: VerdictNote | null; grading: boolean }) {
  if (grading) return <span class="mg-verdict mg-verdict-busy" aria-label="Grading">…</span>
  if (!note) return null
  return <span class={`mg-verdict mg-verdict-${note.verdict}`}>{LABEL[note.verdict]}</span>
}
