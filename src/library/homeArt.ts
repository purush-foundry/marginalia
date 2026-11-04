// Home picture: orientation-based choice among the Drive files, an IndexedDB byte cache and the object URL it serves.
import { signal } from '@preact/signals'
import { downloadFile } from '../drive/api'
import { getAccessToken } from '../drive/auth'
import { idbDel, idbGet, idbKeys, idbSet } from '../lib/idb'
import type { DriveNode, HomeArtFiles } from '../types'

interface HomeArtRecord {
  id: string
  version: string
  type: string
  bytes: ArrayBuffer
}

const PREFIX = 'homeArt:'
const LANDSCAPE_QUERY = '(orientation: landscape)'
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

export function pickHomeArt(files: HomeArtFiles | undefined, landscape: boolean): DriveNode | undefined {
  if (!files) return undefined
  return landscape ? (files.landscape ?? files.generic ?? files.portrait) : (files.portrait ?? files.generic ?? files.landscape)
}

function queryLandscape(): boolean {
  return typeof matchMedia === 'function' ? matchMedia(LANDSCAPE_QUERY).matches : true
}

export const isLandscape = signal(queryLandscape())
export const homeArtUrl = signal<string | null>(null)

// Keeps isLandscape in step with the device orientation; returns the stop function.
export function watchOrientation(): () => void {
  if (typeof matchMedia !== 'function') return () => undefined
  const mq = matchMedia(LANDSCAPE_QUERY)
  const onChange = (e: { matches: boolean }) => {
    isLandscape.value = e.matches
  }
  isLandscape.value = mq.matches
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function typeOf(name: string): string {
  return TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/jpeg'
}

let currentUrl: string | null = null
let calls = 0

function show(record: HomeArtRecord | undefined): void {
  const next = record ? URL.createObjectURL(new Blob([record.bytes], { type: record.type })) : null
  if (currentUrl) URL.revokeObjectURL(currentUrl)
  currentUrl = next
  homeArtUrl.value = next
}

// Shows node's picture (cached by version, else downloaded) and deletes cached pictures whose id is not in keep.
export async function refreshHomeArt(node: DriveNode | undefined, keep: string[]): Promise<void> {
  const call = ++calls
  const keys = (await idbKeys('meta')).filter((k) => k.startsWith(PREFIX) && !keep.includes(k.slice(PREFIX.length)))
  await Promise.all(keys.map((k) => idbDel('meta', k)))
  if (call !== calls) return
  if (!node) return show(undefined)
  const key = `${PREFIX}${node.id}`
  const cached = await idbGet<HomeArtRecord>('meta', key)
  if (call !== calls) return
  if (cached && cached.version === node.version) return show(cached)
  let record = cached
  if (getAccessToken()) {
    try {
      const blob = await downloadFile(node.id)
      const fresh: HomeArtRecord = { id: node.id, version: node.version, type: typeOf(node.name), bytes: await blob.arrayBuffer() }
      if (call !== calls) return
      await idbSet('meta', key, fresh)
      record = fresh
    } catch {
      // keep the cached picture, if any
    }
  }
  if (call !== calls) return
  show(record)
}
