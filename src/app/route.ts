// Hash routes: `#/` library root, `#/f/<folderId>` a folder, `#/p/<pdfId>` the reader.
import { signal } from '@preact/signals'

export type Route = { kind: 'library'; folderId?: string } | { kind: 'paper'; id: string }

export function parseRoute(hash: string): Route {
  const m = hash.match(/^#\/([fp])\/([^/?#]+)/)
  if (!m) return { kind: 'library' }
  const id = decodeURIComponent(m[2])
  return m[1] === 'p' ? { kind: 'paper', id } : { kind: 'library', folderId: id }
}

export const folderHash = (id?: string): string => (id ? `#/f/${encodeURIComponent(id)}` : '#/')
export const paperHash = (id: string): string => `#/p/${encodeURIComponent(id)}`

export const route = signal<Route>(parseRoute(typeof location === 'undefined' ? '' : location.hash))

/** Keeps `route` in step with the URL hash; returns a stop function. */
export function startRouter(): () => void {
  const sync = () => {
    route.value = parseRoute(location.hash)
  }
  sync()
  window.addEventListener('hashchange', sync)
  return () => window.removeEventListener('hashchange', sync)
}

export function navigate(hash: string): void {
  if (location.hash !== hash) location.hash = hash
  route.value = parseRoute(hash)
}
