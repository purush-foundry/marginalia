export const HOST_VERSION = '0.1.0'

export type HostEvent =
  | { type: 'turn_start' }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; id: string; ok: boolean; summary: string }
  | { type: 'status'; text: string }
  | { type: 'turn_end'; costUsd: number; durationMs: number; numTurns: number }
  | { type: 'note'; markdown: string }
  | { type: 'error'; message: string }

export interface StatusResponse {
  version: string
  model: string
  skill: string
  auth: 'api-key' | 'oauth-token' | 'none'
  cwd: string
}

// pdf is base64.
export interface PaperUpload {
  name: string
  title: string | null
  pages: { n: number; text: string }[]
  pdf: string
}

export interface MessageBody {
  text: string
  quote?: { text: string; page: number }
  image?: string
}
