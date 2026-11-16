// @vitest-environment node
import { expect, test } from 'vitest'
import { HOST_VERSION } from './protocol.ts'

test('host version', () => {
  expect(HOST_VERSION).toBe('0.1.0')
})
