import { realpath } from 'node:fs/promises'
import path from 'node:path'

const caseFold = process.platform === 'darwin' || process.platform === 'win32'
const fold = (s: string) => (caseFold ? s.toLowerCase() : s)

// True when `file` is `dir` itself or lies beneath it.
export function insideDir(file: string, dir: string): boolean {
  const rel = path.relative(fold(path.resolve(dir)), fold(path.resolve(file)))
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
}

const PRIVATE_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.config/gcloud', '.config/marginalia', '.claude']
const PRIVATE_FILES = ['.docker/config.json', '.netrc', '.claude.json', '.marginalia/host-token', '.marginalia/sessions.json']

// True for credential and config paths under `home` the agent may never read.
export function isPrivatePath(file: string, home: string): boolean {
  const abs = path.resolve(file)
  const h = path.resolve(home)
  if (PRIVATE_DIRS.some((d) => insideDir(abs, path.join(h, d)))) return true
  if (PRIVATE_FILES.some((f) => fold(abs) === fold(path.join(h, f)))) return true
  if (abs.split(path.sep).some((s) => fold(s).startsWith('.env'))) return true
  const base = fold(path.basename(abs))
  return base.endsWith('.pem') || base.endsWith('.key')
}

async function realpathLoose(p: string): Promise<string> {
  let rest = ''
  let cur = p
  for (;;) {
    try {
      return path.join(await realpath(cur), rest)
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return p
      rest = path.join(path.basename(cur), rest)
      cur = parent
    }
  }
}

// Expands ~, resolves against paperDir and follows symlinks of the nearest existing ancestor.
export async function resolveToolPath(raw: string, paperDir: string, home: string): Promise<string> {
  const expanded = raw === '~' ? home : raw.startsWith('~/') ? path.join(home, raw.slice(2)) : raw
  return realpathLoose(path.resolve(paperDir, expanded))
}

type HookInput = { tool_name: string; tool_input: Record<string, unknown> }

const deny = (reason: string) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
})

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const SEARCH_TOOLS = new Set(['Glob', 'Grep'])

// PreToolUse hook: writes stay in paperDir, reads stay in paperDir or readDirs minus private paths, unknown tools are denied.
export function fenceHook(paperDir: string, home: string, readDirs: string[] = []): (input: HookInput) => Promise<Record<string, unknown>> {
  return async ({ tool_name, tool_input }) => {
    const realHome = await resolveToolPath(home, paperDir, home)
    const realPaper = await resolveToolPath(paperDir, paperDir, home)
    if (WRITE_TOOLS.has(tool_name)) {
      const raw = tool_input.file_path ?? tool_input.notebook_path
      if (typeof raw !== 'string' || raw === '' || raw.includes('://')) return deny('Writes need a plain file path')
      const target = await resolveToolPath(raw, paperDir, home)
      return insideDir(target, realPaper) ? {} : deny('Writes are limited to the paper folder')
    }
    if (tool_name === 'Read' || SEARCH_TOOLS.has(tool_name)) {
      const raw = tool_name === 'Read' ? tool_input.file_path : (tool_input.path ?? paperDir)
      if (typeof raw !== 'string' || raw === '' || raw.includes('://')) return deny('Reads need a plain path')
      if (SEARCH_TOOLS.has(tool_name)) {
        const pattern = tool_input.pattern
        if (typeof pattern === 'string' && (path.isAbsolute(pattern) || pattern.startsWith('~'))) return deny('Search patterns must be relative')
        if (tool_name === 'Glob' && typeof pattern === 'string' && pattern.split(/[\\/]/).includes('..')) return deny('Search patterns must stay inside the search root')
      }
      const target = await resolveToolPath(raw, paperDir, home)
      const roots = [realPaper, ...(await Promise.all(readDirs.map((d) => resolveToolPath(d, paperDir, home))))]
      if (!roots.some((r) => insideDir(target, r))) return deny('That path is outside the allowed folders')
      if (isPrivatePath(target, realHome)) return deny('That path is private')
      return {}
    }
    return deny(`${tool_name} is not allowed`)
  }
}

export const denyAll = async (toolName: string): Promise<{ behavior: 'deny'; message: string }> => ({
  behavior: 'deny',
  message: `${toolName} is not allowed`,
})
