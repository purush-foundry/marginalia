// Ask Claude about an anchored passage or area: presets, streamed answers, follow-ups.
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Box, ChatMessage, PageText, Thread } from '../types.ts'
import { ClaudeError, streamMessage } from './claude.ts'
import { PRESET_LABELS, buildRequest, presetQuestion, type Preset } from './context.ts'
import { renderMarkdown } from './markdown.ts'
import './ask.css'

export interface AskPanelProps {
  thread: Thread
  paperTitle: string | null
  apiKey: string
  textModel: string
  visionModel: string
  getPageText(page: number): Promise<PageText>
  getCrop(page: number, box: Box): Promise<{ mediaType: 'image/png'; dataBase64: string }>
  onThreadChange(thread: Thread): void
  onCite(page: number, quote: string): void
  onOpenSettings(): void
  onClose(): void
}

type Crop = { mediaType: 'image/png'; dataBase64: string }
type Summary = { words: number; page: number; hasImage: boolean }

const PRESETS = Object.keys(PRESET_LABELS) as Preset[]
const EXCERPT_CHARS = 120

function excerpt(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > EXCERPT_CHARS ? `${t.slice(0, EXCERPT_CHARS).trimEnd()}…` : t
}

function sendingLine(s: Summary): string {
  return `Sending ${s.words} word${s.words === 1 ? '' : 's'} from p.${s.page}${s.hasImage ? ' (+ image)' : ''}`
}

function describeError(err: unknown): string {
  if (err instanceof ClaudeError) {
    if (err.status === 401) return 'Claude rejected your API key. Check it in Settings.'
    if (err.status === 429) return 'Claude is rate limiting this key. Wait a moment, then retry.'
    return err.message
  }
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export function AskPanel(props: AskPanelProps) {
  const { thread, apiKey } = props
  const { anchor } = thread
  const isArea = !anchor.text?.trim()

  const [messages, setMessages] = useState<ChatMessage[]>(thread.messages)
  const [smart, setSmart] = useState(isArea || (thread.messages.length > 0 && thread.model === props.visionModel))
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<{ message: string; question: string } | null>(null)
  const [refused, setRefused] = useState(false)
  const [draft, setDraft] = useState('')
  const [thumb, setThumb] = useState<string | null>(null)

  const saved = useRef<ChatMessage[]>(thread.messages)
  const inflight = useRef<AbortController | null>(null)
  const crop = useRef<Promise<Crop> | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  // Fetches the area crop once and reuses it for the thumbnail and every request.
  function loadCrop(): Promise<Crop> {
    if (!crop.current) {
      crop.current = props.getCrop(anchor.page, anchor.boxes[0])
      crop.current.catch(() => (crop.current = null))
    }
    return crop.current
  }

  useEffect(() => {
    if (isArea && anchor.boxes.length > 0) {
      loadCrop().then(
        (c) => setThumb(`data:${c.mediaType};base64,${c.dataBase64}`),
        () => setThumb(null),
      )
    }
    return () => inflight.current?.abort()
  }, [])

  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  function save(model: string, next: ChatMessage[]) {
    saved.current = next
    setMessages(next)
    props.onThreadChange({ ...thread, model, messages: next, updatedAt: Date.now() })
  }

  async function ask(question: string) {
    const q = question.trim()
    if (!q || inflight.current) return
    const ctrl = new AbortController()
    inflight.current = ctrl
    const history = saved.current
    const model = smart ? props.visionModel : props.textModel
    const user: ChatMessage = { role: 'user', content: q, createdAt: Date.now() }
    const startedAt = Date.now()
    let answer = ''
    const turn = () => [...history, user, ...(answer ? [{ role: 'assistant' as const, content: answer, createdAt: startedAt }] : [])]

    setError(null)
    setRefused(false)
    setBusy(true)
    setMessages(turn())
    try {
      const [pageText, image] = await Promise.all([
        props.getPageText(anchor.page),
        isArea && anchor.boxes.length > 0 ? loadCrop() : Promise.resolve(undefined),
      ])
      const req = buildRequest({ paperTitle: props.paperTitle, anchor, pageText, crop: image, history, question: q })
      setSummary(req.summary)
      const gen = streamMessage({ apiKey, model, system: req.system, messages: req.messages, signal: ctrl.signal })
      for (;;) {
        const r = await gen.next()
        if (r.done) {
          setRefused(r.value.stopReason === 'refusal')
          break
        }
        answer += r.value
        setMessages(turn())
      }
      save(model, turn())
    } catch (err) {
      if (ctrl.signal.aborted) {
        save(model, turn())
      } else {
        setMessages(history)
        setError({ message: describeError(err), question: q })
      }
    } finally {
      inflight.current = null
      setBusy(false)
      setSummary(null)
    }
  }

  // Sends the textarea's live value, which can be ahead of the last render.
  function submit() {
    const q = input.current?.value ?? draft
    if (busy || !q.trim()) return
    setDraft('')
    if (input.current) input.current.value = ''
    void ask(q)
  }

  const header = (
    <header class="ask-head">
      <div class="ask-anchor">
        {isArea ? (
          <>
            {thumb && <img class="ask-thumb" src={thumb} alt="" />}
            <span>Area on p.{anchor.page}</span>
          </>
        ) : (
          <q>{excerpt(anchor.text!)}</q>
        )}
      </div>
      {apiKey && (
        <button
          type="button"
          class="btn ask-smart"
          aria-pressed={smart}
          title={`Smart uses ${props.visionModel}`}
          onClick={() => setSmart(!smart)}
        >
          Smart
        </button>
      )}
      <button type="button" class="btn" aria-label="Close" onClick={props.onClose}>
        ×
      </button>
    </header>
  )

  if (!apiKey) {
    return (
      <section class="ask-panel">
        {header}
        <div class="ask-empty">
          <p>Add your Claude key in Settings</p>
          <button type="button" class="btn primary" onClick={props.onOpenSettings}>
            Open Settings
          </button>
        </div>
      </section>
    )
  }

  return (
    <section class="ask-panel">
      {header}
      <div class="ask-list" ref={list}>
        {messages.length === 0 && !busy && (
          <div class="ask-presets">
            {PRESETS.map((p) => (
              <button key={p} type="button" class="btn ask-chip" onClick={() => void ask(presetQuestion(p, anchor))}>
                {PRESET_LABELS[p]}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} class="ask-msg user">
              {m.content}
            </div>
          ) : (
            <div key={i} class="ask-msg assistant">
              {renderMarkdown(m.content, props.onCite)}
            </div>
          ),
        )}
        {refused && <p class="ask-note">Claude declined to answer this. Try asking another way.</p>}
        {error && (
          <p class="ask-error" role="alert">
            <span>{error.message}</span>
            <button type="button" class="btn" onClick={() => void ask(error.question)}>
              Retry
            </button>
          </p>
        )}
      </div>
      {busy && (
        <div class="ask-status" aria-live="polite">
          <span>{summary ? sendingLine(summary) : 'Preparing…'}</span>
          <button type="button" class="btn" onClick={() => inflight.current?.abort()}>
            Stop
          </button>
        </div>
      )}
      <form
        class="ask-input"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          ref={input}
          rows={2}
          value={draft}
          placeholder={messages.length ? 'Ask a follow-up' : 'Ask about this'}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button type="submit" class="btn primary" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}
