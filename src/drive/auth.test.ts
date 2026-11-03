import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DRIVE_SCOPES, TOKEN_RENEW_MARGIN_MS } from '../config'

type Auth = typeof import('./auth')
type Idb = typeof import('../lib/idb')

const HOME = 'http://localhost:3000/'

interface GisStub {
  config?: GisTokenClientConfig
  requests: Array<{ prompt?: string } | undefined>
  revoked: string[]
}

// Installs a fake window.google that records what auth.ts asks of it.
function stubGis(): GisStub {
  const stub: GisStub = { requests: [], revoked: [] }
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient(config) {
          stub.config = config
          return { requestAccessToken: (override) => void stub.requests.push(override) }
        },
        revoke(accessToken, done) {
          stub.revoked.push(accessToken)
          done?.()
        },
      },
    },
  }
  return stub
}

let auth: Auth
let idb: Idb

beforeEach(async () => {
  vi.resetModules()
  auth = await import('./auth')
  idb = await import('../lib/idb')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete window.google
  sessionStorage.clear()
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(HOME)
})

describe('initAuth', () => {
  test('resolves when the GIS script cannot load and reports it unavailable', async () => {
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      queueMicrotask(() => node.dispatchEvent(new Event('error')))
      return node
    })
    await auth.initAuth('client-1')
    expect(auth.gisAvailable.value).toBe(false)
    expect(auth.authState.value.status).toBe('signed-out')
    expect(auth.getAccessToken()).toBeNull()
  })

  test('gives up on a GIS script that never loads after 10 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => node)

    const done = auth.initAuth('client-1')
    await vi.advanceTimersByTimeAsync(10_000)
    await done

    expect(auth.gisAvailable.value).toBe(false)
  })

  test('restores a cached token that is still valid', async () => {
    const expiresAt = Date.now() + 30 * 60_000
    await idb.idbSet('meta', 'token', { accessToken: 'cached', expiresAt })
    stubGis()

    await auth.initAuth('client-1')

    expect(auth.gisAvailable.value).toBe(true)
    expect(auth.authState.value).toEqual({ status: 'ok', expiresAt })
    expect(auth.getAccessToken()).toBe('cached')
  })

  test('a cached token with under 30 s left is not handed out', async () => {
    await idb.idbSet('meta', 'token', { accessToken: 'nearly', expiresAt: Date.now() + 20_000 })
    stubGis()
    await auth.initAuth('client-1')
    expect(auth.getAccessToken()).toBeNull()
    expect(auth.authState.value.status).toBe('expired')
  })

  test('a cached token past its expiry shows as expired', async () => {
    await idb.idbSet('meta', 'token', { accessToken: 'old', expiresAt: Date.now() - 1 })
    stubGis()
    await auth.initAuth('client-1')
    expect(auth.authState.value.status).toBe('expired')
    expect(auth.getAccessToken()).toBeNull()
  })

  test('configures the token client with the client id, Drive scopes and an empty prompt', async () => {
    const gis = stubGis()
    await auth.initAuth('client-1')
    expect(gis.config).toMatchObject({ client_id: 'client-1', scope: DRIVE_SCOPES, prompt: '' })
  })
})

describe('connect', () => {
  test('resolves with a token from the popup and caches it in IndexedDB', async () => {
    const gis = stubGis()
    await auth.initAuth('client-1')

    const done = auth.connect()
    expect(gis.requests).toHaveLength(1)
    gis.config!.callback({ access_token: 'fresh', expires_in: 3599 })
    await done

    expect(auth.authState.value.status).toBe('ok')
    expect(auth.getAccessToken()).toBe('fresh')
    const stored = await idb.idbGet<{ accessToken: string; expiresAt: number }>('meta', 'token')
    expect(stored?.accessToken).toBe('fresh')
    expect(stored!.expiresAt).toBeGreaterThan(Date.now() + 3500_000)
  })

  test('rejects when the user closes the popup', async () => {
    const gis = stubGis()
    await auth.initAuth('client-1')
    const done = auth.connect()
    gis.config!.error_callback!({ type: 'popup_closed' })
    await expect(done).rejects.toThrow()
    expect(auth.authState.value.status).toBe('signed-out')
  })

  test('falls back to the redirect flow when the popup cannot open', async () => {
    const gis = stubGis()
    await auth.initAuth('client-1')

    void auth.connect()
    gis.config!.error_callback!({ type: 'popup_failed_to_open' })

    const url = new URL(location.href)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const q = url.searchParams
    expect(q.get('response_type')).toBe('token')
    expect(q.get('client_id')).toBe('client-1')
    expect(q.get('redirect_uri')).toBe(HOME)
    expect(q.get('scope')).toBe(DRIVE_SCOPES)
    expect(q.has('prompt')).toBe(false)
    expect(q.get('include_granted_scopes')).toBe('true')
    expect(q.get('state')).toBeTruthy()
    expect(sessionStorage.getItem('marginalia.oauthState')).toBe(q.get('state'))
  })
})

describe('consumeRedirectToken', () => {
  test('takes the token when state matches and strips the fragment', async () => {
    sessionStorage.setItem('marginalia.oauthState', 's1')
    location.hash = '#access_token=redir&token_type=Bearer&expires_in=3599&state=s1'

    expect(auth.consumeRedirectToken()).toBe(true)

    expect(location.hash).toBe('')
    expect(location.href).toBe(HOME)
    expect(auth.getAccessToken()).toBe('redir')
    expect(auth.authState.value.status).toBe('ok')
    expect((await idb.idbGet<{ accessToken: string }>('meta', 'token'))?.accessToken).toBe('redir')
  })

  test('rejects a mismatched state but still strips the fragment', () => {
    sessionStorage.setItem('marginalia.oauthState', 's1')
    location.hash = '#access_token=evil&expires_in=3599&state=other'

    expect(auth.consumeRedirectToken()).toBe(false)
    expect(location.hash).toBe('')
    expect(auth.getAccessToken()).toBeNull()
  })

  test('ignores an unrelated fragment', () => {
    location.hash = '#page=3'
    expect(auth.consumeRedirectToken()).toBe(false)
    expect(location.hash).toBe('#page=3')
  })
})

describe('maybeRenew', () => {
  async function connectedWith(expiresInMs: number): Promise<GisStub> {
    await idb.idbSet('meta', 'token', { accessToken: 't', expiresAt: Date.now() + expiresInMs })
    const gis = stubGis()
    await auth.initAuth('client-1')
    return gis
  }

  test('requests a silent renewal when less than the margin remains', async () => {
    const gis = await connectedWith(TOKEN_RENEW_MARGIN_MS - 1000)
    auth.maybeRenew()
    auth.maybeRenew()
    expect(gis.requests).toEqual([{ prompt: '' }])
  })

  test('does nothing while plenty of time remains', async () => {
    const gis = await connectedWith(TOKEN_RENEW_MARGIN_MS + 60_000)
    auth.maybeRenew()
    expect(gis.requests).toEqual([])
  })

  test('connect replaces an in-flight silent renewal with an interactive request', async () => {
    const gis = await connectedWith(1000)
    auth.maybeRenew()
    const done = auth.connect()
    expect(gis.requests).toHaveLength(2)

    gis.config!.error_callback!({ type: 'popup_failed_to_open' })

    expect(new URL(location.href).origin).toBe('https://accounts.google.com')
    void done
  })

  test('does not redirect away when a silent renewal popup cannot open', async () => {
    const gis = await connectedWith(1000)
    auth.maybeRenew()
    gis.config!.error_callback!({ type: 'popup_failed_to_open' })
    expect(location.href).toBe(HOME)
  })
})

test('signOut forgets and revokes the token', async () => {
  await idb.idbSet('meta', 'token', { accessToken: 't', expiresAt: Date.now() + 3600_000 })
  const gis = stubGis()
  await auth.initAuth('client-1')

  await auth.signOut()

  expect(auth.authState.value.status).toBe('signed-out')
  expect(auth.getAccessToken()).toBeNull()
  expect(await idb.idbGet('meta', 'token')).toBeUndefined()
  expect(gis.revoked).toEqual(['t'])
})
