import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('index.html has no status-bar-style meta and keeps viewport-fit=cover', () => {
  const html = readFileSync('index.html', 'utf8')
  expect(html).not.toContain('apple-mobile-web-app-status-bar-style')
  expect(html).toContain('viewport-fit=cover')
})
