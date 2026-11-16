// Paper text extraction and the Messages API grader for worth-reading notes.
import { streamMessage } from '../ai/claude.ts'
import { paperBlock } from '../ai/context.ts'
import { getPdfBlob, library } from '../drive/library'
import { openPdf } from '../pdf/document.ts'
import type { PageText } from '../types.ts'
import { parseNote, type VerdictNote } from './note.ts'
import { skillBody, skillHash } from './skill.ts'

export interface PaperInput {
  pdfId: string
  name: string
  title: string | null
  pages: PageText[]
  bytes: ArrayBuffer
}

export interface DirectOptions {
  apiKey: string
  model: string
  skillText: string
  signal?: AbortSignal
  now?: () => Date
}

export class VerdictFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerdictFormatError'
  }
}

const SYSTEM_SUFFIX =
  'The paper follows in the user message as page-tagged text. Write the note now, exactly in the specified format, nothing before the front matter.'

/** Downloads or reads the cached PDF and extracts every page's text. */
export async function paperInput(pdfId: string): Promise<PaperInput> {
  const blob = await getPdfBlob(pdfId)
  const bytes = await blob.arrayBuffer()
  const doc = await openPdf(blob)
  try {
    const pages = await doc.getAllText()
    return { pdfId, name: library.peek()?.papers[pdfId]?.name ?? '', title: doc.title, pages, bytes }
  } finally {
    doc.destroy()
  }
}

/** Runs the skill through the Messages API; the returned note's skill/model/generated are set by this function. */
export async function gradeDirect(paper: PaperInput, opts: DirectOptions): Promise<VerdictNote> {
  let answer = ''
  const stream = streamMessage({
    apiKey: opts.apiKey,
    model: opts.model,
    system: `${skillBody(opts.skillText)}\n\n${SYSTEM_SUFFIX}`,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: paperBlock(paper.pages, paper.title).text, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'Write the worth-reading note for this paper.' },
        ],
      },
    ],
    signal: opts.signal,
  })
  for await (const delta of stream) answer += delta
  const note = parseNote(answer)
  if (!note) throw new VerdictFormatError(`The model's answer was not a valid note: ${answer.slice(0, 200)}`)
  return { ...note, skill: await skillHash(opts.skillText), model: opts.model, generated: (opts.now?.() ?? new Date()).toISOString() }
}
