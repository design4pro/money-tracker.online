import { area, line } from 'd3-shape'
import { useState } from 'react'

import { focusRing } from '#/components/ui'
import { cn } from '#/lib/cn'
import { asMinor } from '#/lib/money'

import { XAxis, YAxis } from './axis'
import { ChartFrame } from './chart-frame'
import { ChartDataTable, rowsFromSeries } from './data-table'
import {
  SeriesMarker,
  seriesColour,
  seriesDash,
  useChartPatterns,
} from './encoding'
import { chartAmount, chartAxisAmount, pointName } from './format'
import { ChartLegend } from './legend'
import { readingsOf } from './readings'
import { linearProjector, niceDomain, ticksFor } from './scales'
import { useRovingFocus } from './use-roving-focus'

import type { PlotBox } from './axis'
import type { ChartCopy, ChartSeries } from './types'
import type { Locale } from '#/lib/i18n'
import type { CurrencyCode } from '#/lib/money'

/**
 * The line and area chart.
 *
 * Everything that makes a chart in this product a chart rather than a picture is here:
 *
 * - **A gap is a gap.** `d3-shape`'s `.defined()` breaks the path at a `null` reading instead of
 *   drawing a straight line across it. Interpolating invents a number nobody recorded, and the
 *   invented one is exactly the shape a reader would trust. A note under the legend says so.
 * - **Every point is keyboard-reachable.** One `Tab` stop per series; arrows walk the readings;
 *   `Home`/`End` jump to the ends. Each point's accessible name is
 *   _"<series>, <label>, <full amount>"_ with the amount unabbreviated, because "1.2k" is not a
 *   figure anyone can reconcile against a statement.
 * - **Colour is the third channel, not the first.** Each series carries a marker shape and a dash
 *   pattern besides its hue, so two lines crossing in greyscale still resolve.
 * - **The curve is linear.** A smoothed curve passes through values between the readings that the
 *   data does not contain; on a balance chart that is a lie about a day.
 *
 * The component takes `locale` as a prop rather than reading a context, like everything else under
 * `src/components/charts` — see `./types.ts`.
 */

const AXIS_GUTTER = 62
const RIGHT_GUTTER = 14
const TOP_GUTTER = 14
const LABEL_GUTTER = 26

export interface LineChartProps {
  readonly locale: Locale
  /** What every figure in this chart is denominated in. */
  readonly currencyCode: CurrencyCode
  /**
   * One entry per line. Every series must carry the **same** points in the same order — the first
   * series is the category spine for the axis and the text equivalent.
   */
  readonly series: ReadonlyArray<ChartSeries>
  readonly copy: ChartCopy
  readonly variant?: 'line' | 'area'
  /** `'zero'` (the default) keeps the axis honest; `'data'` fits a series that never nears zero. */
  readonly baseline?: 'zero' | 'data'
  readonly height?: number
  /** Off inside a small widget, where the series name is the widget's own heading. */
  readonly showLegend?: boolean
  /** Shown when the data has a gap. Explains that a break is a missing reading, not a zero. */
  readonly gapNote?: string
  readonly className?: string
}

export function LineChart({
  locale,
  currencyCode,
  series,
  copy,
  variant = 'line',
  baseline = 'zero',
  height = 240,
  showLegend = true,
  gapNote,
  className,
}: LineChartProps) {
  const [readout, setReadout] = useState<string | null>(null)
  const patterns = useChartPatterns(series.length)

  const spine = series.at(0)?.points ?? []
  const values = series.flatMap((entry) =>
    entry.points.map((point) => point.amountMinor),
  )
  const isEmpty = values.every((value) => value === null)
  const hasGap = !isEmpty && values.some((value) => value === null)

  const domain = niceDomain(values, { baseline })
  const ticks = ticksFor(domain, 4)
  // A tick is a pixel-space artefact of `nice()`, so it can be fractional at very small ranges.
  // It is rounded back to a whole minor unit *before* it is formatted: the axis states amounts,
  // and an amount is an integer.
  const format = (value: number): string =>
    chartAxisAmount(locale, currencyCode, asMinor(Math.round(value)))

  return (
    <ChartFrame
      copy={copy}
      height={height}
      isEmpty={isEmpty}
      className={className}
      readout={readout ?? ''}
      footnote={hasGap ? gapNote : undefined}
      legend={
        showLegend && !isEmpty ? (
          <ChartLegend
            variant="line"
            patterns={patterns}
            items={series.map((entry, index) => ({
              id: entry.id,
              label: entry.name,
              index,
            }))}
          />
        ) : undefined
      }
      dataTable={
        <ChartDataTable
          caption={copy.title}
          rowHeader={copy.categoryHeader}
          columnHeaders={series.map((entry) => entry.name)}
          rows={rowsFromSeries(
            series,
            (amountMinor) => chartAmount(locale, currencyCode, amountMinor),
            copy.noData,
          )}
        />
      }
    >
      {(width) => {
        const plot: PlotBox = {
          left: AXIS_GUTTER,
          right: Math.max(width - RIGHT_GUTTER, AXIS_GUTTER + 1),
          top: TOP_GUTTER,
          bottom: height - LABEL_GUTTER,
        }
        const project = linearProjector(domain, [plot.bottom, plot.top])
        const span = plot.right - plot.left
        const x = (index: number): number =>
          spine.length <= 1
            ? plot.left + span / 2
            : plot.left + (span * index) / (spine.length - 1)

        return (
          <>
            {patterns.defs}
            <YAxis
              plot={plot}
              ticks={ticks}
              project={project}
              format={format}
              showZeroRule={domain[0] < 0 && domain[1] > 0}
            />
            <XAxis
              plot={plot}
              labels={spine.map((point) => point.label)}
              centre={x}
              maxLabels={Math.max(2, Math.floor(span / 72))}
            />
            {isEmpty
              ? null
              : series.map((entry, index) => (
                  <LineSeries
                    key={entry.id}
                    series={entry}
                    index={index}
                    variant={variant}
                    locale={locale}
                    currencyCode={currencyCode}
                    x={x}
                    project={project}
                    zeroY={project(Math.min(Math.max(0, domain[0]), domain[1]))}
                    fill={patterns.fillFor(index)}
                    onReadout={setReadout}
                  />
                ))}
          </>
        )
      }}
    </ChartFrame>
  )
}

interface LineSeriesProps {
  readonly series: ChartSeries
  readonly index: number
  readonly variant: 'line' | 'area'
  readonly locale: Locale
  readonly currencyCode: CurrencyCode
  readonly x: (index: number) => number
  readonly project: (value: number) => number
  readonly zeroY: number
  readonly fill: string
  readonly onReadout: (value: string | null) => void
}

/**
 * One line and its focusable points.
 *
 * A component of its own because the roving tabindex is a hook and there is one group per series;
 * a loop in the parent could not call it.
 */
function LineSeries({
  series,
  index,
  variant,
  locale,
  currencyCode,
  x,
  project,
  zeroY,
  fill,
  onReadout,
}: LineSeriesProps) {
  const points = series.points
  const visible = readingsOf(points)
  const roving = useRovingFocus(visible.length)
  const colour = seriesColour(index)

  const defined = (position: number): boolean =>
    points[position]?.amountMinor !== null

  const linePath = line<number>()
    .defined(defined)
    .x((position) => x(position))
    .y((position) => project(points[position]?.amountMinor ?? 0))

  const areaPath = area<number>()
    .defined(defined)
    .x((position) => x(position))
    .y0(zeroY)
    .y1((position) => project(points[position]?.amountMinor ?? 0))

  const positions = points.map((_, position) => position)
  const drawnLine = linePath(positions)
  const drawnArea = areaPath(positions)

  return (
    <g>
      {variant === 'area' && drawnArea !== null ? (
        <path d={drawnArea} fill={fill} opacity={0.35} stroke="none" />
      ) : null}
      {drawnLine === null ? null : (
        <path
          d={drawnLine}
          fill="none"
          stroke={colour}
          strokeWidth={2}
          strokeDasharray={seriesDash(index)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      <g role="group" aria-label={series.name} onKeyDown={roving.onKeyDown}>
        {visible.map((entry, order) => {
          const { amountMinor } = entry
          const cx = x(entry.position)
          const cy = project(amountMinor)
          const name = pointName(
            series.name,
            entry.label,
            chartAmount(locale, currencyCode, amountMinor),
          )

          return (
            <g
              key={entry.key}
              ref={roving.register(order)}
              role="img"
              aria-label={name}
              tabIndex={roving.tabIndexFor(order)}
              className={cn('cursor-default', focusRing)}
              onFocus={() => {
                roving.onFocusIndex(order)
                onReadout(name)
              }}
              onBlur={() => onReadout(null)}
              onPointerEnter={() => onReadout(name)}
              onPointerLeave={() => onReadout(null)}
            >
              {/* The hit area. Transparent rather than `fill="none"`, which takes no pointer. */}
              <circle cx={cx} cy={cy} r={14} fill="transparent" />
              <SeriesMarker index={index} cx={cx} cy={cy} radius={4} />
            </g>
          )
        })}
      </g>
    </g>
  )
}
