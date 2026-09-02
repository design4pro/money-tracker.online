import { SeriesMarker, seriesColour, seriesDash } from './encoding'

import type { ChartPatterns } from './encoding'

/**
 * The legend, carrying all three channels at once: the hue, the fill pattern and the marker shape,
 * beside the series' name in words.
 *
 * The swatch is `aria-hidden` and the name is real text, so a screen-reader user gets the name and
 * nothing about the drawing; a greyscale reader gets the pattern and the shape; a colour reader
 * gets all three. That redundancy is the point — see `encoding.tsx` for the measurement behind it.
 *
 * The swatch's `url(#…)` fill resolves against the chart's own `<defs>`, which are document-scoped
 * in SVG. That is why the legend takes the chart's {@link ChartPatterns} rather than defining a
 * second set of its own.
 */

export interface ChartLegendItem {
  readonly id: string
  /** The series' name, in the reader's language. */
  readonly label: string
  /** Position in the chart's series array — what picks the hue, pattern and shape. */
  readonly index: number
  /** An optional figure beside the name — a total, a share. Already formatted. */
  readonly detail?: string
}

export interface ChartLegendProps {
  readonly items: ReadonlyArray<ChartLegendItem>
  readonly patterns: ChartPatterns
  /** `'fill'` shows the pattern swatch; `'line'` shows the dash and the marker. */
  readonly variant?: 'fill' | 'line'
}

export function ChartLegend({
  items,
  patterns,
  variant = 'fill',
}: ChartLegendProps) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2 text-caption">
          <svg
            aria-hidden="true"
            viewBox="0 0 18 12"
            className="h-3 w-[18px] shrink-0 overflow-visible"
          >
            {variant === 'fill' ? (
              <rect
                x={0}
                y={0}
                width={18}
                height={12}
                rx={2}
                fill={patterns.fillFor(item.index)}
                stroke={seriesColour(item.index)}
                strokeWidth={1}
              />
            ) : (
              <>
                <line
                  x1={0}
                  x2={18}
                  y1={6}
                  y2={6}
                  stroke={seriesColour(item.index)}
                  strokeWidth={2}
                  strokeDasharray={seriesDash(item.index)}
                />
                <SeriesMarker index={item.index} cx={9} cy={6} radius={3.5} />
              </>
            )}
          </svg>
          <span className="text-ink">{item.label}</span>
          {item.detail === undefined ? null : (
            <span className="text-ink-2 tabular-nums">{item.detail}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
