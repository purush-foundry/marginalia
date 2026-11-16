import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PaperUpload } from './protocol'

// Folder for a paper under root, with the id reduced to safe characters.
export function paperDir(root: string, pdfId: string): string {
  return path.join(root, 'papers', pdfId.replace(/[^A-Za-z0-9_-]/g, '_'))
}

// Writes paper.pdf, paper.txt and meta.json for an upload and returns the folder.
export async function savePaper(root: string, pdfId: string, upload: PaperUpload): Promise<string> {
  const dir = paperDir(root, pdfId)
  await mkdir(dir, { recursive: true })
  const pages = upload.pages.map((p) => `<page n="${p.n}">\n${p.text}\n</page>\n`).join('')
  const txt = `<paper pages="${upload.pages.length}">\n${pages}</paper>\n`
  const meta = { name: upload.name, title: upload.title, pages: upload.pages.length, savedAt: new Date().toISOString() }
  await writeFile(path.join(dir, 'paper.pdf'), Buffer.from(upload.pdf, 'base64'))
  await writeFile(path.join(dir, 'paper.txt'), txt)
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  return dir
}

export async function readSessions(root: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(path.join(root, 'sessions.json'), 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

// Stores or removes the session id remembered for a paper.
export async function writeSession(root: string, pdfId: string, sessionId: string | null): Promise<void> {
  const all = await readSessions(root)
  if (sessionId === null) delete all[pdfId]
  else all[pdfId] = sessionId
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'sessions.json'), JSON.stringify(all, null, 2))
}

// Reads the persisted bearer token, or generates and stores a new one.
export async function loadToken(root: string, rotate = false): Promise<string> {
  const file = path.join(root, 'host-token')
  if (!rotate) {
    try {
      const existing = (await readFile(file, 'utf8')).trim()
      if (existing) return existing
    } catch {
      // fall through to generate
    }
  }
  const token = randomBytes(32).toString('hex')
  await mkdir(root, { recursive: true })
  await writeFile(file, token, { mode: 0o600 })
  return token
}
