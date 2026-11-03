// Per-device settings in IndexedDB, exposed as a signal; defaults come from config.ts.
import { signal } from '@preact/signals'
import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL, GOOGLE_CLIENT_ID } from '../config'
import { idbGet, idbSet } from '../lib/idb'
import type { Settings } from '../types'

export interface AppSettings extends Settings {
  /** A pen pointer has been seen on this device. */
  penSeen: boolean
}

const KEY = 'app'

export const DEFAULT_SETTINGS: AppSettings = {
  googleClientId: GOOGLE_CLIENT_ID,
  anthropicApiKey: '',
  textModel: DEFAULT_TEXT_MODEL,
  visionModel: DEFAULT_VISION_MODEL,
  nightMode: false,
  invertImages: false,
  fingerDraws: false,
  penSeen: false,
}

export const settings = signal<AppSettings>(DEFAULT_SETTINGS)

/** Reads stored settings over the defaults; an empty client id falls back to config.ts. */
export async function loadSettings(): Promise<AppSettings> {
  const stored = await idbGet<Partial<AppSettings>>('settings', KEY)
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...stored }
  if (!merged.googleClientId) merged.googleClientId = GOOGLE_CLIENT_ID
  settings.value = merged
  return merged
}

/** Applies a patch to the signal and stores the result. */
export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  settings.value = { ...settings.value, ...patch }
  await idbSet('settings', KEY, settings.value)
}
