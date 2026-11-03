// First-run steps: client id, Google sign-in, then the root folder picker.
import { useEffect, useState } from 'preact/hooks'
import { listMyDriveFolders } from '../drive/api'
import { authState, gisAvailable } from '../drive/auth'
import { library, setRootFolder } from '../drive/library'
import type { DriveNode } from '../types'
import { Icon } from './icons'
import { navigate } from './route'
import { Settings, connectDrive } from './Settings'
import { authReady, choosingRoot } from './ui'

function ConnectStep() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = authReady.value
  return (
    <div class="mg-onboard">
      <h1>Marginalia</h1>
      <p class="mg-muted">Read and annotate the papers in one Google Drive folder, on every device.</p>
      <button
        type="button"
        class="btn primary"
        disabled={!ready || busy}
        onClick={() => {
          setBusy(true)
          void connectDrive().then((e) => {
            setError(e)
            setBusy(false)
          })
        }}
      >
        {ready ? 'Connect Google Drive' : 'Loading…'}
      </button>
      {ready && !gisAvailable.value && <p class="mg-error">Google sign-in could not load. Are you offline?</p>}
      {error && <p class="mg-error">{error}</p>}
    </div>
  )
}

export function RootPicker() {
  const [folders, setFolders] = useState<DriveNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState<string | null>(null)

  const load = () => {
    setError(null)
    setFolders(null)
    listMyDriveFolders().then(
      (list) => setFolders([...list].sort((a, b) => a.name.localeCompare(b.name))),
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    )
  }
  useEffect(load, [])

  const pick = async (node: DriveNode) => {
    setPicking(node.id)
    await setRootFolder(node)
    choosingRoot.value = false
    navigate('#/')
  }

  return (
    <div class="mg-onboard">
      <h1>Choose your papers folder</h1>
      <p class="mg-muted">Marginalia shows this folder and its subfolders. Annotations are saved next to each PDF.</p>
      {error && (
        <p class="mg-error">
          {error}{' '}
          {authState.value.status === 'expired' ? (
            <button type="button" class="btn primary" onClick={() => void connectDrive().then((e) => (e ? setError(e) : load()))}>
              Reconnect Drive
            </button>
          ) : (
            <button type="button" class="btn" onClick={load}>
              Retry
            </button>
          )}
        </p>
      )}
      {!folders && !error && <p class="mg-muted">Loading folders…</p>}
      {folders && folders.length === 0 && <p class="mg-muted">No folders in My Drive yet.</p>}
      {folders && (
        <ul class="mg-list">
          {folders.map((f) => (
            <li key={f.id}>
              <button type="button" class="mg-row" disabled={picking !== null} onClick={() => void pick(f)}>
                <Icon name="folder" />
                <span class="mg-row-name">{f.name}</span>
                {picking === f.id && <span class="mg-muted">Opening…</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {choosingRoot.value && library.value && (
        <button type="button" class="btn" onClick={() => (choosingRoot.value = false)}>
          Cancel
        </button>
      )}
    </div>
  )
}

export function Onboarding({ step }: { step: 'client' | 'connect' | 'root' }) {
  if (step === 'client') return <Settings onboarding />
  if (step === 'connect') return <ConnectStep />
  return <RootPicker />
}
