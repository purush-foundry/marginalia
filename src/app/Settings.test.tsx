import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Settings } from './Settings'

const root = document.createElement('div')

beforeEach(() => {
  document.body.append(root)
})

afterEach(() => {
  act(() => render(null, root))
  root.remove()
})

describe('Settings', () => {
  test('links the privacy page from the footer', () => {
    act(() => render(<Settings />, root))
    const link = [...root.querySelectorAll('a')].find((a) => a.textContent === 'Privacy')!
    expect(link.getAttribute('href')).toBe('/privacy.html')
  })
})
