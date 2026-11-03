const IOS_MAX_CANVAS_PIXELS = 5 * 1024 * 1024
const MAX_CANVAS_PIXELS = 2 ** 25
export const MAX_CANVAS_DIM = 32767

/** True on iPhone, iPad and iPadOS reporting as a Mac. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** Largest canvas area in device pixels this platform renders reliably. */
export function canvasPixelCap(): number {
  return isIOS() ? IOS_MAX_CANVAS_PIXELS : MAX_CANVAS_PIXELS
}
