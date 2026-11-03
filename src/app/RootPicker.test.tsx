import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { library, setRootFolder } from '../drive/library'
import { FakeDrive, signIn } from '../drive/test-helpers'
import { FOLDER_MIME, PDF_MIME } from '../types'
import { Onboarding } from './Onboarding'

vi.mock('../drive/library', async (orig) => {
  const real = await orig<typeof import('../drive/library')>()
  return { ...real, setRootFolder: vi.fn(real.setRootFolder) }
})

let drive: FakeDrive
const root = document.createElement('div')

beforeEach(async () => {
  await signIn()
  drive = new FakeDrive()
  drive.add({ id: 'research', name: 'Research', mimeType: FOLDER_MIME, parents: ['root'] })
  drive.add({ id: 'admin', name: 'Admin', mimeType: FOLDER_MIME, parents: ['root'] })
  drive.add({ id: 'papers', name: 'Papers', mimeType: FOLDER_MIME, parents: ['research'] })
  drive.add({ id: 'notes.pdf', name: 'notes.pdf', mimeType: PDF_MIME, parents: ['research'] })
  drive.add({ id: 'ml', name: 'ML', mimeType: FOLDER_MIME, parents: ['papers'] })
  document.body.append(root)
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
  vi.unstubAllGlobals()
})

const rowNames = () => [...root.querySelectorAll('.mg-row .mg-row-name')].map((n) => n.textContent)
const buttonByText = (text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text)!

describe('Root picker', () => {
  test('opens nested folders with breadcrumbs and picks a folder below the top level', async () => {
    await act(async () => render(<Onboarding step="root" />, root))
    await vi.waitFor(() => expect(rowNames()).toEqual(['Admin', 'Research']))

    await act(async () => [...root.querySelectorAll<HTMLButtonElement>('.mg-row')].find((b) => b.textContent === 'Research')!.click())
    await vi.waitFor(() => expect(rowNames()).toEqual(['Papers']))
    expect(root.querySelector('.mg-crumbs')!.textContent).toBe('My Drive/Research')

    await act(async () => [...root.querySelectorAll<HTMLButtonElement>('.mg-row')].find((b) => b.textContent === 'Papers')!.click())
    await vi.waitFor(() => expect(rowNames()).toEqual(['ML']))

    await act(async () => [...root.querySelectorAll<HTMLButtonElement>('.mg-crumbs button')].find((b) => b.textContent === 'Research')!.click())
    await vi.waitFor(() => expect(rowNames()).toEqual(['Papers']))
    await act(async () => [...root.querySelectorAll<HTMLButtonElement>('.mg-row')].find((b) => b.textContent === 'Papers')!.click())
    await vi.waitFor(() => expect(rowNames()).toEqual(['ML']))

    await act(async () => buttonByText('Use “Papers”').click())
    await vi.waitFor(() => expect(Object.keys(library.value?.folders ?? {}).sort()).toEqual(['ml', 'papers']))
    expect(library.value!.rootId).toBe('papers')
  })

  test('a failed pick re-enables the buttons and shows the error', async () => {
    await act(async () => render(<Onboarding step="root" />, root))
    await vi.waitFor(() => expect(rowNames()).toEqual(['Admin', 'Research']))
    await act(async () => [...root.querySelectorAll<HTMLButtonElement>('.mg-row')].find((b) => b.textContent === 'Research')!.click())
    await vi.waitFor(() => expect(rowNames()).toEqual(['Papers']))
    vi.mocked(setRootFolder).mockRejectedValueOnce(new Error('storage unavailable'))

    await act(async () => buttonByText('Use “Research”').click())

    await vi.waitFor(() => expect(root.querySelector('.mg-error')?.textContent).toContain('storage unavailable'))
    expect(buttonByText('Use “Research”').disabled).toBe(false)
    expect([...root.querySelectorAll<HTMLButtonElement>('.mg-row')].every((b) => !b.disabled)).toBe(true)
  })
})
