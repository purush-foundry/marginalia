// @vitest-environment node
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRunner, ENDED_MESSAGE, looksLikeNote, type AgentOptions, type AgentSession } from './agent'
import { paperDir, readSessions, savePaper } from './papers'
import type { HostEvent } from './protocol'

type FakeCall = {
  prompt: unknown
  options: Record<string, any>
  sent: any[]
  setModel: ReturnType<typeof vi.fn>
  interrupt: ReturnType<typeof vi.fn>
}

const sdk = vi.hoisted(() => {
  const state = { calls: [] as FakeCall[], reply: 'Hello there.', failTurn: false }
  const turn = (sessionId: string) => [
    { type: 'system', subtype: 'init', session_id: sessionId },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: state.reply } } },
    { type: 'assistant', message: { content: [{ type: 'text', text: state.reply }] } },
    state.failTurn
      ? { type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['max turns'] }
      : { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, duration_ms: 5, num_turns: 1 },
  ]
  // Records each call and yields one scripted turn per user message (or once for a string prompt).
  function query({ prompt, options }: { prompt: unknown; options: Record<string, any> }) {
    const call: FakeCall = { prompt, options, sent: [], setModel: vi.fn(async () => {}), interrupt: vi.fn(async () => {}) }
    state.calls.push(call)
    const id = options.resume ?? options.sessionId ?? 'one-shot'
    const gen = (async function* () {
      if (typeof prompt === 'string') {
        yield* turn(id)
      } else {
        for await (const msg of prompt as AsyncIterable<unknown>) {
          call.sent.push(msg)
          yield* turn(id)
          if (state.failTurn) break
        }
      }
      if (state.failTurn) throw new Error('process exited')
    })()
    return Object.assign(gen, { setModel: call.setModel, interrupt: call.interrupt })
  }
  return { state, query }
})

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: sdk.query }))

const NOTE = '---\nverdict: skim\nconfidence: medium\n---\n\nWorth a quick pass.'

let root: string
let repoDir: string
let opts: AgentOptions

beforeEach(async () => {
  sdk.state.calls = []
  sdk.state.reply = 'Hello there.'
  sdk.state.failTurn = false
  root = await mkdtemp(path.join(os.tmpdir(), 'mg-agent-root-'))
  repoDir = await mkdtemp(path.join(os.tmpdir(), 'mg-agent-repo-'))
  await mkdir(path.join(repoDir, 'skills', 'worth-reading'), { recursive: true })
  await writeFile(path.join(repoDir, 'skills', 'worth-reading', 'SKILL.md'), '# skill v1\n')
  await savePaper(root, 'p1', { name: 'p1.pdf', title: 'P1', pages: [{ n: 1, text: 'Intro text' }, { n: 2, text: 'Method' }], pdf: '' })
  opts = { root, repoDir, model: 'claude-opus-5-5', effort: 'medium', allowBash: false, readDirs: ['/data/papers'], skillHash: 'start', auth: 'none' }
})

// Reads events until the predicate matches, returning everything read.
async function readUntil(events: AsyncIterator<HostEvent>, stop: (e: HostEvent) => boolean): Promise<HostEvent[]> {
  const out: HostEvent[] = []
  for (;;) {
    const next = await events.next()
    if (next.done) return out
    out.push(next.value)
    if (stop(next.value)) return out
  }
}

async function collect(events: AsyncIterable<HostEvent>): Promise<HostEvent[]> {
  const out: HostEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

const textOf = (msg: any): string =>
  typeof msg.message.content === 'string'
    ? msg.message.content
    : msg.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')

describe('openSession', () => {
  it('passes the session options to query', async () => {
    const runner = createRunner(opts)
    const session = await runner.openSession('p1', 'abc', false)
    const o = sdk.state.calls[0].options
    expect(o.cwd).toBe(paperDir(root, 'p1'))
    expect(o.plugins[0]).toEqual({ type: 'local', path: repoDir })
    expect(o.settingSources).toEqual([])
    expect(o.tools).toEqual(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Write', 'Edit', 'Skill'])
    expect(o.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill'])
    expect(o.hooks.PreToolUse[0]).toMatchObject({ matcher: 'Read|Glob|Grep|Write|Edit|NotebookEdit|Bash', onFailure: 'block' })
    expect(o.hooks.PreToolUse[0].timeout).toBeGreaterThan(0)
    expect(o.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' })
    expect(o.systemPrompt.append).toContain('paper agent inside Marginalia')
    expect(o.systemPrompt.append).toContain('The folders the host was started with are readable: /data/papers;')
    expect(o).toMatchObject({ permissionMode: 'default', model: 'claude-opus-5-5', effort: 'medium', includePartialMessages: true, maxTurns: 40, maxBudgetUsd: 2 })
    expect(o.resume).toBe('abc')
    expect(session.id).toBe('abc')
    session.close()
  })

  it('gives a new session its own id as the SDK session id', async () => {
    const session = await createRunner(opts).openSession('p1', null, false)
    expect(sdk.state.calls[0].options.sessionId).toBe(session.id)
    expect(sdk.state.calls[0].options.resume).toBeUndefined()
    session.close()
  })

  it('lets Bash past the fence only with allowBash', async () => {
    const bashInput = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }
    const signal = new AbortController().signal
    ;(await createRunner(opts).openSession('p1', null, false)).close()
    ;(await createRunner({ ...opts, allowBash: true }).openSession('p1', null, false)).close()
    const [off, on] = sdk.state.calls.map((c) => c.options)
    expect(off.tools).not.toContain('Bash')
    expect(off.allowedTools).not.toContain('Bash')
    expect(on.tools).toContain('Bash')
    expect(on.allowedTools).toContain('Bash')
    expect((await off.hooks.PreToolUse[0].hooks[0](bashInput, 't1', { signal })).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(await on.hooks.PreToolUse[0].hooks[0](bashInput, 't1', { signal })).toEqual({})
    const edit = { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/tmp/x.md' } }
    expect((await on.hooks.PreToolUse[0].hooks[0](edit, 't2', { signal })).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('lets the hook read the repo skills and the owner folders', async () => {
    const owner = await mkdtemp(path.join(os.tmpdir(), 'mg-agent-owner-'))
    await writeFile(path.join(owner, 'a.pdf'), 'x')
    ;(await createRunner({ ...opts, readDirs: [owner] }).openSession('p1', null, false)).close()
    const hook = sdk.state.calls[0].options.hooks.PreToolUse[0].hooks[0]
    const signal = new AbortController().signal
    const read = (file_path: string) => hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path } }, 't', { signal })
    expect(await read(path.join(owner, 'a.pdf'))).toEqual({})
    expect(await read(path.join(repoDir, 'skills', 'worth-reading', 'SKILL.md'))).toEqual({})
    expect((await read(path.join(repoDir, 'package.json'))).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('resumes the stored session id and omits it when fresh', async () => {
    const runner = createRunner(opts)
    const first = await runner.openSession('p1', null, false)
    expect(sdk.state.calls[0].options.resume).toBeUndefined()
    const events = first.events[Symbol.asyncIterator]()
    first.send({ text: 'hi' })
    await readUntil(events, (e) => e.type === 'turn_end')
    expect((await readSessions(root)).p1).toBe(first.id)
    first.close()

    ;(await runner.openSession('p1', null, false)).close()
    expect(sdk.state.calls[1].options.resume).toBe(first.id)
    ;(await runner.openSession('p1', null, true)).close()
    expect(sdk.state.calls[2].options.resume).toBeUndefined()
  })

  it('prepends the paper to the first message of a new session only', async () => {
    const runner = createRunner(opts)
    const session = await runner.openSession('p1', null, false)
    const events = session.events[Symbol.asyncIterator]()
    session.send({ text: 'What is new?', quote: { text: 'Intro text', page: 1 } })
    const turn = await readUntil(events, (e) => e.type === 'turn_end')
    expect(turn[0]).toEqual({ type: 'turn_start' })
    expect(turn).toContainEqual({ type: 'text', delta: 'Hello there.' })
    session.send({ text: 'And then?', image: 'iVBORw0KGgo=' })
    await readUntil(events, (e) => e.type === 'turn_end')
    session.close()

    const [firstMsg, secondMsg] = sdk.state.calls[0].sent
    const first = textOf(firstMsg)
    expect(first).toContain('<paper pages="2">')
    expect(first).toContain('The paper above is the one we are discussing.')
    expect(first).toContain('> "Intro text" (p. 1)\n')
    expect(first.endsWith('What is new?')).toBe(true)
    expect(firstMsg).toMatchObject({ type: 'user', parent_tool_use_id: null, message: { role: 'user' } })

    expect(textOf(secondMsg)).toBe('And then?')
    expect(secondMsg.message.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } })
  })

  it('does not resend the paper into a resumed session', async () => {
    const runner = createRunner(opts)
    const session = await runner.openSession('p1', 'abc', false)
    const events = session.events[Symbol.asyncIterator]()
    session.send({ text: 'Again' })
    await readUntil(events, (e) => e.type === 'turn_end')
    session.close()
    expect(textOf(sdk.state.calls[0].sent[0])).toBe('Again')
  })

  it('routes /model to setModel instead of the conversation', async () => {
    const runner = createRunner(opts)
    const session = await runner.openSession('p1', null, false)
    session.send({ text: '/model claude-fable-5-1' })
    await vi.waitFor(() => expect(sdk.state.calls[0].setModel).toHaveBeenCalledWith('claude-fable-5-1'))
    expect(sdk.state.calls[0].sent).toEqual([])
    session.close()
  })

  it('reports a dead session on send and does not throw on interrupt', async () => {
    sdk.state.failTurn = true
    const session = (await createRunner(opts).openSession('p1', null, false)) as AgentSession
    const events = session.events[Symbol.asyncIterator]()
    session.send({ text: 'hi' })
    const turn = await readUntil(events, (e) => e.type === 'error')
    await vi.waitFor(() => expect(session.ended).toBe(true))
    session.send({ text: 'still there?' })
    expect((await events.next()).value).toEqual({ type: 'error', message: ENDED_MESSAGE })
    await expect(session.interrupt()).resolves.toBeUndefined()
    session.close()
    expect(turn.filter((e) => e.type === 'error')).toEqual([{ type: 'error', message: 'max turns' }])
    expect(await collect(session.events)).toEqual([])
  })

  it('ends the event stream on close', async () => {
    const runner = createRunner(opts)
    const session = await runner.openSession('p1', null, false)
    session.close()
    expect(await collect(session.events)).toEqual([])
  })

  it('allows writes only inside the paper folder', async () => {
    const runner = createRunner(opts)
    ;(await runner.openSession('p1', null, false)).close()
    const { canUseTool, hooks } = sdk.state.calls[0].options
    const signal = new AbortController().signal
    const inside = { file_path: path.join(paperDir(root, 'p1'), 'notes.md'), content: 'x' }
    expect(await canUseTool('Write', inside, { signal })).toEqual({ behavior: 'allow', updatedInput: inside })
    expect((await canUseTool('Write', { file_path: '/tmp/x.md' }, { signal })).behavior).toBe('deny')
    expect((await canUseTool('Write', { file_path: path.join(paperDir(root, 'p1'), '..', 'x.md') }, { signal })).behavior).toBe('deny')
    expect((await canUseTool('WebFetch', { url: 'https://x' }, { signal })).behavior).toBe('deny')
    const out = await hooks.PreToolUse[0].hooks[0]({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/tmp/x.md' } }, 't1', { signal })
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
  })
})

describe('verdict', () => {
  it('ends with the note for a valid answer', async () => {
    sdk.state.reply = NOTE
    const events = await collect(createRunner(opts).verdict('p1'))
    expect(events.at(-1)).toEqual({ type: 'note', markdown: NOTE })
    const call = sdk.state.calls[0]
    expect(call.prompt).toMatch(/^\/marginalia:worth-reading\n\n<paper pages="2">/)
    expect(call.options.tools).not.toContain('Write')
    expect(call.options.tools).not.toContain('Edit')
    expect(call.options.allowedTools).not.toContain('Write')
    expect(call.options.maxTurns).toBe(20)
    expect(call.options.resume).toBeUndefined()
    const inside = { file_path: path.join(paperDir(root, 'p1'), 'notes.md') }
    expect((await call.options.canUseTool('Write', inside, { signal: new AbortController().signal })).behavior).toBe('deny')
  })

  it('reports one error when the run fails after an error result', async () => {
    sdk.state.failTurn = true
    const events = await collect(createRunner(opts).verdict('p1'))
    expect(events.filter((e) => e.type === 'error')).toEqual([{ type: 'error', message: 'max turns' }])
  })

  it('ends with an error for an answer that is not a note', async () => {
    sdk.state.reply = 'I think you should read it.'
    const events = await collect(createRunner(opts).verdict('p1'))
    expect(events.at(-1)).toEqual({ type: 'error', message: 'the agent did not produce a valid note' })
  })
})

describe('looksLikeNote', () => {
  it('accepts front matter with a known verdict', () => {
    expect(looksLikeNote(NOTE)).toBe(true)
    expect(looksLikeNote('---\nverdict: "read"\n---\nbody')).toBe(true)
  })

  it('rejects missing front matter or an unknown verdict', () => {
    expect(looksLikeNote('verdict: read')).toBe(false)
    expect(looksLikeNote('---\nverdict: maybe\n---\n')).toBe(false)
    expect(looksLikeNote('---\nconfidence: high\n---\n')).toBe(false)
  })
})

describe('status and paperReady', () => {
  it('reports a 12-hex skill hash re-read from disk', async () => {
    const runner = createRunner(opts)
    const before = runner.status()
    expect(before.skill).toMatch(/^[0-9a-f]{12}$/)
    expect(before).toMatchObject({ model: 'claude-opus-5-5', auth: 'none', cwd: root })
    await writeFile(path.join(repoDir, 'skills', 'worth-reading', 'SKILL.md'), '# skill v2\n')
    expect(runner.status().skill).not.toBe(before.skill)
  })

  it('is ready only once paper.txt exists', async () => {
    const runner = createRunner(opts)
    expect(await runner.paperReady('p1')).toBe(true)
    expect(await runner.paperReady('nope')).toBe(false)
  })
})
