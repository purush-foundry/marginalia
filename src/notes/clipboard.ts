// In-app clipboard of notebook items, positioned relative to the copied selection's top-left.
import { signal, type Signal } from '@preact/signals'
import type { ItemRef } from '../ink/lasso.ts'
import type { ImageObject, NotebookStroke, ObjectBox, PageContent, TextObject } from './model.ts'

type Bare<T> = Omit<T, 'id' | 'page' | 'z' | 'createdAt' | 'updatedAt' | 'deleted'>

/** Copied items in page-width units relative to the clip's top-left; w and h are the clip's extent. */
export interface Clip {
  strokes: Bare<NotebookStroke>[]
  texts: Bare<TextObject>[]
  images: Bare<ImageObject>[]
  w: number
  h: number
}

export const clipboard: Signal<Clip | null> = signal<Clip | null>(null)

// Drops the identity, page, z, times and tombstone of an item.
function bare<T extends NotebookStroke | TextObject | ImageObject>(item: T): Bare<T> {
  const { id: _id, page: _page, z: _z, createdAt: _c, updatedAt: _u, deleted: _d, ...rest } = item
  return rest
}

/** Puts the referenced items of a page in the clipboard, each kind in z order, and returns the clip. */
export function copyItems(content: PageContent, refs: ItemRef[]): Clip {
  const has = (kind: ItemRef['kind'], id: string) => refs.some((r) => r.kind === kind && r.id === id)
  const strokes = content.strokes.filter((s) => has('stroke', s.id))
  const texts = content.texts.filter((t) => has('text', t.id))
  const images = content.images.filter((m) => has('image', m.id))

  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const cover = (x: number, y: number) => {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  for (const s of strokes) for (let i = 0; i + 1 < s.points.length; i += 3) cover(s.points[i], s.points[i + 1])
  for (const t of texts) {
    cover(t.box.x, t.box.y)
    cover(t.box.x + t.box.w, t.box.y)
  }
  for (const m of images) {
    cover(m.box.x, m.box.y)
    cover(m.box.x + m.box.w, m.box.y + m.box.w * m.aspect)
  }
  if (x0 > x1) x0 = y0 = x1 = y1 = 0

  const shift = (box: ObjectBox): ObjectBox => ({ ...box, x: box.x - x0, y: box.y - y0 })
  const clip: Clip = {
    strokes: strokes.map((s) => ({ ...bare(s), points: s.points.map((v, i) => (i % 3 === 0 ? v - x0 : i % 3 === 1 ? v - y0 : v)) })),
    texts: texts.map((t) => ({ ...bare(t), box: shift(t.box) })),
    images: images.map((m) => ({ ...bare(m), box: shift(m.box) })),
    w: x1 - x0,
    h: y1 - y0,
  }
  clipboard.value = clip
  return clip
}
