import { useEffect, useState } from 'preact/hooks'
import { PAGE_SIZES, type NotePage, type PageSize, type PageStyle, type PageTemplate, type PaperColor } from './model.ts'

type SizeName = keyof typeof PAGE_SIZES
type Orientation = 'portrait' | 'landscape'

const TEMPLATES: readonly { value: PageTemplate; label: string }[] = [
  { value: 'blank', label: 'Blank' },
  { value: 'ruled-narrow', label: 'Ruled narrow' },
  { value: 'ruled-college', label: 'Ruled college' },
  { value: 'ruled-wide', label: 'Ruled wide' },
  { value: 'grid', label: 'Grid' },
  { value: 'dots', label: 'Dots' },
]
const COLORS: readonly { value: PaperColor; label: string }[] = [
  { value: 'white', label: 'White' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'dark', label: 'Dark' },
]
const SIZES: readonly { value: SizeName; label: string }[] = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
  { value: 'standard', label: 'Standard' },
]
const ORIENTATIONS: readonly { value: Orientation; label: string }[] = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
]

// The named size whose short side is closest to the page's short side.
function sizeName(size: PageSize): SizeName {
  const short = Math.min(size.w, size.h)
  return SIZES.map((s) => s.value).reduce((best, name) =>
    Math.abs(PAGE_SIZES[name].w - short) < Math.abs(PAGE_SIZES[best].w - short) ? name : best, 'a4' as SizeName)
}

function Choices<T extends string>(props: { legend: string; name: string; options: readonly { value: T; label: string }[]; value: T; onChange(v: T): void }) {
  return (
    <fieldset class="mg-nb-sheet-group">
      <legend>{props.legend}</legend>
      {props.options.map((o) => (
        <label key={o.value} class="mg-nb-sheet-option">
          <input type="radio" name={props.name} checked={props.value === o.value} onChange={() => props.onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  )
}

/** Template, paper colour, size and orientation for a page; Done applies them to it or to every page. */
export function TemplateSheet({ page, onApply, onClose }: { page: NotePage; onApply(patch: PageStyle, applyToAll: boolean): void; onClose(): void }) {
  const [template, setTemplate] = useState(page.template)
  const [color, setColor] = useState(page.color)
  const [size, setSize] = useState(sizeName(page.size))
  const [orientation, setOrientation] = useState<Orientation>(page.size.w > page.size.h ? 'landscape' : 'portrait')
  const [applyToAll, setApplyToAll] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const done = () => {
    const { w, h } = PAGE_SIZES[size]
    onApply({ template, color, size: orientation === 'landscape' ? { w: h, h: w } : { w, h } }, applyToAll)
    onClose()
  }

  return (
    <div class="mg-nb-sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="mg-nb-sheet" role="dialog" aria-label="Template">
        <Choices legend="Template" name="mg-nb-template" options={TEMPLATES} value={template} onChange={(v) => setTemplate(v)} />
        <Choices legend="Colour" name="mg-nb-color" options={COLORS} value={color} onChange={(v) => setColor(v)} />
        <Choices legend="Size" name="mg-nb-size" options={SIZES} value={size} onChange={(v) => setSize(v)} />
        <Choices legend="Orientation" name="mg-nb-orientation" options={ORIENTATIONS} value={orientation} onChange={(v) => setOrientation(v)} />
        <label class="mg-nb-sheet-option">
          <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.currentTarget.checked)} />
          Apply to all pages
        </label>
        <button type="button" class="btn primary mg-nb-sheet-done" onClick={done}>
          Done
        </button>
      </div>
    </div>
  )
}
