import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { hostState } from '../agent/host'
import { settings } from './settings'

const mocks = vi.hoisted(() => ({
  ungraded: ['a', 'b', 'c'],
  outdated: ['d', 'e'],
  gradeUngraded: vi.fn(),
  regradeOutdated: vi.fn(),
  showToast: vi.fn(),
  canGrade: vi.fn(() => false),
}))
vi.mock('./ui', async (orig) => ({ ...(await orig<typeof import('./ui')>()), showToast: mocks.showToast }))
vi.mock('../verdict/grader', async () => {
  const { signal } = await import('@preact/signals')
  return {
    grading: signal<string | null>(null),
    canGrade: mocks.canGrade,
    hostSkill: () => null,
    currentSkillHash: async () => 'abc123',
    ungradedPapers: async () => mocks.ungraded,
    outdatedPapers: async () => mocks.outdated,
    gradeUngraded: mocks.gradeUngraded,
    regradeOutdated: mocks.regradeOutdated,
  }
})
import { Settings } from './Settings'

const root = document.createElement('div')

beforeEach(() => {
  document.body.append(root)
  mocks.canGrade.mockImplementation(() => Boolean(settings.value.anthropicApiKey))
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
  vi.unstubAllGlobals()
  mocks.showToast.mockReset()
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
    expect(button('Grade 3 ungraded')).toBeTruthy()
    expect(button('Regenerate 2 outdated')).toBeTruthy()
  })

  test('the grading buttons are disabled without a runner and enable when a key is added', async () => {
    await act(async () => render(<Settings />, root))
    await vi.waitFor(() => expect(button('Grade 3 ungraded')).toBeTruthy())
    expect(button('Grade 3 ungraded').disabled).toBe(true)
    expect(button('Regenerate 2 outdated').disabled).toBe(true)
    await act(async () => {
      settings.value = { ...settings.value, anthropicApiKey: 'sk-ant-x' }
    })
    expect(button('Grade 3 ungraded').disabled).toBe(false)
    expect(button('Regenerate 2 outdated').disabled).toBe(false)
  })

  test('the buttons run their jobs and toast the count', async () => {
    settings.value = { ...settings.value, anthropicApiKey: 'sk-ant-x' }
    mocks.gradeUngraded.mockResolvedValue(3)
    mocks.regradeOutdated.mockResolvedValue(1)
    await act(async () => render(<Settings />, root))
    await vi.waitFor(() => expect(button('Grade 3 ungraded')).toBeTruthy())
    await act(async () => button('Grade 3 ungraded').click())
    expect(mocks.gradeUngraded).toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('Graded 3 papers')
    await act(async () => button('Regenerate 2 outdated').click())
    expect(mocks.showToast).toHaveBeenCalledWith('Graded 1 paper')
  })

  test('a button is hidden when its count is zero', async () => {
    mocks.ungraded = []
    mocks.outdated = ['d']
    await act(async () => render(<Settings />, root))
    await vi.waitFor(() => expect(root.textContent).toContain('0 ungraded · 1 from an older skill'))
    expect(button('Grade 0 ungraded')).toBeUndefined()
    expect(button('Regenerate 1 outdated')).toBeTruthy()
    mocks.ungraded = ['a', 'b', 'c']
    mocks.outdated = ['d', 'e']
  })

  test('the Agent host section offers Connect and Forget once paired but unreachable', () => {
    act(() => render(<Settings />, root))
    expect(root.textContent).toContain('Not paired')
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Connect')).toBe(false)

    act(() => {
      settings.value = { ...settings.value, hostToken: 'tok' }
      hostState.value = { status: 'unreachable' }
    })
    expect(root.textContent).toContain('Paired, not reachable')
    expect(button('Connect')).toBeTruthy()
    expect(button('Forget')).toBeTruthy()
    act(() => {
      settings.value = { ...settings.value, hostToken: '' }
      hostState.value = { status: 'off' }
    })
  })

  test('a token with an off state reads "Paired, not yet connected" and keeps Connect', () => {
    act(() => {
      settings.value = { ...settings.value, hostToken: 'tok' }
    })
    act(() => render(<Settings />, root))
    expect(root.textContent).toContain('Paired, not yet connected')
    expect(button('Connect')).toBeTruthy()
    expect(button('Forget')).toBeTruthy()
    act(() => {
      settings.value = { ...settings.value, hostToken: '' }
    })
  })
})
