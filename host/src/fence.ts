import path from 'node:path'

// True when `file` is `dir` itself or lies beneath it.
export function insideDir(file: string, dir: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(file))
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
}

const PRIVATE_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.config/gcloud', '.config/marginalia', '.claude']
const PRIVATE_FILES = ['.docker/config.json', '.netrc', '.claude.json', '.marginalia/host-token', '.marginalia/sessions.json']

// True for credential and config paths under `home` the agent may never read.
export function isPrivatePath(file: string, home: string): boolean {
  const abs = path.resolve(file)
  const h = path.resolve(home)
  if (PRIVATE_DIRS.some((d) => insideDir(abs, path.join(h, d)))) return true
  if (PRIVATE_FILES.some((f) => abs === path.join(h, f))) return true
  const segs = abs.split(path.sep)
  if (segs.includes('.env')) return true
  const base = path.basename(abs)
  return base.endsWith('.pem') || base.endsWith('.key')
}

type HookInput = { tool_name: string; tool_input: Record<string, unknown> }

const deny = (reason: string) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
})

function resolveTool(p: unknown, paperDir: string, home: string): string | null {
  if (typeof p !== 'string' || p === '') return null
  const expanded = p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p
  return path.resolve(paperDir, expanded)
}

// PreToolUse hook that confines writes to the paper dir and blocks reads of private paths.
export function fenceHook(paperDir: string, home: string): (input: HookInput) => Promise<Record<string, unknown>> {
  return async ({ tool_name, tool_input }) => {
    if (tool_name === 'Bash') return deny('Shell access is disabled')
    if (tool_name === 'Write' || tool_name === 'Edit' || tool_name === 'NotebookEdit') {
      const target = resolveTool(tool_input.file_path, paperDir, home)
      if (!target || !insideDir(target, paperDir)) return deny('Writes are limited to the paper folder')
      return {}
    }
    if (tool_name === 'Read' || tool_name === 'Glob' || tool_name === 'Grep') {
      const raw = tool_name === 'Read' ? tool_input.file_path : tool_input.path
      const target = raw === undefined || raw === null ? paperDir : resolveTool(raw, paperDir, home)
      if (target && isPrivatePath(target, home)) return deny('That path is private')
    }
    return {}
  }
}

export const denyAll = async (toolName: string): Promise<{ behavior: 'deny'; message: string }> => ({
  behavior: 'deny',
  message: `${toolName} is not allowed`,
})
