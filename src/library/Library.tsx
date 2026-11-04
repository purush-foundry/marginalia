// Library browser: breadcrumbs, folders then PDFs with size, cached dot and reading badge, sync header.
import { useEffect, useState } from 'preact/hooks'
import { authState } from '../drive/auth'
import { childrenOf, isCached, library, loadSidecar, pathTo, sidecarRevision, syncLibrary, syncState } from '../drive/library'
import { Icon } from '../app/icons'
import { folderHash, paperHash } from '../app/route'
import { connectDrive, formatBytes } from '../app/Settings'
import { settingsOpen } from '../app/ui'
import type { ReadStatus } from '../types'
import { Hero } from './Hero'
import './library.css'

interface PaperInfo {
  cached: boolean
  status: ReadStatus
}

const STATUS_LABEL: Record<ReadStatus, string> = { unread: 'Unread', reading: 'Reading', done: 'Done' }

function syncLabel(): string {
  const s = syncState.value
  if (s.status === 'syncing') return 'Syncing…'
  if (s.status === 'offline' || s.status === 'error') return s.message ?? s.status
  if (s.at) return `Synced ${new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return ''
}

function SyncHeader() {
  const [error, setError] = useState<string | null>(null)
  const state = syncState.value.status
  return (
    <div class="mg-lib-sync">
      <span class={state === 'error' ? 'mg-error' : 'mg-muted'} role="status">
        {error ?? syncLabel()}
      </span>
      {authState.value.status === 'expired' && (
        <button type="button" class="btn primary" onClick={() => void connectDrive().then(setError)}>
          Reconnect Drive
        </button>
      )}
      <button
        type="button"
        class="btn"
        aria-label="Sync now"
        disabled={state === 'syncing'}
        onClick={() => void syncLibrary()}
      >
        <Icon name="sync" />
      </button>
      <button type="button" class="btn" aria-label="Settings" onClick={() => (settingsOpen.value = true)}>
        <Icon name="settings" />
      </button>
    </div>
  )
}

export function Library({ folderId }: { folderId?: string }) {
  const index = library.value
  const current = folderId && index?.folders[folderId] ? folderId : index?.rootId
  const { folders, papers } = current ? childrenOf(current) : { folders: [], papers: [] }
  const crumbs = current ? pathTo(current) : []
  const [info, setInfo] = useState<Record<string, PaperInfo>>({})
  const paperKey = `${papers.map((p) => `${p.id}@${p.version}`).join(',')}#${sidecarRevision.value}`

  useEffect(() => {
    let live = true
    void Promise.all(
      papers.map(async (p) => {
        const [cached, sidecar] = await Promise.all([isCached(p.id), loadSidecar(p.id)])
        return [p.id, { cached, status: sidecar.reading.status }] as const
      }),
    ).then((entries) => {
      if (live) setInfo(Object.fromEntries(entries))
    })
    return () => {
      live = false
    }
  }, [paperKey])

  return (
    <div class="mg-lib">
      <Hero />
      <header class="mg-lib-head">
        <nav class="mg-crumbs" aria-label="Folders">
          {crumbs.map((c, i) => (
            <span key={c.id}>
              {i > 0 && <span class="mg-crumb-sep">/</span>}
              {i === crumbs.length - 1 ? (
                <span aria-current="page">{c.name}</span>
              ) : (
                <a href={folderHash(c.id === index?.rootId ? undefined : c.id)}>{c.name}</a>
              )}
            </span>
          ))}
        </nav>
        <SyncHeader />
      </header>
      <ul class="mg-list">
        {folders.map((f) => (
          <li key={f.id}>
            <a class="mg-row" href={folderHash(f.id)}>
              <Icon name="folder" />
              <span class="mg-row-name">{f.name}</span>
            </a>
          </li>
        ))}
        {papers.map((p) => {
          const pi = info[p.id]
          return (
            <li key={p.id}>
              <a class="mg-row" href={paperHash(p.id)}>
                <Icon name="file" />
                <span class="mg-row-name">{p.name.replace(/\.pdf$/i, '')}</span>
                {pi?.cached && <span class="mg-cached" title="Available offline" aria-label="Cached" />}
                {p.size !== undefined && <span class="mg-muted mg-size">{formatBytes(p.size)}</span>}
                {pi && <span class={`mg-badge mg-badge-${pi.status}`}>{STATUS_LABEL[pi.status]}</span>}
              </a>
            </li>
          )
        })}
      </ul>
      {index && !folders.length && !papers.length && (
        <p class="mg-muted mg-empty">
          {index.syncedAt ? 'No folders or PDFs here.' : 'Reading your Drive folder…'}
        </p>
      )}
    </div>
  )
}
