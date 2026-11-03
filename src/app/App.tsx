// App shell: onboarding, library or reader by route, settings sheet, toast, theme and root gesture hooks.
import { signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { authState, maybeRenew } from '../drive/auth'
import { library, startAutoSync } from '../drive/library'
import { fingerDraws } from '../ink/tools'
import { Library } from '../library/Library'
import { Onboarding } from './Onboarding'
import { applyUpdate, updateReady } from './pwa'
import { route } from './route'
import { saveSettings, settings } from './settings'
import { Settings } from './Settings'
import { authReady, choosingRoot, settingsOpen, toast } from './ui'
import './app.css'

const THEME_COLOR = { day: '#f6f6f4', night: '#151515' }

function onRootPointerDown(e: PointerEvent): void {
  if (e.pointerType === 'pen' && !settings.peek().penSeen) void saveSettings({ penSeen: true })
}

type ReaderModule = typeof import('./Reader')

const readerModule = signal<ReaderModule | null>(null)
const readerError = signal<string | null>(null)
let readerLoad: Promise<void> | null = null

// Fetches the reader chunk (pdf.js, viewer, ink, Ask) once, on the first paper route.
function loadReader(): void {
  readerLoad ??= import('./Reader').then(
    (m) => {
      readerModule.value = m
    },
    (err: unknown) => {
      readerLoad = null
      readerError.value = err instanceof Error ? err.message : String(err)
    },
  )
}

function ReaderRoute({ id }: { id: string }) {
  const mod = readerModule.value
  useEffect(() => {
    if (!mod) loadReader()
  }, [mod])
  if (mod) return <mod.Reader key={id} pdfId={id} />
  return (
    <div class="mg-reader-pending">
      {readerError.value ? (
        <>
          <p class="mg-error">Could not load the reader: {readerError.value}</p>
          <button
            type="button"
            class="btn"
            onClick={() => {
              readerError.value = null
              loadReader()
            }}
          >
            Retry
          </button>
        </>
      ) : (
        <p class="mg-muted">Opening…</p>
      )}
    </div>
  )
}

function Screen() {
  const s = settings.value
  const auth = authState.value
  const hasLibrary = Boolean(library.value)
  if (!s.googleClientId) return <Onboarding step="client" />
  const signedOut = auth.status === 'signed-out' && (authReady.value || !hasLibrary)
  if (signedOut) return <Onboarding step="connect" />
  if (!hasLibrary || choosingRoot.value) return <Onboarding step="root" />
  const r = route.value
  if (r.kind === 'paper') return <ReaderRoute id={r.id} />
  return <Library folderId={r.folderId} />
}

export function App() {
  const s = settings.value
  const hasLibrary = Boolean(library.value)

  useEffect(() => {
    if (s.nightMode) document.documentElement.dataset.theme = 'night'
    else delete document.documentElement.dataset.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.nightMode ? THEME_COLOR.night : THEME_COLOR.day)
  }, [s.nightMode])

  useEffect(() => {
    fingerDraws.value = s.fingerDraws
  }, [s.fingerDraws])

  useEffect(() => (hasLibrary ? startAutoSync() : undefined), [hasLibrary])

  return (
    <div class="mg-app" onPointerDownCapture={onRootPointerDown} onPointerUpCapture={maybeRenew} onClickCapture={maybeRenew}>
      <Screen />
      {settingsOpen.value && (
        <div class="mg-sheet-backdrop" onClick={(e) => e.target === e.currentTarget && (settingsOpen.value = false)}>
          <div class="mg-sheet" role="dialog" aria-label="Settings">
            <Settings />
          </div>
        </div>
      )}
      {updateReady.value && !settingsOpen.value && (
        <button type="button" class="btn primary mg-update" onClick={applyUpdate}>
          Update available — Reload
        </button>
      )}
      {toast.value && (
        <div class="mg-toast" role="status">
          {toast.value}
        </div>
      )}
    </div>
  )
}
