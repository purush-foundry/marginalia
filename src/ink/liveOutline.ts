export const LIVE_CHUNK_SAMPLES = 300
export const LIVE_CHUNK_OVERLAP_PX = 6

export interface LiveOutline {
  /** Points: the whole simplified stroke so far, CSS px, flat [x, y, p]; extra: predicted samples, outlined with the tail only. */
  update(points: number[], extra?: number[]): { frozen: readonly string[]; tail: string }
}

function distance(points: number[], a: number, b: number): number {
  return Math.hypot(points[b * 3] - points[a * 3], points[b * 3 + 1] - points[a * 3 + 1])
}

// Outlines a growing stroke as frozen overlapping chunks plus a tail that is re-outlined on every update.
export function createLiveOutline(outline: (points: number[], ends: { start: boolean; end: boolean }) => string): LiveOutline {
  const frozen: string[] = []
  let tailStart = 0
  return {
    update(points, extra = []) {
      const n = Math.floor(points.length / 3)
      while (n - 1 - tailStart > LIVE_CHUNK_SAMPLES) {
        const end = tailStart + LIVE_CHUNK_SAMPLES
        frozen.push(outline(points.slice(tailStart * 3, (end + 1) * 3), { start: tailStart === 0, end: false }))
        let k = end
        let arc = 0
        while (k > tailStart + 1 && arc < LIVE_CHUNK_OVERLAP_PX) {
          arc += distance(points, k - 1, k)
          k--
        }
        tailStart = k
      }
      const tail = points.slice(tailStart * 3, n * 3).concat(extra)
      return { frozen, tail: outline(tail, { start: tailStart === 0, end: true }) }
    },
  }
}
