import { render } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderMarkdown } from './markdown.ts'

let root: HTMLElement

function show(src: string, onCite = vi.fn()) {
  root = document.createElement('div')
  document.body.append(root)
  render(<div>{renderMarkdown(src, onCite)}</div>, root)
  return { root, onCite }
}

afterEach(() => {
  render(null, root)
  root.remove()
})

describe('renderMarkdown', () => {
  it('renders paragraphs with bold, italic and inline code', () => {
    const { root } = show('One **strong** and *soft* with `x_i`.\n\nSecond para.')
    const ps = root.querySelectorAll('p')
    expect(ps).toHaveLength(2)
    expect(ps[0].querySelector('strong')?.textContent).toBe('strong')
    expect(ps[0].querySelector('em')?.textContent).toBe('soft')
    expect(ps[0].querySelector('code')?.textContent).toBe('x_i')
    expect(ps[1].textContent).toBe('Second para.')
  })

  it('renders bullet and numbered lists', () => {
    const { root } = show('- a\n- **b**\n\n1. one\n2. two\n3. three')
    expect(Array.from(root.querySelectorAll('ul > li'), (li) => li.textContent)).toEqual(['a', 'b'])
    expect(root.querySelector('ul strong')?.textContent).toBe('b')
    expect(Array.from(root.querySelectorAll('ol > li'), (li) => li.textContent)).toEqual(['one', 'two', 'three'])
  })

  it('renders headings and fenced code verbatim', () => {
    const { root } = show('## Idea\n\n```\nsoftmax(QK^T) **not bold**\n<b>x</b>\n```')
    expect(root.querySelector('h4')?.textContent).toBe('Idea')
    const pre = root.querySelector('pre code')
    expect(pre?.textContent).toBe('softmax(QK^T) **not bold**\n<b>x</b>')
    expect(root.querySelector('b')).toBeNull()
  })

  it('keeps an unterminated fence while the answer is still streaming', () => {
    const { root } = show('Look:\n```\nline 1')
    expect(root.querySelector('pre code')?.textContent).toBe('line 1')
  })

  it('never turns text into HTML', () => {
    const { root } = show('<img src=x onerror="alert(1)"> and <script>bad()</script>')
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('script')).toBeNull()
    expect(root.textContent).toContain('<img src=x')
  })

  it('turns page citations into buttons that call onCite', () => {
    const { root, onCite } = show('It uses "Scaled Dot-Product Attention" (p. 3), see also **“multi-head” (p.4)**.')
    const buttons = root.querySelectorAll<HTMLButtonElement>('button.cite')
    expect(buttons).toHaveLength(2)
    buttons[0].click()
    buttons[1].click()
    expect(onCite.mock.calls).toEqual([
      [3, 'Scaled Dot-Product Attention'],
      [4, 'multi-head'],
    ])
    expect(buttons[0].textContent).toContain('Scaled Dot-Product Attention')
  })
})
