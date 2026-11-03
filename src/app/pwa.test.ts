import { afterEach, describe, expect, test, vi } from 'vitest'

const registration = {
  waiting: null,
  installing: null,
  update: vi.fn(async () => undefined),
  addEventListener: vi.fn(),
}

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

describe('registerServiceWorker', () => {
  test('checks for an update on launch and whenever the app becomes visible', async () => {
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { register: vi.fn(async () => registration), controller: {} } })
    const { registerServiceWorker } = await import('./pwa')

    await registerServiceWorker()
    expect(registration.update).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).toHaveBeenCalledTimes(2)
  })
})
