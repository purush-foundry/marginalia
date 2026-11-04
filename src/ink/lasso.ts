// Lasso geometry in page-width units: loop hit tests, selection by stroke share and box centre, selection bounds.

/** Share of a stroke's samples that must lie inside the loop for the stroke to be selected. */
export const LASSO_STROKE_SHARE = 0.6

export interface ItemRef {
  kind: 'stroke' | 'text' | 'image'
  id: string
}

/** A page item as the lasso sees it: a stroke's flat [x, y, pressure] points or an object's box. */
export interface LassoItem extends ItemRef {
  points?: number[]
  box?: { x: number; y: number; w: number; h: number }
}

type Bounds = { x: number; y: number; w: number; h: number }

/** Even-odd test of a point against a loop given as flat [x, y, …], closed implicitly. */
export function pointInLoop(x: number, y: number, loop: number[]): boolean {
  let inside = false
  const n = loop.length - (loop.length % 2)
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = loop[i]
    const yi = loop[i + 1]
    const xj = loop[j]
    const yj = loop[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** True when at least LASSO_STROKE_SHARE of the stroke's samples are inside the loop. */
export function strokeInLoop(points: number[], loop: number[]): boolean {
  let total = 0
  let inside = 0
  for (let i = 0; i + 1 < points.length; i += 3) {
    total++
    if (pointInLoop(points[i], points[i + 1], loop)) inside++
  }
  return total > 0 && inside >= LASSO_STROKE_SHARE * total
}

/** The loop of the rectangle with corners (x0, y0) and (x1, y1). */
export function rectLoop(x0: number, y0: number, x1: number, y1: number): number[] {
  return [x0, y0, x1, y0, x1, y1, x0, y1]
}

/** Strokes with enough samples inside the loop and objects whose box centre is inside it. */
export function selectInLoop(items: LassoItem[], loop: number[]): ItemRef[] {
  const out: ItemRef[] = []
  for (const { kind, id, points, box } of items) {
    const hit = points ? strokeInLoop(points, loop) : box ? pointInLoop(box.x + box.w / 2, box.y + box.h / 2, loop) : false
    if (hit) out.push({ kind, id })
  }
  return out
}

/** Bounding box of the referenced items' samples and boxes; null when none is found. */
export function itemsBounds(items: LassoItem[], refs: ItemRef[]): Bounds | null {
  const wanted = new Set(refs.map((r) => `${r.kind}:${r.id}`))
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const item of items) {
    if (!wanted.has(`${item.kind}:${item.id}`)) continue
    const p = item.points ?? []
    for (let i = 0; i + 1 < p.length; i += 3) {
      x0 = Math.min(x0, p[i])
      y0 = Math.min(y0, p[i + 1])
      x1 = Math.max(x1, p[i])
      y1 = Math.max(y1, p[i + 1])
    }
    if (item.box) {
      x0 = Math.min(x0, item.box.x)
      y0 = Math.min(y0, item.box.y)
      x1 = Math.max(x1, item.box.x + item.box.w)
      y1 = Math.max(y1, item.box.y + item.box.h)
    }
  }
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}
