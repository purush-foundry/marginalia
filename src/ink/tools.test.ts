import { beforeEach, describe, expect, test, vi } from 'vitest'

type ToolsModule = typeof import('./tools')
let t: ToolsModule

beforeEach(async () => {
  vi.resetModules()
  t = await import('./tools')
})

describe('tool model', () => {
  test('pen, highlighter, text and eraser start with the spec defaults', () => {
    expect(t.tool.value).toBe('pen')
    expect(t.previousTool.value).toBe('pen')
    expect(t.palettes.value.pen).toEqual({
      colors: ['#1c1c1a', '#2f6fed', '#d33a2c'],
      widthsMm: [0.3, 0.5, 0.7],
      colorIndex: 0,
      widthIndex: 1,
    })
    expect(t.palettes.value.highlighter.widthsMm).toEqual([3, 5, 8])
    expect(t.palettes.value.text).toEqual({
      colors: ['#1c1c1a', '#2f6fed', '#d33a2c'],
      widthsMm: [],
      colorIndex: 0,
      widthIndex: 0,
    })
    expect(t.penSettings.value).toEqual({
      style: 'fountain',
      drawAndHold: true,
    })
    expect(t.highlighterSettings.value).toEqual({ straight: false })
    expect(t.eraserSettings.value).toEqual({
      style: 'stroke',
      sizeMm: 2,
      erasePen: true,
      eraseHighlighter: true,
      autoDeselect: false,
    })
    expect(t.lassoSettings.value).toEqual({ rect: false })
    expect(t.textSize.value).toBe('m')
    expect(t.activeWidthMm('pen')).toBe(0.5)
    expect(t.activeColor('highlighter')).toBe('#ffe066')
  })

  test('setTool remembers the tool it leaves', () => {
    t.setTool('pen')
    t.setTool('eraser')
    expect(t.previousTool.value).toBe('pen')
    t.setTool('eraser')
    expect(t.previousTool.value).toBe('pen')
  })

  test('a colour slot can be added up to 12, and moving a slot keeps the selection on it', () => {
    for (let i = 0; i < 9; i++) expect(t.addColorSlot('pen', '#00000' + i)).toBe(true)
    expect(t.palettes.value.pen.colors).toHaveLength(12)
    expect(t.palettes.value.pen.colorIndex).toBe(11)
    expect(t.addColorSlot('pen', '#ffffff')).toBe(false)
    t.selectColor('pen', 0)
    t.moveColorSlot('pen', 0, 2)
    expect(t.palettes.value.pen.colors[2]).toBe('#1c1c1a')
    expect(t.palettes.value.pen.colorIndex).toBe(2)
  })

  test('moving a slot past the selection shifts the selected index with it', () => {
    t.selectColor('pen', 1)
    t.moveColorSlot('pen', 0, 2)
    expect(t.activeColor('pen')).toBe('#2f6fed')
    t.selectWidth('pen', 1)
    t.moveWidthSlot('pen', 2, 0)
    expect(t.activeWidthMm('pen')).toBe(0.5)
  })

  test('palette operations replace the value instead of mutating it', () => {
    const before = t.palettes.value
    t.setColor('pen', 0, '#123456')
    expect(t.palettes.value).not.toBe(before)
    expect(before.pen.colors[0]).toBe('#1c1c1a')
  })

  test('thickness is clamped to the tool range in its steps', () => {
    t.setWidthMm('pen', 0, 3)
    expect(t.palettes.value.pen.widthsMm[0]).toBe(2)
    t.setWidthMm('pen', 0, 0.333)
    expect(t.palettes.value.pen.widthsMm[0]).toBe(0.35)
    t.setWidthMm('highlighter', 0, 0.2)
    expect(t.palettes.value.highlighter.widthsMm[0]).toBe(1)
  })

  test('a 0.35 mm pen is 0.35 mm on A4 and on a Letter PDF page', () => {
    expect(t.mmToFraction(0.35, t.A4_WIDTH_MM)).toBeCloseTo(0.35 / 210, 10)
    expect(t.pageWidthMm(612)).toBeCloseTo(215.9136, 4)
    expect(t.mmToFraction(0.35, t.pageWidthMm(612)) * 612 * t.MM_PER_PT).toBeCloseTo(0.35, 10)
  })

  test('isInkTool is true for pen, highlighter and eraser only', () => {
    const all = ['lasso', 'pen', 'highlighter', 'eraser', 'text', 'image'] as const
    expect(all.filter((x) => t.isInkTool(x))).toEqual(['pen', 'highlighter', 'eraser'])
  })

  test('inkDisplayColor takes an explicit dark flag', () => {
    expect(t.inkDisplayColor('#1c1c1a', true)).toBe('#e8e6e1')
    expect(t.inkDisplayColor('#1c1c1a', false)).toBe('#1c1c1a')
  })
})
