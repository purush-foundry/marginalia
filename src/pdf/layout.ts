// Vertical page stack geometry in CSS pixels of the scroll content.

export const PAGE_GAP = 8
export const PAD_X = 8
export const MIN_SCALE = 0.25
export const MAX_SCALE = 6

export interface Crop {
  left: number
  right: number
}

export interface Layout {
  scale: number
  tops: number[]
  lefts: number[]
  /** Visible (cropped) page widths. */
  widths: number[]
  heights: number[]
  /** Uncropped page widths at this scale. */
  fullWidths: number[]
  contentW: number
  contentH: number
}

/** Point on a page as fractions of the unrotated page, pinned to a point of the scroller viewport. */
export interface Anchor {
  page: number
  fy: number
  vy: number
  fx?: number
  vx?: number
}

type Size = { w: number; h: number }

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

function visible(crop: Crop): number {
  return Math.max(0.05, 1 - crop.left - crop.right)
}

export function fitWidthScale(sizes: Size[], crop: Crop, viewportW: number): number {
  const widest = Math.max(1, ...sizes.map((s) => s.w * visible(crop)))
  return clampScale((viewportW - 2 * PAD_X) / widest)
}

export function layoutPages(sizes: Size[], scale: number, crop: Crop, viewportW: number): Layout {
  const widths = sizes.map((s) => s.w * visible(crop) * scale)
  const fullWidths = sizes.map((s) => s.w * scale)
  const heights = sizes.map((s) => s.h * scale)
  const contentW = Math.max(viewportW, Math.max(0, ...widths) + 2 * PAD_X)
  const lefts = widths.map((w) => (contentW - w) / 2)
  const tops: number[] = []
  let y = PAGE_GAP
  for (const h of heights) {
    tops.push(y)
    y += h + PAGE_GAP
  }
  return { scale, tops, lefts, widths, heights, fullWidths, contentW, contentH: y }
}

/** Zero-based index of the page at content y (the page above when y is in a gap). */
export function pageIndexAt(layout: Layout, y: number): number {
  let lo = 0
  let hi = layout.tops.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (layout.tops[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return Math.max(0, lo)
}

/** Page and fraction of its height at content y. */
export function positionAt(layout: Layout, y: number): { page: number; offset: number } {
  const i = pageIndexAt(layout, y)
  const offset = (y - layout.tops[i]) / layout.heights[i]
  return { page: i + 1, offset: Math.min(1, Math.max(0, offset)) }
}

export function anchorAt(
  layout: Layout,
  crop: Crop,
  scrollLeft: number,
  scrollTop: number,
  vx: number,
  vy: number,
): Anchor {
  const x = scrollLeft + vx
  const y = scrollTop + vy
  const i = pageIndexAt(layout, y)
  return {
    page: i + 1,
    fy: (y - layout.tops[i]) / layout.heights[i],
    vy,
    fx: (x - layout.lefts[i]) / layout.fullWidths[i] + crop.left,
    vx,
  }
}

/** Scroll offsets that put the anchor's page point at its viewport point; left is null when the anchor has no x. */
export function scrollFor(layout: Layout, crop: Crop, a: Anchor): { left: number | null; top: number } {
  const i = Math.min(layout.tops.length - 1, Math.max(0, a.page - 1))
  const top = layout.tops[i] + a.fy * layout.heights[i] - a.vy
  const left =
    a.fx === undefined || a.vx === undefined
      ? null
      : layout.lefts[i] + (a.fx - crop.left) * layout.fullWidths[i] - a.vx
  return { left, top }
}
