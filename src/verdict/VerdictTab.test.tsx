import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { signal } from '@preact/signals'
import type { AnnotationStore } from '../annot/store'
import { settings } from '../app/settings'
import type { Sidecar } from '../types'
import type { VerdictNote } from './note'

const note: VerdictNote = {
  verdict: 'read',
  confidence: 'high',
  readTime: '20 min',
  oneLine: 'Worth it',
  topics: [],
  skill: 'abc123',
  model: 'claude-test',
  generated: '2026-01-02T00:00:00Z',
  body: 'Solid paper "attention is all" (p. 3).',
}

const mocks = vi.hoisted(() => ({
  loadVerdict: vi.fn(),
  currentSkillHash: vi.fn(),
  gradeNow: vi.fn(),
  canGrade: vi.fn(() => true),
  showToast: vi.fn(),
  grading: { value: null as string | null },
}))
vi.mock('../app/ui', () => ({ showToast: mocks.showToast }))
vi.mock('../drive/library', async () => {
  const { signal } = await import('@preact/signals')
  return { loadVerdict: mocks.loadVerdict, sidecarRevision: signal(0), unreadableVerdicts: signal<Record<string, string>>({}) }
})
vi.mock('./grader', async () => {
  const { signal } = await import('@preact/signals')
  return { grading: signal<string | null>(null), currentSkillHash: mocks.currentSkillHash, gradeNow: mocks.gradeNow, canGrade: mocks.canGrade, hostSkill: () => null }
})

import { unreadableVerdicts } from '../drive/library'
import { grading } from './grader'
import { VerdictTab } from './VerdictTab'

let root: HTMLElement
const setGist = vi.fn()
const store = (gist = 'my old gist') =>
  ({ sidecar: signal({ gist: { text: gist, updatedAt: 1 } } as Sidecar), setGist }) as unknown as AnnotationStore
beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  mocks.loadVerdict.mockResolvedValue(note)
  mocks.currentSkillHash.mockResolvedValue('abc123')
  mocks.canGrade.mockReturnValue(true)
  mocks.gradeNow.mockReset()
  mocks.showToast.mockReset()
  setGist.mockReset()
  grading.value = null
  unreadableVerdicts.value = {}
  settings.value = { ...settings.value, anthropicApiKey: '' }
})
afterEach(() => {
  act(() => render(null, root))
  root.remove()
})

const show = async (onGo: (page: number) => void = vi.fn(), pdfId = 'p1', settle = true) => {
  await act(async () => {
    render(<VerdictTab pdfId={pdfId} store={store()} onGo={onGo} />, root)
  })
  if (settle) await vi.waitFor(() => expect(root.textContent).not.toContain('Loading'))
}
const button = (t: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === t)

describe('VerdictTab', () => {
  test('renders the note, its meta line and Regenerate', async () => {
    await show()
    expect(root.textContent).toContain('Solid paper')
    expect(root.textContent).toContain('claude-test · skill abc123')
    expect(root.querySelector('.mg-verdict-read')!.textContent).toBe('Read')
    expect(button('Regenerate')).toBeTruthy()
    expect(root.textContent).not.toContain('older version')
  })

  test('says so when the note was written with another skill', async () => {
    mocks.currentSkillHash.mockResolvedValue('zzz999')
    await show()
    expect(root.textContent).toContain('Written with an older version of the skill')
  })

  test('with no note offers Grade now, or points to Settings without a runner', async () => {
    mocks.loadVerdict.mockResolvedValue(null)
    await show()
    expect(root.textContent).toContain('No note yet')
    expect(button('Grade now')).toBeTruthy()
  })

  test('with no note and no runner it points to Settings, and a key added later enables Grade now', async () => {
    mocks.loadVerdict.mockResolvedValue(null)
    mocks.canGrade.mockImplementation(() => Boolean(settings.value.anthropicApiKey))
    await show()
    expect(button('Grade now')).toBeUndefined()
    expect(root.textContent).toContain('Add a Claude key or pair the agent host in Settings')
    await act(async () => {
      settings.value = { ...settings.value, anthropicApiKey: 'sk-ant-x' }
    })
    expect(button('Grade now')).toBeTruthy()
  })

  test('a note in Drive that cannot be read is named, with no Grade now', async () => {
    mocks.loadVerdict.mockResolvedValue(null)
    unreadableVerdicts.value = { p1: 'Attention.worth-reading.md' }
    await show()
    expect(root.textContent).toContain('The note in Drive (Attention.worth-reading.md) could not be read — fix or delete it')
    expect(root.textContent).not.toContain('No note yet')
    expect(button('Grade now')).toBeUndefined()
  })

  test('a local note over an unreadable Drive note shows the notice instead of Regenerate', async () => {
    unreadableVerdicts.value = { p1: 'Attention.worth-reading.md' }
    await show()
    expect(root.textContent).toContain('Solid paper')
    expect(root.textContent).toContain('could not be read — fix or delete it')
    expect(button('Regenerate')).toBeUndefined()
  })

  test('a citation jumps to its page', async () => {
    const onGo = vi.fn()
    await show(onGo)
    await act(async () => root.querySelector<HTMLButtonElement>('button.cite')!.click())
    expect(onGo).toHaveBeenCalledWith(3)
  })

  test('a failed Regenerate toasts the error message', async () => {
    mocks.gradeNow.mockRejectedValue(new Error('rate limited'))
    await show()
    await act(async () => button('Regenerate')!.click())
    expect(mocks.showToast).toHaveBeenCalledWith('rate limited')
  })

  test('Regenerate is disabled while a paper is grading, and the pulse shows only for this paper', async () => {
    grading.value = 'other'
    await show()
    expect((button('Regenerate') as HTMLButtonElement).disabled).toBe(true)
    expect(root.querySelector('.mg-verdict-busy')).toBeNull()
    await act(async () => {
      grading.value = 'p1'
    })
    expect(root.querySelector('.mg-verdict-busy')).not.toBeNull()
  })

  test('switching paper drops the previous note before the new one loads', async () => {
    await show()
    expect(root.textContent).toContain('Solid paper')
    mocks.loadVerdict.mockReturnValue(new Promise(() => undefined))
    await show(vi.fn(), 'p2', false)
    expect(root.textContent).not.toContain('Solid paper')
    expect(button('Regenerate')).toBeUndefined()
  })

  test('Regenerate grades the paper', async () => {
    mocks.gradeNow.mockResolvedValue(note)
    await show()
    await act(async () => button('Regenerate')!.click())
    expect(mocks.gradeNow).toHaveBeenCalledWith('p1')
  })

  test('the gist field shows the saved gist and saves an edit on blur', async () => {
    await show()
    const area = root.querySelector<HTMLTextAreaElement>('#mg-verdict-gist')!
    expect(root.querySelector('label[for="mg-verdict-gist"]')!.textContent).toBe('Your gist')
    expect(area.value).toBe('my old gist')
    await act(async () => {
      area.value = '  a cleaner sampler  '
      area.dispatchEvent(new Event('input', { bubbles: true }))
      area.dispatchEvent(new Event('blur'))
    })
    expect(setGist).toHaveBeenCalledWith('a cleaner sampler')
  })

  test('a changed gist is saved when the tab closes without a blur, an unchanged one is not', async () => {
    await show()
    act(() => render(null, root))
    expect(setGist).not.toHaveBeenCalled()
    await show()
    await act(async () => {
      const area = root.querySelector<HTMLTextAreaElement>('#mg-verdict-gist')!
      area.value = 'typed then closed'
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => render(null, root))
    expect(setGist).toHaveBeenCalledWith('typed then closed')
  })
})
