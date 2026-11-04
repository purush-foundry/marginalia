import { expect, test } from 'vitest'
import { compareOrder, orderBetween } from './order'

test('orderBetween(null, null) is "V" and keys sort with plain string comparison', () => {
  expect(orderBetween(null, null)).toBe('V')
  expect(orderBetween('V', null) > 'V').toBe(true)
  expect(orderBetween(null, 'V') < 'V').toBe(true)
})

test('1000 appends increase, 1000 prepends decrease, and no key ends in "0"', () => {
  let last = orderBetween(null, null)
  let first = last
  for (let i = 0; i < 1000; i++) {
    const appended = orderBetween(last, null)
    const prepended = orderBetween(null, first)
    expect(appended > last).toBe(true)
    expect(prepended < first).toBe(true)
    expect(appended.endsWith('0')).toBe(false)
    expect(prepended.endsWith('0')).toBe(false)
    last = appended
    first = prepended
  }
})

test('50 inserts between two neighbours stay strictly between and distinct', () => {
  const lo = orderBetween(null, null)
  let hi = orderBetween(lo, null)
  const keys = new Set<string>()
  for (let i = 0; i < 50; i++) {
    const key = orderBetween(lo, hi)
    expect(key > lo && key < hi).toBe(true)
    expect(key.endsWith('0')).toBe(false)
    keys.add(key)
    hi = key
  }
  expect(keys.size).toBe(50)
})

test('equal neighbours yield a key after them', () => {
  expect(orderBetween('V', 'V') > 'V').toBe(true)
})

test('compareOrder breaks equal keys by id', () => {
  const items = [
    { order: 'b', id: 'x' },
    { order: 'a', id: 'z' },
    { order: 'b', id: 'a' },
  ]
  expect(items.sort(compareOrder)).toEqual([
    { order: 'a', id: 'z' },
    { order: 'b', id: 'a' },
    { order: 'b', id: 'x' },
  ])
  expect(compareOrder({ order: 'a', id: 'q' }, { order: 'a', id: 'q' })).toBe(0)
})
