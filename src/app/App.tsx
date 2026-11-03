// App shell: onboarding, library or reader by route, settings sheet, toast, theme and root gesture hooks.
import { useEffect } from 'preact/hooks'
import { authState, maybeRenew } from '../drive/auth'
import { library, startAutoSync } from '../drive/library'
import { fingerDraws } from '../ink/tools'
import { Library } from '../library/Library'
import { Onboarding } from './Onboarding'
import { applyUpdate, updateReady } from './pwa'
import { Reader } from './Reader'
import { route } from './route'
import { saveSettings, settings } from './settings'
import { Settings } from './Settings'
import { authReady, choosingRoot, settingsOpen, toast } from './ui'
import './app.css'

function onRootPointerDown(e: PointerEvent): void {
  maybeRenew()
  if (e.pointerType === 'pen' && !settings.peek().penSeen) void saveSettings({ penSeen: true })
}

function Screen() {
  const s = settings.value
  const auth = authState.value
  const hasLibrary = Boolean(library.value)
  if (!s.googleClientId) return <Onboarding step="client" />
  if (auth.status === 'signed-out') return authReady.value ? <Onboarding step="connect" /> : <div class="mg-splash" />
  if (!hasLibrary || choosingRoot.value) return <Onboarding step="root" />
  const r = route.value
  if (r.kind === 'paper') return <Reader key={r.id} pdfId={r.id} />
  return <Library folderId={r.folderId} />
}

export function App() {
  const s = settings.value
  const hasLibrary = Boolean(library.value)

  useEffect(() => {
    if (s.nightMode) document.documentElement.dataset.theme = 'night'
    else delete document.documentElement.dataset.theme
  }, [s.nightMode])

  useEffect(() => {
    fingerDraws.value = s.fingerDraws
  }, [s.fingerDraws])

  useEffect(() => (hasLibrary ? startAutoSync() : undefined), [hasLibrary])

  return (
    <div class="mg-app" onPointerDownCapture={onRootPointerDown}>
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
