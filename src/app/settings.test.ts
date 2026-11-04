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

  test('pen colour and width persist per device; values outside the presets fall back', async () => {
    const idb = await import('../lib/idb')
    await idb.idbSet('settings', 'app', { penColor: '#2f6fed', penWidth: 0.007 })
    await mod.loadSettings()
    const tools = await import('../ink/tools')
    const stop = mod.bindPenPalette()
    expect(tools.penColor.value).toBe('#2f6fed')
    expect(tools.penWidth.value).toBe(0.007)
    tools.penColor.value = '#e8710a'
    await vi.waitFor(async () =>
      expect((await idb.idbGet<{ penColor: string }>('settings', 'app'))!.penColor).toBe('#e8710a'),
    )
    stop()
    await idb.idbSet('settings', 'app', { penColor: '#ff00ff', penWidth: 3 })
    await mod.loadSettings()
    mod.bindPenPalette()
    expect(tools.penColor.value).toBe('#d33a2c')
    expect(tools.penWidth.value).toBe(0.004)
  })
})
