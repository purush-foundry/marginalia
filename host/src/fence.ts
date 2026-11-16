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

// Trims like the CLI, expands ~ and ~/, and resolves against paperDir without following symlinks.
function expandToolPath(raw: string, paperDir: string, home: string): string {
  const p = raw.trim()
  const expanded = p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p
  return path.resolve(paperDir, expanded)
}

// Trims, expands ~, resolves against paperDir and follows symlinks of the nearest existing ancestor.
export async function resolveToolPath(raw: string, paperDir: string, home: string): Promise<string> {
  return realpathLoose(expandToolPath(raw, paperDir, home))
}

const plainPath = (raw: unknown): raw is string => typeof raw === 'string' && raw.trim() !== '' && !raw.includes('://')

// True when a tool write to `raw` lands inside paperDir once trimmed, expanded and symlink-resolved.
export async function writeAllowed(raw: unknown, paperDir: string, home: string): Promise<boolean> {
  if (!plainPath(raw)) return false
  const [target, realPaper] = await Promise.all([resolveToolPath(raw, paperDir, home), resolveToolPath(paperDir, paperDir, home)])
  return insideDir(target, realPaper)
}

// True when the lexical or resolved path is private, or the resolved path lies in a resolved private location.
async function privateTarget(lexical: string, target: string, home: string): Promise<boolean> {
  const realHome = await realpathLoose(path.resolve(home))
  if (isPrivatePath(lexical, home) || isPrivatePath(lexical, realHome) || isPrivatePath(target, realHome)) return true
  const locations = await Promise.all([...PRIVATE_DIRS, ...PRIVATE_FILES].map((p) => realpathLoose(path.join(realHome, p))))
  return locations.some((l) => insideDir(target, l))
}

type HookInput = { tool_name: string; tool_input: Record<string, unknown> }

const deny = (reason: string) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
})

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const SEARCH_TOOLS = new Set(['Glob', 'Grep'])

// PreToolUse hook: writes stay in paperDir; Read and Glob reach paperDir, readDirs and grepDirs, Grep only paperDir and grepDirs, minus private paths; unknown tools are denied.
export function fenceHook(paperDir: string, home: string, readDirs: string[] = [], grepDirs: string[] = []): (input: HookInput) => Promise<Record<string, unknown>> {
  return async ({ tool_name, tool_input }) => {
    if (WRITE_TOOLS.has(tool_name)) {
      const allowed = await writeAllowed(tool_input.file_path ?? tool_input.notebook_path, paperDir, home)
      return allowed ? {} : deny('Writes are limited to the paper folder')
    }
    if (tool_name === 'Read' || SEARCH_TOOLS.has(tool_name)) {
      const raw = tool_name === 'Read' ? tool_input.file_path : (tool_input.path ?? paperDir)
      if (!plainPath(raw)) return deny('Reads need a plain path')
      if (SEARCH_TOOLS.has(tool_name) && typeof tool_input.pattern === 'string') {
        const pattern = tool_input.pattern.trim()
        if (path.isAbsolute(pattern) || pattern.startsWith('~')) return deny('Search patterns must be relative')
      }
      const glob = tool_name === 'Glob' ? tool_input.pattern : tool_name === 'Grep' ? tool_input.glob : undefined
      if (typeof glob === 'string' && glob.includes('..')) return deny('Search patterns must stay inside the search root')
      const lexical = expandToolPath(raw, paperDir, home)
      const target = await realpathLoose(lexical)
      const dirs = [paperDir, ...grepDirs, ...(tool_name === 'Grep' ? [] : readDirs)]
      const roots = await Promise.all(dirs.map((d) => resolveToolPath(d, paperDir, home)))
      if (!roots.some((r) => insideDir(target, r))) return deny('That path is outside the allowed folders')
      if (await privateTarget(lexical, target, home)) return deny('That path is private')
      return {}
    }
    return deny(`${tool_name} is not allowed`)
  }
}

export const denyAll = async (toolName: string): Promise<{ behavior: 'deny'; message: string }> => ({
  behavior: 'deny',
  message: `${toolName} is not allowed`,
})
