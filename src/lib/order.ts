// Fractional order keys: base-62 strings that sort with plain code-unit comparison.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

// A key strictly between a and b (null b is an open upper end); never ends in the lowest digit.
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while ((a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[da] + midpoint(a.slice(1), null)
}

/** A key strictly between a and b; null is an open end, and a b not greater than a counts as null. */
export function orderBetween(a: string | null, b: string | null): string {
  const lo = a ?? ''
  return midpoint(lo, b !== null && b > lo ? b : null)
}

/** Sorts by order key with plain code-unit comparison, then by id. */
export function compareOrder(x: { order: string; id: string }, y: { order: string; id: string }): number {
  if (x.order !== y.order) return x.order < y.order ? -1 : 1
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
}
