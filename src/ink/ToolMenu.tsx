// Floating tool pill: a tap flips Pen and Eraser, a long-press expands the tools and palettes, a drag docks it to a host edge.
import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Icon } from '../app/icons.tsx'
import { saveSettings, settings, type DockEdge } from '../app/settings.ts'
import { PRESET_COLORS, normalizeHex, wheelColorAt } from './color.ts'
import {
  MAX_COLOR_SLOTS,
  WIDTH_RANGE_MM,
  activeColor,
  addColorSlot,
  eraserSettings,
  highlighterSettings,
  inkDisplayColor,
  moveColorSlot,
  moveWidthSlot,
  palettes,
  penSettings,
  previousTool,
  selectColor,
  selectWidth,
  setColor,
  setTool,
  setWidthMm,
  tool,
  type EraserSettings,
  type PaletteTool,
  type PenStyle,
  type Tool,
} from './tools.ts'
import './toolmenu.css'

export const TOOL_MENU_LONG_PRESS_MS = 350
const SIZE = 44
const MARGIN = 8
const DRAG_PX = 8
const WHEEL_PX = 160
const WHEEL_STEP_DEG = 3
const DOT_MIN_PX = 4
const DOT_MAX_PX = 24

type SlotTool = 'pen' | 'highlighter'
type SlotKind = 'color' | 'width'
type Timer = ReturnType<typeof setTimeout> | null
interface Size {
  w: number
  h: number
}
interface Box {
  left: number
  top: number
}
interface Editor {
  tool: SlotTool
  kind: SlotKind
  index: number
}
interface PillGesture {
  pointerId: number
  startX: number
  startY: number
  cx: number
  cy: number
  size: Size
  dragging: boolean
  long: boolean
  wasOpen: boolean
}
interface SlotGesture {
  pointerId: number
  index: number
  startX: number
  startY: number
  long: boolean
  to: number
}

const TOOL_LABELS: Record<Tool, string> = {
  lasso: 'Lasso',
  pen: 'Pen',
  highlighter: 'Highlighter',
  eraser: 'Eraser',
  text: 'Text',
  image: 'Image',
}
const PEN_STYLES: readonly { value: PenStyle; label: string }[] = [
  { value: 'ball', label: 'Ball' },
  { value: 'fountain', label: 'Fountain' },
  { value: 'brush', label: 'Brush' },
]
const ERASER_STYLES: readonly { value: EraserSettings['style']; label: string }[] = [
  { value: 'stroke', label: 'Stroke' },
  { value: 'segment', label: 'Segment' },
]
const ERASER_SIZES: readonly EraserSettings['sizeMm'][] = [2, 4, 8]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const stop = (e: Event) => e.stopPropagation()
const vertical = (edge: DockEdge) => edge === 'left' || edge === 'right'

// Tool a tap on the collapsed pill switches to.
function flipped(current: Tool, previous: Tool): Tool {
  if (current === 'pen' || current === 'highlighter') return 'eraser'
  if (current === 'eraser') return previous === 'pen' || previous === 'highlighter' ? previous : 'pen'
  return 'pen'
}

// Display colour of the active tool's ink; tools without a palette show the pen's.
function ringColor(t: Tool): string {
  const p: PaletteTool = t === 'highlighter' || t === 'text' ? t : 'pen'
  return inkDisplayColor(activeColor(p))
}

// Top-left of the pill docked at a fraction along an edge, kept inside the host.
function dockedBox(edge: DockEdge, at: number, size: Size): Box {
  const along = vertical(edge) ? size.h : size.w
  const pos = clamp(at * along - SIZE / 2, MARGIN, Math.max(MARGIN, along - SIZE - MARGIN))
  if (edge === 'left') return { left: MARGIN, top: pos }
  if (edge === 'right') return { left: size.w - SIZE - MARGIN, top: pos }
  if (edge === 'top') return { left: pos, top: MARGIN }
  return { left: pos, top: size.h - SIZE - MARGIN }
}

// Edge nearest a pill centre and the centre's fraction along it.
function dockAt(cx: number, cy: number, size: Size): { edge: DockEdge; at: number } {
  const d: Record<DockEdge, number> = {
    left: Math.abs(cx),
    right: Math.abs(size.w - cx),
    top: Math.abs(cy),
    bottom: Math.abs(size.h - cy),
  }
  const edge = (Object.keys(d) as DockEdge[]).reduce((a, b) => (d[b] < d[a] ? b : a))
  const at = vertical(edge) ? cy / (size.h || 1) : cx / (size.w || 1)
  return { edge, at: clamp(at, 0, 1) }
}

// Inline position for the docked pill, measured from its own edge.
function dockedStyle(edge: DockEdge, box: Box): Record<string, string> {
  if (edge === 'left') return { left: `${MARGIN}px`, top: `${box.top}px` }
  if (edge === 'right') return { right: `${MARGIN}px`, top: `${box.top}px` }
  if (edge === 'top') return { top: `${MARGIN}px`, left: `${box.left}px` }
  return { bottom: `${MARGIN}px`, left: `${box.left}px` }
}

// Anchors the panel and editors to the pill's side facing the larger part of the host, capped to fit.
function popAnchor(edge: DockEdge, box: Box, size: Size): Record<string, string> {
  if (vertical(edge)) {
    return box.top + SIZE / 2 > size.h / 2
      ? { bottom: '0px', maxHeight: `${box.top + SIZE - MARGIN}px` }
      : { top: '0px', maxHeight: `${size.h - box.top - MARGIN}px` }
  }
  return box.left + SIZE / 2 > size.w / 2
    ? { right: '0px', maxWidth: `${box.left + SIZE - MARGIN}px` }
    : { left: '0px', maxWidth: `${size.w - box.left - MARGIN}px` }
}

export function ToolMenu({ tools }: { tools: readonly Tool[] }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLButtonElement>(null)
  const gesture = useRef<PillGesture | null>(null)
  const timer = useRef<Timer>(null)
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)

  const measure = (): Size => {
    const r = rootRef.current?.parentElement?.getBoundingClientRect()
    const next = { w: r?.width ?? 0, h: r?.height ?? 0 }
    setSize(next)
    return next
  }
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const collapse = () => {
    setOpen(false)
    setEditor(null)
  }

  useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    const host = rootRef.current?.parentElement
    const observer = host && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null
    if (host) observer?.observe(host)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [])

  useEffect(() => clearTimer, [])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) collapse()
    }
    document.addEventListener('pointerdown', onDocDown, true)
    return () => document.removeEventListener('pointerdown', onDocDown, true)
  }, [open])

  const { edge, at } = settings.value.toolDock
  const box = drag
    ? {
        left: clamp(drag.x - SIZE / 2, MARGIN, Math.max(MARGIN, size.w - SIZE - MARGIN)),
        top: clamp(drag.y - SIZE / 2, MARGIN, Math.max(MARGIN, size.h - SIZE - MARGIN)),
      }
    : dockedBox(edge, at, size)
  const rootStyle = drag ? { left: `${box.left}px`, top: `${box.top}px` } : dockedStyle(edge, box)
  const anchor = popAnchor(edge, box, size)

  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || e.button !== 0) return
    clearTimer()
    setDrag(null)
    try {
      mainRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // The pointer can no longer be captured.
    }
    const s = measure()
    const start = dockedBox(edge, at, s)
    gesture.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      cx: start.left + SIZE / 2,
      cy: start.top + SIZE / 2,
      size: s,
      dragging: false,
      long: false,
      wasOpen: open,
    }
    timer.current = setTimeout(() => {
      timer.current = null
      if (gesture.current) gesture.current.long = true
      setOpen(true)
    }, TOOL_MENU_LONG_PRESS_MS)
  }

  const onMove = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (!g.dragging && Math.hypot(dx, dy) > DRAG_PX) {
      g.dragging = true
      clearTimer()
    }
    if (g.dragging) setDrag({ x: g.cx + dx, y: g.cy + dy })
  }

  const onUp = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    gesture.current = null
    clearTimer()
    if (g.dragging) {
      setDrag(null)
      const next = dockAt(g.cx + e.clientX - g.startX, g.cy + e.clientY - g.startY, g.size)
      saveSettings({ toolDock: next }).catch(console.error)
    } else if (g.wasOpen && !g.long) {
      collapse()
    } else if (!g.long) {
      setTool(flipped(tool.peek(), previousTool.peek()))
    }
  }

  const onCancel = (e: PointerEvent) => {
    if (gesture.current && e.pointerId !== gesture.current.pointerId) return
    gesture.current = null
    clearTimer()
    setDrag(null)
  }

  const active = tool.value
  const slotTool: SlotTool | null = active === 'pen' || active === 'highlighter' ? active : null
  const editing = (kind: SlotKind) =>
    editor && editor.tool === slotTool && editor.kind === kind ? editor.index : null
  const onEdit = (kind: SlotKind) => (index: number | null) =>
    setEditor(index === null || !slotTool ? null : { tool: slotTool, kind, index })

  return (
    <div
      ref={rootRef}
      class="mg-toolmenu"
      data-edge={edge}
      style={rootStyle}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onClick={stop}
      onTouchStart={stop}
      onTouchMove={stop}
      onTouchEnd={stop}
      onTouchCancel={stop}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <button
        ref={mainRef}
        type="button"
        class="mg-toolmenu-main"
        aria-label="Tool menu"
        aria-expanded={open}
        data-tool={active}
        style={{ '--tool-color': ringColor(active) }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      >
        <Icon name={active} />
      </button>
      {open && (
        <div class="mg-toolmenu-panel" role="dialog" aria-label="Tools" style={anchor}>
          <div class="mg-toolmenu-scroll">
            <div class="mg-toolmenu-group" role="group" aria-label="Tool">
              {tools.map((t) => (
                <button
                  key={t}
                  type="button"
                  class="mg-toolmenu-tool"
                  aria-label={TOOL_LABELS[t]}
                  title={TOOL_LABELS[t]}
                  aria-pressed={active === t}
                  onClick={() => {
                    setEditor(null)
                    setTool(t)
                  }}
                >
                  <Icon name={t} />
                </button>
              ))}
            </div>
            {active === 'pen' && (
              <Radios
                label="Pen type"
                options={PEN_STYLES}
                value={penSettings.value.style}
                onPick={(style) => (penSettings.value = { ...penSettings.value, style })}
              />
            )}
            {slotTool && (
              <>
                <ColorSlots t={slotTool} editing={editing('color')} onEdit={onEdit('color')} />
                <WidthSlots t={slotTool} editing={editing('width')} onEdit={onEdit('width')} />
              </>
            )}
            {active === 'highlighter' && (
              <Toggle
                role="switch"
                label="Draw straight line"
                checked={highlighterSettings.value.straight}
                onToggle={(straight) => (highlighterSettings.value = { ...highlighterSettings.value, straight })}
              />
            )}
            {active === 'eraser' && <EraserOptions />}
          </div>
          {slotTool && editor?.tool === slotTool && editor.kind === 'color' && (
            <ColorEditor t={slotTool} index={editor.index} style={anchor} />
          )}
          {slotTool && editor?.tool === slotTool && editor.kind === 'width' && (
            <WidthEditor t={slotTool} index={editor.index} style={anchor} />
          )}
        </div>
      )}
    </div>
  )
}

function Radios<T extends string>(props: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onPick: (value: T) => void
}) {
  return (
    <div class="mg-toolmenu-group" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          class="mg-toolmenu-text"
          aria-checked={props.value === o.value}
          onClick={() => props.onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Toggle(props: { role: 'switch' | 'checkbox'; label: string; checked: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role={props.role}
      class="mg-toolmenu-text"
      aria-checked={props.checked}
      onClick={() => props.onToggle(!props.checked)}
    >
      {props.label}
    </button>
  )
}

function EraserOptions() {
  const s = eraserSettings.value
  const patch = (p: Partial<EraserSettings>) => (eraserSettings.value = { ...eraserSettings.value, ...p })
  return (
    <>
      <Radios label="Eraser type" options={ERASER_STYLES} value={s.style} onPick={(style) => patch({ style })} />
      <div class="mg-toolmenu-group" role="group" aria-label="Eraser size">
        {ERASER_SIZES.map((mm) => (
          <button
            key={mm}
            type="button"
            class="mg-toolmenu-size"
            aria-pressed={s.sizeMm === mm}
            onClick={() => patch({ sizeMm: mm })}
          >
            {mm} mm
          </button>
        ))}
      </div>
      <div class="mg-toolmenu-group" role="group" aria-label="Erases">
        <Toggle role="checkbox" label="Pen" checked={s.erasePen} onToggle={(erasePen) => patch({ erasePen })} />
        <Toggle
          role="checkbox"
          label="Highlighter"
          checked={s.eraseHighlighter}
          onToggle={(eraseHighlighter) => patch({ eraseHighlighter })}
        />
      </div>
      <Toggle role="switch" label="Auto-deselect" checked={s.autoDeselect} onToggle={(autoDeselect) => patch({ autoDeselect })} />
    </>
  )
}

interface SlotProps {
  t: SlotTool
  editing: number | null
  onEdit: (index: number | null) => void
}

function ColorSlots({ t, editing, onEdit }: SlotProps) {
  const p = palettes.value[t]
  const add = () => {
    const index = p.colors.length
    if (addColorSlot(t, activeColor(t))) onEdit(index)
  }
  return (
    <SlotRow
      kind="color"
      label="Colours"
      count={p.colors.length}
      selected={p.colorIndex}
      editing={editing}
      onSelect={(i) => selectColor(t, i)}
      onEdit={onEdit}
      onMove={(from, to) => moveColorSlot(t, from, to)}
      renderSlot={(i) => ({ 'aria-label': `Colour ${i + 1}`, style: { '--swatch': inkDisplayColor(p.colors[i]) } })}
    >
      {p.colors.length < MAX_COLOR_SLOTS && (
        <button type="button" class="mg-toolmenu-add" aria-label="Add colour" title="Add colour" onClick={add}>
          <Icon name="plus" />
        </button>
      )}
    </SlotRow>
  )
}

function WidthSlots({ t, editing, onEdit }: SlotProps) {
  const p = palettes.value[t]
  const { min, max } = WIDTH_RANGE_MM[t]
  const dot = (mm: number) => DOT_MIN_PX + ((DOT_MAX_PX - DOT_MIN_PX) * (mm - min)) / (max - min)
  return (
    <SlotRow
      kind="width"
      label="Thicknesses"
      count={p.widthsMm.length}
      selected={p.widthIndex}
      editing={editing}
      onSelect={(i) => selectWidth(t, i)}
      onEdit={onEdit}
      onMove={(from, to) => moveWidthSlot(t, from, to)}
      renderSlot={(i) => ({
        'aria-label': `Thickness ${i + 1}`,
        style: { '--dot': `${Math.round(dot(p.widthsMm[i]))}px` },
      })}
    />
  )
}

// A row of slots: a tap selects or opens the editor, a long-press then drag reorders on release.
function SlotRow(props: {
  kind: SlotKind
  label: string
  count: number
  selected: number
  editing: number | null
  onSelect: (index: number) => void
  onEdit: (index: number | null) => void
  onMove: (from: number, to: number) => void
  renderSlot: (index: number) => { 'aria-label': string; style: Record<string, string> }
  children?: JSX.Element | false
}) {
  const groupRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<SlotGesture | null>(null)
  const timer = useRef<Timer>(null)
  const swallowClick = useRef(false)
  const [lift, setLift] = useState<{ from: number; to: number } | null>(null)

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clearTimer, [])

  const slotAt = (x: number, y: number, fallback: number): number => {
    const slots = groupRef.current?.querySelectorAll<HTMLElement>(`.mg-slot-${props.kind}`) ?? []
    let best = fallback
    let bestD = Infinity
    slots.forEach((el, i) => {
      const r = el.getBoundingClientRect()
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2))
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  const onDown = (e: PointerEvent, index: number) => {
    if (!e.isPrimary || e.button !== 0) return
    clearTimer()
    setLift(null)
    swallowClick.current = false
    const el = e.currentTarget as HTMLElement
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // The pointer can no longer be captured.
    }
    const g: SlotGesture = { pointerId: e.pointerId, index, startX: e.clientX, startY: e.clientY, long: false, to: index }
    gesture.current = g
    timer.current = setTimeout(() => {
      timer.current = null
      g.long = true
      setLift({ from: index, to: index })
    }, TOOL_MENU_LONG_PRESS_MS)
  }

  const onMove = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    if (!g.long) {
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > DRAG_PX) clearTimer()
      return
    }
    g.to = slotAt(e.clientX, e.clientY, g.to)
    setLift({ from: g.index, to: g.to })
  }

  const onUp = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    gesture.current = null
    clearTimer()
    if (!g.long) return
    swallowClick.current = true
    setLift(null)
    if (g.to !== g.index) {
      props.onEdit(null)
      props.onMove(g.index, g.to)
    }
  }

  const onCancel = (e: PointerEvent) => {
    if (gesture.current && e.pointerId !== gesture.current.pointerId) return
    gesture.current = null
    clearTimer()
    setLift(null)
  }

  const onClick = (index: number) => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    if (index !== props.selected) {
      props.onEdit(null)
      props.onSelect(index)
    } else {
      props.onEdit(props.editing === index ? null : index)
    }
  }

  return (
    <div ref={groupRef} class="mg-toolmenu-group" role="group" aria-label={props.label}>
      {Array.from({ length: props.count }, (_, i) => {
        const { 'aria-label': label, style } = props.renderSlot(i)
        return (
          <button
            key={i}
            type="button"
            class={`mg-slot mg-slot-${props.kind}`}
            aria-label={label}
            title={label}
            aria-pressed={props.selected === i}
            data-lifted={lift?.from === i ? '' : undefined}
            data-drop={lift && lift.to === i && lift.from !== i ? '' : undefined}
            style={style}
            onPointerDown={(e) => onDown(e, i)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onCancel}
            onClick={() => onClick(i)}
          >
            {props.kind === 'width' && <span class="mg-slot-dot" />}
          </button>
        )
      })}
      {props.children}
    </div>
  )
}

// Paints the hue/lightness wheel as filled wedges, outer rings first.
function drawWheel(canvas: HTMLCanvasElement | null) {
  const ctx = canvas?.getContext('2d')
  if (!ctx) return
  const r = WHEEL_PX / 2
  for (let ring = r; ring > 0; ring--) {
    for (let a = 0; a < 360; a += WHEEL_STEP_DEG) {
      const rad = (a * Math.PI) / 180
      ctx.beginPath()
      ctx.moveTo(r, r)
      ctx.arc(r, r, ring, rad, ((a + WHEEL_STEP_DEG + 0.5) * Math.PI) / 180)
      ctx.closePath()
      ctx.fillStyle = wheelColorAt(ring * Math.cos(rad), ring * Math.sin(rad), r)
      ctx.fill()
    }
  }
}

function ColorEditor({ t, index, style }: { t: SlotTool; index: number; style: Record<string, string> }) {
  const color = palettes.value[t].colors[index]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const picking = useRef<number | null>(null)
  const [draft, setDraft] = useState(color)

  useEffect(() => drawWheel(canvasRef.current), [])
  useEffect(() => setDraft(color), [color])

  const pick = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const radius = r.width / 2
    if (radius <= 0) return
    setColor(t, index, wheelColorAt(e.clientX - r.left - radius, e.clientY - r.top - r.height / 2, radius))
  }
  const commit = (input: HTMLInputElement) => {
    const hex = normalizeHex(input.value)
    if (hex) setColor(t, index, hex)
    else input.value = color
  }

  return (
    <div class="mg-toolmenu-editor" role="dialog" aria-label="Edit colour" style={style}>
      <div class="mg-presets">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            class="mg-preset"
            aria-label={c}
            title={c}
            aria-pressed={c === color}
            style={{ '--swatch': c }}
            onClick={() => setColor(t, index, c)}
          />
        ))}
      </div>
      <canvas
        ref={canvasRef}
        class="mg-wheel"
        width={WHEEL_PX}
        height={WHEEL_PX}
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return
          picking.current = e.pointerId
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // The pointer can no longer be captured.
          }
          pick(e)
        }}
        onPointerMove={(e) => {
          if (picking.current === e.pointerId) pick(e)
        }}
        onPointerUp={() => (picking.current = null)}
        onPointerCancel={() => (picking.current = null)}
      />
      <input
        class="mg-toolmenu-hex"
        aria-label="HEX"
        value={draft}
        spellcheck={false}
        autocomplete="off"
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget)
        }}
        onBlur={(e) => commit(e.currentTarget)}
      />
    </div>
  )
}

function WidthEditor({ t, index, style }: { t: SlotTool; index: number; style: Record<string, string> }) {
  const mm = palettes.value[t].widthsMm[index]
  const { min, max, step } = WIDTH_RANGE_MM[t]
  return (
    <div class="mg-toolmenu-editor" role="dialog" aria-label="Edit thickness" style={style}>
      <label class="mg-toolmenu-range">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={mm}
          onInput={(e) => setWidthMm(t, index, Number(e.currentTarget.value))}
        />
        <span>{mm} mm</span>
      </label>
    </div>
  )
}
