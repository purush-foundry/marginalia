// Reader toolbar: back, title, area select, pen strip or Draw latch, undo/redo, night, sidebar, threads, export.
import type { Signal } from '@preact/signals'
import type { AnnotationStore } from '../annot/store'
import { mouseDraws, penTool } from '../ink/tools'
import { PenStrip } from '../ink/PenStrip'
import { Icon, type IconName } from './icons'

export interface ToolbarProps {
  title: string
  store: AnnotationStore
  areaArmed: Signal<boolean>
  penCapable: boolean
  finePointer: boolean
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

export function Toolbar(props: ToolbarProps) {
  const { store } = props
  const latched = mouseDraws.value
  const toggleLatch = () => {
    const next = !mouseDraws.value
    mouseDraws.value = next
    if (next && penTool.value === 'select') penTool.value = 'pen'
  }
  return (
    <header class="mg-toolbar">
      <div class="mg-toolbar-lead">
        <ToolButton icon="back" label="Library" onClick={props.onBack} />
        <span class="mg-title" title={props.title}>
          {props.title}
        </span>
      </div>
      <div class="mg-toolbar-tools">
        <ToolButton
          icon="area"
          label="Area select"
          pressed={props.areaArmed.value}
          onClick={() => (props.areaArmed.value = !props.areaArmed.value)}
        />
        {props.penCapable && <PenStrip withSelect />}
        {!props.penCapable && props.finePointer && (
          <>
            <ToolButton icon="draw" label="Draw" pressed={latched} onClick={toggleLatch} />
            {latched && <PenStrip withSelect={false} />}
          </>
        )}
        <ToolButton icon="undo" label="Undo" disabled={!store.canUndo.value} onClick={store.undo} />
        <ToolButton icon="redo" label="Redo" disabled={!store.canRedo.value} onClick={store.redo} />
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
