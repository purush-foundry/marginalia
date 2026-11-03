// Service worker registration, the update-ready signal and the one-time persistent-storage request.
import { signal } from '@preact/signals'
import { idbGet, idbSet } from '../lib/idb'

/** A new service worker is installed and waiting; the user decides when to reload. */
export const updateReady = signal(false)

let registration: ServiceWorkerRegistration | null = null

// Flags the update once a new worker finishes installing while an old one controls the page.
function watch(worker: ServiceWorker): void {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) updateReady.value = true
  })
}

/** Registers `sw.js` next to the app; never reloads on its own. */
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const base = import.meta.env.BASE_URL
  registration = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base })
  if (registration.waiting && navigator.serviceWorker.controller) updateReady.value = true
  if (registration.installing) watch(registration.installing)
  registration.addEventListener('updatefound', () => {
    if (registration?.installing) watch(registration.installing)
  })
}

/** Activates the waiting worker, then reloads once it takes control. */
export function applyUpdate(): void {
  const waiting = registration?.waiting
  if (!waiting) {
    location.reload()
    return
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
  waiting.postMessage({ type: 'skip-waiting' })
}

/** Asks for persistent storage the first time the app runs on this device. */
export async function requestPersistence(): Promise<void> {
  if (!navigator.storage?.persist || (await idbGet<boolean>('settings', 'persistAsked'))) return
  await idbSet('settings', 'persistAsked', true)
  if (!(await navigator.storage.persisted())) await navigator.storage.persist()
}

/** Short build id from the hashed bundle name, or "dev". */
export function buildId(): string {
  return import.meta.url.match(/-([\w-]{6,})\.js$/)?.[1] ?? 'dev'
}
