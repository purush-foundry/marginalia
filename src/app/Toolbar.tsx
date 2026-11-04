// Reader toolbar: back, title or Snip hint, Snip, Paper · Both · Notes (a Notes toggle below 700 px), undo/redo of the active pane, night, sidebar, threads, export.
import type { ReadonlySignal, Signal } from '@preact/signals'
import { Icon, type IconName } from './icons'
import type { NotesLayout } from './settings'

/** The undo history the toolbar's Undo and Redo act on. */
export interface UndoTarget {
  canUndo: ReadonlySignal<boolean>
  canRedo: ReadonlySignal<boolean>
  undo(): void
  redo(): void
}

export interface ToolbarProps {
  title: string
  history: UndoTarget
  areaArmed: Signal<boolean>
  layout: NotesLayout
  /** At least 700 px wide: the title, and Paper · Both · Notes; narrower gets Back alone and a Notes toggle. */
  wide: boolean
  onLayout(layout: NotesLayout): void
  nightMode: boolean
  threadCount: number
  sidebarOpen: boolean
  onBack(): void
  onToggleNight(): void
  onToggleSidebar(): void
  onThreads(): void
  onExport(): void
}

function ToolButton(props: { icon: IconName; label: string; pressed?: boolean; disabled?: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      class="btn mg-tool"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  )
}

const LAYOUTS: readonly { value: NotesLayout; label: string }[] = [
  { value: 'paper', label: 'Paper' },
  { value: 'both', label: 'Both' },
  { value: 'notes', label: 'Notes' },
]

export function Toolbar(props: ToolbarProps) {
  const { history } = props
  return (
    <header class={`mg-toolbar${props.wide ? '' : ' mg-toolbar-narrow'}`}>
      <div class="mg-toolbar-lead">
        <ToolButton icon="back" label="Library" onClick={props.onBack} />
        {!props.wide ? null : props.areaArmed.value ? (
          <span class="mg-snip-hint" role="status">
            Drag a box
          </span>
        ) : (
          <span class="mg-title" title={props.title}>
            {props.title}
          </span>
        )}
      </div>
      <div class="mg-toolbar-tools">
        <ToolButton
          icon="snip"
          label="Snip"
          pressed={props.areaArmed.value}
          onClick={() => (props.areaArmed.value = !props.areaArmed.value)}
        />
        {props.wide ? (
          <div class="mg-seg" role="radiogroup" aria-label="Layout">
            {LAYOUTS.map((l) => (
              <button
                key={l.value}
                type="button"
                role="radio"
                class="btn mg-seg-item"
                aria-checked={props.layout === l.value}
                onClick={() => props.onLayout(l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
        ) : (
          <ToolButton
            icon="notes"
            label="Notes"
            pressed={props.layout === 'notes'}
            onClick={() => props.onLayout(props.layout === 'notes' ? 'paper' : 'notes')}
          />
        )}
        <ToolButton icon="undo" label="Undo" disabled={!history.canUndo.value} onClick={() => history.undo()} />
        <ToolButton icon="redo" label="Redo" disabled={!history.canRedo.value} onClick={() => history.redo()} />
        <ToolButton icon="moon" label="Night mode" pressed={props.nightMode} onClick={props.onToggleNight} />
        <ToolButton icon="sidebar" label="Sidebar" pressed={props.sidebarOpen} onClick={props.onToggleSidebar} />
        <button type="button" class="btn mg-tool" aria-label="Ask threads" title="Ask threads" onClick={props.onThreads}>
          <Icon name="chat" />
          {props.threadCount > 0 && <span class="mg-count">{props.threadCount}</span>}
        </button>
        <ToolButton icon="copy" label="Copy as Markdown" onClick={props.onExport} />
      </div>
    </header>
  )
}
