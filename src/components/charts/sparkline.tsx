import { area, line } from 'd3-shape'
import { useState } from 'react'

import { focusRing } from '#/components/ui'
import { cn } from '#/lib/cn'

import { ChartFrame } from './chart-frame'
import { ChartDataTable } from './data-table'
import { seriesColour } from './encoding'
import { chartAmount, pointName } from './format'
import { readingsOf } from './readings'
import { linearProjector, niceDomain } from './scales'
import { useRovingFocus } from './use-roving-focus'

import type { ChartReading } from './readings'
import type { ChartCopy, ChartPoint } from './types'
import type { Locale } from '#/lib/i18n'
import type { CurrencyCode } from '#/lib/money'

/**
 * The sparkline: a trend at a glance, with no axes and no legend.
 *
 * **A small chart is not an exempt chart.** It still ships the visually-hidden table, and it still
 * puts every reading one `Tab` and a set of arrow keys away — one tab stop for the whole line, as
 * everywhere else in this directory, so a ninety-day trend costs the keyboard reader one stop
 * rather than ninety.
 *
 * The **minimum and the maximum are annotated in place** with their real amounts, formatted through
 * the same `chartAmount` every other surface uses. They are the data values, never the scaled pixel
 * positions — the two are easy to confuse in a chart with no axis to check against, which is
 * exactly why the annotation exists.
 */

export interface SparklineCopy extends ChartCopy {
  /** Marks the low point — "Lowest". */
  readonly minLabel: string
  /** Marks the high point — "Highest". */
  readonly maxLabel: string
  /** Header of the text equivalent's single value column. */
  readonly valueHeader: string
}

export interface SparklineProps {
  readonly locale: Locale
  readonly currencyCode: CurrencyCode
  readonly points: ReadonlyArray<ChartPoint>
  readonly copy: SparklineCopy
  /** The series' position in its parent's palette, when a widget draws several. */
  readonly seriesIndex?: number
  readonly height?: number
  readonly className?: string
}

export function Sparkline({
  locale,
  currencyCode,
  points,
  copy,
  seriesIndex = 0,
  height = 64,
  className,
}: SparklineProps) {
  const [readout, setReadout] = useState<string | null>(null)

  const readings = readingsOf(points)
  const isEmpty = readings.length === 0
  const domain = niceDomain(
    points.map((point) => point.amountMinor),
    { baseline: 'data' },
  )

  const extremes = readings.reduce<{
    low: ChartReading | null
    high: ChartReading | null
  }>(
    (found, reading) => ({
      low:
        found.low === null || reading.amountMinor < found.low.amountMinor
          ? reading
          : found.low,
      high:
        found.high === null || reading.amountMinor > found.high.amountMinor
          ? reading
          : found.high,
    }),
    { low: null, high: null },
  )

  return (
    <ChartFrame
      copy={copy}
      height={height}
      fallbackWidth={280}
      isEmpty={isEmpty}
      className={className}
      readout={readout ?? ''}
      dataTable={
        <ChartDataTable
          caption={copy.title}
          rowHeader={copy.categoryHeader}
          columnHeaders={[copy.valueHeader]}
          rows={points.map((point) => ({
            key: point.key,
            header: point.label,
            cells: [
              point.amountMinor === null
                ? copy.noData
                : chartAmount(locale, currencyCode, point.amountMinor),
            ],
          }))}
        />
      }
    >
      {(width) => {
        const left = 6
        const right = Math.max(width - 6, left + 1)
        const project = linearProjector(domain, [height - 10, 10])
        const x = (index: number): number =>
          points.length <= 1
            ? (left + right) / 2
            : left + ((right - left) * index) / (points.length - 1)

        const defined = (position: number): boolean =>
          points[position]?.amountMinor !== null
        const positions = points.map((_, position) => position)
        const drawnLine = line<number>()
          .defined(defined)
          .x(x)
          .y((position) => project(points[position]?.amountMinor ?? 0))(
          positions,
        )
        const drawnArea = area<number>()
          .defined(defined)
          .x(x)
          .y0(height - 2)
          .y1((position) => project(points[position]?.amountMinor ?? 0))(
          positions,
        )
        const colour = seriesColour(seriesIndex)

        return (
          <>
            {drawnArea === null ? null : (
              <path d={drawnArea} fill={colour} opacity={0.16} />
            )}
            {drawnLine === null ? null : (
              <path
                d={drawnLine}
                fill="none"
                stroke={colour}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* The two annotations. `aria-hidden` because the same figures are in the table
                and in each point's accessible name; a third announcement is noise. */}
            <g aria-hidden="true" className="tabular-nums">
              {[
                { reading: extremes.high, label: copy.maxLabel, dy: -8 },
                { reading: extremes.low, label: copy.minLabel, dy: 16 },
              ].map(({ reading, label, dy }) =>
                reading === null ? null : (
                  <text
                    key={label}
                    x={Math.min(
                      Math.max(x(reading.position), left + 2),
                      right - 2,
                    )}
                    y={project(reading.amountMinor) + dy}
                    textAnchor="middle"
                    className="fill-ink-2 text-[10px]"
                  >
                    {chartAmount(locale, currencyCode, reading.amountMinor)}
                  </text>
                ),
              )}
            </g>

            <SparklinePoints
              readings={readings}
              title={copy.title}
              locale={locale}
              currencyCode={currencyCode}
              seriesIndex={seriesIndex}
              x={x}
              project={project}
              onReadout={setReadout}
            />
          </>
        )
      }}
    </ChartFrame>
  )
}

interface SparklinePointsProps {
  readonly readings: ReadonlyArray<ChartReading>
  readonly title: string
  readonly locale: Locale
  readonly currencyCode: CurrencyCode
  readonly seriesIndex: number
  readonly x: (index: number) => number
  readonly project: (value: number) => number
  readonly onReadout: (value: string | null) => void
}

/** The focusable readings. Its own component so the roving tabindex is a hook, once. */
function SparklinePoints({
  readings,
  title,
  locale,
  currencyCode,
  seriesIndex,
  x,
  project,
  onReadout,
}: SparklinePointsProps) {
  const roving = useRovingFocus(readings.length)
  const colour = seriesColour(seriesIndex)

  return (
    <g role="group" aria-label={title} onKeyDown={roving.onKeyDown}>
      {readings.map((reading, order) => {
        const cx = x(reading.position)
        const cy = project(reading.amountMinor)
        const name = pointName(
          reading.label,
          chartAmount(locale, currencyCode, reading.amountMinor),
        )
        const isActive = roving.activeIndex === order

        return (
          <g
            key={reading.key}
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
            <circle cx={cx} cy={cy} r={10} fill="transparent" />
            {isActive ? <circle cx={cx} cy={cy} r={3} fill={colour} /> : null}
          </g>
        )
      })}
    </g>
  )
}
