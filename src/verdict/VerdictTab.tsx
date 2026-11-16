// Reader sidebar tab: the paper's verdict note with citations, regenerate and an outdated notice.
import { useEffect, useState } from 'preact/hooks'
import { renderMarkdown } from '../ai/markdown'
import { showToast } from '../app/ui'
import { loadVerdict, sidecarRevision } from '../drive/library'
import { VerdictChip } from './VerdictChip'
import { canGrade, currentSkillHash, gradeNow, grading, hostSkill } from './grader'
import { isOutdated, type VerdictNote } from './note'
import './verdict.css'

export function VerdictTab({ pdfId, onGo }: { pdfId: string; onGo(page: number): void }) {
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

  if (!loaded) return <p class="mg-muted mg-pad">Loading…</p>
  if (!note) {
    return (
      <div class="mg-verdict-tab">
        <VerdictChip note={null} grading={busy === pdfId} />
        <p class="mg-muted">No note yet</p>
        {runnable ? (
          <button type="button" class="btn" disabled={busy !== null} onClick={() => void run()}>
            Grade now
          </button>
        ) : (
          <p class="mg-muted">Add a Claude key or pair the agent host in Settings</p>
        )}
      </div>
    )
  }
  return (
    <div class="mg-verdict-tab">
      <VerdictChip note={note} grading={busy === pdfId} />
      <div class="mg-verdict-body">{renderMarkdown(note.body, (page) => onGo(page))}</div>
      <p class="mg-muted">
        {note.model} · skill {note.skill} · {new Date(note.generated).toLocaleDateString()}
      </p>
      {outdated && <p class="mg-muted">Written with an older version of the skill</p>}
      <button type="button" class="btn" disabled={busy !== null} onClick={() => void run()}>
        Regenerate
      </button>
    </div>
  )
}
