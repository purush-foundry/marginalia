import { signal, type Signal } from '@preact/signals'
import type { PenStyle } from '../types'

export type { PenStyle } from '../types'

const BLACK_INK = '#1c1c1a'
const NIGHT_BLACK_INK = '#e8e6e1'

/** Night mode is on, so ink displays in its night colours. */
export const nightInk: Signal<boolean> = signal(false)

/** The colour ink is shown in: the stored colour, with Black shown pale at night. */
export function inkDisplayColor(color: string, dark: boolean = nightInk.value): string {
  return dark && color.toLowerCase() === BLACK_INK ? NIGHT_BLACK_INK : color
}

/** Preference: a finger draws like the pen. */
export const fingerDraws: Signal<boolean> = signal(false)

/** Pen contact shared by every page's ink layer for palm rejection. */
export const penActivity: { down: boolean; downOn: Element | null; lastUp: number } = {
  down: false,
  downOn: null,
  lastUp: -Infinity,
}

export type Tool = 'lasso' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'image'
export type PaletteTool = 'pen' | 'highlighter' | 'text'
type WidthTool = 'pen' | 'highlighter'
export interface ToolPalette {
  colors: string[]
  widthsMm: number[]
  colorIndex: number
  widthIndex: number
}
export interface PenSettings {
  style: PenStyle
  drawAndHold: boolean
}
export interface HighlighterSettings {
  straight: boolean
}
export interface EraserSettings {
  style: 'stroke' | 'segment'
  sizeMm: 2 | 4 | 8
  erasePen: boolean
  eraseHighlighter: boolean
  autoDeselect: boolean
}
export interface LassoSettings {
  rect: boolean
}
export type TextSize = 's' | 'm' | 'l'

export const DEFAULT_PALETTES: Record<PaletteTool, ToolPalette> = {
  pen: {
    colors: ['#1c1c1a', '#2f6fed', '#d33a2c'],
    widthsMm: [0.3, 0.5, 0.7],
    colorIndex: 0,
    widthIndex: 1,
  },
  highlighter: {
    colors: ['#ffe066', '#9be38a', '#ffb3c6'],
    widthsMm: [3, 5, 8],
    colorIndex: 0,
    widthIndex: 1,
  },
  text: {
    colors: ['#1c1c1a', '#2f6fed', '#d33a2c'],
    widthsMm: [],
    colorIndex: 0,
    widthIndex: 0,
  },
}
export const DEFAULT_PEN_SETTINGS: PenSettings = {
  style: 'fountain',
  drawAndHold: true,
}
export const DEFAULT_HIGHLIGHTER_SETTINGS: HighlighterSettings = {
  straight: false,
}
export const DEFAULT_ERASER_SETTINGS: EraserSettings = {
  style: 'stroke',
  sizeMm: 2,
  erasePen: true,
  eraseHighlighter: true,
  autoDeselect: false,
}
export const DEFAULT_LASSO_SETTINGS: LassoSettings = { rect: false }
export const MAX_COLOR_SLOTS = 12
export const WIDTH_RANGE_MM: Record<WidthTool, { min: number; max: number; step: number }> = {
  pen: { min: 0.1, max: 2, step: 0.05 },
  highlighter: { min: 1, max: 15, step: 0.5 },
}
export const MM_PER_PT = 0.3528
export const A4_WIDTH_MM = 210

export const tool: Signal<Tool> = signal<Tool>('pen')
export const previousTool: Signal<Tool> = signal<Tool>('pen')
export const palettes: Signal<Record<PaletteTool, ToolPalette>> = signal(DEFAULT_PALETTES)
export const penSettings: Signal<PenSettings> = signal(DEFAULT_PEN_SETTINGS)
export const highlighterSettings: Signal<HighlighterSettings> = signal(DEFAULT_HIGHLIGHTER_SETTINGS)
export const eraserSettings: Signal<EraserSettings> = signal(DEFAULT_ERASER_SETTINGS)
export const lassoSettings: Signal<LassoSettings> = signal(DEFAULT_LASSO_SETTINGS)
export const textSize: Signal<TextSize> = signal<TextSize>('m')

/** Switches tool, recording the outgoing one in previousTool. */
export function setTool(next: Tool): void {
  if (next === tool.peek()) return
  previousTool.value = tool.peek()
  tool.value = next
}

export function isInkTool(t: Tool): t is 'pen' | 'highlighter' | 'eraser' {
  return t === 'pen' || t === 'highlighter' || t === 'eraser'
}

export function activeColor(t: PaletteTool): string {
  const p = palettes.value[t]
  return p.colors[p.colorIndex]
}

export function activeWidthMm(t: WidthTool): number {
  const p = palettes.value[t]
  return p.widthsMm[p.widthIndex]
}

function patchPalette(t: PaletteTool, patch: Partial<ToolPalette>): void {
  palettes.value = {
    ...palettes.value,
    [t]: { ...palettes.value[t], ...patch },
  }
}

const inRange = (i: number, n: number) => Number.isInteger(i) && i >= 0 && i < n

export function selectColor(t: PaletteTool, index: number): void {
  if (inRange(index, palettes.value[t].colors.length)) patchPalette(t, { colorIndex: index })
}

export function setColor(t: PaletteTool, index: number, hex: string): void {
  const p = palettes.value[t]
  if (!inRange(index, p.colors.length)) return
  patchPalette(t, { colors: p.colors.map((c, i) => (i === index ? hex : c)) })
}

/** Appends and selects a colour; false when the palette is full. */
export function addColorSlot(t: PaletteTool, hex: string): boolean {
  const p = palettes.value[t]
  if (p.colors.length >= MAX_COLOR_SLOTS) return false
  patchPalette(t, { colors: [...p.colors, hex], colorIndex: p.colors.length })
  return true
}

function moved(index: number, from: number, to: number): number {
  if (index === from) return to
  if (from < index && to >= index) return index - 1
  if (from > index && to <= index) return index + 1
  return index
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice()
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

export function moveColorSlot(t: PaletteTool, from: number, to: number): void {
  const p = palettes.value[t]
  if (!inRange(from, p.colors.length) || !inRange(to, p.colors.length)) return
  patchPalette(t, {
    colors: reorder(p.colors, from, to),
    colorIndex: moved(p.colorIndex, from, to),
  })
}

export function selectWidth(t: WidthTool, index: number): void {
  if (inRange(index, palettes.value[t].widthsMm.length)) patchPalette(t, { widthIndex: index })
}

/** Sets a width slot, clamped to the tool range and rounded to its step. */
export function setWidthMm(t: WidthTool, index: number, mm: number): void {
  const p = palettes.value[t]
  if (!inRange(index, p.widthsMm.length) || !Number.isFinite(mm)) return
  const { min, max, step } = WIDTH_RANGE_MM[t]
  const clamped = Math.min(max, Math.max(min, mm))
  const snapped = Math.min(max, Math.max(min, min + Math.round((clamped - min) / step) * step))
  const value = Number(snapped.toFixed(4))
  patchPalette(t, {
    widthsMm: p.widthsMm.map((w, i) => (i === index ? value : w)),
  })
}

export function moveWidthSlot(t: WidthTool, from: number, to: number): void {
  const p = palettes.value[t]
  if (!inRange(from, p.widthsMm.length) || !inRange(to, p.widthsMm.length)) return
  patchPalette(t, {
    widthsMm: reorder(p.widthsMm, from, to),
    widthIndex: moved(p.widthIndex, from, to),
  })
}

export function pageWidthMm(ptWidth: number): number {
  return ptWidth * MM_PER_PT
}

export function mmToFraction(mm: number, pageWidthMm: number): number {
  return mm / pageWidthMm
}
