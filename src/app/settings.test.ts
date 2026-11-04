import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL } from '../config'

type SettingsModule = typeof import('./settings')

let mod: SettingsModule

beforeEach(async () => {
  vi.resetModules()
  mod = await import('./settings')
})

describe('settings', () => {
  test('loads the config defaults when nothing is stored', async () => {
    const loaded = await mod.loadSettings()
    expect(loaded).toMatchObject({
      anthropicApiKey: '',
      textModel: DEFAULT_TEXT_MODEL,
      visionModel: DEFAULT_VISION_MODEL,
      nightMode: false,
      invertImages: false,
      fingerDraws: false,
      penSeen: false,
    })
    expect(mod.settings.value).toEqual(loaded)
  })

  test('saveSettings updates the signal and survives a reload', async () => {
    await mod.loadSettings()
    await mod.saveSettings({ googleClientId: 'abc.apps.googleusercontent.com', nightMode: true })
    expect(mod.settings.value.nightMode).toBe(true)

    const idb = await import('../lib/idb')
    vi.resetModules()
    vi.doMock('../lib/idb', () => idb)
    const reloaded = await import('./settings')
    await reloaded.loadSettings()
    vi.doUnmock('../lib/idb')

    expect(reloaded.settings.value.googleClientId).toBe('abc.apps.googleusercontent.com')
    expect(reloaded.settings.value.nightMode).toBe(true)
    expect(reloaded.settings.value.textModel).toBe(DEFAULT_TEXT_MODEL)
  })

  test('a stored empty client id falls back to config.ts', async () => {
    vi.resetModules()
    vi.doMock('../config', async (orig) => ({ ...(await orig<object>()), GOOGLE_CLIENT_ID: 'from-config' }))
    const withConfig = await import('./settings')
    await withConfig.saveSettings({ googleClientId: '' })
    await withConfig.loadSettings()
    vi.doUnmock('../config')

    expect(withConfig.settings.value.googleClientId).toBe('from-config')
  })
})

describe('tool settings', () => {
  test('tool palettes and settings round-trip per device', async () => {
    const idb = await import('../lib/idb')
    const pen = {
      colors: ['#000000'],
      widthsMm: [0.3, 0.4, 0.6],
      colorIndex: 0,
      widthIndex: 2,
    }
    await idb.idbSet('settings', 'app', { palettes: { pen } })
    await mod.loadSettings()
    const tools = await import('../ink/tools')
    const stop = mod.bindToolSettings()
    expect(tools.palettes.value.pen).toEqual(pen)
    tools.setColor('pen', 0, '#123456')
    await vi.waitFor(async () =>
      expect(
        (await idb.idbGet<{ palettes: { pen: { colors: string[] } } }>('settings', 'app'))!.palettes.pen.colors[0],
      ).toBe('#123456'),
    )
    stop()
  })

  test('malformed stored tool settings fall back field by field', async () => {
    const hl = {
      colors: ['#aabbcc'],
      widthsMm: [2, 4, 6],
      colorIndex: 0,
      widthIndex: 1,
    }
    const clean = mod.sanitizeToolSettings({
      palettes: { pen: { colors: ['nope'] }, highlighter: hl },
      eraserSettings: { sizeMm: 5 },
      toolDock: { edge: 'middle', at: NaN },
    } as never)
    const tools = await import('../ink/tools')
    expect(clean.palettes.pen).toEqual(tools.DEFAULT_PALETTES.pen)
    expect(clean.palettes.highlighter).toEqual(hl)
    expect(clean.eraserSettings.sizeMm).toBe(2)
    expect(clean.toolDock).toEqual({ edge: 'right', at: 0.6 })
    expect(mod.sanitizeToolSettings({ toolDock: { edge: 'left', at: 4 } }).toolDock).toEqual({ edge: 'left', at: 1 })
  })
})

describe('bindToolSettings first run', () => {
  test('binding cleans the signals; the first change stores clean values', async () => {
    const idb = await import('../lib/idb')
    await idb.idbSet('settings', 'app', { palettes: { pen: { colors: ['nope'] } }, eraserSettings: { sizeMm: 5 } })
    await mod.loadSettings()
    const tools = await import('../ink/tools')
    const stop = mod.bindToolSettings()
    expect(tools.palettes.value.pen).toEqual(tools.DEFAULT_PALETTES.pen)
    expect(tools.eraserSettings.value.sizeMm).toBe(2)
    tools.textSize.value = 'l'
    await vi.waitFor(async () => {
      const stored = (await idb.idbGet<{ palettes: { pen: unknown }; eraserSettings: { sizeMm: number } }>('settings', 'app'))!
      expect(stored.palettes.pen).toEqual(tools.DEFAULT_PALETTES.pen)
      expect(stored.eraserSettings.sizeMm).toBe(2)
    })
    stop()
  })
})
