// Browser client for the local agent host: reachability state, pairing, paper upload, sessions and verdict runs.
import { signal } from '@preact/signals'
import { HOST_DEFAULT_URL } from '../config'
import { saveSettings, settings } from '../app/settings'
import { sseEvents } from '../lib/sse'
import type { PageText } from '../types'
import type { HostEvent, MessageBody, PaperUpload, StatusResponse } from '../../host/src/protocol.ts'

export type HostState =
  | { status: 'off' }
  | { status: 'unreachable' }
  | { status: 'unauthorised' }
  | { status: 'ready'; info: StatusResponse }

export interface PaperSource {
  name: string
  title: string | null
  pages: PageText[]
  bytes: ArrayBuffer
}

const PROBE_TIMEOUT_MS = 3_000

export const hostState = signal<HostState>({ status: 'off' })

const uploaded = new Set<string>()

class HostHttpError extends Error {
  status: number

  constructor(status: number) {
    super(`Agent host returned HTTP ${status}`)
    this.status = status
  }
}

function request(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const { hostUrl, hostToken } = settings.peek()
  return fetch(hostUrl + path, {
    method,
    mode: 'cors',
    headers: { Authorization: 'Bearer ' + hostToken, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    targetAddressSpace: 'loopback',
  } as RequestInit)
}

async function call(path: string, method: string, body?: unknown): Promise<Response> {
  const res = await request(path, method, body)
  if (!res.ok) throw new HostHttpError(res.status)
  return res
}

async function permissionState(): Promise<string | null> {
  try {
    const res = await navigator.permissions.query({ name: 'loopback-network' } as unknown as PermissionDescriptor)
    return res.state
  } catch {
    return null
  }
}

/** Probes GET /status; `gesture` allows the loopback permission prompt; a 401 sets `unauthorised`. */
export async function probeHost(gesture = false): Promise<HostState> {
  if (!settings.peek().hostToken) return (hostState.value = { status: 'off' })
  if (!gesture && (await permissionState()) === 'prompt') return hostState.peek()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS)
  let next: HostState
  try {
    const res = await request('/status', 'GET', undefined, ctl.signal)
    if (res.status === 401) next = { status: 'unauthorised' }
    else if (!res.ok) next = { status: 'unreachable' }
    else next = { status: 'ready', info: (await res.json()) as StatusResponse }
  } catch {
    next = { status: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
  return (hostState.value = next)
}

export function pairHost(token: string, url: string = HOST_DEFAULT_URL): Promise<void> {
  return saveSettings({ hostToken: token, hostUrl: url }).then(() => {
    hostState.value = { status: 'unreachable' }
  })
}

export async function forgetHost(): Promise<void> {
  uploaded.clear()
  await saveSettings({ hostToken: '' })
  hostState.value = { status: 'off' }
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < view.length; i += 0x8000) bin += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Uploads the paper once per app session. */
export async function uploadPaper(pdfId: string, source: PaperSource): Promise<void> {
  if (uploaded.has(pdfId)) return
  const body: PaperUpload = {
    name: source.name,
    title: source.title,
    pages: source.pages.map((p) => ({ n: p.page, text: p.text })),
    pdf: toBase64(source.bytes),
  }
  await call(`/papers/${encodeURIComponent(pdfId)}`, 'PUT', body)
  uploaded.add(pdfId)
}

export async function openSession(pdfId: string, sessionId: string | null, fresh: boolean): Promise<string> {
  const res = await call('/sessions', 'POST', { pdfId, sessionId, fresh })
  return ((await res.json()) as { sessionId: string }).sessionId
}

async function* events(path: string, signal: AbortSignal): AsyncGenerator<HostEvent> {
  const res = await request(path, 'GET', undefined, signal)
  if (!res.ok) throw new HostHttpError(res.status)
  if (!res.body) return
  try {
    yield* sseEvents(res.body, (data) => JSON.parse(data) as HostEvent)
  } catch (err) {
    if (signal.aborted) return
    throw err
  }
}

export function sessionEvents(sessionId: string, signal: AbortSignal): AsyncGenerator<HostEvent> {
  return events(`/sessions/${encodeURIComponent(sessionId)}/events`, signal)
}

export async function sendMessage(sessionId: string, body: MessageBody): Promise<void> {
  await call(`/sessions/${encodeURIComponent(sessionId)}/messages`, 'POST', body)
}

export async function interrupt(sessionId: string): Promise<void> {
  await call(`/sessions/${encodeURIComponent(sessionId)}/interrupt`, 'POST')
}

/** Uploads the paper if needed, runs the verdict skill on the host and resolves with the note markdown. */
export async function hostVerdict(pdfId: string, source: PaperSource): Promise<string> {
  await uploadPaper(pdfId, source)
  const { jobId } = (await (await call('/verdicts', 'POST', { pdfId })).json()) as { jobId: string }
  const ctl = new AbortController()
  try {
    for await (const ev of events(`/verdicts/${encodeURIComponent(jobId)}/events`, ctl.signal)) {
      if (ev.type === 'note') return ev.markdown
      if (ev.type === 'error') throw new Error(ev.message)
    }
  } finally {
    ctl.abort()
  }
  throw new Error('The agent host finished without a note.')
}
