// Startup: consumes a redirect token, restores settings and the library, renders, then restores the Drive session in the background.
import { render } from 'preact'
import { consumeRedirectToken, gisAvailable, initAuth } from '../drive/auth'
import { loadLibrary } from '../drive/library'
import { App } from './App'
import { registerServiceWorker, requestPersistence } from './pwa'
import { startRouter } from './route'
import { bindPenPalette, bindToolSettings, loadSettings, settings } from './settings'
import { authReady, online } from './ui'

export async function boot(el: HTMLElement): Promise<void> {
  consumeRedirectToken()
  const [s] = await Promise.all([loadSettings(), loadLibrary()])
  bindPenPalette()
  bindToolSettings()
  startRouter()
  render(<App />, el)
  if (import.meta.env.PROD) registerServiceWorker().catch(console.error)
  requestPersistence().catch(() => undefined)
  window.addEventListener('offline', () => (online.value = false))
  window.addEventListener('online', () => {
    online.value = true
    const clientId = settings.peek().googleClientId
    if (clientId && authReady.peek() && !gisAvailable.peek()) void initAuth(clientId)
  })
  if (!s.googleClientId) return
  initAuth(s.googleClientId).then(
    () => (authReady.value = true),
    () => (authReady.value = true),
  )
}
