import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, test } from 'vitest'
import { authError, gisAvailable } from '../drive/auth'
import { Onboarding } from './Onboarding'
import { authReady } from './ui'

const root = document.createElement('div')

afterEach(() => {
  act(() => render(null, root))
  root.remove()
})

describe('Connect step', () => {
  test('says Google sign-in is unavailable offline instead of offering a dead button', () => {
    document.body.append(root)
    authReady.value = true
    gisAvailable.value = false
    act(() => render(<Onboarding step="connect" />, root))

    expect(root.textContent).toContain('Offline — Google sign-in unavailable')
    expect(root.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)

    act(() => {
      gisAvailable.value = true
    })
    expect(root.textContent).not.toContain('Offline')
    expect(root.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false)
  })

  test('offers the redirect sign-in and shows the error Google returned', () => {
    document.body.append(root)
    authReady.value = true
    gisAvailable.value = true
    authError.value = 'Google sign-in failed: access_denied'
    act(() => render(<Onboarding step="connect" />, root))

    expect([...root.querySelectorAll('button')].map((b) => b.textContent)).toContain('Sign in with a redirect instead')
    expect(root.textContent).toContain('access_denied')
    authError.value = null
  })
})
