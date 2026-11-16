import { act } from 'preact/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { idbGet, idbSet } from '../lib/idb'
import { FOLDER_MIME, PDF_MIME, type DriveNode, type LibraryIndex } from '../types'

vi.mock('../drive/auth', async (orig) => ({
  ...(await orig<typeof import('../drive/auth')>()),
  initAuth: vi.fn(() => new Promise<void>(() => {})),
}))

const node = (id: string, name: string, mimeType: string, parents: string[]): DriveNode => ({
  id, name, mimeType, parents, modifiedTime: 't', version: '1', size: 10,
})

const root = document.createElement('div')

afterEach(() => root.remove())

describe('boot', () => {
  test('renders the stored library while Google sign-in never finishes loading', async () => {
    const index: LibraryIndex = {
      rootId: 'r',
      rootName: 'Papers',
      folders: { r: node('r', 'Papers', FOLDER_MIME, []) },
      papers: { p: node('p', 'attention.pdf', PDF_MIME, ['r']) },
      sidecars: {},
      syncedAt: 1,
    }
    await idbSet('settings', 'app', { googleClientId: 'client.apps.googleusercontent.com' })
    await idbSet('meta', 'library', index)
    document.body.append(root)
    const { boot } = await import('./boot')
    const { initAuth } = await import('../drive/auth')

    await act(() => boot(root))

    expect(initAuth).toHaveBeenCalledWith('client.apps.googleusercontent.com')
    expect(root.querySelector('.mg-crumbs')!.textContent).toBe('Papers')
    expect(root.querySelector('.mg-row-name')!.textContent).toBe('attention')
  })

  test('stamps gradingSince on a fresh install and keeps a stored stamp', async () => {
    document.body.append(root)
    const { boot } = await import('./boot')

    await act(() => boot(root))
    await vi.waitFor(async () => expect((await idbGet<{ gradingSince: number }>('settings', 'app'))!.gradingSince).toBeGreaterThan(0))

    await idbSet('settings', 'app', { googleClientId: '', gradingSince: 42 })
    await act(() => boot(root))
    expect((await idbGet<{ gradingSince: number }>('settings', 'app'))!.gradingSince).toBe(42)
  })

  test('a #/pair/<token> link stores the token, drops it from the URL and shows the library', async () => {
    history.replaceState(null, '', '/#/pair/tok')
    document.body.append(root)
    const { boot } = await import('./boot')
    const { route } = await import('./route')

    await act(() => boot(root))

    expect((await idbGet<{ hostToken: string }>('settings', 'app'))!.hostToken).toBe('tok')
    expect(location.hash).toBe('#/')
    expect(location.href).not.toContain('tok')
    expect(route.value).toEqual({ kind: 'library' })
    history.replaceState(null, '', '/')
  })
})
