import { thinIndices } from './scales'

/**
 * Gridlines, axis rules and tick labels — shared by the line and the bar chart so the two cannot
 * drift into two different visual languages.
 *
 * **Contrast.** `DESIGN.md` names chart gridlines and axis rules as one of exactly two exceptions
 * to the 7:1 rule: they are non-text and are held to 3:1, which `border-strong` clears. The tick
 * **labels** are text and are `ink-2`, which clears 7:1 in both themes like every other text token.
 *
 * **The zero rule is drawn separately** and heavier than the gridlines. On a chart that crosses
 * zero it is the single most important line on the plot, and rendering it in the gridline weight
 * makes an expense month look like a small income month.
 */

export interface PlotBox {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export interface YAxisProps {
  readonly plot: PlotBox
  readonly ticks: ReadonlyArray<number>
  readonly project: (value: number) => number
  /** Formats a tick. Always `chartAxisAmount`, so the axis agrees with the table. */
  readonly format: (value: number) => string
  /** Whether the domain crosses zero and therefore needs the emphasised baseline. */
  readonly showZeroRule?: boolean
}

export function YAxis({
  plot,
  ticks,
  project,
  format,
  showZeroRule = false,
}: YAxisProps) {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => {
        const y = project(tick)
        return (
          <g key={tick}>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={y}
              y2={y}
              className="stroke-border-subtle"
              strokeWidth={1}
            />
            <text
              x={plot.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-ink-2 text-[11px] tabular-nums"
            >
              {format(tick)}
            </text>
          </g>
        )
      })}
      {showZeroRule ? (
        <line
          x1={plot.left}
          x2={plot.right}
          y1={project(0)}
          y2={project(0)}
          className="stroke-border-strong"
          strokeWidth={1.5}
        />
      ) : null}
    </g>
  )
}

export interface XAxisProps {
  readonly plot: PlotBox
  readonly labels: ReadonlyArray<string>
  readonly centre: (index: number) => number
  /** How many labels fit. The first and the last always survive the thinning. */
  readonly maxLabels?: number
}

export function XAxis({ plot, labels, centre, maxLabels = 7 }: XAxisProps) {
  const kept = thinIndices(labels.length, maxLabels)
  return (
    <g aria-hidden="true">
      <line
        x1={plot.left}
        x2={plot.right}
        y1={plot.bottom}
        y2={plot.bottom}
        className="stroke-border-strong"
        strokeWidth={1}
      />
      {kept.map((index) => (
        <text
          key={labels[index] ?? index}
          x={centre(index)}
          y={plot.bottom + 16}
          textAnchor="middle"
          className="fill-ink-2 text-[11px]"
        >
          {labels[index]}
        </text>
      ))}
    </g>
  )
}
