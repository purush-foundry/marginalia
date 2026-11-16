import text from '../../skills/worth-reading/SKILL.md?raw'

// The bundled worth-reading skill, front matter included.
export const SKILL_TEXT: string = text

// Returns the instructions after the skill's own front matter.
export function skillBody(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  return (m ? text.slice(m[0].length) : text).trim()
}

// First 12 hex characters of the SHA-256 of the text.
export async function skillHash(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
}
