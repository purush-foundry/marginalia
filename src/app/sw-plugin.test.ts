import { describe, expect, test } from 'vitest'
import { precacheList, swPrecache } from './sw-plugin'

const swSource = `const PRECACHE="__PRECACHE_MANIFEST__";const CACHE="marginalia-__PRECACHE_VERSION__";`

function bundle(names: string[]) {
  const out: Record<string, { type: 'chunk' | 'asset'; fileName: string; code?: string }> = {
    'sw.js': { type: 'chunk', fileName: 'sw.js', code: swSource },
  }
  for (const n of names) out[n] = { type: n.endsWith('.js') ? 'chunk' : 'asset', fileName: n, code: '' }
  return out
}

function written(code: string): { files: string[]; cache: string } {
  const files = JSON.parse(code.match(/PRECACHE=(\[.*?\]);/)![1]) as string[]
  const cache = code.match(/CACHE="([^"]+)"/)![1]
  return { files, cache }
}

describe('swPrecache', () => {
  test('writes every built file except the worker and maps, plus the extras, into sw.js', () => {
    const b = bundle(['index.html', 'assets/index-abc.js', 'assets/index-abc.js.map', 'assets/index-def.css', 'assets/pdf.worker.min-x.mjs'])
    swPrecache(['manifest.webmanifest']).generateBundle(undefined, b)

    const { files, cache } = written(b['sw.js'].code!)
    expect(files).toEqual([
      'assets/index-abc.js',
      'assets/index-def.css',
      'assets/pdf.worker.min-x.mjs',
      'index.html',
      'manifest.webmanifest',
    ])
    expect(cache).toMatch(/^marginalia-[0-9a-z]+$/)
    expect(b['sw.js'].code).not.toContain('__PRECACHE')
  })

  test('the cache version changes when the asset list changes', () => {
    const a = bundle(['index.html', 'assets/index-abc.js'])
    const b = bundle(['index.html', 'assets/index-xyz.js'])
    swPrecache().generateBundle(undefined, a)
    swPrecache().generateBundle(undefined, b)
    expect(written(a['sw.js'].code!).cache).not.toBe(written(b['sw.js'].code!).cache)
  })

  test('fails the build when sw.js or its placeholder is missing', () => {
    const b = bundle(['index.html'])
    b['sw.js'].code = 'const PRECACHE=[]'
    expect(() => swPrecache().generateBundle(undefined, b)).toThrow(/sw\.js/)
    expect(() => swPrecache().generateBundle(undefined, { 'index.html': { type: 'asset', fileName: 'index.html' } })).toThrow()
  })

  test('precacheList de-duplicates and sorts', () => {
    expect(precacheList(bundle(['b.js', 'a.css']), ['a.css'])).toEqual(['a.css', 'b.js'])
  })
})
