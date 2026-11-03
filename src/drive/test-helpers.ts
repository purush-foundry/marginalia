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

interface FakeFile {
  id: string
  name: string
  mimeType: string
  parents: string[]
  version: number
  appProperties?: Record<string, string>
  content: string
  trashed: boolean
}

/** In-memory Drive v3 behind a mocked fetch: files.list by parents, get, media, multipart create, media update, changes. */
export class FakeDrive {
  files = new Map<string, FakeFile>()
  changeLog: string[] = []
  calls: Call[]
  /** Failure hooks: the first one returning a Response answers the call instead of the fake. */
  failWhen: Array<(call: Call) => Response | undefined> = []
  private nextId = 1

  constructor() {
    this.calls = mockFetch((call) => this.handle(call))
  }

  add(file: { id: string; name: string; mimeType: string; parents: string[]; appProperties?: Record<string, string>; content?: string }): void {
    this.files.set(file.id, { ...file, content: file.content ?? '', version: 1, trashed: false })
    this.changeLog.push(file.id)
  }

  update(id: string, patch: Partial<Omit<FakeFile, 'id' | 'version'>>): void {
    const file = this.files.get(id)!
    Object.assign(file, patch, { version: file.version + 1 })
    this.changeLog.push(id)
  }

  remove(id: string): void {
    this.files.delete(id)
    this.changeLog.push(id)
  }

  json<T>(id: string): T {
    return JSON.parse(this.files.get(id)!.content) as T
  }

  private raw(f: FakeFile) {
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      parents: f.parents,
      modifiedTime: '2026-01-01T00:00:00Z',
      version: String(f.version),
      size: String(f.content.length),
      ...(f.appProperties ? { appProperties: f.appProperties } : {}),
    }
  }

  private handle(call: Call): Response {
    for (const fail of this.failWhen) {
      const res = fail(call)
      if (res) return res
    }
    const { url, method } = call
    const path = url.pathname
    const params = url.searchParams
    if (path === '/drive/v3/files' && method === 'GET') {
      const q = params.get('q')!
      const parents = [...q.matchAll(/'([^']+)' in parents/g)].map((m) => m[1])
      const tag = q.match(/appProperties has \{ key='pdf' and value='([^']+)' \}/)?.[1]
      const name = q.match(/name = '([^']+)'/)?.[1]
      const files = [...this.files.values()].filter(
        (f) =>
          !f.trashed &&
          (!parents.length || f.parents.some((p) => parents.includes(p))) &&
          (!tag || f.appProperties?.pdf === tag) &&
          (!name || f.name === name),
      )
      return json({ files: files.map((f) => this.raw(f)) })
    }
    if (path === '/drive/v3/changes/startPageToken') return json({ startPageToken: String(this.changeLog.length) })
    if (path === '/drive/v3/changes') {
      const ids = this.changeLog.slice(Number(params.get('pageToken')))
      const changes = [...new Set(ids)].map((id) => {
        const f = this.files.get(id)
        return f ? { fileId: id, removed: false, file: { ...this.raw(f), trashed: f.trashed } } : { fileId: id, removed: true }
      })
      return json({ changes, newStartPageToken: String(this.changeLog.length) })
    }
    if (path === '/upload/drive/v3/files' && method === 'POST') {
      const boundary = call.headers['content-type'].split('boundary=')[1]
      const [meta, media] = call.body!.split(`--${boundary}`).slice(1, 3).map((p) => p.split('\r\n\r\n')[1].trim())
      const id = `created-${this.nextId++}`
      this.add({ id, ...(JSON.parse(meta) as Omit<FakeFile, 'id'>), content: media })
      return json(this.raw(this.files.get(id)!))
    }
    const fileMatch = path.match(/^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/)
    const file = fileMatch && this.files.get(decodeURIComponent(fileMatch[1]))
    if (!file) return driveError(404, 'notFound')
    if (method === 'PATCH') {
      this.update(file.id, { content: call.body! })
      return json(this.raw(file))
    }
    if (params.get('alt') === 'media') return new Response(file.content)
    return json(this.raw(file))
  }
}
