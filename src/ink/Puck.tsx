// Floating round control that flips the Pencil between pen and eraser and opens the pen palette on long-press.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Icon } from '../app/icons.tsx'
import { saveSettings, settings } from '../app/settings.ts'
import { PenStrip } from './PenStrip.tsx'
import { inkDisplayColor, penColor, penTool } from './tools.ts'
import './puck.css'

export const PUCK_LONG_PRESS_MS = 350
const SIZE = 44
const MARGIN = 8
const DRAG_PX = 8

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface Gesture {
  pointerId: number
  startY: number
  startFraction: number
  dragging: boolean
  long: boolean
}

export function Puck({ visible }: { visible: boolean }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hostH, setHostH] = useState(0)
  const [dragY, setDragY] = useState<number | null>(null)
  const [open, setOpen] = useState(false)

  const measure = () => {
    const h = buttonRef.current?.parentElement?.getBoundingClientRect().height ?? 0
    setHostH(h)
    return h
  }
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  useLayoutEffect(() => {
    if (!visible) return
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [visible])

  useEffect(() => clearTimer, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  if (!visible) return null

  const fraction = dragY ?? settings.value.puckY
  const top = clamp(fraction * hostH - SIZE / 2, MARGIN, Math.max(MARGIN, hostH - SIZE - MARGIN))

  const onDown = (e: PointerEvent) => {
    e.stopPropagation()
    if (!e.isPrimary || e.button !== 0 || gesture.current) return
    try {
      buttonRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // The pointer can no longer be captured.
    }
    measure()
    gesture.current = { pointerId: e.pointerId, startY: e.clientY, startFraction: settings.value.puckY, dragging: false, long: false }
    clearTimer()
    timer.current = setTimeout(() => {
      timer.current = null
      if (gesture.current) gesture.current.long = true
      setOpen(true)
    }, PUCK_LONG_PRESS_MS)
  }

  const onMove = (e: PointerEvent) => {
    e.stopPropagation()
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    const dy = e.clientY - g.startY
    if (!g.dragging && Math.abs(dy) > DRAG_PX) {
      g.dragging = true
      clearTimer()
    }
    if (g.dragging && hostH > 0) setDragY(clamp(g.startFraction + dy / hostH, 0, 1))
  }

  const onUp = (e: PointerEvent) => {
    e.stopPropagation()
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    gesture.current = null
    clearTimer()
    if (g.dragging) {
      const y = clamp(g.startFraction + (e.clientY - g.startY) / (hostH || 1), 0, 1)
      setDragY(null)
      saveSettings({ puckY: y }).catch(console.error)
    } else if (!g.long) {
      penTool.value = penTool.value === 'pen' ? 'eraser' : 'pen'
    }
  }

  const onCancel = (e: PointerEvent) => {
    e.stopPropagation()
    if (gesture.current && e.pointerId !== gesture.current.pointerId) return
    gesture.current = null
    clearTimer()
    setDragY(null)
  }

  const popStyle = top + SIZE / 2 > hostH / 2 ? { bottom: `${hostH - top - SIZE}px` } : { top: `${top}px` }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        class="mg-puck"
        aria-label="Pen tools"
        data-tool={penTool.value}
        style={{ top: `${top}px`, '--puck-color': inkDisplayColor(penColor.value) }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onClick={(e) => e.stopPropagation()}
      >
        <Icon name={penTool.value} />
      </button>
      {open && (
        <div ref={popRef} class="mg-puck-pop" role="dialog" aria-label="Pen palette" style={popStyle}>
          <PenStrip withSelect layout="stack" />
        </div>
      )}
    </>
  )
}
