import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { settings } from './settings'

vi.mock('../verdict/grader', async () => {
  const { signal } = await import('@preact/signals')
  return {
    grading: signal(null),
    canGrade: () => true,
    currentSkillHash: async () => 'abc123',
    ungradedPapers: async () => ['a', 'b', 'c'],
    outdatedPapers: async () => ['d', 'e'],
    gradeUngraded: vi.fn(),
    regradeOutdated: vi.fn(),
  }
})
import { Settings } from './Settings'

const root = document.createElement('div')

beforeEach(() => {
  document.body.append(root)
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
  vi.unstubAllGlobals()
  settings.value = { ...settings.value, anthropicApiKey: '' }
})

const keyField = () => root.querySelector<HTMLInputElement>('#mg-api-key')!
const button = (text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text)!

describe('Settings', () => {
  test('the finger switch is labelled "Draw with finger"', () => {
    act(() => render(<Settings />, root))
    const labels = [...root.querySelectorAll('label')].map((l) => l.textContent ?? '')
    expect(labels.some((t) => t.startsWith('Draw with finger'))).toBe(true)
    expect(labels.some((t) => t.startsWith('Finger draws'))).toBe(false)
  })

  test('links the privacy page from the footer', () => {
    act(() => render(<Settings />, root))
    const link = [...root.querySelectorAll('a')].find((a) => a.textContent === 'Privacy')!
    expect(link.getAttribute('href')).toBe('/privacy.html')
  })

  test('the API key field is a masked text input that keeps what the user types and enables Test key', async () => {
    act(() => render(<Settings />, root))
    const field = keyField()
    expect(field.type).toBe('text')
    expect(field.classList.contains('mg-secret')).toBe(true)
    expect(field.getAttribute('autocomplete')).toBe('off')
    expect(field.hasAttribute('data-1p-ignore')).toBe(true)
    expect(field.getAttribute('data-lpignore')).toBe('true')
    expect(button('Test key').disabled).toBe(true)

    await act(async () => {
      field.value = 'sk-ant-typed'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(keyField().value).toBe('sk-ant-typed')
    expect(button('Test key').disabled).toBe(false)
  })

  test('Paste fills the API key field from the clipboard', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: vi.fn(async () => '  sk-ant-pasted\n') } })
    act(() => render(<Settings />, root))

    await act(async () => button('Paste').click())

    expect(keyField().value).toBe('sk-ant-pasted')
    expect(button('Test key').disabled).toBe(false)
  })

  test('Paste says so when clipboard access is denied', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: vi.fn(async () => Promise.reject(new Error('denied'))) } })
    act(() => render(<Settings />, root))

    await act(async () => button('Paste').click())

    await vi.waitFor(() => expect(root.textContent).toContain('Clipboard access denied — paste manually'))
  })

  test('Claude section has the grading toggle and the ungraded and outdated buttons', async () => {
    await act(async () => render(<Settings />, root))
    const labels = [...root.querySelectorAll('label')].map((l) => l.textContent ?? '')
    expect(labels.some((t) => t.startsWith('Grade new papers on this device'))).toBe(true)
    await vi.waitFor(() => expect(root.textContent).toContain('Skill abc123 · 3 ungraded · 2 from an older skill'))
    expect(button('Grade 3 ungraded').disabled).toBe(false)
    expect(button('Regenerate 2 outdated')).toBeTruthy()
  })
})
