// Colour maths for the tool menu: HSL to hex, hex input parsing and the hue/lightness wheel.

export const PRESET_COLORS: readonly string[] = [
  '#1c1c1a',
  '#5f6368',
  '#ffffff',
  '#d33a2c',
  '#e8710a',
  '#f2c94c',
  '#1f9d55',
  '#2f9e9e',
  '#2f6fed',
  '#7b4fd6',
  '#c2185b',
  '#8d5524',
]

const WHEEL_SATURATION = 90
const WHEEL_CENTRE_LIGHTNESS = 100
const WHEEL_RIM_LIGHTNESS = 25

/** Hue in degrees, saturation and lightness in percent, to '#rrggbb'. */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const lig = l / 100
  const a = sat * Math.min(lig, 1 - lig)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    const v = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** Three or six hex digits, with or without '#', to lower-case '#rrggbb'; null otherwise. */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())
  if (!m) return null
  const digits = m[1].length === 3 ? [...m[1]].map((d) => d + d).join('') : m[1]
  return `#${digits.toLowerCase()}`
}

/** Wheel colour at an offset from its centre: hue by angle, lightness from white at the centre to dark at the rim. */
export function wheelColorAt(dx: number, dy: number, radius: number): string {
  const hue = (((Math.atan2(dy, dx) * 180) / Math.PI) % 360 + 360) % 360
  const r = radius > 0 ? Math.min(1, Math.hypot(dx, dy) / radius) : 0
  const lightness = WHEEL_CENTRE_LIGHTNESS - (WHEEL_CENTRE_LIGHTNESS - WHEEL_RIM_LIGHTNESS) * r
  return hslToHex(hue, WHEEL_SATURATION, lightness)
}
