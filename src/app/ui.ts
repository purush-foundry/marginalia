// App-wide UI state shared by the shell's screens.
import { signal } from '@preact/signals'

/** Settings sheet is open. */
export const settingsOpen = signal(false)

/** The root folder picker is open over an existing library. */
export const choosingRoot = signal(false)

/** initAuth has finished restoring the cached token and loading Google sign-in. */
export const authReady = signal(false)

/** Short status message shown at the bottom of the screen. */
export const toast = signal<string | null>(null)

let toastTimer: ReturnType<typeof setTimeout> | undefined

export function showToast(message: string, ms = 2500): void {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), ms)
}

/** Writes text to the clipboard; accepts a promise so Safari keeps the user gesture. */
export async function copyText(text: string | Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const blob = Promise.resolve(text).then((t) => new Blob([t], { type: 'text/plain' }))
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
    return
  }
  await navigator.clipboard.writeText(await text)
}
