import { sortHighlights } from '../annot/store'
import { compareOrder } from '../lib/order'
import type { Box, HighlightColor, NotesDoc, Sidecar } from '../types'

export interface ExportOptions {
  title: string
  colorLabels?: Partial<Record<HighlightColor, string>>
  pageLink?: (page: number) => string
  columns?: Record<number, Box[]>
}

/** Title, then highlights in store order as `> quote` blocks with `— p.N · <colour label>` and the note below; area highlights as `[Area on p.N]`; then threads as Q/A. */
export function sidecarToMarkdown(sidecar: Sidecar, opts: ExportOptions): string {
  const labels = { ...sidecar.colorLabels, ...opts.colorLabels }
  const link = (text: string, page: number) => (opts.pageLink ? `[${text}](${opts.pageLink(page)})` : text)
  const out: string[] = [`# ${opts.title}`]

  for (const h of sortHighlights(sidecar.highlights.filter((x) => !x.deleted), opts.columns)) {
    const label = labels[h.color] || h.color
    const lines: string[] = []
    if (h.kind === 'text') {
      lines.push(...h.text.split('\n').map((l) => `> ${l}`))
      lines.push(`— ${link(`p.${h.page}`, h.page)} · ${label}`)
    } else {
      lines.push(`${opts.pageLink ? link('Area on p.' + h.page, h.page) : `[Area on p.${h.page}]`} · ${label}`)
    }
    if (h.note) lines.push('', h.note)
    out.push(lines.join('\n'))
  }

  const threads = sidecar.threads.filter((t) => !t.deleted).sort((a, b) => a.createdAt - b.createdAt)
  if (threads.length) out.push('## Threads')
  for (const t of threads) {
    const lines = [`### ${link(`p.${t.anchor.page}`, t.anchor.page)}`]
    if (t.anchor.text) lines.push(t.anchor.text.split('\n').map((l) => `> ${l}`).join('\n'))
    for (const m of t.messages) lines.push(`**${m.role === 'user' ? 'Q' : 'A'}:** ${m.content}`)
    out.push(lines.join('\n\n'))
  }

  return out.join('\n\n') + '\n'
}

/** A `## Notes` section: non-empty text blocks and `(image, p.N)` lines in block order; empty when there is nothing to list. */
export function notesToMarkdown(doc: NotesDoc): string {
  const lines: string[] = []
  for (const b of doc.blocks.filter((x) => !x.deleted).sort(compareOrder)) {
    if (b.kind === 'image') lines.push(b.page ? `(image, p.${b.page})` : '(image)')
    else if (b.text.trim()) lines.push(b.text)
  }
  return lines.length ? ['## Notes', ...lines].join('\n\n') + '\n' : ''
}
