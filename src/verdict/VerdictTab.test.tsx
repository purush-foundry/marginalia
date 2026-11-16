import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
}))
vi.mock('../drive/library', async () => {
  const { signal } = await import('@preact/signals')
  return { loadVerdict: mocks.loadVerdict, sidecarRevision: signal(0) }
})
vi.mock('./grader', async () => {
  const { signal } = await import('@preact/signals')
  return { grading: signal(null), currentSkillHash: mocks.currentSkillHash, gradeNow: mocks.gradeNow, canGrade: mocks.canGrade }
})

import { VerdictTab } from './VerdictTab'

let root: HTMLElement
beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
  mocks.loadVerdict.mockResolvedValue(note)
  mocks.currentSkillHash.mockResolvedValue('abc123')
})
afterEach(() => {
  act(() => render(null, root))
  root.remove()
})

const show = async () => {
  await act(async () => {
    render(<VerdictTab pdfId="p1" onGo={vi.fn()} />, root)
  })
  await vi.waitFor(() => expect(root.textContent).not.toContain('Loading'))
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
    mocks.canGrade.mockReturnValue(false)
    await show()
    expect(button('Grade now')).toBeUndefined()
    expect(root.textContent).toContain('Add a Claude key or pair the agent host in Settings')
  })

  test('Regenerate grades the paper', async () => {
    mocks.gradeNow.mockResolvedValue(note)
    await show()
    await act(async () => button('Regenerate')!.click())
    expect(mocks.gradeNow).toHaveBeenCalledWith('p1')
  })
})
