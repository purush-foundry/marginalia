// Zoom and layout maths for the notebook pane.

export const NOTEBOOK_GAP_PX = 16
export const NOTEBOOK_MAX_ZOOM = 4
export const PULL_ADD_PX = 80

/** Zoom clamped to [1, NOTEBOOK_MAX_ZOOM]; 1 is fit-width. */
export function clampZoom(z: number): number {
  return Math.min(NOTEBOOK_MAX_ZOOM, Math.max(1, z))
}

/** CSS width of a page when the widest page fits the pane less a gap each side, times zoom. */
export function pageCssWidth(pageWmm: number, widestMm: number, paneW: number, zoom: number): number {
  return ((paneW - 2 * NOTEBOOK_GAP_PX) * pageWmm * zoom) / widestMm
}

/** Scroll offset that keeps the content under `anchor` (pane coordinates) still when zoom goes from `from` to `to`. */
export function zoomScroll(
  scroll: { left: number; top: number },
  anchor: { x: number; y: number },
  from: number,
  to: number,
): { left: number; top: number } {
  const k = to / from
  return { left: (scroll.left + anchor.x) * k - anchor.x, top: (scroll.top + anchor.y) * k - anchor.y }
}
