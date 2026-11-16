import { loadSidecar, saveSidecar } from '../drive/library'
import type { PaperLink, Sidecar } from '../types'

// Returns the sidecar with the gist set at stamp t.
export function withGist(s: Sidecar, text: string, t: number): Sidecar {
  return { ...s, gist: { text, updatedAt: t } }
}

// Returns the sidecar with the topic ids set at stamp t.
export function withTopics(s: Sidecar, ids: string[], t: number): Sidecar {
  return { ...s, topics: { ids, updatedAt: t } }
}

// Returns the sidecar pinned at the point, or unpinned (negative sentinel) when null.
export function withPin(s: Sidecar, pin: { x: number; y: number } | null, t: number): Sidecar {
  return { ...s, pin: pin ? { x: pin.x, y: pin.y, updatedAt: t } : { x: -1, y: -1, updatedAt: t } }
}

// Returns the sidecar with the link replaced by id, or appended when new.
export function withLink(s: Sidecar, link: PaperLink): Sidecar {
  const links = s.links ?? []
  const has = links.some((l) => l.id === link.id)
  return { ...s, links: has ? links.map((l) => (l.id === link.id ? link : l)) : [...links, link] }
}

// Returns the sidecar with the link tombstoned at stamp t.
export function withoutLink(s: Sidecar, id: string, t: number): Sidecar {
  return { ...s, links: (s.links ?? []).map((l) => (l.id === id ? { ...l, deleted: true, updatedAt: t } : l)) }
}

/** Loads, edits and saves a sidecar that may not be open in a store. */
export async function updateSidecar(pdfId: string, edit: (s: Sidecar) => Sidecar): Promise<Sidecar> {
  const next = edit(await loadSidecar(pdfId))
  await saveSidecar(pdfId, next)
  return next
}
