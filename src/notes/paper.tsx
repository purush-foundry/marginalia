import { useId } from 'preact/hooks'
import { TEMPLATE_SPACING_MM, type PageTemplate, type PaperColor } from './model.ts'

const RULE_LIGHT = '#c9d3de'
const RULE_DARK = 'rgba(255, 255, 255, 0.15)'
const DOT_RADIUS = 0.06

/** Page template drawn as an SVG pattern in CSS px, so it stays crisp at any zoom. */
export function PaperBackground({ template, color, cssW, widthMm }: { template: PageTemplate; color: PaperColor; cssW: number; widthMm: number }) {
  const id = useId()
  const rule = color === 'dark' ? RULE_DARK : RULE_LIGHT
  if (template === 'blank') return <svg class="mg-nb-paper" aria-hidden="true" />
  const step = (TEMPLATE_SPACING_MM[template] * cssW) / widthMm
  const ruled = template.startsWith('ruled')
  return (
    <svg class="mg-nb-paper" aria-hidden="true">
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width={ruled ? cssW : step} height={step}>
          {template === 'dots' ? (
            <circle cx={step / 2} cy={step / 2} r={Math.max(1, step * DOT_RADIUS)} fill={rule} />
          ) : (
            <path
              d={ruled ? `M0 ${step - 0.5}H${cssW}` : `M${step - 0.5} 0V${step}M0 ${step - 0.5}H${step}`}
              stroke={rule}
              stroke-width={1}
              fill="none"
            />
          )}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}
