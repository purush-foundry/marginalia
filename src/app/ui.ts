// App-wide UI state shared by the shell's screens.
import { signal } from '@preact/signals'

/** Settings sheet is open. */
export const settingsOpen = signal(false)

/** The root folder picker is open over an existing library. */
export const choosingRoot = signal(false)

/** initAuth has finished restoring the cached token and loading Google sign-in. */
export const authReady = signal(false)

/** The browser reports a network connection. */
export const online = signal(typeof navigator === 'undefined' ? true : navigator.onLine)

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

/** Copies a PNG to the clipboard, or downloads it when the clipboard cannot take images. */
export async function copyImage(blob: Blob | Promise<Blob>, filename: string): Promise<'copied' | 'downloaded'> {
  const png = Promise.resolve(blob)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      return 'copied'
    } catch {
      // Falls through to the download.
    }
  }
  const url = URL.createObjectURL(await png)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return 'downloaded'
}
