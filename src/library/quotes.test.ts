import { expect, test } from 'vitest'
import { QUOTES, pickQuote } from './quotes'

test('pickQuote is deterministic and wraps any seed into the list', () => {
  expect(pickQuote(5)).toBe(pickQuote(5))
  expect(pickQuote(QUOTES.length)).toBe(pickQuote(0))
  expect(pickQuote(-1)).toBe(QUOTES.at(-1))
  expect(pickQuote(2.7)).toBe(pickQuote(2))
})

test('8 to 16 quotations of at most 14 words, each attributed to an author and a work', () => {
  expect(QUOTES.length).toBeGreaterThanOrEqual(8)
  expect(QUOTES.length).toBeLessThanOrEqual(16)
  for (const q of QUOTES) {
    expect(q.text.trim().split(/\s+/).length).toBeLessThanOrEqual(14)
    expect(q.author.trim()).not.toBe('')
    expect(q.source.trim()).not.toBe('')
  }
})
