// Thin Drive v3 REST layer over fetch with bearer auth, JSON error mapping and rate-limit retries.
import { FOLDER_MIME, type DriveNode } from '../types'
import { authState, getAccessToken } from './auth'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const NODE_FIELDS = 'id,name,mimeType,parents,modifiedTime,version,size,md5Checksum,appProperties'
const LIST_FIELDS = `nextPageToken,files(${NODE_FIELDS})`
const CHANGES_FIELDS = `nextPageToken,newStartPageToken,changes(fileId,removed,file(${NODE_FIELDS},trashed))`
const PARENTS_PER_QUERY = 20
const PAGE_SIZE = '1000'
const MAX_RETRIES = 3
const RETRY_BASE_MS = 1000
const RATE_LIMIT_REASONS = new Set(['userRateLimitExceeded', 'rateLimitExceeded'])

/** JSON bodies above this many UTF-8 bytes are uploaded through a resumable session. */
export const SIMPLE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024

export class DriveError extends Error {
  status: number
  reason?: string
  constructor(status: number, reason?: string, message?: string) {
    super(`Drive ${status}${reason ? ` ${reason}` : ''}${message ? `: ${message}` : ''}`)
    this.name = 'DriveError'
    this.status = status
    this.reason = reason
  }
}

type RawNode = Omit<DriveNode, 'size' | 'parents'> & { size?: string; parents?: string[]; trashed?: boolean }

interface DriveChange {
  fileId: string
  removed: boolean
  file?: DriveNode & { trashed?: boolean }
}

function toNode(raw: RawNode): DriveNode & { trashed?: boolean } {
  const { size, parents, ...rest } = raw
  const node: DriveNode & { trashed?: boolean } = { ...rest, parents: parents ?? [] }
  if (size !== undefined) node.size = Number(size)
  return node
}

function url(base: string, path: string, params: Record<string, string>): string {
  return `${base}${path}?${new URLSearchParams(params)}`
}

function quote(id: string): string {
  return `'${id.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

async function readError(res: Response): Promise<DriveError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> }
  } | null
  const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status
  return new DriveError(res.status, reason, body?.error?.message)
}

// Sends an authorised request; retries rate limits with exponential backoff, expires auth on 401.
async function request(target: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = getAccessToken()
    if (!token) throw new DriveError(401, 'noToken', 'not connected to Drive')
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const res = await fetch(target, { ...init, headers })
    if (res.ok) return res
    const err = await readError(res)
    if (res.status === 401) {
      authState.value = { status: 'expired' }
      throw err
    }
    const rateLimited = res.status === 429 || (res.status === 403 && RATE_LIMIT_REASONS.has(err.reason ?? ''))
    if (!rateLimited || attempt >= MAX_RETRIES) throw err
    await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * 2 ** attempt))
  }
}

async function getJson<T>(target: string, init?: RequestInit): Promise<T> {
  return (await (await request(target, init)).json()) as T
}

async function listAll(q: string): Promise<DriveNode[]> {
  const nodes: DriveNode[] = []
  let pageToken: string | undefined
  do {
    const params: Record<string, string> = { q, fields: LIST_FIELDS, pageSize: PAGE_SIZE }
    if (pageToken) params.pageToken = pageToken
    const page = await getJson<{ files: RawNode[]; nextPageToken?: string }>(url(API, '/files', params))
    nodes.push(...page.files.map(toNode))
    pageToken = page.nextPageToken
  } while (pageToken)
  return nodes
}

/** Non-trashed children of the given folders; batches up to 20 parents per query and follows nextPageToken. */
export async function listChildren(parentIds: string[]): Promise<DriveNode[]> {
  const nodes: DriveNode[] = []
  for (let i = 0; i < parentIds.length; i += PARENTS_PER_QUERY) {
    const batch = parentIds.slice(i, i + PARENTS_PER_QUERY)
    const parents = batch.map((id) => `${quote(id)} in parents`).join(' or ')
    nodes.push(...(await listAll(`(${parents}) and trashed = false`)))
  }
  return nodes
}

/** Folders directly under My Drive, for the first-run root picker. */
export function listMyDriveFolders(): Promise<DriveNode[]> {
  return listAll(`'root' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`)
}

export async function getNode(id: string): Promise<DriveNode> {
  return toNode(await getJson<RawNode>(url(API, `/files/${encodeURIComponent(id)}`, { fields: NODE_FIELDS })))
}

/** Downloads file content; onProgress receives the bytes received so far. */
export async function downloadFile(id: string, onProgress?: (bytesReceived: number) => void): Promise<Blob> {
  const res = await request(url(API, `/files/${encodeURIComponent(id)}`, { alt: 'media' }))
  if (!onProgress || !res.body) return res.blob()
  const reader = res.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onProgress(received)
  }
  return new Blob(chunks, { type: res.headers.get('Content-Type') ?? '' })
}

export async function downloadJson<T>(id: string): Promise<T> {
  return getJson<T>(url(API, `/files/${encodeURIComponent(id)}`, { alt: 'media' }))
}

function exceedsSimpleUpload(text: string): boolean {
  return new TextEncoder().encode(text).byteLength > SIMPLE_UPLOAD_MAX_BYTES
}

// Opens a resumable upload session with the metadata, then PUTs the JSON text to the session URL.
async function uploadResumable(method: 'POST' | 'PATCH', path: string, metadata: object, text: string): Promise<DriveNode> {
  const session = await request(url(UPLOAD, path, { uploadType: 'resumable', fields: NODE_FIELDS }), {
    method,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  })
  const location = session.headers.get('Location')
  if (!location) throw new DriveError(session.status, 'noUploadSession', 'resumable upload returned no session URL')
  const raw = await getJson<RawNode>(location, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text })
  return toNode(raw)
}

/** Creates a JSON file with metadata in one multipart upload, or a resumable session above SIMPLE_UPLOAD_MAX_BYTES. */
export async function createJsonFile(
  name: string,
  parentId: string,
  body: unknown,
  appProperties: Record<string, string>,
): Promise<DriveNode> {
  const metadata = { name, parents: [parentId], mimeType: 'application/json', appProperties }
  const text = JSON.stringify(body)
  if (exceedsSimpleUpload(text)) return uploadResumable('POST', '/files', metadata, text)
  const boundary = `marginalia-${crypto.randomUUID()}`
  const multipart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    text,
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const raw = await getJson<RawNode>(url(UPLOAD, '/files', { uploadType: 'multipart', fields: NODE_FIELDS }), {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  })
  return toNode(raw)
}

/** Replaces a JSON file's content, through a resumable session above SIMPLE_UPLOAD_MAX_BYTES. */
export async function updateJsonFile(id: string, body: unknown): Promise<DriveNode> {
  const path = `/files/${encodeURIComponent(id)}`
  const text = JSON.stringify(body)
  if (exceedsSimpleUpload(text)) return uploadResumable('PATCH', path, {}, text)
  const raw = await getJson<RawNode>(url(UPLOAD, path, { uploadType: 'media', fields: NODE_FIELDS }), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: text,
  })
  return toNode(raw)
}

/** An existing companion file of the given kind for the PDF: by its appProperties tag and PDF key, else by name in the parent folder. */
export async function findCompanionFile(
  pdfId: string,
  name: string,
  parentId: string,
  tag: '1' | 'notes',
  pdfKey: 'pdf' | 'notesFor',
): Promise<DriveNode | null> {
  const kind = tag === '1' ? '' : ` and appProperties has { key='marginalia' and value=${quote(tag)} }`
  const tagged = await listAll(`appProperties has { key=${quote(pdfKey)} and value=${quote(pdfId)} }${kind} and trashed = false`)
  const match = tagged.find((node) => node.appProperties?.marginalia === tag)
  if (match) return match
  const [named] = await listAll(`name = ${quote(name)} and ${quote(parentId)} in parents and trashed = false`)
  return named ?? null
}

/** An existing sidecar for the PDF: by appProperties.pdf, else by name in the parent folder. */
export function findSidecarFile(pdfId: string, name: string, parentId: string): Promise<DriveNode | null> {
  return findCompanionFile(pdfId, name, parentId, '1', 'pdf')
}

export async function getStartPageToken(): Promise<string> {
  return (await getJson<{ startPageToken: string }>(url(API, '/changes/startPageToken', {}))).startPageToken
}

export async function listChanges(
  pageToken: string,
): Promise<{ changes: DriveChange[]; newStartPageToken?: string; nextPageToken?: string }> {
  const page = await getJson<{
    changes: Array<{ fileId: string; removed: boolean; file?: RawNode }>
    newStartPageToken?: string
    nextPageToken?: string
  }>(url(API, '/changes', { pageToken, fields: CHANGES_FIELDS, pageSize: PAGE_SIZE }))
  return {
    ...page,
    changes: page.changes.map(({ file, ...c }): DriveChange => (file ? { ...c, file: toNode(file) } : c)),
  }
}
