import { describe, expect, it } from 'vitest'
import { SKILL_TEXT, skillBody, skillHash } from './skill'

describe('skill', () => {
  it('strips the front matter and hashes stably', async () => {
    expect(skillBody('---\nname: x\n---\nBody here')).toBe('Body here')
    expect(await skillHash('abc')).toMatch(/^[0-9a-f]{12}$/)
    expect(await skillHash('abc')).toBe(await skillHash('abc'))
    expect(await skillHash('abc')).toBe('ba7816bf8f01')
  })
  it('bundles the real skill', () => {
    expect(SKILL_TEXT).toContain('name: worth-reading')
    expect(skillBody(SKILL_TEXT)).toContain('## Verdict')
  })
})
