// Pen tools, widths and colours for the toolbar (one row) or the tool puck popover (three rows).
import { Icon, type IconName } from '../app/icons.tsx'
import { PEN_COLORS, PEN_WIDTHS, inkDisplayColor, penColor, penTool, penWidth, type PenTool } from './tools.ts'
import './ink.css'

const TOOLS: { tool: PenTool; icon: IconName; label: string }[] = [
  { tool: 'pen', icon: 'pen', label: 'Pen' },
  { tool: 'eraser', icon: 'eraser', label: 'Eraser' },
  { tool: 'select', icon: 'select', label: 'Select' },
]

const DOT_PX_PER_WIDTH = 2400

// Applies a width or colour pick and leaves the eraser or select for the pen.
function pick(apply: () => void) {
  apply()
  if (penTool.value !== 'pen') penTool.value = 'pen'
}

export function PenStrip({ withSelect, layout = 'row' }: { withSelect: boolean; layout?: 'row' | 'stack' }) {
  return (
    <span class={`mg-penstrip mg-penstrip-${layout}`} role="group" aria-label="Pen tools">
      <span class="mg-penstrip-row">
        {TOOLS.filter((t) => withSelect || t.tool !== 'select').map((t) => (
          <button
            key={t.tool}
            type="button"
            class="btn mg-tool"
            aria-label={t.label}
            title={t.label}
            aria-pressed={penTool.value === t.tool}
            onClick={() => (penTool.value = t.tool)}
          >
            <Icon name={t.icon} />
          </button>
        ))}
      </span>
      <span class="mg-penstrip-row">
        {PEN_WIDTHS.map((w) => (
          <button
            key={w.name}
            type="button"
            class="btn mg-tool"
            aria-label={w.name}
            title={w.name}
            aria-pressed={penWidth.value === w.value}
            onClick={() => pick(() => (penWidth.value = w.value))}
          >
            <span class="mg-penstrip-dot" style={{ '--dot': `${Math.round(w.value * DOT_PX_PER_WIDTH)}px` }} />
          </button>
        ))}
      </span>
      <span class="mg-penstrip-row">
        {PEN_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            class="btn mg-tool mg-swatch"
            aria-label={c.name}
            title={c.name}
            aria-pressed={penColor.value === c.value}
            style={{ '--swatch': inkDisplayColor(c.value) }}
            onClick={() => pick(() => (penColor.value = c.value))}
          />
        ))}
      </span>
    </span>
  )
}
