// @vitest-environment node
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadToken, paperDir, readSessions, savePaper, writeSession } from './papers'

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'papers-'))

describe('papers', () => {
  it('sanitises the folder name', () => {
    expect(paperDir('/r', 'a/b c')).toBe('/r/papers/a_b_c')
  })

  it('writes pdf, text and meta', async () => {
    const root = await tmp()
    const dir = await savePaper(root, 'id1', { name: 'a.pdf', title: 'T', pages: [{ n: 1, text: 'one' }, { n: 2, text: 'two' }], pdf: Buffer.from('PDF').toString('base64') })
    const txt = await readFile(path.join(dir, 'paper.txt'), 'utf8')
    expect(txt.startsWith('<paper pages="2">\n<page n="1">\none\n</page>\n')).toBe(true)
    expect(txt.endsWith('</paper>\n')).toBe(true)
    expect((await readFile(path.join(dir, 'paper.pdf'))).toString()).toBe('PDF')
    const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
    expect(meta).toMatchObject({ name: 'a.pdf', title: 'T', pages: 2 })
    expect(typeof meta.savedAt).toBe('string')
  })

  it('stores and removes sessions', async () => {
    const root = await tmp()
    await writeSession(root, 'p', 's1')
    expect(await readSessions(root)).toEqual({ p: 's1' })
    await writeSession(root, 'p', null)
    expect(await readSessions(root)).toEqual({})
  })

  it('persists the token, rotating on request, with mode 600', async () => {
    const root = await tmp()
    const a = await loadToken(root)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await loadToken(root)).toBe(a)
    expect(await loadToken(root, true)).not.toBe(a)
    expect((await stat(path.join(root, 'host-token'))).mode & 0o777).toBe(0o600)
  })
})
