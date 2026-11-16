// Tells agent-terminal threads apart from Ask threads.
import type { Thread } from '../types'

/** True for a whole-paper thread held by the agent terminal. */
export function isAgentThread(t: Thread): boolean {
  return t.anchor.page === 0 && t.model === 'agent'
}
