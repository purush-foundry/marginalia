import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostEvent } from '../../host/src/protocol.ts'
import type { AnnotationStore } from '../annot/store.ts'
import type { Thread } from '../types.ts'
import * as host from './host.ts'
import { Terminal, type TerminalProps } from './Terminal.tsx'

vi.mock('./host', async () => {
  const { signal } = await import('@preact/signals')
  return {
    hostState: signal({ status: 'ready', info: { version: '0.1.0', model: 'opus 5.5', skill: 'h', auth: 'none', cwd: '/' } }),
    uploadPaper: vi.fn(async () => {}),
    openSession: vi.fn(),
    sessionEvents: vi.fn(),
    sendMessage: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
  }
})

// A pushable event stream that ends on close() or abort.
function stream() {
  const queue: (HostEvent | null)[] = []
  let wake: (() => void) | null = null
  const kick = () => {
    wake?.()
    wake = null
  }
  return {
    push(ev: HostEvent) {
      queue.push(ev)
      kick()
    },
    close() {
      queue.push(null)
      kick()
    },
    async *iterate(signal: AbortSignal): AsyncGenerator<HostEvent> {
      signal.addEventListener('abort', kick)
      for (;;) {
        if (signal.aborted) return
        const ev = queue.shift()
        if (ev === null) return
        if (ev) yield ev
        else await new Promise<void>((r) => (wake = r))
      }
    },
  }
}

let root: HTMLElement
let streams: ReturnType<typeof stream>[]
let sessions: number

function thread(over: Partial<Thread> = {}): Thread {
  return {
    kind: 'thread',
    id: 't1',
    createdAt: 1,
    updatedAt: 1,
    anchor: { page: 0, boxes: [] },
    model: 'agent',
    session: 'old-session',
    messages: [
      { role: 'user', content: 'What is eq 3?', createdAt: 1 },
      { role: 'assistant', content: 'Scaled attention.', createdAt: 2 },
    ],
    ...over,
  }
}

function mount(over: Partial<TerminalProps> = {}) {
  const store = { upsertThread: vi.fn() } as unknown as AnnotationStore
  const props: TerminalProps = {
    pdfId: 'pdf1',
    title: 'Attention Is All You Need',
    store,
    thread: null,
    paper: vi.fn(async () => ({ name: 'a.pdf', title: 'Attention', pages: [], bytes: new ArrayBuffer(1) })),
    attach: null,
    live: true,
    onCite: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  root = document.createElement('div')
  document.body.append(root)
  render(<Terminal {...props} />, root)
  return { props, upsert: store.upsertThread as ReturnType<typeof vi.fn> }
}

function input(): HTMLTextAreaElement {
  const el = root.querySelector('textarea')
  if (!el) throw new Error('no textarea')
  return el
}

function type(text: string) {
  const el = input()
  el.value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function key(k: string, opts: KeyboardEventInit = {}) {
  input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }))
}

async function send(text: string) {
  type(text)
  key('Enter')
}

async function ready(n = 1) {
  await vi.waitFor(() => expect(streams.length).toBe(n))
}

beforeEach(() => {
  streams = []
  sessions = 0
  vi.mocked(host.openSession).mockImplementation(async () => `s${++sessions}`)
  vi.mocked(host.sessionEvents).mockImplementation((_id, signal) => {
    const s = stream()
    streams.push(s)
    return s.iterate(signal)
  })
})

afterEach(() => {
  render(null, root)
  root.remove()
  vi.clearAllMocks()
})

describe('Terminal', () => {
  it('renders the header with the title, model and host version', async () => {
    mount()
    expect(root.textContent).toContain('✻ Marginalia agent · Attention Is All You Need')
    expect(root.textContent).toContain('opus 5.5 · host 0.1.0')
  })

  it("shows a given thread's turns before any event and resumes its session", async () => {
    const { props } = mount({ thread: thread() })
    expect(root.textContent).toContain('What is eq 3?')
    expect(root.textContent).toContain('Scaled attention.')
    await ready()
    expect(host.uploadPaper).toHaveBeenCalledWith('pdf1', await vi.mocked(props.paper).mock.results[0].value)
    expect(host.openSession).toHaveBeenCalledWith('pdf1', 'old-session', false)
  })

  it('stores a changed session id on the thread', async () => {
    const { upsert } = mount({ thread: thread() })
    await ready()
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', session: 's1' }))
  })

  it('sends typed text, shows the prompt line and streams text and tools under ⏺', async () => {
    mount()
    await ready()
    await send('how does eq 3 relate?')
    await vi.waitFor(() => expect(host.sendMessage).toHaveBeenCalledWith('s1', { text: 'how does eq 3 relate?' }))
    expect(root.querySelector('.mg-term-prompt')?.textContent).toBe('>how does eq 3 relate?')
    expect(root.textContent).toContain('esc to interrupt')

    streams[0].push({ type: 'turn_start' })
    streams[0].push({ type: 'text', delta: 'I will check.' })
    streams[0].push({ type: 'tool_start', id: 'a', name: 'Read', input: { file_path: '/p/paper.txt' } })
    streams[0].push({ type: 'tool_end', id: 'a', ok: true, summary: 'Read 412 lines' })
    await vi.waitFor(() => expect(root.textContent).toContain('Read 412 lines'))
    const text = root.querySelector('.mg-term-text')!
    expect(text.querySelector('.mg-term-g')?.textContent).toBe('⏺')
    expect(text.textContent).toContain('I will check.')
    const tool = root.querySelector<HTMLButtonElement>('.mg-term-tool')!
    expect(tool.textContent).toContain('⏺Read(paper.txt)')
    expect(root.textContent).toContain('⎿  Read 412 lines')
    expect(root.querySelector('pre')).toBeNull()
    tool.click()
    await vi.waitFor(() => expect(root.querySelector('pre')?.textContent).toContain('"file_path": "/p/paper.txt"'))
  })

  it('upserts a finished turn as a Thread with both messages and the session', async () => {
    const { upsert } = mount()
    await ready()
    await send('q')
    streams[0].push({ type: 'turn_start' })
    streams[0].push({ type: 'text', delta: 'One.' })
    streams[0].push({ type: 'tool_start', id: 'a', name: 'Grep', input: { pattern: 'x' } })
    streams[0].push({ type: 'text', delta: 'Two.' })
    streams[0].push({ type: 'turn_end', costUsd: 0.05, durationMs: 10, numTurns: 1 })
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(2))
    const saved = upsert.mock.calls[1][0] as Thread
    expect(saved).toMatchObject({ kind: 'thread', model: 'agent', session: 's1', anchor: { page: 0, boxes: [] } })
    expect(saved.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'q'],
      ['assistant', 'One.\n\nTwo.'],
    ])
    expect(root.textContent).toContain('turn $0.05 · session $0.05')
    expect(root.textContent).not.toContain('esc to interrupt)')
  })

  it('Esc interrupts a running turn', async () => {
    mount()
    await ready()
    await send('q')
    await vi.waitFor(() => expect(host.sendMessage).toHaveBeenCalled())
    key('Escape')
    expect(host.interrupt).toHaveBeenCalledWith('s1')
  })

  it('/clear reopens a fresh session and starts a new Thread', async () => {
    const { upsert } = mount({ thread: thread() })
    await ready()
    await send('/clear')
    await ready(2)
    expect(host.openSession).toHaveBeenLastCalledWith('pdf1', null, true)
    expect(root.textContent).not.toContain('Scaled attention.')
    await send('fresh q')
    await vi.waitFor(() => expect(host.sendMessage).toHaveBeenCalledWith('s2', { text: 'fresh q' }))
    const saved = upsert.mock.calls.at(-1)![0] as Thread
    expect(saved.id).not.toBe('t1')
    expect(saved.session).toBe('s2')
    expect(saved.messages.map((m) => m.content)).toEqual(['fresh q'])
  })

  it('/paper asks for a re-read and /help lists the commands', async () => {
    mount()
    await ready()
    await send('/help')
    expect(root.textContent).toContain('/model <name>')
    expect(host.sendMessage).not.toHaveBeenCalled()
    await send('/paper')
    await vi.waitFor(() => expect(host.sendMessage).toHaveBeenCalledWith('s1', { text: 'Re-read paper.txt in full before answering.' }))
  })

  it('sends the attach chip as quote once, then drops it', async () => {
    mount({ attach: { text: 'scaled dot products', page: 4 } })
    await ready()
    expect(root.textContent).toContain('Attach: “scaled dot products” p. 4')
    await send('why?')
    await vi.waitFor(() => expect(host.sendMessage).toHaveBeenCalledWith('s1', { text: 'why?', quote: { text: 'scaled dot products', page: 4 } }))
    expect(root.textContent).not.toContain('Attach:')
    streams[0].push({ type: 'turn_end', costUsd: 0.01, durationMs: 1, numTurns: 1 })
    await vi.waitFor(() => expect(root.textContent).not.toContain('esc to interrupt)'))
    await send('and?')
    await vi.waitFor(() => expect(host.sendMessage).toHaveBeenLastCalledWith('s1', { text: 'and?' }))
  })

  it('walks the sent history with the arrow keys', async () => {
    mount()
    await ready()
    await send('/help')
    await send('/paper')
    key('ArrowUp')
    expect(input().value).toBe('/paper')
    key('ArrowUp')
    expect(input().value).toBe('/help')
    key('ArrowDown')
    expect(input().value).toBe('/paper')
    key('ArrowDown')
    expect(input().value).toBe('')
  })

  it('reports a lost connection when the stream ends mid-turn', async () => {
    mount()
    await ready()
    await send('q')
    streams[0].push({ type: 'turn_start' })
    streams[0].close()
    await vi.waitFor(() => expect(root.textContent).toContain('Connection to the host was lost'))
    expect(root.textContent).not.toContain('esc to interrupt)')
  })

  it('connects when live turns true on a mounted terminal', async () => {
    const { props } = mount({ live: false, thread: thread() })
    expect(root.querySelector('textarea')).toBeNull()
    render(<Terminal {...props} live />, root)
    await ready()
    expect(host.openSession).toHaveBeenCalledWith('pdf1', 'old-session', false)
    await send('now?')
    await vi.waitFor(() => expect(host.sendMessage).toHaveBeenCalledWith('s1', { text: 'now?' }))
  })

  it('a failed open says /clear retries, and /clear reconnects', async () => {
    vi.mocked(host.openSession).mockRejectedValueOnce(new Error('Agent host returned HTTP 500'))
    mount()
    await vi.waitFor(() => expect(root.textContent).toContain('Agent host returned HTTP 500 — /clear to retry'))
    await send('/clear')
    await ready()
    expect(host.openSession).toHaveBeenLastCalledWith('pdf1', null, true)
    await send('again')
    await vi.waitFor(() => expect(host.sendMessage).toHaveBeenCalledWith('s1', { text: 'again' }))
  })

  it('without a live host shows the pairing line and no input', async () => {
    mount({ live: false, thread: thread() })
    expect(root.textContent).toContain('Scaled attention.')
    expect(root.textContent).toContain('Pair the agent host on the laptop to continue')
    expect(root.querySelector('textarea')).toBeNull()
    await new Promise((r) => setTimeout(r, 10))
    expect(host.openSession).not.toHaveBeenCalled()
  })

  it('renders citations in assistant text as clickable', async () => {
    const { props } = mount({ live: false, thread: thread({ messages: [{ role: 'assistant', content: 'See "scale the dot products" (p. 4).', createdAt: 1 }] }) })
    root.querySelector<HTMLButtonElement>('button.cite')!.click()
    expect(props.onCite).toHaveBeenCalledWith(4, 'scale the dot products')
  })
})
