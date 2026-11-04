import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FakeIndexedDb } from './test-idb'

let fake: FakeIndexedDb

beforeEach(() => {
  vi.resetModules()
  fake = new FakeIndexedDb()
  vi.stubGlobal('indexedDB', fake)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const OLD_STORES = { files: {}, sidecars: {}, settings: {}, meta: {}, queue: { 'notes:p1': { queuedAt: 1 } } }

test('upgrading an older database copies every notes record into notebooks and leaves notes in place', async () => {
  const notes = { p1: { sidecar: { schema: 2, kind: 'notes' }, dirty: true }, p2: { sidecar: { schema: 1, kind: 'notes' }, dirty: false } }
  fake.seed('marginalia', 2, { ...OLD_STORES, notes })
  const idb = await import('./idb')

  expect(await idb.idbGet('notebooks', 'p1')).toEqual(notes.p1)
  expect(Object.fromEntries((await idb.idbGetAll('notebooks')).map(({ key, value }) => [key, value]))).toEqual(notes)
  expect(fake.records('marginalia', 'notes')).toEqual(notes)
  expect(await idb.idbKeys('queue')).toEqual(['notes:p1'])
  expect(fake.databases.get('marginalia')!.version).toBe(3)
})

test('a new database has a notebooks store and no notes store', async () => {
  const idb = await import('./idb')

  await idb.idbSet('notebooks', 'p1', { dirty: false })

  expect(fake.records('marginalia', 'notebooks')).toEqual({ p1: { dirty: false } })
  expect(fake.records('marginalia', 'notes')).toBeUndefined()
})
