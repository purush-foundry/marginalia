// Test-only helpers: sign in through the real auth path with a stubbed GIS, and capture fetch calls.
import { vi } from 'vitest'

export const TEST_TOKEN = 'test-token'

export interface Call {
  url: URL
  method: string
  headers: Record<string, string>
  body: string | undefined
}

/** Restores a valid cached token through initAuth, with GIS stubbed so no script is loaded. */
export async function signIn(): Promise<void> {
  const { idbSet } = await import('../lib/idb')
  const { initAuth } = await import('./auth')
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: () => ({ requestAccessToken: () => undefined }),
        revoke: () => undefined,
      },
    },
  }
  await idbSet('meta', 'token', { accessToken: TEST_TOKEN, expiresAt: Date.now() + 3600_000 })
  await initAuth('test-client')
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function driveError(status: number, reason: string): Response {
  return json({ error: { code: status, message: reason, errors: [{ reason, message: reason }] } }, status)
}

/** Replaces global fetch with a handler and records every call. */
export function mockFetch(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call: Call = {
        url: new URL(input),
        method: init.method ?? 'GET',
        headers: Object.fromEntries([...new Headers(init.headers).entries()].map(([k, v]) => [k.toLowerCase(), v])),
        body: typeof init.body === 'string' ? init.body : undefined,
      }
      calls.push(call)
      return handler(call)
    }),
  )
  return calls
}
