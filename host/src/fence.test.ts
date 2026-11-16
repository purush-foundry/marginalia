// @vitest-environment node
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { denyAll, fenceHook, insideDir, isPrivatePath, resolveToolPath } from './fence'

let home: string
let dir: string
let hook: ReturnType<typeof fenceHook>
let docsHook: ReturnType<typeof fenceHook>
const denied = (r: Record<string, unknown>) => (r.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision === 'deny'

beforeAll(async () => {
  home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'fence-')))
  dir = path.join(home, '.marginalia', 'papers', 'p1')
  await mkdir(dir, { recursive: true })
  await mkdir(path.join(home, '.ssh'), { recursive: true })
  await writeFile(path.join(home, '.ssh', 'id_ed25519'), 'k')
  await mkdir(path.join(home, 'Documents'), { recursive: true })
  await mkdir(path.join(home, 'certs'), { recursive: true })
  await symlink(path.join(home, '.ssh'), path.join(home, 'Documents', 'link-to-ssh'))
  hook = fenceHook(dir, home)
  docsHook = fenceHook(dir, home, ['~/Documents'])
})

describe('insideDir', () => {
  it('handles prefixes and traversal', () => {
    expect(insideDir('/a/b/c', '/a/b')).toBe(true)
    expect(insideDir('/a/b', '/a/b')).toBe(true)
    expect(insideDir('/a/bc', '/a/b')).toBe(false)
    expect(insideDir('/a/b/../c', '/a/b')).toBe(false)
  })
})

describe('isPrivatePath', () => {
  it('flags credentials, keys and .env variants', () => {
    for (const p of ['.ssh/id_ed25519', '.aws/credentials', '.claude.json', '.marginalia/host-token', 'proj/.env', 'proj/.env.local', 'x/server.key', 'x/a.pem']) {
      expect(isPrivatePath(`/home/u/${p}`, '/home/u')).toBe(true)
    }
    expect(isPrivatePath('/home/u/Documents/x.md', '/home/u')).toBe(false)
  })
})

describe('resolveToolPath', () => {
  it('expands ~, resolves relative paths and follows symlinks', async () => {
    expect(await resolveToolPath('~/Documents/x.md', dir, home)).toBe(path.join(home, 'Documents', 'x.md'))
    expect(await resolveToolPath('notes.md', dir, home)).toBe(path.join(dir, 'notes.md'))
    expect(await resolveToolPath('~/Documents/link-to-ssh/id_ed25519', dir, home)).toBe(path.join(home, '.ssh', 'id_ed25519'))
  })
})

describe('fenceHook writes', () => {
  it('limits writes to the paper dir', async () => {
    expect(await hook({ tool_name: 'Write', tool_input: { file_path: `${dir}/notes.md` } })).toEqual({})
    expect(await hook({ tool_name: 'Write', tool_input: { file_path: 'notes.md' } })).toEqual({})
    expect(await hook({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'n.ipynb' } })).toEqual({})
    expect(await hook({ tool_name: 'MultiEdit', tool_input: { file_path: 'a.md' } })).toEqual({})
    for (const input of [{ file_path: `${home}/x.md` }, { file_path: `${dir}/../x` }, { file_path: '~/x' }, { file_path: 'file:///etc/x' }, {}]) {
      expect(denied(await hook({ tool_name: 'Edit', tool_input: input }))).toBe(true)
    }
    expect(denied(await hook({ tool_name: 'MultiEdit', tool_input: { file_path: '~/x' } }))).toBe(true)
  })
})

describe('fenceHook reads', () => {
  it('allows the paper dir and listed read dirs only', async () => {
    expect(await hook({ tool_name: 'Read', tool_input: { file_path: 'paper.txt' } })).toEqual({})
    expect(denied(await hook({ tool_name: 'Read', tool_input: { file_path: '~/Documents/x.md' } }))).toBe(true)
    expect(await docsHook({ tool_name: 'Read', tool_input: { file_path: '~/Documents/x.md' } })).toEqual({})
    expect(await docsHook({ tool_name: 'Grep', tool_input: { path: '~/Documents', pattern: 'x' } })).toEqual({})
    expect(await hook({ tool_name: 'Glob', tool_input: { pattern: '*.md' } })).toEqual({})
  })

  it('denies private paths and every bypass', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['Read', { file_path: '~/.ssh/id_ed25519' }],
      ['Read', { file_path: '~/.SSH/id_ed25519' }],
      ['Read', { file_path: '~/Documents/link-to-ssh/id_ed25519' }],
      ['Read', { file_path: '~/proj/.env.local' }],
      ['Read', { file_path: '~/x/server.key' }],
      ['Grep', { path: '~', pattern: 'aws_secret_access_key' }],
      ['Grep', { path: '/', pattern: 'x' }],
      ['Grep', { path: '~/certs', pattern: 'x' }],
      ['Grep', { path: '~/.aws', pattern: 'x' }],
      ['Glob', { pattern: `${home}/.ssh/*` }],
      ['Glob', { pattern: '/x/*' }],
      ['Glob', { pattern: '~/.ssh/*' }],
      ['Glob', { pattern: '../../../../.ssh/*' }],
    ]
    for (const [tool_name, tool_input] of cases) {
      expect(denied(await docsHook({ tool_name, tool_input })), `${tool_name} ${JSON.stringify(tool_input)}`).toBe(true)
    }
    expect(denied(await docsHook({ tool_name: 'Grep', tool_input: { path: '~', pattern: 'x' } }))).toBe(true)
  })

  it.runIf(process.platform === 'linux')('denies /proc/self/root spellings', async () => {
    expect(denied(await docsHook({ tool_name: 'Read', tool_input: { file_path: `/proc/self/root${home}/.ssh/id_ed25519` } }))).toBe(true)
  })
})

describe('fenceHook other tools', () => {
  it('denies Bash and unknown tools', async () => {
    for (const tool_name of ['Bash', 'Task', 'mcp__x__y', 'WebFetch']) {
      expect(denied(await hook({ tool_name, tool_input: { command: 'ls' } }))).toBe(true)
    }
  })
  it('denyAll denies', async () => {
    expect((await denyAll('Bash')).behavior).toBe('deny')
  })
})
