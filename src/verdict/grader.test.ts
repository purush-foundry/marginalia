import { signal } from '@preact/signals'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, settings } from '../app/settings'
import type { library } from '../drive/library'
type LibraryIndex = NonNullable<typeof library.value>
import type { VerdictNote } from './note'
import type { PaperInput } from './runner'

const lib = vi.hoisted(() => ({
  library: null as unknown,
  sidecarRevision: null as unknown,
  notes: new Map<string, unknown>(),
  remote: new Set<string>(),
  saved: [] as string[],
}))

vi.mock('../drive/library', async () => {
  const { signal: sig } = await import('@preact/signals')
  lib.library = sig(null)
  lib.sidecarRevision = sig(0)
  return {
    library: lib.library,
    sidecarRevision: lib.sidecarRevision,
    loadVerdict: vi.fn(async (id: string) => lib.notes.get(id) ?? null),
    saveVerdict: vi.fn((id: string, note: unknown) => {
      lib.notes.set(id, note)
      lib.saved.push(id)
    }),
    hasRemoteVerdict: vi.fn(async (id: string) => lib.remote.has(id)),
    syncLibrary: vi.fn(async () => {}),
  }
})

import {
  currentSkillHash,
  gradeErrors,
  gradeNow,
  gradeUngraded,
  grading,
  outdatedPapers,
  regradeOutdated,
  setHostSkillHash,
  startGrader,
  ungradedPapers,
  type GraderDeps,
} from './grader'
import { skillHash, SKILL_TEXT } from './skill'

const libSig = lib.library as ReturnType<typeof signal<LibraryIndex | null>>
let counter = 0
const uid = () => `p${++counter}`

function note(skill = 'h1'): VerdictNote {
  return { verdict: 'read', confidence: 'high', readTime: '', oneLine: '', topics: [], skill, model: 'm', generated: 'g', body: '' }
}

function setPapers(papers: Record<string, string>, verdicts: string[] = []) {
  libSig.value = {
    papers: Object.fromEntries(Object.entries(papers).map(([id, t]) => [id, { id, name: id, modifiedTime: t }])),
    verdicts: Object.fromEntries(verdicts.map((id) => [id, { id }])),
  } as unknown as LibraryIndex
}

const paper = async (pdfId: string): Promise<PaperInput> => ({ pdfId, name: pdfId, title: null, pages: [], bytes: new ArrayBuffer(0) })
const tick = () => new Promise((r) => setTimeout(r, 5))

function deferredGrader() {
  const calls: { id: string; resolve: (n?: VerdictNote) => void; reject: (e: Error) => void }[] = []
  const grader = (p: PaperInput) =>
    new Promise<VerdictNote>((resolve, reject) => {
      calls.push({ id: p.pdfId, resolve: (n = note()) => resolve(n), reject })
    })
  return { calls, grader }
}

beforeEach(() => {
  lib.notes.clear()
  lib.remote.clear()
  lib.saved.length = 0
  gradeErrors.value = {}
  grading.value = null
  libSig.value = null
  settings.value = { ...DEFAULT_SETTINGS, gradeOnThisDevice: true, gradingSince: 0, anthropicApiKey: 'k' }
  setHostSkillHash(() => null)
})

describe('startGrader', () => {
  it('grades new papers newest first, one at a time', async () => {
    const [a, b] = [uid(), uid()]
    setPapers({ [a]: '2026-01-01T00:00:00Z', [b]: '2026-02-01T00:00:00Z' })
    const d = deferredGrader()
    const deps: GraderDeps = { host: () => null, direct: () => d.grader, paper }
    const stop = startGrader(deps)
    await tick()
    expect(d.calls.map((c) => c.id)).toEqual([b])
    expect(grading.value).toBe(b)
    d.calls[0].resolve()
    await tick()
    expect(d.calls.map((c) => c.id)).toEqual([b, a])
    d.calls[1].resolve()
    await tick()
    expect(lib.saved).toEqual([b, a])
    expect(grading.value).toBeNull()
    stop()
  })

  it('leaves papers older than gradingSince alone but counts them as ungraded', async () => {
    const [old, fresh] = [uid(), uid()]
    settings.value = { ...settings.value, gradingSince: Date.parse('2026-01-15T00:00:00Z') }
    setPapers({ [old]: '2026-01-01T00:00:00Z', [fresh]: '2026-02-01T00:00:00Z' })
    const d = deferredGrader()
    const stop = startGrader({ host: () => null, direct: () => d.grader, paper })
    await tick()
    d.calls[0]?.resolve()
    await tick()
    expect(d.calls.map((c) => c.id)).toEqual([fresh])
    expect(await ungradedPapers()).toContain(old)
    stop()
  })

  it('skips papers that already have a note, an index entry or a remote verdict', async () => {
    const [local, indexed, remote] = [uid(), uid(), uid()]
    lib.notes.set(local, note())
    lib.remote.add(remote)
    setPapers({ [local]: '2026-03-01T00:00:00Z', [indexed]: '2026-03-02T00:00:00Z', [remote]: '2026-03-03T00:00:00Z' }, [indexed])
    const d = deferredGrader()
    const stop = startGrader({ host: () => null, direct: () => d.grader, paper })
    await tick()
    expect(d.calls).toEqual([])
    expect(lib.saved).toEqual([])
    stop()
  })

  it('records a failure and does not retry it', async () => {
    const [a, b] = [uid(), uid()]
    setPapers({ [a]: '2026-03-01T00:00:00Z', [b]: '2026-02-01T00:00:00Z' })
    const calls: string[] = []
    const direct = async (p: PaperInput) => {
      calls.push(p.pdfId)
      if (p.pdfId === a) throw new Error('boom')
      return note()
    }
    const stop = startGrader({ host: () => null, direct: () => direct, paper })
    await tick()
    libSig.value = { ...libSig.value! }
    await tick()
    expect(gradeErrors.value[a]).toBe('boom')
    expect(calls).toEqual([a, b])
    stop()
  })

  it('prefers the host grader when available', async () => {
    const a = uid()
    setPapers({ [a]: '2026-03-01T00:00:00Z' })
    const host = vi.fn(async () => note('host'))
    const direct = vi.fn(async () => note('direct'))
    const stop = startGrader({ host: () => host, direct: () => direct, paper })
    await tick()
    expect(host).toHaveBeenCalledTimes(1)
    expect(direct).not.toHaveBeenCalled()
    stop()
  })

  it('falls back to direct when the host fails, without recording an error', async () => {
    const a = uid()
    setPapers({ [a]: '2026-03-01T00:00:00Z' })
    const host = vi.fn(async () => {
      throw new Error('host down')
    })
    const direct = vi.fn(async () => note('direct'))
    const stop = startGrader({ host: () => host, direct: () => direct, paper })
    await tick()
    expect(direct).toHaveBeenCalledTimes(1)
    expect(gradeErrors.value[a]).toBeUndefined()
    expect(lib.saved).toEqual([a])
    stop()
  })

  it('grades nothing when the device toggle is off', async () => {
    settings.value = { ...settings.value, gradeOnThisDevice: false }
    setPapers({ [uid()]: '2026-03-01T00:00:00Z' })
    const direct = vi.fn(async () => note())
    const stop = startGrader({ host: () => null, direct: () => direct, paper })
    await tick()
    expect(direct).not.toHaveBeenCalled()
    stop()
  })
})

describe('one lane', () => {
  it('queues a manual grade behind a running automatic pass', async () => {
    const [a, b] = [uid(), uid()]
    setPapers({ [a]: '2026-03-01T00:00:00Z' })
    const d = deferredGrader()
    const deps: GraderDeps = { host: () => null, direct: () => d.grader, paper }
    const stop = startGrader(deps)
    await tick()
    const manual = gradeNow(b, deps)
    await tick()
    expect(d.calls.map((c) => c.id)).toEqual([a])
    d.calls[0].resolve()
    await tick()
    expect(d.calls.map((c) => c.id)).toEqual([a, b])
    d.calls[1].resolve()
    await manual
    stop()
  })

  it('shares the in-flight result when the paper is already being graded', async () => {
    const a = uid()
    setPapers({ [a]: '2026-03-01T00:00:00Z' })
    const d = deferredGrader()
    const deps: GraderDeps = { host: () => null, direct: () => d.grader, paper }
    const stop = startGrader(deps)
    await tick()
    const manual = gradeNow(a, deps)
    d.calls[0].resolve()
    await manual
    expect(d.calls).toHaveLength(1)
    stop()
  })

  it('stops chained passes when disposed', async () => {
    const [a, b] = [uid(), uid()]
    setPapers({ [a]: '2026-03-01T00:00:00Z', [b]: '2026-02-01T00:00:00Z' })
    const d = deferredGrader()
    const stop = startGrader({ host: () => null, direct: () => d.grader, paper })
    await tick()
    stop()
    d.calls[0].resolve()
    await tick()
    expect(d.calls).toHaveLength(1)
  })

  it('leaves gradeErrors empty when the remote check throws', async () => {
    const a = uid()
    setPapers({ [a]: '2026-03-01T00:00:00Z' })
    const lib2 = await import('../drive/library')
    vi.mocked(lib2.hasRemoteVerdict).mockRejectedValueOnce(new Error('signed out'))
    const direct = vi.fn(async () => note())
    const stop = startGrader({ host: () => null, direct: () => direct, paper })
    await tick()
    expect(gradeErrors.value).toEqual({})
    expect(direct).not.toHaveBeenCalled()
    stop()
  })
})

describe('back catalogue and regrading', () => {
  it('gradeNow throws on failure and clears grading', async () => {
    const a = uid()
    await expect(gradeNow(a, { host: () => null, direct: () => async () => { throw new Error('no') }, paper })).rejects.toThrow('no')
    expect(grading.value).toBeNull()
  })

  it('gradeUngraded grades the back catalogue and returns the count', async () => {
    const [a, b, c] = [uid(), uid(), uid()]
    lib.notes.set(c, note())
    setPapers({ [a]: '2020-01-01T00:00:00Z', [b]: '2020-01-02T00:00:00Z', [c]: '2020-01-03T00:00:00Z' })
    const direct = vi.fn(async () => note())
    expect(await gradeUngraded({ host: () => null, direct: () => direct, paper })).toBe(2)
    expect(lib.saved.sort()).toEqual([a, b].sort())
  })

  it('outdatedPapers lists only notes with another hash; regradeOutdated regrades them', async () => {
    const [a, b, c] = [uid(), uid(), uid()]
    lib.notes.set(a, note('old'))
    lib.notes.set(b, note('new'))
    setPapers({ [a]: '2020-01-01T00:00:00Z', [b]: '2020-01-02T00:00:00Z', [c]: '2020-01-03T00:00:00Z' })
    expect(await outdatedPapers('new')).toEqual([a])
    setHostSkillHash(() => 'new')
    const direct = vi.fn(async () => note('new'))
    expect(await regradeOutdated({ host: () => null, direct: () => direct, paper })).toBe(1)
    expect(lib.saved).toEqual([a])
  })

  it('currentSkillHash prefers the host hash, else the bundled skill', async () => {
    expect(await currentSkillHash()).toBe(await skillHash(SKILL_TEXT))
    setHostSkillHash(() => 'hosthash')
    expect(await currentSkillHash()).toBe('hosthash')
  })
})
