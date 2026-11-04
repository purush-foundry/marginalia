// First-run steps: client id, Google sign-in, then the root folder picker with drill-down.
import { useEffect, useState } from 'preact/hooks'
import { listChildren, listMyDriveFolders } from '../drive/api'
import { authError, authState, gisAvailable } from '../drive/auth'
import { library, setRootFolder } from '../drive/library'
import { FOLDER_MIME, type DriveNode } from '../types'
import { Hero } from '../library/Hero'
import { Icon } from './icons'
import { navigate } from './route'
import { RedirectSignIn, Settings, connectDrive } from './Settings'
import { authReady, choosingRoot, online } from './ui'

function ConnectStep() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = authReady.value
  const offline = !online.value || (ready && !gisAvailable.value)
  return (
    <div class="mg-onboard">
      <Hero />
      <h1>Marginalia</h1>
      <p class="mg-muted">Read and annotate the papers in one Google Drive folder, on every device.</p>
      <button
        type="button"
        class="btn primary"
        disabled={!ready || busy || offline}
        onClick={() => {
          setBusy(true)
          void connectDrive().then((e) => {
            setError(e)
            setBusy(false)
          })
        }}
      >
        Connect Google Drive
      </button>
      {ready && !offline && <RedirectSignIn />}
      {offline && <p class="mg-error">Offline — Google sign-in unavailable</p>}
      {!ready && !offline && <p class="mg-muted">Loading Google sign-in…</p>}
      {(error ?? authError.value) && <p class="mg-error">{error ?? authError.value}</p>}
    </div>
  )
}

export function RootPicker() {
  const [trail, setTrail] = useState<DriveNode[]>([])
  const [folders, setFolders] = useState<DriveNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const here = trail.at(-1)

  useEffect(() => {
    let live = true
    setError(null)
    setFolders(null)
    const request = here
      ? listChildren([here.id]).then((list) => list.filter((n) => n.mimeType === FOLDER_MIME))
      : listMyDriveFolders()
    request.then(
      (list) => live && setFolders([...list].sort((a, b) => a.name.localeCompare(b.name))),
      (err: unknown) => live && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      live = false
    }
  }, [here?.id, attempt])

  const reload = () => setAttempt((n) => n + 1)

  const pick = async (node: DriveNode) => {
    setPicking(true)
    setError(null)
    try {
      await setRootFolder(node)
      choosingRoot.value = false
      navigate('#/')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPicking(false)
    }
  }

  return (
    <div class="mg-onboard">
      <Hero />
      <h1>Choose your papers folder</h1>
      <p class="mg-muted">Marginalia shows this folder and its subfolders. Annotations are saved next to each PDF.</p>
      <nav class="mg-crumbs" aria-label="Folders">
        {trail.length ? (
          <button type="button" class="mg-link-btn" onClick={() => setTrail([])}>
            My Drive
          </button>
        ) : (
          <span aria-current="page">My Drive</span>
        )}
        {trail.map((f, i) => (
          <span key={f.id}>
            <span class="mg-crumb-sep">/</span>
            {i === trail.length - 1 ? (
              <span aria-current="page">{f.name}</span>
            ) : (
              <button type="button" class="mg-link-btn" onClick={() => setTrail(trail.slice(0, i + 1))}>
                {f.name}
              </button>
            )}
          </span>
        ))}
      </nav>
      {here && (
        <button type="button" class="btn primary" disabled={picking} onClick={() => void pick(here)}>
          {picking ? 'Opening…' : `Use “${here.name}”`}
        </button>
      )}
      {error && (
        <p class="mg-error">
          {error}{' '}
          {authState.value.status === 'expired' ? (
            <button type="button" class="btn primary" onClick={() => void connectDrive().then((e) => (e ? setError(e) : reload()))}>
              Reconnect Drive
            </button>
          ) : (
            <button type="button" class="btn" onClick={reload}>
              Retry
            </button>
          )}
        </p>
      )}
      {!folders && !error && <p class="mg-muted">Loading folders…</p>}
      {folders && folders.length === 0 && <p class="mg-muted">{here ? 'No subfolders.' : 'No folders in My Drive yet.'}</p>}
      {folders && (
        <ul class="mg-list">
          {folders.map((f) => (
            <li key={f.id}>
              <button type="button" class="mg-row" disabled={picking} onClick={() => setTrail([...trail, f])}>
                <Icon name="folder" />
                <span class="mg-row-name">{f.name}</span>
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
