import { render } from 'preact'
import './app/theme.css'
import { App } from './app/App.tsx'
import { registerServiceWorker, requestPersistence } from './app/pwa.ts'
import { startRouter } from './app/route.ts'
import { loadSettings } from './app/settings.ts'
import { authReady } from './app/ui.ts'
import { consumeRedirectToken, initAuth } from './drive/auth.ts'
import { loadLibrary } from './drive/library.ts'

// Restores settings and the library, renders, then restores the Drive session in the background.
async function boot(): Promise<void> {
  consumeRedirectToken()
  const [s] = await Promise.all([loadSettings(), loadLibrary()])
  startRouter()
  render(<App />, document.getElementById('app')!)
  if (import.meta.env.PROD) registerServiceWorker().catch(console.error)
  requestPersistence().catch(() => undefined)
  if (s.googleClientId) await initAuth(s.googleClientId)
  authReady.value = true
}

void boot()
