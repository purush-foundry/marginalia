// Per-device settings in IndexedDB, exposed as a signal; defaults come from config.ts.
import { effect, signal } from '@preact/signals'
import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL, GOOGLE_CLIENT_ID } from '../config'
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_WIDTH, PEN_COLORS, PEN_WIDTHS, penColor, penWidth } from '../ink/tools'
import { idbGet, idbSet } from '../lib/idb'
import type { Settings } from '../types'

export interface AppSettings extends Settings {
  /** A pen pointer has been seen on this device. */
  penSeen: boolean
  /** Ink colour the pen draws with on this device. */
  penColor: string
  /** Pen width as a fraction of page or sheet width. */
  penWidth: number
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
  penColor: DEFAULT_PEN_COLOR,
  penWidth: DEFAULT_PEN_WIDTH,
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

/** Copies the stored pen colour and width into the pen signals and saves them back on change; returns the unsubscribe. */
export function bindPenPalette(): () => void {
  const stored = settings.peek()
  penColor.value = PEN_COLORS.some((c) => c.value === stored.penColor) ? stored.penColor : DEFAULT_PEN_COLOR
  penWidth.value = PEN_WIDTHS.some((w) => w.value === stored.penWidth) ? stored.penWidth : DEFAULT_PEN_WIDTH
  return effect(() => {
    const color = penColor.value
    const width = penWidth.value
    const current = settings.peek()
    if (color !== current.penColor || width !== current.penWidth) {
      saveSettings({ penColor: color, penWidth: width }).catch(console.error)
    }
  })
}
