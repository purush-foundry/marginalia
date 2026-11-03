import { afterEach, describe, expect, test, vi } from 'vitest'

type Listener = (e: unknown) => void

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function loadWorker(): Promise<Record<string, Listener>> {
  const listeners: Record<string, Listener> = {}
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, fn: Listener) => {
    listeners[type] = fn
  }) as typeof window.addEventListener)
  vi.stubGlobal('caches', { open: async () => ({ put: async () => undefined }), match: async () => undefined })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
  vi.resetModules()
  await import('./sw')
  return listeners
}

function navigation(path: string) {
  return { request: { url: new URL(path, location.origin).href, method: 'GET', mode: 'navigate' }, respondWith: vi.fn() }
}

describe('service worker fetch', () => {
  test('serves the app shell network-first but leaves other pages such as privacy.html alone', async () => {
    const { fetch } = await loadWorker()

    const shell = navigation('/')
    fetch(shell)
    expect(shell.respondWith).toHaveBeenCalledOnce()

    const privacy = navigation('/privacy.html')
    fetch(privacy)
    expect(privacy.respondWith).not.toHaveBeenCalled()
  })
})
