// Claude-Code-style agent terminal: streams a host session, renders text and tool lines, saves turns to a Thread.
import { useEffect, useRef, useState } from 'preact/hooks'
import type { HostEvent, MessageBody } from '../../host/src/protocol.ts'
import { renderMarkdown } from '../ai/markdown.ts'
import type { AnnotationStore } from '../annot/store.ts'
import { newId, now } from '../lib/ids.ts'
import type { ChatMessage, Thread } from '../types.ts'
import { hostState, interrupt, openSession, sendMessage, sessionEvents, uploadPaper, type PaperSource } from './host.ts'
import { EMPTY, append, fromThread, reduce, toolLabel, turnText, type Line, type Transcript } from './transcript.ts'
import './terminal.css'

export interface TerminalProps {
  pdfId: string
  title: string
  store: AnnotationStore
  thread: Thread | null
  paper(): Promise<PaperSource>
  attach: { text: string; page: number } | null
  live: boolean
  onCite(page: number, quote: string): void
  onClose(): void
}

const WORDS = ['Thinking', 'Reading', 'Searching', 'Pondering', 'Working']
const WORD_SECONDS = 3
const STICK_PX = 40
const ATTACH_CHARS = 80
const PAPER_PROMPT = 'Re-read paper.txt in full before answering.'
const LOST = 'Connection to the host was lost'
const HELP = [
  '/clear          start a fresh session',
  '/model <name>   switch the model',
  '/paper          re-read the whole paper',
  '/help           list these commands',
].join('\n')

function usd(n: number): string {
  return '$' + n.toFixed(2)
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function short(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > ATTACH_CHARS ? `${t.slice(0, ATTACH_CHARS).trimEnd()}…` : t
}

function newThread(): Thread {
  const at = now()
  return { kind: 'thread', id: newId(), createdAt: at, updatedAt: at, anchor: { page: 0, boxes: [] }, model: 'agent', messages: [] }
}

function lastTurnCost(lines: Line[]): number {
  const turn = lines.findLast((l): l is Extract<Line, { kind: 'turn' }> => l.kind === 'turn')
  return turn?.costUsd ?? 0
}

export function Terminal(props: TerminalProps) {
  const [t, setT] = useState<Transcript>(() => (props.thread ? fromThread(props.thread) : EMPTY))
  const [attach, setAttach] = useState(props.attach)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [seconds, setSeconds] = useState(0)

  const tRef = useRef(t)
  const thread = useRef(props.thread)
  const session = useRef<string | null>(null)
  const ctl = useRef<AbortController | null>(null)
  const history = useRef<string[]>([])
  const histAt = useRef(0)
  const stick = useRef(true)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  function update(next: Transcript) {
    tRef.current = next
    setT(next)
  }

  function save(next: Thread) {
    thread.current = next
    props.store.upsertThread(next)
  }

  function addMessage(role: ChatMessage['role'], content: string) {
    const th = thread.current ?? newThread()
    save({ ...th, session: session.current ?? th.session, messages: [...th.messages, { role, content, createdAt: now() }] })
  }

  function apply(ev: HostEvent) {
    const next = reduce(tRef.current, ev)
    update(next)
    if (ev.type !== 'turn_end') return
    const text = turnText(next)
    if (text) addMessage('assistant', text)
  }

  // Uploads the paper, opens the session and feeds its events until aborted or the stream ends.
  async function connect(prev: string | null, fresh: boolean) {
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    session.current = null
    try {
      await uploadPaper(props.pdfId, await props.paper())
      const id = await openSession(props.pdfId, prev, fresh)
      if (c.signal.aborted) return
      session.current = id
      if (thread.current && thread.current.session !== id) save({ ...thread.current, session: id })
      for await (const ev of sessionEvents(id, c.signal)) apply(ev)
    } catch (err) {
      if (!c.signal.aborted) apply({ type: 'error', message: errorText(err) })
      return
    }
    if (!c.signal.aborted) apply({ type: 'error', message: LOST })
  }

  useEffect(() => {
    if (props.live) void connect(props.thread?.session ?? null, false)
    return () => ctl.current?.abort()
  }, [])

  useEffect(() => {
    setAttach(props.attach)
  }, [props.attach?.text, props.attach?.page])

  useEffect(() => {
    if (!t.busy) return
    const start = Date.now()
    setSeconds(0)
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [t.busy])

  useEffect(() => {
    const el = list.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [t])

  function setInput(value: string) {
    const el = input.current
    if (!el) return
    el.value = value
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  function post(body: MessageBody) {
    sendMessage(session.current!, body).catch((err: unknown) => apply({ type: 'error', message: errorText(err) }))
  }

  function submit() {
    const text = input.current?.value.trim() ?? ''
    if (!text || tRef.current.busy) return
    const local = text === '/help' || text === '/clear'
    if (!local && !session.current) return
    history.current.push(text)
    histAt.current = history.current.length
    setInput('')
    if (text === '/clear') {
      thread.current = null
      setExpanded(new Set())
      update(EMPTY)
      void connect(null, true)
    } else if (text === '/help') {
      update(append(append(tRef.current, { kind: 'prompt', text }), { kind: 'status', text: HELP }))
    } else if (text.startsWith('/model ')) {
      update(append(append(tRef.current, { kind: 'prompt', text }), { kind: 'status', text: `Switching to ${text.slice(7).trim()}` }))
      post({ text })
    } else {
      const body: MessageBody = { text: text === '/paper' ? PAPER_PROMPT : text }
      if (attach) body.quote = attach
      setAttach(null)
      update(append(tRef.current, { kind: 'prompt', text }, true))
      addMessage('user', text)
      post(body)
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const el = e.currentTarget as HTMLTextAreaElement
    const h = history.current
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (tRef.current.busy && session.current) interrupt(session.current).catch((err: unknown) => apply({ type: 'error', message: errorText(err) }))
      else setAttach(null)
    } else if (e.key === 'ArrowUp' && histAt.current > 0 && !el.value.slice(0, el.selectionStart).includes('\n')) {
      e.preventDefault()
      setInput(h[--histAt.current])
    } else if (e.key === 'ArrowDown' && histAt.current < h.length && !el.value.slice(el.selectionEnd).includes('\n')) {
      e.preventDefault()
      setInput(h[++histAt.current] ?? '')
    }
  }

  function toggle(id: string) {
    const next = new Set(expanded)
    if (!next.delete(id)) next.add(id)
    setExpanded(next)
  }

  function row(l: Line, i: number) {
    switch (l.kind) {
      case 'prompt':
        return (
          <div key={i} class="mg-term-row mg-term-prompt">
            <span class="mg-term-g">&gt;</span>
            <span class="mg-term-body">{l.text}</span>
          </div>
        )
      case 'text':
        return (
          <div key={i} class="mg-term-row mg-term-text">
            <span class="mg-term-g">⏺</span>
            <div class="mg-term-body mg-term-md">{renderMarkdown(l.md, props.onCite)}</div>
          </div>
        )
      case 'tool':
        return (
          <div key={i}>
            <button type="button" class="mg-term-row mg-term-tool" aria-expanded={expanded.has(l.id)} onClick={() => toggle(l.id)}>
              <span class={l.ok === false ? 'mg-term-g bad' : 'mg-term-g'}>⏺</span>
              <span class="mg-term-body">{toolLabel(l.name, l.input)}</span>
            </button>
            {l.summary !== undefined && <div class="mg-term-sub">{`⎿  ${l.summary}`}</div>}
            {expanded.has(l.id) && <pre class="mg-term-input">{JSON.stringify(l.input, null, 2)}</pre>}
          </div>
        )
      case 'status':
        return (
          <div key={i} class="mg-term-note">
            {l.text}
          </div>
        )
      case 'error':
        return (
          <div key={i} class="mg-term-row mg-term-error">
            <span class="mg-term-g">⏺</span>
            <span class="mg-term-body">{l.message}</span>
          </div>
        )
      case 'turn':
        return null
    }
  }

  const host = hostState.value
  return (
    <section class="mg-term">
      <header class="mg-term-head">
        <span class="mg-term-title">
          <span class="mg-term-star">✻</span> Marginalia agent · {props.title}
        </span>
        {host.status === 'ready' && (
          <span class="mg-term-meta">
            {host.info.model} · host {host.info.version}
          </span>
        )}
        <button type="button" class="mg-term-close" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </header>
      <div
        class="mg-term-log"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX
        }}
      >
        {t.lines.map(row)}
        {t.busy && (
          <div class="mg-term-status" aria-live="polite">
            <span class="mg-term-star">✻</span> {WORDS[Math.floor(seconds / WORD_SECONDS) % WORDS.length]}… ({seconds}s · esc to interrupt)
          </div>
        )}
      </div>
      {props.live ? (
        <div class="mg-term-foot-wrap">
          {attach && (
            <div class="mg-term-attach">
              <span>
                Attach: “{short(attach.text)}” p. {attach.page}
              </span>
              <button type="button" aria-label="Drop attachment" onClick={() => setAttach(null)}>
                ×
              </button>
            </div>
          )}
          <div class="mg-term-box" onClick={() => input.current?.focus()}>
            <span class="mg-term-g">&gt;</span>
            <textarea ref={input} rows={1} spellcheck={false} aria-label="Message the agent" onInput={(e) => setInput(e.currentTarget.value)} onKeyDown={onKeyDown} />
          </div>
          <footer class="mg-term-foot">
            <span>↑ history · / commands · esc interrupt</span>
            <span>
              turn {usd(lastTurnCost(t.lines))} · session {usd(t.sessionCostUsd)}
            </span>
          </footer>
        </div>
      ) : (
        <p class="mg-term-pair">Pair the agent host on the laptop to continue</p>
      )}
    </section>
  )
}
