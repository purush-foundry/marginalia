import { signal } from '@preact/signals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('./runner', async (orig) => ({
  ...(await orig<typeof import('./runner')>()),
  paperInput: async (pdfId: string) => ({ pdfId, name: pdfId, title: null, pages: [], bytes: new ArrayBuffer(0) }),
}))

const host = vi.hoisted(() => ({ state: null as unknown, hostVerdict: vi.fn(), probeHost: vi.fn(), HostRunError: class HostRunError extends Error {} }))
vi.mock('../agent/host', async () => {
  const { signal: sig } = await import('@preact/signals')
  host.state = sig({ status: 'off' })
  return { hostState: host.state, hostVerdict: host.hostVerdict, probeHost: host.probeHost, HostRunError: host.HostRunError }
})

import type { HostState } from '../agent/host'
import { connectHostGrading as connectHost } from './hostGrader'
import {
  canGrade,
  currentSkillHash,
  gradeErrors,
  gradeNow,
  gradeUngraded,
  grading,
  HostUnavailableError,
  outdatedPapers,
  regradeOutdated,
  setHostSkillHash,
  startGrader as startLane,
  ungradedPapers,
  type GraderDeps,
} from './grader'
import { skillHash, SKILL_TEXT } from './skill'

const libSig = lib.library as ReturnType<typeof signal<LibraryIndex | null>>
const hostSig = host.state as ReturnType<typeof signal<HostState>>
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

type Call = { id: string; resolve: (n?: VerdictNote) => void; reject: (e: Error) => void }
const cleanups: (() => void)[] = []
const allCalls: Call[] = []

// Starts a grader that afterEach stops.
function startGrader(deps?: GraderDeps): () => void {
  const stop = startLane(deps)
  cleanups.push(stop)
  return stop
}

// Plugs the host grader in until afterEach unplugs it.
function connectHostGrading(): () => void {
  const unplug = connectHost()
  cleanups.push(unplug)
  return unplug
}

function deferredGrader() {
  const calls: Call[] = []
  const grader = (p: PaperInput) =>
    new Promise<VerdictNote>((resolve, reject) => {
      const call = { id: p.pdfId, resolve: (n = note()) => resolve(n), reject }
      calls.push(call)
      allCalls.push(call)
    })
  return { calls, grader }
}

// Stops every grader and resolves every deferred call until the lane is idle.
afterEach(async () => {
  for (const stop of cleanups.splice(0)) stop()
  for (let seen = -1; seen !== allCalls.length; ) {
    seen = allCalls.length
    for (const call of allCalls) call.resolve()
    await tick()
  }
  allCalls.length = 0
  hostSig.value = { status: 'off' }
})

beforeEach(() => {
  lib.notes.clear()
  lib.remote.clear()
  lib.saved.length = 0
  gradeErrors.value = {}
  grading.value = null
  libSig.value = null
  settings.value = { ...DEFAULT_SETTINGS, gradeOnThisDevice: true, gradingSince: 0, anthropicApiKey: 'k' }
  setHostSkillHash(() => null)
  host.probeHost.mockReset()
})

describe('startGrader', () => {
  it('grades new papers newest first, one at a time', async () => {
    const [a, b] = [uid(), uid()]
    setPapers({ [a]: '2026-01-01T00:00:00Z', [b]: '2026-02-01T00:00:00Z' })
    const d = deferredGrader()
    const deps: GraderDeps = { host: () => null, direct: () => d.grader, paper }
    const stop = startGrader(deps)
    await vi.waitFor(() => expect(d.calls.map((c) => c.id)).toEqual([b]))
    expect(grading.value).toBe(b)
    d.calls[0].resolve()
    await vi.waitFor(() => expect(d.calls.map((c) => c.id)).toEqual([b, a]))
    d.calls[1].resolve()
    await vi.waitFor(() => expect(lib.saved).toEqual([b, a]))
    await vi.waitFor(() => expect(grading.value).toBeNull())
    stop()
  })

  it('leaves papers older than gradingSince alone but counts them as ungraded', async () => {
    const [old, fresh] = [uid(), uid()]
    settings.value = { ...settings.value, gradingSince: Date.parse('2026-01-15T00:00:00Z') }
    setPapers({ [old]: '2026-01-01T00:00:00Z', [fresh]: '2026-02-01T00:00:00Z' })
    const d = deferredGrader()
    const stop = startGrader({ host: () => null, direct: () => d.grader, paper })
    await vi.waitFor(() => expect(d.calls).toHaveLength(1))
    d.calls[0].resolve()
    await vi.waitFor(() => expect(lib.saved).toEqual([fresh]))
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
    await vi.waitFor(() => expect(lib.saved).toEqual([b]))
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
    await vi.waitFor(() => expect(lib.saved).toEqual([a]))
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
    await vi.waitFor(() => expect(lib.saved).toEqual([a]))
    expect(direct).toHaveBeenCalledTimes(1)
    expect(gradeErrors.value[a]).toBeUndefined()
    stop()
  })

  it('an unreachable host with no direct grader ends the pass without recording errors and retries later', async () => {
    settings.value = { ...settings.value, anthropicApiKey: '' }
    const [a, b] = [uid(), uid()]
    setPapers({ [a]: '2026-03-01T00:00:00Z', [b]: '2026-02-01T00:00:00Z' })
    let up = false
    const host = vi.fn(async () => {
      if (!up) throw new HostUnavailableError('host down')
      return note('host')
    })
    const stop = startGrader({ host: () => host, direct: () => null, paper })
    await vi.waitFor(() => expect(host).toHaveBeenCalledTimes(1))
    await tick()
    expect(host).toHaveBeenCalledTimes(1)
    expect(gradeErrors.value).toEqual({})
    up = true
    libSig.value = { ...libSig.value! }
    await vi.waitFor(() => expect(lib.saved).toEqual([a, b]))
    expect(gradeErrors.value).toEqual({})
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
    await vi.waitFor(() => expect(d.calls).toHaveLength(1))
    const manual = gradeNow(b, deps)
    await tick()
    expect(d.calls.map((c) => c.id)).toEqual([a])
    d.calls[0].resolve()
    await vi.waitFor(() => expect(d.calls.map((c) => c.id)).toEqual([a, b]))
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
    await vi.waitFor(() => expect(d.calls).toHaveLength(1))
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
    await vi.waitFor(() => expect(d.calls).toHaveLength(1))
    stop()
    d.calls[0].resolve()
    await vi.waitFor(() => expect(lib.saved).toHaveLength(1))
    await tick()
    expect(d.calls).toHaveLength(1)
  })

  it('runs a pass for a restarted grader after the old pass finishes', async () => {
    const [a, b] = [uid(), uid()]
    setPapers({ [a]: '2026-03-01T00:00:00Z' })
    const d = deferredGrader()
    const deps: GraderDeps = { host: () => null, direct: () => d.grader, paper }
    const stop = startGrader(deps)
    await vi.waitFor(() => expect(d.calls).toHaveLength(1))
    stop()
    const stop2 = startGrader(deps)
    setPapers({ [a]: '2026-03-01T00:00:00Z', [b]: '2026-04-01T00:00:00Z' })
    d.calls[0].resolve()
    await vi.waitFor(() => expect(d.calls.map((c) => c.id)).toEqual([a, b]))
    d.calls[1].resolve()
    await vi.waitFor(() => expect(lib.saved).toEqual([a, b]))
    stop2()
  })

  it('leaves gradeErrors empty when the remote check throws', async () => {
    const a = uid()
    setPapers({ [a]: '2026-03-01T00:00:00Z' })
    const lib2 = await import('../drive/library')
    vi.mocked(lib2.hasRemoteVerdict).mockRejectedValueOnce(new Error('signed out'))
    const direct = vi.fn(async () => note())
    const stop = startGrader({ host: () => null, direct: () => direct, paper })
    await vi.waitFor(() => expect(lib2.hasRemoteVerdict).toHaveBeenCalledWith(a))
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

describe('host grading', () => {
  const ready: HostState = {
    status: 'ready',
    info: { version: '1', model: 'claude-host', skill: 'hosthash', auth: 'api-key', cwd: '/' },
  }
  const markdown = '---\nverdict: skim\nconfidence: low\none_line: Fine\ntopics: [a]\n---\nBody'

  beforeEach(() => {
    hostSig.value = { status: 'off' }
    host.hostVerdict.mockReset()
  })

  it('the host grades when ready', async () => {
    settings.value = { ...settings.value, anthropicApiKey: '' }
    const a = uid()
    setPapers({ [a]: '2026-03-01T00:00:00Z' })
    host.hostVerdict.mockResolvedValue(markdown)
    connectHostGrading()
    startGrader()
    await tick()
    expect(canGrade()).toBe(false)
    expect(host.hostVerdict).not.toHaveBeenCalled()
    hostSig.value = ready
    expect(canGrade()).toBe(true)
    await vi.waitFor(() => expect(lib.notes.get(a)).toBeDefined())
    expect(host.hostVerdict).toHaveBeenCalledWith(a, expect.objectContaining({ pdfId: a, name: a }))
    expect(lib.notes.get(a)).toMatchObject({ verdict: 'skim', oneLine: 'Fine', topics: ['a'], skill: 'hosthash', model: 'claude-host' })
    expect(await currentSkillHash()).toBe('hosthash')
    hostSig.value = { status: 'unreachable' }
    expect(canGrade()).toBe(false)
    expect(await currentSkillHash()).toBe(await skillHash(SKILL_TEXT))
  })

  it('a host note that does not parse is a clear error', async () => {
    settings.value = { ...settings.value, anthropicApiKey: '' }
    const a = uid()
    host.hostVerdict.mockResolvedValue('not a note')
    connectHostGrading()
    hostSig.value = ready
    await expect(gradeNow(a)).rejects.toThrow(/agent host's note could not be parsed/)
    expect(lib.saved).toEqual([])
    expect(host.probeHost).not.toHaveBeenCalled()
  })

  it('a host that dies mid-pass with no key records no errors, is probed, and grades once it is back', async () => {
    settings.value = { ...settings.value, anthropicApiKey: '' }
    const [a, b] = [uid(), uid()]
    setPapers({ [a]: '2026-03-01T00:00:00Z', [b]: '2026-02-01T00:00:00Z' })
    host.hostVerdict.mockRejectedValue(new TypeError('Failed to fetch'))
    host.probeHost.mockImplementation(async () => (hostSig.value = { status: 'unreachable' }))
    connectHostGrading()
    startGrader()
    hostSig.value = ready
    await vi.waitFor(() => expect(host.probeHost).toHaveBeenCalled())
    await tick()
    expect(host.hostVerdict).toHaveBeenCalledTimes(1)
    expect(gradeErrors.value).toEqual({})
    expect(canGrade()).toBe(false)
    host.hostVerdict.mockResolvedValue(markdown)
    hostSig.value = ready
    await vi.waitFor(() => expect(lib.saved).toEqual([a, b]))
    expect(gradeErrors.value).toEqual({})
  })

  it('a run the host finished with an error is recorded once, not probed and not retried', async () => {
    settings.value = { ...settings.value, anthropicApiKey: '' }
    const a = uid()
    setPapers({ [a]: '2026-03-01T00:00:00Z' })
    host.hostVerdict.mockRejectedValue(new host.HostRunError('max turns'))
    connectHostGrading()
    startGrader()
    hostSig.value = ready
    await vi.waitFor(() => expect(gradeErrors.value[a]).toBe('max turns'))
    libSig.value = { ...libSig.value! }
    await tick()
    expect(host.hostVerdict).toHaveBeenCalledTimes(1)
    expect(host.probeHost).not.toHaveBeenCalled()
  })

  it('a bad host note is recorded once, not probed and not retried', async () => {
    settings.value = { ...settings.value, anthropicApiKey: '' }
    const a = uid()
    setPapers({ [a]: '2026-03-01T00:00:00Z' })
    host.hostVerdict.mockResolvedValue('not a note')
    connectHostGrading()
    startGrader()
    hostSig.value = ready
    await vi.waitFor(() => expect(gradeErrors.value[a]).toMatch(/agent host's note could not be parsed/))
    libSig.value = { ...libSig.value! }
    await tick()
    expect(host.hostVerdict).toHaveBeenCalledTimes(1)
    expect(host.probeHost).not.toHaveBeenCalled()
  })

  it('a host with no Claude credentials is not plugged in', async () => {
    settings.value = { ...settings.value, anthropicApiKey: '' }
    const a = uid()
    setPapers({ [a]: '2026-03-01T00:00:00Z' })
    connectHostGrading()
    startGrader()
    hostSig.value = { status: 'ready', info: { ...ready.info, auth: 'none' } }
    await tick()
    expect(canGrade()).toBe(false)
    expect(host.hostVerdict).not.toHaveBeenCalled()
    expect(await currentSkillHash()).toBe(await skillHash(SKILL_TEXT))
  })
})
