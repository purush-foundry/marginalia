import { signal, type Signal } from '@preact/signals'

export type PenTool = 'pen' | 'eraser' | 'select'

/** Tool the Pencil (or latched mouse) uses on the ink layer. */
export const penTool: Signal<PenTool> = signal<PenTool>('pen')

export const penColor: Signal<string> = signal('#d33a2c')

/** Pen width as a fraction of page width. */
export const penWidth: Signal<number> = signal(0.004)

/** Laptop "Draw" latch: the mouse draws with the current tool. */
export const mouseDraws: Signal<boolean> = signal(false)

/** Preference: a finger draws like the pen. */
export const fingerDraws: Signal<boolean> = signal(false)

/** Pen contact shared by every page's ink layer for palm rejection. */
export const penActivity: { down: boolean; downOn: Element | null; lastUp: number } = {
  down: false,
  downOn: null,
  lastUp: -Infinity,
}
