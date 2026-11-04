import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { PageTemplate, PaperColor } from './model.ts'
import { PaperBackground } from './paper.tsx'

let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  render(null, host)
  host.remove()
})

async function paper(template: PageTemplate, color: PaperColor = 'white') {
  await act(() => {
    render(<PaperBackground template={template} color={color} cssW={840} widthMm={210} />, host)
  })
  return host.querySelector('svg.mg-nb-paper')!
}

const size = (svg: Element) => {
  const p = svg.querySelector('pattern')!
  return [Number(p.getAttribute('width')), Number(p.getAttribute('height'))]
}

const rule = (svg: Element) => {
  const mark = svg.querySelector('pattern > *')!
  return mark.getAttribute('stroke') ?? mark.getAttribute('fill')
}

test('ruled college lines repeat every 7.1 mm of page width', async () => {
  const svg = await paper('ruled-college')
  expect(size(svg)[1]).toBeCloseTo(28.4)
  expect(svg.querySelector('rect')!.getAttribute('fill')).toBe(`url(#${svg.querySelector('pattern')!.id})`)
})

test('grid and dots repeat every 5 mm; blank draws no pattern', async () => {
  expect(size(await paper('grid'))).toEqual([20, 20])
  expect(size(await paper('dots'))).toEqual([20, 20])
  const blank = await paper('blank')
  expect(blank).not.toBeNull()
  expect(blank.querySelector('pattern')).toBeNull()
})

test('rules are light blue-grey on white and yellow and 15 % white on dark', async () => {
  expect(rule(await paper('ruled-wide', 'white'))).toBe('#c9d3de')
  expect(rule(await paper('grid', 'yellow'))).toBe('#c9d3de')
  expect(rule(await paper('dots', 'dark'))).toBe('rgba(255, 255, 255, 0.15)')
})
