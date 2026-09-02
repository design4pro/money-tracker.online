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
  /**
   * The unit the ticks are counted in — `zł`, `$` — drawn once, above the top tick.
   *
   * The ticks themselves stay bare. Repeating the mark down five gridlines is noise, and
   * suffixing only the top one (the other obvious answer) widens the gutter by the width of the
   * mark for every chart in the product, taking those pixels out of the plot. An axis title costs
   * nothing horizontally and is where a reader of a scientific chart already looks for the unit.
   *
   * It matters on this product specifically: a workspace can hold accounts in several currencies,
   * so "12 000" on a plot beside a list showing two currency marks is a number without a unit.
   */
  readonly unit?: string
}

export function YAxis({
  plot,
  ticks,
  project,
  format,
  showZeroRule = false,
  unit,
}: YAxisProps) {
  return (
    <g aria-hidden="true">
      {unit === undefined || unit === '' ? null : (
        <text
          x={plot.left - 8}
          y={plot.top - 8}
          textAnchor="end"
          className="fill-ink-2 text-[11px]"
        >
          {unit}
        </text>
      )}
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
  /**
   * Which categories the chart is about, when the rest are only context — one flag per label.
   *
   * The marked label is **promoted**: primary ink at a heavier weight, against the secondary ink
   * the others already carry. The context labels are not touched, because they are text and text
   * in this product clears 7:1 whatever job it is doing on the plot.
   */
  readonly emphasis?: ReadonlyArray<boolean>
}

export function XAxis({
  plot,
  labels,
  centre,
  maxLabels = 7,
  emphasis,
}: XAxisProps) {
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
          className={
            emphasis?.[index] === true
              ? 'fill-ink text-[11px] font-semibold'
              : 'fill-ink-2 text-[11px]'
          }
        >
          {labels[index]}
        </text>
      ))}
    </g>
  )
}
