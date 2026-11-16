// Reader sidebar tab: the reader's gist, then the paper's verdict note with citations, regenerate and an outdated notice.
import { useEffect, useState } from 'preact/hooks'
import type { AnnotationStore } from '../annot/store'
import { renderMarkdown } from '../ai/markdown'
import { showToast } from '../app/ui'
import { GIST_MAX_CHARS } from '../config'
import { loadVerdict, sidecarRevision } from '../drive/library'
import { useDraft } from '../lib/draft'
import { VerdictChip } from './VerdictChip'
import { canGrade, currentSkillHash, gradeNow, grading, hostSkill } from './grader'
import { isOutdated, type VerdictNote } from './note'
import './verdict.css'

function GistField({ store }: { store: AnnotationStore }) {
  const gist = useDraft(store.sidecar.peek().gist?.text ?? '', (text) => store.setGist(text))
  return (
    <div class="mg-field">
      <label for="mg-verdict-gist">Your gist</label>
      <textarea id="mg-verdict-gist" placeholder="Your one line on this paper" maxLength={GIST_MAX_CHARS} rows={2} {...gist} />
    </div>
  )
}

export function VerdictTab({ pdfId, store, onGo }: { pdfId: string; store: AnnotationStore; onGo(page: number): void }) {
  const [note, setNote] = useState<VerdictNote | null>(null)
  const [outdated, setOutdated] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const busy = grading.value
  const revision = sidecarRevision.value
  const runnable = canGrade()
  const skill = hostSkill()

  // Clears the previous paper's note when the paper changes.
  useEffect(() => {
    setNote(null)
    setOutdated(false)
    setLoaded(false)
  }, [pdfId])

  useEffect(() => {
    let live = true
    void (async () => {
      const n = await loadVerdict(pdfId)
      const old = n ? isOutdated(n, await currentSkillHash()) : false
      if (!live) return
      setNote(n)
      setOutdated(old)
      setLoaded(true)
    })()
    return () => {
      live = false
    }
  }, [pdfId, revision, busy, skill])

  const run = () =>
    gradeNow(pdfId).then(
      () => undefined,
      (err: unknown) => showToast(err instanceof Error ? err.message : String(err)),
    )

  return (
    <div class="mg-verdict-tab">
      <GistField key={pdfId} store={store} />
      {!loaded ? (
        <p class="mg-muted">Loading…</p>
      ) : !note ? (
        <>
          <VerdictChip note={null} grading={busy === pdfId} />
          <p class="mg-muted">No note yet</p>
          {runnable ? (
            <button type="button" class="btn" disabled={busy !== null} onClick={() => void run()}>
              Grade now
            </button>
          ) : (
            <p class="mg-muted">Add a Claude key or pair the agent host in Settings</p>
          )}
        </>
      ) : (
        <>
          <VerdictChip note={note} grading={busy === pdfId} />
          <div class="mg-verdict-body">{renderMarkdown(note.body, (page) => onGo(page))}</div>
          <p class="mg-muted">
            {note.model} · skill {note.skill} · {new Date(note.generated).toLocaleDateString()}
          </p>
          {outdated && <p class="mg-muted">Written with an older version of the skill</p>}
          <button type="button" class="btn" disabled={busy !== null} onClick={() => void run()}>
            Regenerate
          </button>
        </>
      )}
    </div>
  )
}
