import { expect, test } from 'vitest'
import { mapHash, parseRoute } from './route'

test('parses the map and pair routes', () => {
  expect(parseRoute('#/map')).toEqual({ kind: 'map' })
  expect(parseRoute('#/pair/abc-123')).toEqual({ kind: 'pair', token: 'abc-123' })
  expect(parseRoute('#/')).toEqual({ kind: 'library' })
  expect(mapHash).toBe('#/map')
})

test('keeps the folder and paper routes', () => {
  expect(parseRoute('#/f/a%20b')).toEqual({ kind: 'library', folderId: 'a b' })
  expect(parseRoute('#/p/xyz')).toEqual({ kind: 'paper', id: 'xyz' })
})
