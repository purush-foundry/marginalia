// Caret helpers for editable text: read and place the caret by character offset, and keep it above the visual viewport's bottom edge.

const CARET_MARGIN_PX = 16

/** Character offset of the selection start inside el, or 0 when the selection is elsewhere. */
export function caretOffset(el: HTMLElement): number {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return 0
  const before = document.createRange()
  before.setStart(el, 0)
  before.setEnd(range.startContainer, range.startOffset)
  return before.toString().length
}

/** Collapses the selection to the given character offset inside el. */
export function placeCaret(el: HTMLElement, offset: number): void {
  const sel = document.getSelection()
  if (!sel) return
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let left = offset
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node as Text).length
    if (left <= length) {
      sel.collapse(node, left)
      return
    }
    left -= length
  }
  sel.collapse(el, el.childNodes.length)
}

/** Scrolls the scroller so the caret sits above the visual viewport's bottom edge. */
export function keepCaretVisible(scroller: HTMLElement): void {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (!scroller.contains(range.endContainer)) return
  let rect = range.getBoundingClientRect()
  if (rect.top === 0 && rect.bottom === 0) {
    const node = range.endContainer
    rect = (node instanceof Element ? node : node.parentElement)?.getBoundingClientRect() ?? rect
  }
  const vv = window.visualViewport
  const limit = (vv ? vv.offsetTop + vv.height : window.innerHeight) - CARET_MARGIN_PX
  if (rect.bottom > limit) scroller.scrollTop += rect.bottom - limit
}

