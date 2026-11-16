// Grades through the paired agent host and plugs that grader into the queue while the host is ready.
import { effect } from '@preact/signals'
import { hostState, hostVerdict } from '../agent/host'
import type { StatusResponse } from '../../host/src/protocol.ts'
import { setHostGrader, setHostSkillHash, type Grader } from './grader'
import { parseNote } from './note'
import { VerdictFormatError } from './runner'

/** Runs the skill on the host and stamps the host's skill hash and model and the time on the note. */
export function hostGrader(info: StatusResponse, now: () => Date = () => new Date()): Grader {
  return async (paper) => {
    const markdown = await hostVerdict(paper.pdfId, paper)
    const note = parseNote(markdown)
    if (!note) throw new VerdictFormatError(`The agent host's note could not be parsed: ${markdown.slice(0, 200)}`)
    return { ...note, skill: info.skill, model: info.model, generated: now().toISOString() }
  }
}

/** Keeps the queue's host grader and skill hash in step with hostState; returns a stop function. */
export function connectHostGrading(): () => void {
  let key: string | null = null
  const stop = effect(() => {
    const s = hostState.value
    const info = s.status === 'ready' && s.info.skill !== 'missing' ? s.info : null
    const next = info ? `${info.skill}\n${info.model}` : ''
    if (next === key) return
    key = next
    const grader = info ? hostGrader(info) : null
    setHostGrader(() => grader)
    setHostSkillHash(() => info?.skill ?? null)
  })
  return () => {
    stop()
    setHostGrader(() => null)
    setHostSkillHash(() => null)
  }
}
