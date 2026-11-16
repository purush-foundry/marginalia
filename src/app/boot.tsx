// Startup: consumes a redirect token, restores settings and the library, renders, then restores the Drive session in the background.
import { render } from 'preact'
import { pairHost } from '../agent/host'
import { consumeRedirectToken, gisAvailable, initAuth } from '../drive/auth'
import { loadLibrary } from '../drive/library'
import { App } from './App'
import { registerServiceWorker, requestPersistence } from './pwa'
import { route, startRouter } from './route'
import { bindToolSettings, loadSettings, saveSettings, settings } from './settings'
import { authReady, online, showToast } from './ui'

export async function boot(el: HTMLElement): Promise<void> {
  consumeRedirectToken()
  const [s] = await Promise.all([loadSettings(), loadLibrary()])
  if (s.gradingSince === 0) saveSettings({ gradingSince: Date.now() }).catch(console.error)
  bindToolSettings()
  startRouter()
  const r = route.value
  if (r.kind === 'pair') {
    await pairHost(r.token)
    history.replaceState(null, '', location.pathname + '#/')
    route.value = { kind: 'library' }
    showToast('Agent host paired')
  }
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
