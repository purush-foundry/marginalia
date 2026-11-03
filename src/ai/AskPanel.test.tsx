import { render } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Anchor, PageText, Thread } from '../types.ts'
import { AskPanel, type AskPanelProps } from './AskPanel.tsx'

const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }
const textAnchor: Anchor = { page: 3, boxes: [box], text: 'We call our particular attention Scaled Dot-Product Attention.' }
const areaAnchor: Anchor = { page: 5, boxes: [box] }
const pageText: PageText = {
  page: 3,
  lines: [],
  columns: [],
  text: 'Intro words here. We call our particular attention Scaled Dot-Product Attention. More words.',
}

function thread(anchor: Anchor): Thread {
  return { id: 't1', kind: 'thread', createdAt: 1, updatedAt: 1, anchor, model: '', messages: [] }
}

function sseAnswer(parts: string[], stopReason = 'end_turn'): string {
  const events = [
    ...parts.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    { type: 'message_delta', delta: { stop_reason: stopReason } },
    { type: 'message_stop' },
  ]
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
}

function okResponse(sse: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(sse))
      c.close()
    },
  })
  return { ok: true, status: 200, body, text: async () => '' } as unknown as Response
}

let root: HTMLElement

function mount(over: Partial<AskPanelProps> = {}) {
  const props: AskPanelProps = {
    thread: thread(textAnchor),
    paperTitle: 'Attention Is All You Need',
    apiKey: 'sk-ant-test',
    textModel: 'claude-haiku-5-5',
    visionModel: 'claude-opus-5-5',
    getPageText: vi.fn(async () => pageText),
    getCrop: vi.fn(async () => ({ mediaType: 'image/png' as const, dataBase64: 'iVBORw0KGgo=' })),
    onThreadChange: vi.fn(),
    onCite: vi.fn(),
    onOpenSettings: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  root = document.createElement('div')
  document.body.append(root)
  render(<AskPanel {...props} />, root)
  return props
}

function button(label: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll('button')).find((x) => x.textContent?.trim() === label)
  if (!b) throw new Error(`no button "${label}"`)
  return b
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string)
}

afterEach(() => {
  render(null, root)
  root.remove()
  vi.unstubAllGlobals()
})

describe('AskPanel', () => {
  it('asks for a key instead of sending when none is set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const props = mount({ apiKey: '' })
    await vi.waitFor(() => expect(root.textContent).toContain('Add your Claude key in Settings'))
    expect(root.textContent).not.toContain('Explain')
    button('Open Settings').click()
    expect(props.onOpenSettings).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends a preset, shows what is sent, streams the answer and saves both turns', async () => {
    let release!: (r: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (release = r)))
    vi.stubGlobal('fetch', fetchMock)
    const props = mount()

    await vi.waitFor(() => button('Explain'))
    button('Explain').click()

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(root.textContent).toContain('Sending 13 words from p.3'))
    expect(root.textContent).not.toContain('(+ image)')
    const body = requestBody(fetchMock)
    expect(body.model).toBe('claude-haiku-5-5')
    expect(JSON.stringify(body.messages)).toContain('Explain the selected passage in plain terms.')

    release(okResponse(sseAnswer(['It is ', '"Scaled Dot-Product Attention" (p. 3).'])))

    await vi.waitFor(() => expect(root.querySelector('button.cite')).not.toBeNull())
    root.querySelector<HTMLButtonElement>('button.cite')!.click()
    expect(props.onCite).toHaveBeenCalledWith(3, 'Scaled Dot-Product Attention')
    expect(root.textContent).not.toContain('Sending 13 words')

    await vi.waitFor(() => expect(props.onThreadChange).toHaveBeenCalledOnce())
    const saved = (props.onThreadChange as ReturnType<typeof vi.fn>).mock.calls[0][0] as Thread
    expect(saved.id).toBe('t1')
    expect(saved.model).toBe('claude-haiku-5-5')
    expect(saved.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Explain the selected passage in plain terms.'],
      ['assistant', 'It is "Scaled Dot-Product Attention" (p. 3).'],
    ])
    expect(JSON.stringify(saved)).not.toContain('sk-ant-test')
  })

  it('uses Smart and sends the crop for area anchors', async () => {
    const fetchMock = vi.fn(async () => okResponse(sseAnswer(['A softmax.'])))
    vi.stubGlobal('fetch', fetchMock)
    const props = mount({ thread: thread(areaAnchor) })

    await vi.waitFor(() => expect(root.textContent).toContain('Area on p.5'))
    expect(button('Smart').getAttribute('aria-pressed')).toBe('true')
    button('Unpack the maths').click()

    await vi.waitFor(() => expect(props.onThreadChange).toHaveBeenCalledOnce())
    const body = requestBody(fetchMock)
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.messages[0].content.some((b: { type: string }) => b.type === 'image')).toBe(true)
    expect(props.getCrop).toHaveBeenCalledWith(5, box)
  })

  it('sends a typed question on Enter and keeps Shift+Enter for new lines', async () => {
    const fetchMock = vi.fn(async () => okResponse(sseAnswer(['Yes.'])))
    vi.stubGlobal('fetch', fetchMock)
    const props = mount()
    const input = await vi.waitFor(() => root.querySelector('textarea')!)

    input.value = 'Is this new?'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    expect(fetchMock).not.toHaveBeenCalled()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    await vi.waitFor(() => expect(props.onThreadChange).toHaveBeenCalledOnce())
    expect(JSON.stringify(requestBody(fetchMock).messages)).toContain('Is this new?')
    expect(root.textContent).toContain('Yes.')
  })

  it('shows a neutral note when Claude declines', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(sseAnswer([], 'refusal'))))
    const props = mount()

    await vi.waitFor(() => button('Define here'))
    button('Define here').click()

    await vi.waitFor(() => expect(props.onThreadChange).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(root.querySelector('.ask-note')?.textContent).toContain('Claude declined to answer this'))
    expect(root.querySelector('[role=alert]')).toBeNull()
  })

  it('Stop keeps and saves the partial answer', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          const delta = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half an' } }
          c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta)}\n\n`))
          init.signal?.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')))
        },
      })
      return { ok: true, status: 200, body, text: async () => '' } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    const props = mount()

    await vi.waitFor(() => button('Why does it matter'))
    button('Why does it matter').click()
    await vi.waitFor(() => expect(root.textContent).toContain('Half an'))
    button('Stop').click()

    await vi.waitFor(() => expect(props.onThreadChange).toHaveBeenCalledOnce())
    const saved = (props.onThreadChange as ReturnType<typeof vi.fn>).mock.calls[0][0] as Thread
    expect(saved.messages.map((m) => m.content)).toEqual(["Why does the selected passage matter for the paper's argument?", 'Half an'])
    expect(root.querySelector('[role=alert]')).toBeNull()
  })

  it('shows the error with Retry and does not save the failed turn', async () => {
    const fail = { ok: false, status: 500, body: null, text: async () => '{"error":{"type":"api_error","message":"Internal"}}' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(okResponse(sseAnswer(['Recovered.'])))
    vi.stubGlobal('fetch', fetchMock)
    const props = mount()

    await vi.waitFor(() => button('Explain'))
    button('Explain').click()
    await vi.waitFor(() => button('Retry'))
    expect(root.textContent).toContain('Internal')
    expect(props.onThreadChange).not.toHaveBeenCalled()

    button('Retry').click()
    await vi.waitFor(() => expect(props.onThreadChange).toHaveBeenCalledOnce())
    const saved = (props.onThreadChange as ReturnType<typeof vi.fn>).mock.calls[0][0] as Thread
    expect(saved.messages.map((m) => m.content)).toEqual(['Explain the selected passage in plain terms.', 'Recovered.'])
  })
})
