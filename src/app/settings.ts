// Per-device settings in IndexedDB, exposed as a signal; defaults come from config.ts.
import { effect, signal, untracked } from '@preact/signals'
import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL, GOOGLE_CLIENT_ID } from '../config'
import {
  DEFAULT_ERASER_SETTINGS,
  DEFAULT_HIGHLIGHTER_SETTINGS,
  DEFAULT_LASSO_SETTINGS,
  DEFAULT_PALETTES,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_SETTINGS,
  DEFAULT_PEN_WIDTH,
  MAX_COLOR_SLOTS,
  PEN_COLORS,
  PEN_WIDTHS,
  WIDTH_RANGE_MM,
  eraserSettings,
  highlighterSettings,
  lassoSettings,
  palettes,
  penColor,
  penSettings,
  penWidth,
  textSize,
  type EraserSettings,
  type HighlighterSettings,
  type LassoSettings,
  type PaletteTool,
  type PenSettings,
  type TextSize,
  type ToolPalette,
} from '../ink/tools'
import { idbGet, idbSet } from '../lib/idb'
import type { Settings } from '../types'

export type NotesLayout = 'paper' | 'both' | 'notes'
export type DockEdge = 'left' | 'right' | 'top' | 'bottom'

export interface AppSettings extends Settings {
  /** A pen pointer has been seen on this device. */
  penSeen: boolean
  /** Ink colour the pen draws with on this device. */
  penColor: string
  /** Pen width as a fraction of page or sheet width. */
  penWidth: number
  /** Tool puck centre as a fraction of the host height. */
  puckY: number
  /** Reader panes: the paper, the paper beside the notes sheet, or the notes sheet. */
  notesLayout: NotesLayout
  /** Paper pane width as a fraction of the panes in the Both layout. */
  splitRatio: number
  palettes: Record<PaletteTool, ToolPalette>
  penSettings: PenSettings
  highlighterSettings: HighlighterSettings
  eraserSettings: EraserSettings
  lassoSettings: LassoSettings
  textSize: TextSize
  /** Tool dock edge and its position along that edge as a fraction. */
  toolDock: { edge: DockEdge; at: number }
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
  puckY: 0.6,
  notesLayout: 'paper',
  splitRatio: 0.5,
  palettes: DEFAULT_PALETTES,
  penSettings: DEFAULT_PEN_SETTINGS,
  highlighterSettings: DEFAULT_HIGHLIGHTER_SETTINGS,
  eraserSettings: DEFAULT_ERASER_SETTINGS,
  lassoSettings: DEFAULT_LASSO_SETTINGS,
  textSize: 'm',
  toolDock: { edge: 'right', at: 0.6 },
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
  if (patch.puckY !== undefined) patch = { ...patch, puckY: Math.min(1, Math.max(0, patch.puckY)) }
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

const HEX = /^#[0-9a-f]{6}$/i
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isIndex = (v: unknown, n: number): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n

function sanitizePalette(v: unknown, tool: PaletteTool): ToolPalette {
  const fallback = DEFAULT_PALETTES[tool]
  if (!isObj(v) || !Array.isArray(v.colors) || !Array.isArray(v.widthsMm)) return fallback
  const { colors, widthsMm, colorIndex, widthIndex } = v
  if (colors.length < 1 || colors.length > MAX_COLOR_SLOTS) return fallback
  if (!colors.every((c) => typeof c === 'string' && HEX.test(c))) return fallback
  if (tool === 'text') {
    if (widthsMm.length !== 0) return fallback
  } else {
    const { min, max } = WIDTH_RANGE_MM[tool]
    if (widthsMm.length !== 3) return fallback
    if (!widthsMm.every((w) => typeof w === 'number' && Number.isFinite(w) && w >= min && w <= max)) return fallback
  }
  if (!isIndex(colorIndex, colors.length)) return fallback
  if (tool === 'text' ? widthIndex !== 0 : !isIndex(widthIndex, 3)) return fallback
  return {
    colors: [...colors],
    widthsMm: [...widthsMm],
    colorIndex: colorIndex as number,
    widthIndex: widthIndex as number,
  }
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback
}

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

/** Validates stored tool settings field by field, falling back to the default for each invalid field. */
export function sanitizeToolSettings(
  stored: Partial<AppSettings>,
): Pick<
  AppSettings,
  'palettes' | 'penSettings' | 'highlighterSettings' | 'eraserSettings' | 'lassoSettings' | 'textSize' | 'toolDock'
> {
  const p: unknown = stored.palettes
  const pen: unknown = stored.penSettings
  const hl: unknown = stored.highlighterSettings
  const er: unknown = stored.eraserSettings
  const lasso: unknown = stored.lassoSettings
  const dock: unknown = stored.toolDock
  const palette = (t: PaletteTool) => sanitizePalette(isObj(p) ? p[t] : undefined, t)
  const at =
    isObj(dock) && typeof dock.at === 'number' && !Number.isNaN(dock.at) ? Math.min(1, Math.max(0, dock.at)) : 0.6
  return {
    palettes: {
      pen: palette('pen'),
      highlighter: palette('highlighter'),
      text: palette('text'),
    },
    penSettings: {
      style: pick(isObj(pen) ? pen.style : undefined, ['ball', 'fountain', 'brush'], DEFAULT_PEN_SETTINGS.style),
      drawAndHold: bool(isObj(pen) ? pen.drawAndHold : undefined, DEFAULT_PEN_SETTINGS.drawAndHold),
    },
    highlighterSettings: {
      straight: bool(isObj(hl) ? hl.straight : undefined, DEFAULT_HIGHLIGHTER_SETTINGS.straight),
    },
    eraserSettings: {
      style: pick(isObj(er) ? er.style : undefined, ['stroke', 'segment'], DEFAULT_ERASER_SETTINGS.style),
      sizeMm:
        isObj(er) && (er.sizeMm === 2 || er.sizeMm === 4 || er.sizeMm === 8)
          ? er.sizeMm
          : DEFAULT_ERASER_SETTINGS.sizeMm,
      erasePen: bool(isObj(er) ? er.erasePen : undefined, DEFAULT_ERASER_SETTINGS.erasePen),
      eraseHighlighter: bool(isObj(er) ? er.eraseHighlighter : undefined, DEFAULT_ERASER_SETTINGS.eraseHighlighter),
      autoDeselect: bool(isObj(er) ? er.autoDeselect : undefined, DEFAULT_ERASER_SETTINGS.autoDeselect),
    },
    lassoSettings: {
      rect: bool(isObj(lasso) ? lasso.rect : undefined, DEFAULT_LASSO_SETTINGS.rect),
    },
    textSize: pick(stored.textSize, ['s', 'm', 'l'], 'm'),
    toolDock: {
      edge: pick(isObj(dock) ? dock.edge : undefined, ['left', 'right', 'top', 'bottom'], 'right'),
      at,
    },
  }
}

/** Copies the sanitised stored tool settings into the tool signals and saves them back on change; returns the unsubscribe. */
export function bindToolSettings(): () => void {
  const clean = sanitizeToolSettings(settings.peek())
  palettes.value = clean.palettes
  penSettings.value = clean.penSettings
  highlighterSettings.value = clean.highlighterSettings
  eraserSettings.value = clean.eraserSettings
  lassoSettings.value = clean.lassoSettings
  textSize.value = clean.textSize
  let first = true
  return effect(() => {
    const next = {
      palettes: palettes.value,
      penSettings: penSettings.value,
      highlighterSettings: highlighterSettings.value,
      eraserSettings: eraserSettings.value,
      lassoSettings: lassoSettings.value,
      textSize: textSize.value,
    }
    if (first) {
      first = false
      return
    }
    untracked(() => saveSettings(next).catch(console.error))
  })
}
