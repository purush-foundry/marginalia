import { expect, test } from 'vitest'
import { PRESET_COLORS, hslToHex, normalizeHex, wheelColorAt } from './color.ts'

test('PRESET_COLORS holds the twelve presets', () => {
  expect(PRESET_COLORS).toEqual([
    '#1c1c1a', '#5f6368', '#ffffff', '#d33a2c', '#e8710a', '#f2c94c',
    '#1f9d55', '#2f9e9e', '#2f6fed', '#7b4fd6', '#c2185b', '#8d5524',
  ])
})

test('hslToHex', () => {
  expect(hslToHex(0, 100, 50)).toBe('#ff0000')
  expect(hslToHex(120, 100, 25)).toBe('#008000')
  expect(hslToHex(240, 100, 50)).toBe('#0000ff')
  expect(hslToHex(0, 0, 100)).toBe('#ffffff')
})

test('normalizeHex accepts three or six digits with or without #', () => {
  expect(normalizeHex('#ABC')).toBe('#aabbcc')
  expect(normalizeHex('abc')).toBe('#aabbcc')
  expect(normalizeHex('a1b2c3')).toBe('#a1b2c3')
  expect(normalizeHex(' #A1B2C3 ')).toBe('#a1b2c3')
  expect(normalizeHex('zzz')).toBeNull()
  expect(normalizeHex('#12345')).toBeNull()
  expect(normalizeHex('')).toBeNull()
})

test('wheelColorAt: white at the centre, darker toward the rim, hue by angle', () => {
  expect(wheelColorAt(0, 0, 50)).toBe('#ffffff')
  expect(wheelColorAt(50, 0, 50)).toBe(hslToHex(0, 90, 25))
  expect(wheelColorAt(0, -50, 50)).toBe(hslToHex(270, 90, 25))
  expect(wheelColorAt(25, 0, 50)).toBe(hslToHex(0, 90, 62.5))
  expect(wheelColorAt(500, 0, 50)).toBe(hslToHex(0, 90, 25))
})
