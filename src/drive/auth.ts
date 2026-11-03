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
const RETURN_KEY = 'marginalia.oauthReturn'
const REQUEST_TIMEOUT_MS = 60_000
const DEFAULT_EXPIRES_IN_S = 3600
const GIS_LOAD_TIMEOUT_MS = 10_000
const TOKEN_EXPIRY_SKEW_MS = 30_000

export const authState = signal<AuthState>({ status: 'signed-out' })
/** False when the GIS script could not load (typically offline). */
export const gisAvailable = signal(false)
/** The error Google returned to the last redirect sign-in, if any. */
export const authError = signal<string | null>(null)

let token: Token | null = null
let activeClientId = ''
let tokenClient: GisTokenClient | null = null
let gisLoad: Promise<boolean> | null = null
interface TokenRequest {
  interactive: boolean
}

/** GIS requests awaiting a callback, oldest first; each callback answers the oldest. */
let inflight: TokenRequest[] = []
let requestTimer: ReturnType<typeof setTimeout> | undefined
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

// Takes the oldest in-flight request off the list; clears the timeout once none remain.
function answer(): TokenRequest | undefined {
  const request = inflight.shift()
  if (!inflight.length) clearTimeout(requestTimer)
  return request
}

// Settles waiters with an error unless it belongs to a silent request superseded by a pending interactive one.
function fail(request: TokenRequest | undefined, error: Error): void {
  if (!request?.interactive && inflight.some((r) => r.interactive)) return
  settle(error)
}

function onTokenResponse(response: GisTokenResponse): void {
  const request = answer()
  if (response.error || !response.access_token) {
    fail(request, new Error(response.error_description ?? response.error ?? 'No access token returned'))
    return
  }
  const expiresIn = Number(response.expires_in ?? DEFAULT_EXPIRES_IN_S)
  setToken({ accessToken: response.access_token, expiresAt: Date.now() + expiresIn * 1000 })
  settle()
}

function onTokenError(error: GisClientConfigError): void {
  const request = answer()
  if (error.type === 'popup_failed_to_open' && request?.interactive) {
    redirectToGoogle()
    return
  }
  fail(request, new Error(error.message ?? error.type))
}

// Forgets every in-flight request and rejects waiters when Google never answers.
function onRequestTimeout(): void {
  inflight = []
  settle(new Error('Google sign-in did not respond; try signing in with a redirect instead'))
}

// Navigates to Google's implicit-flow endpoint; the token returns in the URL fragment and the current route is restored after.
function redirectToGoogle(): void {
  const state = newId()
  sessionStorage.setItem(STATE_KEY, state)
  sessionStorage.setItem(RETURN_KEY, location.hash)
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
  if (inflight.some((r) => r.interactive || !interactive)) return
  inflight.push({ interactive })
  clearTimeout(requestTimer)
  requestTimer = setTimeout(onRequestTimeout, REQUEST_TIMEOUT_MS)
  tokenClient.requestAccessToken({ prompt: '' })
}

function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
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

/** Leaves the app for Google's sign-in page; the token comes back in the URL fragment. */
export function connectWithRedirect(): void {
  if (activeClientId) redirectToGoogle()
}

/** Must run inside a user gesture: opens the GIS popup (the redirect flow in an iOS home-screen app); on `popup_failed_to_open` falls back to the redirect flow. */
export function connect(): Promise<void> {
  if (!activeClientId) return Promise.reject(new Error('Google client id is not set'))
  authError.value = null
  if (isStandalone()) {
    redirectToGoogle()
    return new Promise(() => undefined)
  }
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

/** Call on an activation-triggering gesture; renews silently (prompt: '') when a live token has less than TOKEN_RENEW_MARGIN_MS left. */
export function maybeRenew(): void {
  if (!token || authState.peek().status !== 'ok') return
  if (token.expiresAt - Date.now() < TOKEN_RENEW_MARGIN_MS) requestToken(false)
}

export async function signOut(): Promise<void> {
  const old = token
  token = null
  authState.value = { status: 'signed-out' }
  await idbDel('meta', 'token')
  if (old) oauth2()?.revoke(old.accessToken)
}

/** Handles the `#access_token=` fragment, or `#error=` while a redirect sign-in is pending, restoring the route it left from; returns true if a token was consumed. */
export function consumeRedirectToken(): boolean {
  const params = new URLSearchParams(location.hash.slice(1))
  const expected = sessionStorage.getItem(STATE_KEY)
  if (!params.has('access_token') && !(params.has('error') && expected)) return false
  const returnHash = sessionStorage.getItem(RETURN_KEY) ?? ''
  history.replaceState(history.state, '', location.pathname + location.search + returnHash)
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(RETURN_KEY)
  const error = params.get('error')
  if (error) {
    authError.value = `Google sign-in failed: ${params.get('error_description') ?? error}`
    return false
  }
  const accessToken = params.get('access_token')
  if (!accessToken || !expected || params.get('state') !== expected) return false
  const expiresIn = Number(params.get('expires_in') ?? DEFAULT_EXPIRES_IN_S)
  setToken({ accessToken, expiresAt: Date.now() + expiresIn * 1000 })
  return true
}
