// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist'
import { expect, it, vi } from 'vitest'
import { imageRegions } from './images.ts'

vi.mock('pdfjs-dist', () => import('pdfjs-dist/legacy/build/pdf.mjs'))

it('finds the raster figures of attention.pdf and nothing on text pages', async () => {
  const data = new Uint8Array(readFileSync('test/fixtures/attention.pdf'))
  const task = getDocument({ data, verbosity: 0 })
  const doc = await task.promise
  expect(await imageRegions(await doc.getPage(2))).toEqual([])
  const fig1 = await imageRegions(await doc.getPage(3))
  expect(fig1).toHaveLength(1)
  expect(fig1[0].x).toBeCloseTo(0.321, 2)
  expect(fig1[0].y).toBeCloseTo(0.091, 2)
  expect(fig1[0].w).toBeCloseTo(0.358, 2)
  expect(fig1[0].h).toBeCloseTo(0.407, 2)
  expect(await imageRegions(await doc.getPage(4))).toHaveLength(2)
  await task.destroy()
})
