import { useState } from 'react'

import { focusRing } from '#/components/ui'
import { cn } from '#/lib/cn'
import { asMinor, sumMinor } from '#/lib/money'

import { XAxis, YAxis } from './axis'
import { ChartFrame } from './chart-frame'
import { ChartDataTable, rowsFromSeries } from './data-table'
import { seriesColour, useChartPatterns } from './encoding'
import { chartAmount, chartAxisAmount, pointName } from './format'
import { ChartLegend } from './legend'
import { readingsOf } from './readings'
import { bandLayout, linearProjector, niceDomain, ticksFor } from './scales'
import { useRovingFocus } from './use-roving-focus'

import type { BandLayout } from './scales'
import type { ChartCopy, ChartSeries } from './types'
import type { Locale } from '#/lib/i18n'
import type { CurrencyCode, Minor } from '#/lib/money'

/**
 * The bar chart, stacked or grouped.
 *
 * **The stack's total is the sum of its segments, never an independently computed figure.** It is
 * added with `sumMinor` over the integers the segments were drawn from, so the total in the
 * accessible name, the total in the text equivalent's footer row and the height of the stack are
 * one number that cannot drift into three.
 *
 * **Stacked bars take non-negative values only**, and the component clamps rather than pretending
 * otherwise: a stack is a part-to-whole statement, and a negative part of a whole has no reading.
 * A series that genuinely goes both ways — a net figure — belongs in the grouped layout or in the
 * line chart.
 *
 * Each segment is individually focusable and announces its series, its category, its own amount
 * and the stack's total, so a keyboard reader gets the same comparison a sighted reader makes by
 * looking at the segment's share of the column.
 */

const AXIS_GUTTER = 62
const RIGHT_GUTTER = 14
const TOP_GUTTER = 14
const LABEL_GUTTER = 26

export interface BarChartProps {
  readonly locale: Locale
  readonly currencyCode: CurrencyCode
  /** One entry per series; each must carry the same categories in the same order. */
  readonly series: ReadonlyArray<ChartSeries>
  readonly copy: ChartCopy
  readonly layout?: 'stacked' | 'grouped'
  /**
   * Names the total in a stacked chart — the footer row's header and the last fragment of every
   * segment's accessible name. Required for `stacked`, meaningless for `grouped`.
   */
  readonly totalLabel?: string
  readonly height?: number
  readonly showLegend?: boolean
  readonly className?: string
}

export function BarChart({
  locale,
  currencyCode,
  series,
  copy,
  layout = 'stacked',
  totalLabel,
  height = 240,
  showLegend = true,
  className,
}: BarChartProps) {
  const [readout, setReadout] = useState<string | null>(null)
  const patterns = useChartPatterns(series.length)

  const spine = series.at(0)?.points ?? []
  const isEmpty = series.every((entry) =>
    entry.points.every((point) => point.amountMinor === null),
  )

  /** The stack height of each category, in minor units. Also the source of the footer totals. */
  const totals = spine.map((_, index) =>
    sumMinor(
      series.map((entry) => {
        const amountMinor = entry.points[index]?.amountMinor ?? asMinor(0)
        return layout === 'stacked'
          ? asMinor(Math.max(amountMinor, 0))
          : amountMinor
      }),
    ),
  )

  const domainValues =
    layout === 'stacked'
      ? totals
      : series.flatMap((entry) =>
          entry.points.map((point) => point.amountMinor),
        )
  const domain = niceDomain(domainValues, { baseline: 'zero' })
  const ticks = ticksFor(domain, 4)

  return (
    <ChartFrame
      copy={copy}
      height={height}
      isEmpty={isEmpty}
      className={className}
      readout={readout ?? ''}
      legend={
        showLegend && !isEmpty ? (
          <ChartLegend
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
          footerRow={
            totalLabel === undefined
              ? undefined
              : {
                  key: 'total',
                  header: totalLabel,
                  // One total per column, so the footer lines up under the series it sums.
                  cells: series.map((entry) =>
                    chartAmount(
                      locale,
                      currencyCode,
                      sumMinor(
                        entry.points.flatMap((point) =>
                          point.amountMinor === null ? [] : [point.amountMinor],
                        ),
                      ),
                    ),
                  ),
                }
          }
        />
      }
    >
      {(width) => {
        const plot = {
          left: AXIS_GUTTER,
          right: Math.max(width - RIGHT_GUTTER, AXIS_GUTTER + 1),
          top: TOP_GUTTER,
          bottom: height - LABEL_GUTTER,
        }
        const project = linearProjector(domain, [plot.bottom, plot.top])
        const band = bandLayout(spine.length, plot.right - plot.left)

        return (
          <>
            {patterns.defs}
            <YAxis
              plot={plot}
              ticks={ticks}
              project={project}
              format={(value) =>
                chartAxisAmount(
                  locale,
                  currencyCode,
                  asMinor(Math.round(value)),
                )
              }
              showZeroRule={domain[0] < 0}
            />
            <XAxis
              plot={plot}
              labels={spine.map((point) => point.label)}
              centre={(index) => plot.left + band.centre(index)}
              maxLabels={Math.max(2, Math.floor((plot.right - plot.left) / 64))}
            />
            {isEmpty
              ? null
              : series.map((entry, index) => (
                  <BarSeries
                    key={entry.id}
                    series={entry}
                    index={index}
                    seriesCount={series.length}
                    stackedBelow={series.slice(0, index)}
                    layout={layout}
                    totals={totals}
                    totalLabel={totalLabel}
                    locale={locale}
                    currencyCode={currencyCode}
                    band={band}
                    offsetX={plot.left}
                    project={project}
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

interface BarSeriesProps {
  readonly series: ChartSeries
  readonly index: number
  readonly seriesCount: number
  /** The series drawn under this one; their sum is where this one's segment starts. */
  readonly stackedBelow: ReadonlyArray<ChartSeries>
  readonly layout: 'stacked' | 'grouped'
  readonly totals: ReadonlyArray<Minor>
  readonly totalLabel: string | undefined
  readonly locale: Locale
  readonly currencyCode: CurrencyCode
  readonly band: BandLayout
  readonly offsetX: number
  readonly project: (value: number) => number
  readonly fill: string
  readonly onReadout: (value: string | null) => void
}

/** One series' segments. Its own component because the roving tabindex is one hook per group. */
function BarSeries({
  series,
  index,
  seriesCount,
  stackedBelow,
  layout,
  totals,
  totalLabel,
  locale,
  currencyCode,
  band,
  offsetX,
  project,
  fill,
  onReadout,
}: BarSeriesProps) {
  const visible = readingsOf(series.points)
  const roving = useRovingFocus(visible.length)
  const zeroY = project(0)
  const innerWidth = layout === 'grouped' ? band.band / seriesCount : band.band

  return (
    <g role="group" aria-label={series.name} onKeyDown={roving.onKeyDown}>
      {visible.map((entry, order) => {
        const value =
          layout === 'stacked'
            ? asMinor(Math.max(entry.amountMinor, 0))
            : entry.amountMinor
        const base =
          layout === 'stacked'
            ? sumMinor(
                stackedBelow.map((below) =>
                  asMinor(
                    Math.max(below.points[entry.position]?.amountMinor ?? 0, 0),
                  ),
                ),
              )
            : asMinor(0)

        const top = project(base + value)
        const bottom = layout === 'stacked' ? project(base) : zeroY
        const y = Math.min(top, bottom)
        const barHeight = Math.max(Math.abs(bottom - top), value === 0 ? 0 : 1)
        const x =
          offsetX +
          band.at(entry.position) +
          (layout === 'grouped' ? innerWidth * index : 0)

        const name = pointName(
          series.name,
          entry.label,
          chartAmount(locale, currencyCode, entry.amountMinor),
          layout === 'stacked' && totalLabel !== undefined
            ? `${totalLabel}: ${chartAmount(locale, currencyCode, totals[entry.position] ?? asMinor(0))}`
            : '',
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
            <rect
              x={x}
              y={y}
              width={Math.max(innerWidth, 1)}
              height={barHeight}
              fill={fill}
              stroke={seriesColour(index)}
              strokeWidth={1}
            />
          </g>
        )
      })}
    </g>
  )
}
