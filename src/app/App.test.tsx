import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../drive/auth', async (orig) => ({
  ...(await orig<typeof import('../drive/auth')>()),
  maybeRenew: vi.fn(),
}))

const { maybeRenew } = await import('../drive/auth')
const { App } = await import('./App')
const { settings } = await import('./settings')
const { nightInk } = await import('../ink/tools')

const root = document.createElement('div')

afterEach(() => {
  act(() => render(null, root))
  root.remove()
})

describe('App gesture hooks', () => {
  test('token renewal runs from pointerup and click, never from pointerdown', () => {
    document.body.append(root)
    act(() => render(<App />, root))
    const app = root.querySelector('.mg-app')!

    app.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    expect(maybeRenew).not.toHaveBeenCalled()

    app.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))
    expect(maybeRenew).toHaveBeenCalledTimes(1)

    app.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(maybeRenew).toHaveBeenCalledTimes(2)
  })
})

describe('App theme', () => {
  test('the theme-color meta and the night ink follow night mode', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = '#f6f6f4'
    document.head.append(meta)
    document.body.append(root)
    act(() => render(<App />, root))

    act(() => {
      settings.value = { ...settings.value, nightMode: true }
    })
    expect(meta.content).toBe('#151515')
    expect(document.documentElement.dataset.theme).toBe('night')
    expect(nightInk.value).toBe(true)

    act(() => {
      settings.value = { ...settings.value, nightMode: false }
    })
    expect(meta.content).toBe('#f6f6f4')
    expect(nightInk.value).toBe(false)
    meta.remove()
  })
})
