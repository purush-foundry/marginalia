import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySidecar, type PaperLink } from '../types'
import { updateSidecar, withGist, withLink, withoutLink, withPin, withTopics } from './data'

const mocks = vi.hoisted(() => ({ loadSidecar: vi.fn(), saveSidecar: vi.fn() }))
vi.mock('../drive/library', () => mocks)

const base = () => emptySidecar('p', 'p.pdf', 1)
const link = (id: string, extra: Partial<PaperLink> = {}): PaperLink => ({
  id, kind: 'link', to: 'q', rel: 'related', createdAt: 1, updatedAt: 1, ...extra,
})

describe('pure sidecar edits', () => {
  it('sets gist, topics and pin with the stamp', () => {
    expect(withGist(base(), 'hi', 5).gist).toEqual({ text: 'hi', updatedAt: 5 })
    expect(withTopics(base(), ['a'], 6).topics).toEqual({ ids: ['a'], updatedAt: 6 })
    expect(withPin(base(), { x: 0.2, y: 0.3 }, 7).pin).toEqual({ x: 0.2, y: 0.3, updatedAt: 7 })
  })

  it('unpins with a negative sentinel', () => {
    expect(withPin(base(), null, 8).pin).toEqual({ x: -1, y: -1, updatedAt: 8 })
  })

  it('upserts a link by id', () => {
    const s = withLink(withLink(base(), link('a')), link('a', { rel: 'extends', updatedAt: 2 }))
    expect(s.links).toHaveLength(1)
    expect(s.links![0].rel).toBe('extends')
    expect(withLink(s, link('b')).links!.map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('tombstones a link', () => {
    const s = withoutLink(withLink(base(), link('a')), 'a', 9)
    expect(s.links![0]).toMatchObject({ id: 'a', deleted: true, updatedAt: 9 })
  })
})

describe('updateSidecar', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads, edits, saves and returns the edited sidecar', async () => {
    mocks.loadSidecar.mockResolvedValue(base())
    const out = await updateSidecar('p', (s) => withGist(s, 'g', 3))
    expect(out.gist).toEqual({ text: 'g', updatedAt: 3 })
    expect(mocks.saveSidecar).toHaveBeenCalledWith('p', out)
  })
})
