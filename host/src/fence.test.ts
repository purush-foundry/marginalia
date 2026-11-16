// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { denyAll, fenceHook, insideDir, isPrivatePath } from './fence'

const home = '/home/u'
const dir = '/home/u/.marginalia/papers/p1'
const hook = fenceHook(dir, home)
const denied = (r: Record<string, unknown>) => (r.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision === 'deny'

describe('insideDir', () => {
  it('handles prefixes and traversal', () => {
    expect(insideDir('/a/b/c', '/a/b')).toBe(true)
    expect(insideDir('/a/b', '/a/b')).toBe(true)
    expect(insideDir('/a/bc', '/a/b')).toBe(false)
    expect(insideDir('/a/b/../c', '/a/b')).toBe(false)
  })
})

describe('isPrivatePath', () => {
  it('flags credentials and keys', () => {
    for (const p of ['.ssh/id_ed25519', '.aws/credentials', '.claude.json', '.marginalia/host-token', 'proj/.env', 'x/server.key', 'x/a.pem']) {
      expect(isPrivatePath(`${home}/${p}`, home)).toBe(true)
    }
    expect(isPrivatePath(`${home}/Documents/x.md`, home)).toBe(false)
  })
})

describe('fenceHook', () => {
  it('limits writes to the paper dir', async () => {
    expect(await hook({ tool_name: 'Write', tool_input: { file_path: `${dir}/notes.md` } })).toEqual({})
    expect(await hook({ tool_name: 'Write', tool_input: { file_path: 'notes.md' } })).toEqual({})
    const out = await hook({ tool_name: 'Edit', tool_input: { file_path: `${home}/x.md` } })
    expect(denied(out)).toBe(true)
    expect(denied(await hook({ tool_name: 'Write', tool_input: { file_path: `${dir}/../x` } }))).toBe(true)
    expect(denied(await hook({ tool_name: 'Write', tool_input: { file_path: '~/x' } }))).toBe(true)
  })
  it('blocks private reads only', async () => {
    expect(await hook({ tool_name: 'Read', tool_input: { file_path: '~/Documents/x.md' } })).toEqual({})
    for (const p of ['~/.ssh/id_ed25519', '~/.config/marginalia/host.env', '~/proj/.env', '~/x/server.key']) {
      expect(denied(await hook({ tool_name: 'Read', tool_input: { file_path: p } }))).toBe(true)
    }
    expect(denied(await hook({ tool_name: 'Grep', tool_input: { path: '~/.aws' } }))).toBe(true)
    expect(await hook({ tool_name: 'Glob', tool_input: {} })).toEqual({})
  })
  it('denies Bash always', async () => {
    expect(denied(await hook({ tool_name: 'Bash', tool_input: { command: 'ls' } }))).toBe(true)
    expect(denied(await hook({ tool_name: 'Bash', tool_input: {} }))).toBe(true)
  })
  it('denyAll denies', async () => {
    expect((await denyAll('Bash')).behavior).toBe('deny')
  })
})
