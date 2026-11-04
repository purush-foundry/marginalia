import { signal, type Signal } from '@preact/signals'

export type PenTool = 'pen' | 'eraser' | 'select'

/** Tool the Pencil (or latched mouse) uses on the ink layer. */
export const penTool: Signal<PenTool> = signal<PenTool>('pen')

const BLACK_INK = '#1c1c1a'
const NIGHT_BLACK_INK = '#e8e6e1'

/** Ink colours offered by the pen strip, in display order. */
export const PEN_COLORS: readonly { name: string; value: string }[] = [
  { name: 'Red', value: '#d33a2c' },
  { name: 'Black', value: BLACK_INK },
  { name: 'Blue', value: '#2f6fed' },
  { name: 'Green', value: '#1f9d55' },
  { name: 'Orange', value: '#e8710a' },
  { name: 'Purple', value: '#7b4fd6' },
]

/** Pen widths as fractions of page or sheet width. */
export const PEN_WIDTHS: readonly { name: 'Fine' | 'Medium' | 'Thick'; value: number }[] = [
  { name: 'Fine', value: 0.0025 },
  { name: 'Medium', value: 0.004 },
  { name: 'Thick', value: 0.007 },
]

export const DEFAULT_PEN_COLOR = '#d33a2c'
export const DEFAULT_PEN_WIDTH = 0.004

export const penColor: Signal<string> = signal(DEFAULT_PEN_COLOR)

/** Pen width as a fraction of page width. */
export const penWidth: Signal<number> = signal(DEFAULT_PEN_WIDTH)

/** Laptop "Draw" latch: the mouse draws with the current tool. */
export const mouseDraws: Signal<boolean> = signal(false)

/** Night mode is on, so ink displays in its night colours. */
export const nightInk: Signal<boolean> = signal(false)

/** The colour ink is shown in: the stored colour, with Black shown pale at night. */
export function inkDisplayColor(color: string): string {
  return nightInk.value && color.toLowerCase() === BLACK_INK ? NIGHT_BLACK_INK : color
}

/** Preference: a finger draws like the pen. */
export const fingerDraws: Signal<boolean> = signal(false)

/** Pen contact shared by every page's ink layer for palm rejection. */
export const penActivity: { down: boolean; downOn: Element | null; lastUp: number } = {
  down: false,
  downOn: null,
  lastUp: -Infinity,
}
