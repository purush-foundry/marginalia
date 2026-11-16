import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { query, type CanUseTool, type HookCallback, type HookJSONOutput, type Options, type PreToolUseHookInput, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { createNormalizer, type SdkMsg } from './events'
import { denyAll, fenceHook, writeAllowed } from './fence'
import { paperDir, readSessions, writeSession } from './papers'
import type { HostEvent, MessageBody, StatusResponse } from './protocol'
import type { Runner, Session } from './server'

export interface AgentOptions {
  root: string
  repoDir: string
  model: string
  effort: 'low' | 'medium' | 'high'
  allowBash: boolean
  readDirs: string[]
  skillHash: string
  auth: StatusResponse['auth']
}

export interface AgentSession extends Session {
  readonly ended: boolean
}

// System prompt append naming the folders the agent may read besides its own.
export function marginaliaAppend(readDirs: string[]): string {
  const folders =
    readDirs.length > 0
      ? `The folders the host was started with can be listed with Glob and read with Read, not searched with Grep: ${readDirs.join(', ')}; everything else, including private configuration, is off limits.`
      : 'No folders besides this one are readable; private configuration is off limits.'
  return `You are the paper agent inside Marginalia, the user's paper reader. The whole paper was given to you in the first message, page-tagged with <page n="…"> blocks; the same text is in paper.txt and the original PDF in paper.pdf in your working directory, for Grep or a second look. When you quote the paper, write "quoted words" (p. N) so the app can jump to the page. Resolve cross-references ("Section 5", "Eq. 3", "Fig. 2") by reading that part of the paper. ${folders} Web search and web fetch are allowed. Write only inside this folder. Answer in plain Markdown: short paragraphs, lists, bold, code; no tables.`
}

export const ENDED_MESSAGE = 'The agent session has ended; use /clear to start a new one'

const PAPER_LEAD = 'The paper above is the one we are discussing.'
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit'])
const UNFENCED_TOOLS = new Set(['WebSearch', 'WebFetch', 'Skill'])
const HOOK_TIMEOUT_S = 30

type UserContent = SDKUserMessage['message']['content']

// First 12 hex of the SHA-256 of the worth-reading skill, or null when it cannot be read.
export function hashSkill(repoDir: string): string | null {
  try {
    const text = readFileSync(path.join(repoDir, 'skills', 'worth-reading', 'SKILL.md'))
    return createHash('sha256').update(text).digest('hex').slice(0, 12)
  } catch {
    return null
  }
}

// True when the text has a front matter block whose `verdict` is read, skim or skip.
export function looksLikeNote(markdown: string): boolean {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex((l) => l.trim() === '---')
  const end = lines.findIndex((l, i) => i > start && l.trim() === '---')
  if (start < 0 || end < 0) return false
  return lines.slice(start + 1, end).some((l) => /^\s*verdict\s*:\s*(["']?)(read|skim|skip)\1\s*$/.test(l))
}

// Drops any text before the note's front matter.
function noteText(text: string): string {
  const start = text.search(/^---[ \t]*$/m)
  return (start > 0 ? text.slice(start) : text).trim()
}

// Single-consumer async queue whose iterator ends once closed and drained.
function channel<T>() {
  const items: T[] = []
  let wake: (() => void) | undefined
  let closed = false
  const notify = () => {
    wake?.()
    wake = undefined
  }
  async function* iterate(): AsyncGenerator<T> {
    for (;;) {
      if (items.length > 0) yield items.shift() as T
      else if (closed) return
      else await new Promise<void>((resolve) => (wake = resolve))
    }
  }
  return {
    push(item: T) {
      if (closed) return
      items.push(item)
      notify()
    },
    close() {
      closed = true
      notify()
    },
    iterable: iterate(),
  }
}

// Builds the user message content: optional paper, optional quote line, text, and an optional image block.
function userContent(body: MessageBody, paper: string | null): UserContent {
  let text = body.text
  if (body.quote) text = `> "${body.quote.text}" (p. ${body.quote.page})\n\n${text}`
  if (paper !== null) text = `${paper.trimEnd()}\n\n${PAPER_LEAD}\n\n${text}`
  if (!body.image) return text
  return [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: body.image } },
    { type: 'text', text },
  ]
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Builds the Agent SDK runner that backs the HTTP server.
export function createRunner(opts: AgentOptions): Runner {
  const { root, repoDir, model, effort, allowBash, readDirs } = opts
  const home = os.homedir()
  const append = marginaliaAppend(readDirs)
  const skillsDir = path.join(repoDir, 'skills')
  const readPaper = (pdfId: string) => readFile(path.join(paperDir(root, pdfId), 'paper.txt'), 'utf8')

  function options(dir: string, write: boolean): Options {
    const extra = allowBash ? ['Bash'] : []
    const fence = fenceHook(dir, home, readDirs, [skillsDir])
    const hook: HookCallback = async (input) => {
      const pre = input as PreToolUseHookInput
      if (UNFENCED_TOOLS.has(pre.tool_name) || (allowBash && pre.tool_name === 'Bash')) return {}
      return (await fence({ tool_name: pre.tool_name, tool_input: (pre.tool_input ?? {}) as Record<string, unknown> })) as HookJSONOutput
    }
    const canUseTool: CanUseTool = async (name, input) => {
      if (write && WRITE_TOOLS.has(name) && (await writeAllowed(input.file_path ?? input.notebook_path, dir, home))) {
        return { behavior: 'allow', updatedInput: input }
      }
      return denyAll(name)
    }
    return {
      cwd: dir,
      settingSources: [],
      plugins: [{ type: 'local', path: repoDir }],
      systemPrompt: { type: 'preset', preset: 'claude_code', append },
      tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', ...(write ? ['Write', 'Edit'] : []), 'Skill', ...extra],
      allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill', ...extra],
      hooks: { PreToolUse: [{ hooks: [hook], timeout: HOOK_TIMEOUT_S, onFailure: 'block' }] },
      canUseTool,
      permissionMode: 'default',
      model,
      effort,
      includePartialMessages: true,
      maxTurns: 40,
      maxBudgetUsd: 2,
    }
  }

  async function openSession(pdfId: string, sessionId: string | null, fresh: boolean): Promise<AgentSession> {
    const dir = paperDir(root, pdfId)
    const resume = fresh ? undefined : (sessionId ?? (await readSessions(root))[pdfId])
    const id = resume ?? randomUUID()
    const inbox = channel<MessageBody>()
    const events = channel<HostEvent>()
    const abort = new AbortController()
    let closed = false
    let ended = false

    async function* userMessages(): AsyncGenerator<SDKUserMessage> {
      let needsPaper = resume === undefined
      for await (const body of inbox.iterable) {
        const paper = needsPaper ? await readPaper(pdfId) : null
        needsPaper = false
        events.push({ type: 'turn_start' })
        yield { type: 'user', message: { role: 'user', content: userContent(body, paper) }, parent_tool_use_id: null }
      }
    }

    const q = query({
      prompt: userMessages(),
      options: { ...options(dir, true), abortController: abort, ...(resume ? { resume } : { sessionId: id }) },
    })

    void (async () => {
      const norm = createNormalizer()
      let lastWasError = false
      try {
        for await (const msg of q) {
          if (msg.type === 'system' && msg.subtype === 'init') await writeSession(root, pdfId, msg.session_id)
          for (const ev of norm.push(msg as unknown as SdkMsg)) {
            lastWasError = ev.type === 'error'
            events.push(ev)
          }
        }
      } catch (err) {
        if (!closed && !lastWasError) events.push({ type: 'error', message: errorText(err) })
      } finally {
        ended = true
      }
    })()

    return {
      id,
      events: events.iterable,
      get ended() {
        return ended
      },
      send(body) {
        if (ended) {
          events.push({ type: 'error', message: ENDED_MESSAGE })
          return
        }
        if (body.text.startsWith('/model ')) {
          q.setModel(body.text.slice(7).trim()).catch((err: unknown) => events.push({ type: 'error', message: errorText(err) }))
          return
        }
        inbox.push(body)
      },
      async interrupt() {
        if (ended) return
        await q.interrupt().catch(() => undefined)
      },
      close() {
        closed = true
        inbox.close()
        events.close()
        abort.abort()
      },
    }
  }

  async function* verdict(pdfId: string): AsyncGenerator<HostEvent> {
    const dir = paperDir(root, pdfId)
    const paper = await readPaper(pdfId)
    const norm = createNormalizer()
    let failed = false
    try {
      const q = query({ prompt: '/marginalia:worth-reading\n\n' + paper, options: { ...options(dir, false), maxTurns: 20 } })
      for await (const msg of q) {
        for (const ev of norm.push(msg as unknown as SdkMsg)) {
          if (ev.type === 'error') failed = true
          yield ev
        }
      }
    } catch (err) {
      if (!failed) yield { type: 'error', message: errorText(err) }
      return
    }
    if (failed) return
    const text = norm.finalText()
    if (looksLikeNote(text)) yield { type: 'note', markdown: noteText(text) }
    else yield { type: 'error', message: 'the agent did not produce a valid note' }
  }

  return {
    status: () => ({ model, skill: hashSkill(repoDir) ?? opts.skillHash, auth: opts.auth, cwd: root }),
    openSession,
    verdict,
    async paperReady(pdfId) {
      try {
        await access(path.join(paperDir(root, pdfId), 'paper.txt'))
        return true
      } catch {
        return false
      }
    },
  }
}
