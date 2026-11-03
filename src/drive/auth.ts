// Google Identity Services token model: popup sign-in, redirect fallback, cached token, silent renewal.
import { signal } from '@preact/signals'
import { DRIVE_SCOPES, TOKEN_RENEW_MARGIN_MS } from '../config'
import { idbDel, idbGet, idbSet } from '../lib/idb'
import { newId } from '../lib/ids'

export interface AuthState {
  status: 'signed-out' | 'ok' | 'expired'
  expiresAt?: number
}

interface Token {
  accessToken: string
  expiresAt: number
}

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const STATE_KEY = 'marginalia.oauthState'
const DEFAULT_EXPIRES_IN_S = 3600
const GIS_LOAD_TIMEOUT_MS = 10_000
const TOKEN_EXPIRY_SKEW_MS = 30_000

export const authState = signal<AuthState>({ status: 'signed-out' })
/** False when the GIS script could not load (typically offline). */
export const gisAvailable = signal(false)

let token: Token | null = null
let activeClientId = ''
let tokenClient: GisTokenClient | null = null
let gisLoad: Promise<boolean> | null = null
let requesting: { interactive: boolean } | null = null
let waiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = []

function oauth2(): GisOauth2 | undefined {
  return window.google?.accounts?.oauth2
}

function setToken(t: Token): void {
  token = t
  authState.value = { status: 'ok', expiresAt: t.expiresAt }
  idbSet('meta', 'token', t).catch(() => undefined)
}

function settle(error?: Error): void {
  const pending = waiters
  waiters = []
  for (const w of pending) {
    if (error) w.reject(error)
    else w.resolve()
  }
}

// Injects the GIS script once; resolves false if it fails to load or times out.
function loadGis(): Promise<boolean> {
  if (oauth2()) return Promise.resolve(true)
  gisLoad ??= new Promise((resolve) => {
    const script = document.createElement('script')
    const fail = () => {
      clearTimeout(timer)
      gisLoad = null
      script.remove()
      resolve(false)
    }
    const timer = setTimeout(fail, GIS_LOAD_TIMEOUT_MS)
    script.src = GIS_SRC
    script.async = true
    script.onload = () => {
      clearTimeout(timer)
      resolve(Boolean(oauth2()))
    }
    script.onerror = fail
    document.head.appendChild(script)
  })
  return gisLoad
}

function onTokenResponse(response: GisTokenResponse): void {
  requesting = null
  if (response.error || !response.access_token) {
    settle(new Error(response.error_description ?? response.error ?? 'No access token returned'))
    return
  }
  const expiresIn = Number(response.expires_in ?? DEFAULT_EXPIRES_IN_S)
  setToken({ accessToken: response.access_token, expiresAt: Date.now() + expiresIn * 1000 })
  settle()
}

function onTokenError(error: GisClientConfigError): void {
  const interactive = requesting?.interactive ?? false
  requesting = null
  if (error.type === 'popup_failed_to_open' && interactive) {
    redirectToGoogle()
    return
  }
  settle(new Error(error.message ?? error.type))
}

// Navigates to Google's implicit-flow endpoint; the token returns in the URL fragment.
function redirectToGoogle(): void {
  const state = newId()
  sessionStorage.setItem(STATE_KEY, state)
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: activeClientId,
    redirect_uri: location.origin + import.meta.env.BASE_URL,
    scope: DRIVE_SCOPES,
    include_granted_scopes: 'true',
    state,
  })
  location.assign(`${OAUTH_URL}?${params.toString().replace(/\+/g, '%20')}`)
}

// Starts a GIS token request unless one is in flight; an interactive request supersedes a silent one.
function requestToken(interactive: boolean): void {
  if (!tokenClient) return
  if (requesting && (requesting.interactive || !interactive)) return
  requesting = { interactive }
  tokenClient.requestAccessToken({ prompt: '' })
}

/** Loads https://accounts.google.com/gsi/client (tolerates offline), restores a cached token. */
export async function initAuth(clientId: string): Promise<void> {
  activeClientId = clientId
  if (!token) {
    const cached = await idbGet<Token>('meta', 'token')
    if (cached && !token) {
      token = cached
      authState.value = {
        status: cached.expiresAt > Date.now() ? 'ok' : 'expired',
        expiresAt: cached.expiresAt,
      }
    }
  }
  gisAvailable.value = await loadGis()
  const api = oauth2()
  tokenClient =
    api && activeClientId
      ? api.initTokenClient({
          client_id: activeClientId,
          scope: DRIVE_SCOPES,
          prompt: '',
          callback: onTokenResponse,
          error_callback: onTokenError,
        })
      : null
}

/** Must run inside a user gesture: opens the GIS popup; on `popup_failed_to_open` falls back to the implicit redirect flow. */
export function connect(): Promise<void> {
  if (!activeClientId) return Promise.reject(new Error('Google client id is not set'))
  if (!tokenClient) return Promise.reject(new Error('Google sign-in is unavailable; are you offline?'))
  return new Promise((resolve, reject) => {
    waiters.push({ resolve, reject })
    requestToken(true)
  })
}

/** The current token, or null when absent, expired or within TOKEN_EXPIRY_SKEW_MS of expiry. */
export function getAccessToken(): string | null {
  if (!token || authState.peek().status !== 'ok') return null
  if (token.expiresAt - Date.now() <= TOKEN_EXPIRY_SKEW_MS) {
    authState.value = { status: 'expired', expiresAt: token.expiresAt }
    return null
  }
  return token.accessToken
}

/** Call on any user gesture; renews silently (prompt: '') when less than TOKEN_RENEW_MARGIN_MS remains. */
export function maybeRenew(): void {
  if (!token) return
  const fresh = authState.peek().status === 'ok' && token.expiresAt - Date.now() >= TOKEN_RENEW_MARGIN_MS
  if (!fresh) requestToken(false)
}

export async function signOut(): Promise<void> {
  const old = token
  token = null
  authState.value = { status: 'signed-out' }
  await idbDel('meta', 'token')
  if (old) oauth2()?.revoke(old.accessToken)
}

/** Handles the `#access_token=` fragment after a redirect-flow return; returns true if one was consumed. */
export function consumeRedirectToken(): boolean {
  const params = new URLSearchParams(location.hash.slice(1))
  if (!params.has('access_token') && !params.has('error')) return false
  history.replaceState(history.state, '', location.pathname + location.search)
  const expected = sessionStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(STATE_KEY)
  const accessToken = params.get('access_token')
  if (!accessToken || !expected || params.get('state') !== expected) return false
  const expiresIn = Number(params.get('expires_in') ?? DEFAULT_EXPIRES_IN_S)
  setToken({ accessToken, expiresAt: Date.now() + expiresIn * 1000 })
  return true
}
