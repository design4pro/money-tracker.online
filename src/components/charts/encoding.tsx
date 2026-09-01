import { useId } from 'react'

import type { ReactNode } from 'react'

/**
 * The non-colour encodings. This file is the reason a chart in this product is readable in
 * greyscale, and it is not optional decoration.
 *
 * `src/styles/tokens.css` records the measurement: eight simultaneously-visible series at 7:1
 * against **each other** is not achievable in sRGB — the worst pair in our palette separates by
 * 1.03:1 in luminance — so colour is a **secondary** channel here, always. Every series carries,
 * in addition to its hue:
 *
 * - a **marker shape** (circle, square, triangle, …), drawn at every data point on a line;
 * - a **dash pattern**, so two lines crossing in greyscale still resolve;
 * - a **fill pattern**, so two stacked segments or two donut slices do.
 *
 * And every chart carries a direct label besides — in the legend, in the text equivalent and in
 * each point's accessible name. That is the Colour-Is-Never-Alone Rule from `DESIGN.md`.
 *
 * ## Why patterns are per-instance rather than per-document
 *
 * SVG `<pattern>` ids are document-global, so a single shared `<defs>` block is the tempting
 * design. It breaks the moment a chart is rendered on its own — in a test, in the gallery, in an
 * email preview — because the fills resolve to nothing and the chart silently loses its second
 * channel. `useChartPatterns` mints ids with React's `useId`, defines **only the slots the chart
 * actually uses**, and cannot collide with another instance on the page.
 */

/** How many distinguishable encodings exist. A ninth series reuses the first. */
export const SERIES_SLOTS = 8

/** The palette slot, marker shape and pattern a series at `index` gets. Stable and wrapping. */
export function seriesSlot(index: number): number {
  return ((index % SERIES_SLOTS) + SERIES_SLOTS) % SERIES_SLOTS
}

/** The token reference for a slot's hue. Never a hex literal at a call site. */
export function seriesColour(index: number): string {
  return `var(--color-series-${seriesSlot(index) + 1})`
}

/**
 * Stroke dash patterns, one per slot, all with the same visual weight.
 *
 * Slot 0 is solid: the first series of a one-series chart should not look like a projection.
 */
const SERIES_DASHES = [
  undefined,
  '7 3',
  '2 3',
  '11 3 2 3',
  '5 3 2 3',
  '1 3',
  '14 4',
  '9 3 2 3 2 3',
] as const

/** The `stroke-dasharray` for a series, or `undefined` for the solid slot. */
export function seriesDash(index: number): string | undefined {
  return SERIES_DASHES[seriesSlot(index)]
}

export interface SeriesMarkerProps {
  /** The series' position in the chart's series array. */
  readonly index: number
  readonly cx: number
  readonly cy: number
  /** Half the marker's width. */
  readonly radius: number
  readonly className?: string
}

/**
 * The marker shape for a series, centred on `(cx, cy)`.
 *
 * Eight shapes that stay apart at 4px: three are filled outlines, two are strokes, and none of
 * them is distinguished from another only by size.
 */
export function SeriesMarker({
  index,
  cx,
  cy,
  radius,
  className,
}: SeriesMarkerProps) {
  const colour = seriesColour(index)
  const common = { className, fill: colour } as const
  const stroked = {
    className,
    fill: 'none',
    stroke: colour,
    strokeWidth: radius * 0.7,
    strokeLinecap: 'round',
  } as const

  switch (seriesSlot(index)) {
    case 0:
      return <circle {...common} cx={cx} cy={cy} r={radius} />
    case 1:
      return (
        <rect
          {...common}
          x={cx - radius}
          y={cy - radius}
          width={radius * 2}
          height={radius * 2}
        />
      )
    case 2:
      return (
        <polygon
          {...common}
          points={`${cx},${cy - radius} ${cx + radius},${cy + radius} ${cx - radius},${cy + radius}`}
        />
      )
    case 3:
      return (
        <polygon
          {...common}
          points={`${cx},${cy - radius} ${cx + radius},${cy} ${cx},${cy + radius} ${cx - radius},${cy}`}
        />
      )
    case 4:
      return (
        <polygon
          {...common}
          points={`${cx},${cy + radius} ${cx + radius},${cy - radius} ${cx - radius},${cy - radius}`}
        />
      )
    case 5:
      return (
        <path
          {...stroked}
          d={`M ${cx - radius} ${cy} H ${cx + radius} M ${cx} ${cy - radius} V ${cy + radius}`}
        />
      )
    case 6:
      return (
        <path
          {...stroked}
          d={`M ${cx - radius} ${cy - radius} L ${cx + radius} ${cy + radius} M ${cx + radius} ${cy - radius} L ${cx - radius} ${cy + radius}`}
        />
      )
    default:
      return (
        <polygon
          {...common}
          points={[
            `${cx - radius},${cy}`,
            `${cx - radius / 2},${cy - radius}`,
            `${cx + radius / 2},${cy - radius}`,
            `${cx + radius},${cy}`,
            `${cx + radius / 2},${cy + radius}`,
            `${cx - radius / 2},${cy + radius}`,
          ].join(' ')}
        />
      )
  }
}

/** The strokes that make one pattern tile, drawn over a tinted ground of the same hue. */
function patternStrokes(slot: number, colour: string): ReactNode {
  const stroke = { stroke: colour, strokeWidth: 2, fill: 'none' } as const
  switch (slot) {
    case 0:
      return null
    case 1:
      return <path {...stroke} d="M -2 6 L 6 -2 M 2 10 L 10 2" />
    case 2:
      return <path {...stroke} d="M -2 2 L 2 6 M 2 -2 L 10 6 M 6 -2 L 10 2" />
    case 3:
      return <circle cx={4} cy={4} r={1.6} fill={colour} />
    case 4:
      return <path {...stroke} d="M 0 4 H 8" />
    case 5:
      return <path {...stroke} d="M 4 0 V 8" />
    case 6:
      return <path {...stroke} d="M 0 4 H 8 M 4 0 V 8" />
    default:
      return <path fill={colour} d="M 0 0 H 4 V 4 H 0 Z M 4 4 H 8 V 8 H 4 Z" />
  }
}

export interface ChartPatterns {
  /** Drop inside the chart's `<svg>`. Renders exactly the slots the chart uses. */
  readonly defs: ReactNode
  /** The `fill` value for a series — a `url(#…)` reference, or the flat hue for slot 0. */
  readonly fillFor: (index: number) => string
  /** The same fill for a legend swatch, which is drawn in its own tiny `<svg>`. */
  readonly patternIdFor: (index: number) => string
}

/**
 * Instance-local `<pattern>` definitions for `count` series.
 *
 * The tile is 8×8 in user space, so a pattern reads the same whether it fills a 4px bar segment
 * or a 120px donut ring.
 */
export function useChartPatterns(count: number): ChartPatterns {
  const prefix = useId()
  const slots = Array.from({ length: count }, (_, index) => seriesSlot(index))
  const unique = [...new Set(slots)]

  const idFor = (index: number): string =>
    `${prefix}pattern-${seriesSlot(index)}`

  return {
    patternIdFor: idFor,
    fillFor: (index) =>
      seriesSlot(index) === 0 ? seriesColour(index) : `url(#${idFor(index)})`,
    defs: (
      <defs>
        {unique
          .filter((slot) => slot !== 0)
          .map((slot) => {
            const colour = `var(--color-series-${slot + 1})`
            return (
              <pattern
                key={slot}
                id={`${prefix}pattern-${slot}`}
                width={8}
                height={8}
                patternUnits="userSpaceOnUse"
              >
                <rect width={8} height={8} fill={colour} opacity={0.3} />
                {patternStrokes(slot, colour)}
              </pattern>
            )
          })}
      </defs>
    ),
  }
}
