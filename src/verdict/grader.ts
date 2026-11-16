// Grades new papers one at a time, newest first, and regrades on demand.
import { effect, signal } from '@preact/signals'
import { settings } from '../app/settings'
import { hasRemoteVerdict, library, loadVerdict, saveVerdict, sidecarRevision } from '../drive/library'
import { isOutdated, type VerdictNote } from './note'
import { gradeDirect, paperInput, type PaperInput } from './runner'
import { SKILL_TEXT, skillHash } from './skill'

export type Grader = (paper: PaperInput) => Promise<VerdictNote>
export interface GraderDeps {
  host(): Grader | null
  direct(): Grader | null
  paper(pdfId: string): Promise<PaperInput>
}

/** The pdfId being graded, null when idle. */
export const grading = signal<string | null>(null)
/** This session's grading failures by pdfId. */
export const gradeErrors = signal<Record<string, string>>({})

const hostGraderProvider = signal<() => Grader | null>(() => null)
const hostSkillHash = signal<() => string | null>(() => null)

/** Plugs in the paired host's grader. */
export function setHostGrader(p: () => Grader | null): void {
  hostGraderProvider.value = p
}

/** Plugs in the paired host's skill hash. */
export function setHostSkillHash(p: () => string | null): void {
  hostSkillHash.value = p
}

const defaultDeps: GraderDeps = {
  host: () => hostGraderProvider.value(),
  direct: () => {
    const { anthropicApiKey, visionModel } = settings.peek()
    if (!anthropicApiKey) return null
    return (paper) => gradeDirect(paper, { apiKey: anthropicApiKey, model: visionModel, skillText: SKILL_TEXT })
  },
  paper: paperInput,
}

const gradedThisSession = new Set<string>()
let running: Promise<void> | null = null
let rerun = false

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The hash notes are compared against: the paired host's when ready, else the bundled skill's. */
export async function currentSkillHash(): Promise<string> {
  return hostSkillHash.value() ?? (await skillHash(SKILL_TEXT))
}

class HostGradeError extends Error {}

// Grades with the host, falling back to direct when the host fails or is absent.
async function gradeWith(pdfId: string, deps: GraderDeps): Promise<VerdictNote> {
  const paper = await deps.paper(pdfId)
  const host = deps.host()
  let hostError: unknown = null
  if (host) {
    try {
      return await host(paper)
    } catch (err) {
      hostError = err
    }
  }
  const direct = deps.direct()
  if (direct) return direct(paper)
  if (hostError) throw new HostGradeError(messageOf(hostError), { cause: hostError })
  throw new Error('No grader available: set an API key or pair a host')
}

const inFlight = new Map<string, Promise<VerdictNote>>()
let lane: Promise<unknown> = Promise.resolve()
let generation = 0
let active: { deps: GraderDeps; gen: number } | null = null

// Queues a job behind every grading already queued or running.
function serial<T>(job: () => Promise<T>): Promise<T> {
  const p = lane.then(job)
  lane = p.catch(() => {})
  return p
}

// Grades one paper, tracking it in `grading` and `inFlight`, and stores the note; runs inside the lane.
async function gradeAndSave(pdfId: string, deps: GraderDeps): Promise<VerdictNote> {
  const work = (async () => {
    grading.value = pdfId
    try {
      const note = await gradeWith(pdfId, deps)
      saveVerdict(pdfId, note)
      gradedThisSession.add(pdfId)
      return note
    } finally {
      grading.value = null
      inFlight.delete(pdfId)
    }
  })()
  inFlight.set(pdfId, work)
  return work
}

// Grades one paper through the lane, sharing the result when that paper is already being graded.
function gradeQueued(pdfId: string, deps: GraderDeps): Promise<VerdictNote> {
  const existing = inFlight.get(pdfId)
  if (existing) return existing
  const queued = serial(() => gradeAndSave(pdfId, deps))
  inFlight.set(pdfId, queued)
  const clear = () => {
    if (inFlight.get(pdfId) === queued) inFlight.delete(pdfId)
  }
  queued.then(clear, clear)
  return queued
}

// Papers newer than gradingSince with no index entry, local note, recorded error or session grade, newest first.
async function candidates(): Promise<string[]> {
  const index = library.peek()
  if (!index) return []
  const since = settings.peek().gradingSince
  const errors = gradeErrors.peek()
  const found: { id: string; time: number }[] = []
  for (const node of Object.values(index.papers)) {
    const time = Date.parse(node.modifiedTime)
    if (!(time > since) || index.verdicts?.[node.id] || errors[node.id] || gradedThisSession.has(node.id)) continue
    if (await loadVerdict(node.id)) continue
    found.push({ id: node.id, time })
  }
  return found.sort((a, b) => b.time - a.time).map((c) => c.id)
}

class RemoteCheckError extends Error {}

// Checks Drive for an existing note, marking a failed check so the paper is retried later.
async function remoteVerdict(pdfId: string): Promise<boolean> {
  try {
    return await hasRemoteVerdict(pdfId)
  } catch {
    throw new RemoteCheckError()
  }
}

// Handles one candidate; resolves true when another pass should follow; a failed remote check or host-only grade ends the pass unrecorded.
async function passOnce(deps: GraderDeps, gen: number): Promise<boolean> {
  if (gen !== generation || !settings.peek().gradeOnThisDevice || (!deps.host() && !deps.direct())) return false
  const [next, ...rest] = await candidates()
  if (!next || gen !== generation) return false
  try {
    if (await remoteVerdict(next)) {
      gradedThisSession.add(next)
    } else {
      await gradeAndSave(next, deps)
    }
  } catch (err) {
    if (err instanceof RemoteCheckError || err instanceof HostGradeError) return false
    gradeErrors.value = { ...gradeErrors.peek(), [next]: messageOf(err) }
  }
  return rest.length > 0
}

// Runs one pass in the lane unless one is pending, then chains the next while candidates remain.
function schedulePass(deps: GraderDeps, gen: number): void {
  if (gen !== generation) return
  if (running) {
    rerun = true
    return
  }
  running = serial(() => passOnce(deps, gen))
    .then((more) => {
      rerun ||= more
    })
    .catch(() => {})
    .finally(() => {
      running = null
      if (rerun && active) {
        rerun = false
        const { deps: liveDeps, gen: liveGen } = active
        queueMicrotask(() => schedulePass(liveDeps, liveGen))
      }
    })
}

/** Watches the library and settings; grades ungraded papers one at a time, newest first; returns a stop function. */
export function startGrader(deps: GraderDeps = defaultDeps): () => void {
  const gen = ++generation
  active = { deps, gen }
  const stop = effect(() => {
    library.value
    sidecarRevision.value
    settings.value
    hostGraderProvider.value
    schedulePass(deps, gen)
  })
  return () => {
    stop()
    generation++
    if (active?.gen === gen) {
      active = null
      rerun = false
    }
  }
}

/** True when a host or an API key can grade; reactive when read in a component. */
export function canGrade(): boolean {
  return Boolean(settings.value.anthropicApiKey) || hostGraderProvider.value() !== null
}

/** The paired host's skill hash, null when none; reactive when read in a component. */
export function hostSkill(): string | null {
  return hostSkillHash.value()
}

/** Grades one paper now, replacing any note. */
export function gradeNow(pdfId: string, deps: GraderDeps = defaultDeps): Promise<VerdictNote> {
  return gradeQueued(pdfId, deps)
}

/** Every paper without a note, regardless of date (the back catalogue). */
export async function ungradedPapers(): Promise<string[]> {
  const index = library.peek()
  if (!index) return []
  const ids: string[] = []
  for (const id of Object.keys(index.papers)) {
    if (index.verdicts?.[id] || (await loadVerdict(id))) continue
    ids.push(id)
  }
  return ids
}

// Grades each id in turn; failures are recorded, not thrown.
async function gradeAll(ids: string[], deps: GraderDeps): Promise<number> {
  let count = 0
  for (const id of ids) {
    try {
      await gradeQueued(id, deps)
      count++
    } catch (err) {
      gradeErrors.value = { ...gradeErrors.peek(), [id]: messageOf(err) }
    }
  }
  return count
}

/** Grades the back catalogue one at a time; resolves with the count graded. */
export async function gradeUngraded(deps: GraderDeps = defaultDeps): Promise<number> {
  return gradeAll(await ungradedPapers(), deps)
}

/** Papers whose note's skill hash differs from the current one. */
export async function outdatedPapers(currentSkill: string): Promise<string[]> {
  const index = library.peek()
  if (!index) return []
  const ids: string[] = []
  for (const id of Object.keys(index.papers)) {
    const note = await loadVerdict(id)
    if (note && isOutdated(note, currentSkill)) ids.push(id)
  }
  return ids
}

export async function regradeOutdated(deps: GraderDeps = defaultDeps): Promise<number> {
  return gradeAll(await outdatedPapers(await currentSkillHash()), deps)
}
