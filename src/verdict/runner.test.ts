// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PageText } from '../types.ts'
import { SKILL_TEXT, skillBody, skillHash } from './skill.ts'
import { gradeDirect, paperInput, VerdictFormatError, type PaperInput } from './runner.ts'

vi.mock('pdfjs-dist', () => import('pdfjs-dist/legacy/build/pdf.mjs'))

function fixture(): ArrayBuffer {
  const bytes = readFileSync('test/fixtures/attention.pdf')
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

vi.mock('../drive/library', () => ({
  library: { peek: () => ({ papers: { p1: { name: 'attention.pdf' } } }) },
  getPdfBlob: async () => new Blob([fixture()], { type: 'application/pdf' }),
}))

function sseAnswer(parts: string[]): string {
  const events = [
    ...parts.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
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

const NOTE = '---\nverdict: read\nconfidence: high\nread_time: 40 min\none_line: Worth it.\ntopics: [attention]\nskill: old\nmodel: old\ngenerated: old\n---\n\nBody text.'

function mockFetch(answer: string[]) {
  const fetchMock = vi.fn(async () => okResponse(sseAnswer(answer)))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestBody(fetchMock: ReturnType<typeof mockFetch>) {
  const calls = fetchMock.mock.calls as unknown as [string, { body: string }][]
  return JSON.parse(calls[0][1].body) as {
    system: string
    messages: { content: { type: string; text: string; cache_control?: unknown }[] }[]
  }
}

const page = (n: number, text: string): PageText => ({ page: n, lines: [], columns: [], text })
const paper = (pages: PageText[]): PaperInput => ({ pdfId: 'p1', name: 'a.pdf', title: 'T', pages, bytes: new ArrayBuffer(0) })
const opts = { apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5', skillText: SKILL_TEXT, now: () => new Date('2030-01-02T03:04:05.000Z') }

afterEach(() => vi.unstubAllGlobals())

describe('paperInput', () => {
  it('extracts the title, name and every page of the fixture', async () => {
    const p = await paperInput('p1')
    expect(p.pdfId).toBe('p1')
    expect(p.name).toBe('attention.pdf')
    expect(p.pages).toHaveLength(15)
    expect(p.bytes.byteLength).toBeGreaterThan(0)
    expect(p.title).toBeNull()
  })
})

describe('gradeDirect', () => {
  it('sends the cached paper block first and overwrites skill, model and generated', async () => {
    const f = mockFetch([NOTE.slice(0, 30), NOTE.slice(30)])
    const note = await gradeDirect(paper([page(1, 'Hello words.')]), opts)
    const body = requestBody(f)
    expect(body.messages[0].content[0].text).toContain('<paper')
    expect(body.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(body.messages[0].content[1].text).toBe('Write the worth-reading note for this paper.')
    expect(note).toMatchObject({ verdict: 'read', body: 'Body text.', model: 'claude-sonnet-5-5', generated: '2030-01-02T03:04:05.000Z' })
    expect(note.skill).toBe(await skillHash(SKILL_TEXT))
  })

  it('tolerates prose before the front matter', async () => {
    mockFetch(['Here is the note.\n\n', NOTE])
    expect((await gradeDirect(paper([page(1, 'x')]), opts)).verdict).toBe('read')
  })

  it('throws VerdictFormatError when there is no front matter', async () => {
    mockFetch(['I cannot grade this.'])
    const err = await gradeDirect(paper([page(1, 'x')]), opts).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(VerdictFormatError)
    expect((err as Error).message).toContain('I cannot grade this.')
  })

  it('grades a paper with no text using the skill body', async () => {
    const f = mockFetch([NOTE])
    await gradeDirect(paper([page(1, ''), page(2, '')]), opts)
    const body = requestBody(f)
    expect(body.messages[0].content[0].text).toContain('<paper pages="2">')
    expect(body.system).toContain(skillBody(SKILL_TEXT))
  })
})
