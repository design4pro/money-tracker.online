import { arc } from 'd3-shape'
import { useState } from 'react'

import { Button, focusRing } from '#/components/ui'
import { cn } from '#/lib/cn'
import { asMinor, sumMinor } from '#/lib/money'

import { ChartFrame } from './chart-frame'
import { ChartDataTable } from './data-table'
import { seriesColour, useChartPatterns } from './encoding'
import { chartAmount, pointName } from './format'
import { ChartLegend } from './legend'
import { percentagesOf } from './scales'
import { useRovingFocus } from './use-roving-focus'

import type { ChartCopy, ChartSlice } from './types'
import type { Locale } from '#/lib/i18n'
import type { CurrencyCode, Minor } from '#/lib/money'

/**
 * The donut.
 *
 * Four decisions worth reading before changing anything here.
 *
 * **The percentages are computed from integers by largest remainder** — the same method the split
 * allocator uses — so the displayed shares sum to exactly 100. Rounding each share on its own
 * produces three slices totalling 99% often enough that somebody will screenshot it, and a finance
 * product that cannot make its own pie add up has a credibility problem, not a rounding problem.
 * The **angles** are drawn from the exact integers rather than from the rounded percentages, so the
 * ring is geometrically true even where the labels are whole numbers.
 *
 * **Slices below 1% are grouped.** A 0.3% slice is roughly one degree of arc: unhittable by
 * pointer, invisible in print and meaningless in the legend. They collapse into one _Other_ slice
 * whose amount is the **exact integer sum** of what it hides, and the contents stay reachable
 * behind a real button — hidden, not deleted.
 *
 * **The tab order is value order, not visual order**, so tabbing goes largest-first: that is the
 * order a person reasons about a breakdown in, and it makes the first `Tab` land on the answer to
 * the question they came with.
 *
 * **A single slice is drawn as a labelled full ring**, never as a circle with an invisible
 * boundary somewhere on it. And the percentage is never the only information: every slice carries
 * its category and its amount in its accessible name, in the legend and in the text equivalent.
 */

export interface DonutCopy extends ChartCopy {
  /** Names the grouped remainder — "Other". */
  readonly otherLabel: string
  /** The button that reveals what _Other_ hides. */
  readonly expandLabel: string
  /** The same button once it is open. */
  readonly collapseLabel: string
  /** Names the whole — the centre's caption and the table's footer row. */
  readonly totalLabel: string
  /** Header of the text equivalent's amount column. */
  readonly amountHeader: string
  /** Header of its share column. */
  readonly shareHeader: string
  /** Renders a whole-number share as the reader's language says it. */
  readonly formatShare: (percent: number) => string
}

export interface DonutChartProps {
  readonly locale: Locale
  readonly currencyCode: CurrencyCode
  /** Non-negative parts of one whole, in any order. The chart sorts them. */
  readonly slices: ReadonlyArray<ChartSlice>
  readonly copy: DonutCopy
  readonly size?: number
  readonly className?: string
}

/** A slice after sorting, grouping and share computation — what actually gets drawn. */
interface DrawnSlice {
  readonly id: string
  readonly label: string
  readonly amountMinor: Minor
  readonly percent: number
  readonly startAngle: number
  readonly endAngle: number
}

export function DonutChart({
  locale,
  currencyCode,
  slices,
  copy,
  size = 240,
  className,
}: DonutChartProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  const ordered = [...slices]
    .filter((slice) => slice.amountMinor > 0)
    .sort((left, right) => right.amountMinor - left.amountMinor)
  const total = sumMinor(ordered.map((slice) => slice.amountMinor))
  const isEmpty = ordered.length === 0 || total === 0

  // A slice is "tiny" by its true share, decided before any grouping changes the denominator.
  const tiny = ordered.filter(
    (slice) => (slice.amountMinor * 100) / Math.max(total, 1) < 1,
  )
  const grouped = tiny.length > 1
  const kept = grouped
    ? ordered.filter((slice) => !tiny.includes(slice))
    : ordered
  const otherAmount = grouped
    ? sumMinor(tiny.map((slice) => slice.amountMinor))
    : asMinor(0)

  const visible: ReadonlyArray<ChartSlice> = grouped
    ? [
        ...kept,
        { id: '__other', label: copy.otherLabel, amountMinor: otherAmount },
      ]
    : kept

  const percents = percentagesOf(visible.map((slice) => slice.amountMinor))
  // The text equivalent lists every slice, `Other` uncollapsed, so it needs its own
  // largest-remainder pass over the ungrouped set. Rounding each share independently would let
  // the column sum to 99.
  const orderedPercents = percentagesOf(
    ordered.map((slice) => slice.amountMinor),
  )
  const drawn: ReadonlyArray<DrawnSlice> = (() => {
    let cursor = 0
    return visible.map((slice, index) => {
      const startAngle = (cursor / Math.max(total, 1)) * Math.PI * 2
      cursor += slice.amountMinor
      return {
        id: slice.id,
        label: slice.label,
        amountMinor: slice.amountMinor,
        percent: percents[index] ?? 0,
        startAngle,
        endAngle: (cursor / Math.max(total, 1)) * Math.PI * 2,
      }
    })
  })()

  const patterns = useChartPatterns(drawn.length)
  const focused = drawn.find((slice) => slice.id === focusedId) ?? null

  return (
    <ChartFrame
      copy={copy}
      height={size}
      fallbackWidth={size}
      isEmpty={isEmpty}
      className={className}
      legend={
        isEmpty ? undefined : (
          <ChartLegend
            patterns={patterns}
            items={drawn.map((slice, index) => ({
              id: slice.id,
              label: slice.label,
              index,
              detail: chartAmount(locale, currencyCode, slice.amountMinor),
            }))}
          />
        )
      }
      footnote={
        grouped ? (
          <OtherDisclosure
            slices={tiny}
            locale={locale}
            currencyCode={currencyCode}
            isExpanded={isExpanded}
            onToggle={() => setIsExpanded((open) => !open)}
            copy={copy}
          />
        ) : undefined
      }
      dataTable={
        <ChartDataTable
          caption={copy.title}
          rowHeader={copy.categoryHeader}
          columnHeaders={[copy.amountHeader, copy.shareHeader]}
          // Every slice, including the ones `Other` hides: the text equivalent is the
          // uncollapsed truth, which is the whole reason it exists.
          rows={ordered.map((slice, index) => ({
            key: slice.id,
            header: slice.label,
            cells: [
              chartAmount(locale, currencyCode, slice.amountMinor),
              copy.formatShare(orderedPercents[index] ?? 0),
            ],
          }))}
          footerRow={{
            key: 'total',
            header: copy.totalLabel,
            cells: [
              chartAmount(locale, currencyCode, total),
              copy.formatShare(100),
            ],
          }}
        />
      }
    >
      {(width) => (
        <DonutRing
          width={width}
          size={size}
          drawn={drawn}
          patterns={patterns}
          locale={locale}
          currencyCode={currencyCode}
          total={total}
          copy={copy}
          focused={focused}
          onFocusedChange={setFocusedId}
        />
      )}
    </ChartFrame>
  )
}

interface DonutRingProps {
  readonly width: number
  readonly size: number
  readonly drawn: ReadonlyArray<DrawnSlice>
  readonly patterns: ReturnType<typeof useChartPatterns>
  readonly locale: Locale
  readonly currencyCode: CurrencyCode
  readonly total: Minor
  readonly copy: DonutCopy
  readonly focused: DrawnSlice | null
  readonly onFocusedChange: (id: string | null) => void
}

/** The ring, its focusable slices and the centre that follows them. */
function DonutRing({
  width,
  size,
  drawn,
  patterns,
  locale,
  currencyCode,
  total,
  copy,
  focused,
  onFocusedChange,
}: DonutRingProps) {
  const roving = useRovingFocus(drawn.length)
  const cx = width / 2
  const cy = size / 2
  const outer = Math.max(Math.min(size, width) / 2 - 10, 8)
  const inner = outer * 0.6

  const shape = arc<DrawnSlice>()
    .innerRadius(inner)
    .outerRadius(outer)
    .padAngle(drawn.length > 1 ? 0.012 : 0)
    .startAngle((slice) => slice.startAngle)
    .endAngle((slice) => slice.endAngle)

  const centreTitle = focused?.label ?? copy.totalLabel
  const centreValue = chartAmount(
    locale,
    currencyCode,
    focused?.amountMinor ?? total,
  )

  return (
    <>
      {patterns.defs}
      <g
        transform={`translate(${cx} ${cy})`}
        role="group"
        aria-label={copy.title}
        onKeyDown={roving.onKeyDown}
      >
        {drawn.map((slice, index) => {
          const path = shape(slice)
          if (path === null) {
            return null
          }
          const name = pointName(
            slice.label,
            chartAmount(locale, currencyCode, slice.amountMinor),
            copy.formatShare(slice.percent),
          )
          return (
            <g
              key={slice.id}
              ref={roving.register(index)}
              role="img"
              aria-label={name}
              tabIndex={roving.tabIndexFor(index)}
              className={cn('cursor-default', focusRing)}
              onFocus={() => {
                roving.onFocusIndex(index)
                onFocusedChange(slice.id)
              }}
              onBlur={() => onFocusedChange(null)}
              onPointerEnter={() => onFocusedChange(slice.id)}
              onPointerLeave={() => onFocusedChange(null)}
            >
              <path
                d={path}
                fill={patterns.fillFor(index)}
                stroke={seriesColour(index)}
                strokeWidth={1}
              />
            </g>
          )
        })}
      </g>

      {/* The centre repeats what the focused slice already announced, so it is hidden from
          assistive technology and exists for the reader who is looking at the ring. */}
      <g aria-hidden="true" transform={`translate(${cx} ${cy})`}>
        <text textAnchor="middle" y={-4} className="fill-ink-2 text-[11px]">
          {centreTitle}
        </text>
        <text
          textAnchor="middle"
          y={16}
          className="fill-ink text-[15px] font-semibold tabular-nums"
        >
          {centreValue}
        </text>
      </g>
    </>
  )
}

interface OtherDisclosureProps {
  readonly slices: ReadonlyArray<ChartSlice>
  readonly locale: Locale
  readonly currencyCode: CurrencyCode
  readonly isExpanded: boolean
  readonly onToggle: () => void
  readonly copy: DonutCopy
}

/** What `Other` hides, one button away. Hidden is not the same as gone. */
function OtherDisclosure({
  slices,
  locale,
  currencyCode,
  isExpanded,
  onToggle,
  copy,
}: OtherDisclosureProps) {
  return (
    <span className="block">
      <Button
        variant="ghost"
        size="sm"
        onPress={onToggle}
        aria-expanded={isExpanded}
      >
        {isExpanded ? copy.collapseLabel : copy.expandLabel}
      </Button>
      {isExpanded ? (
        <ul className="mt-2 flex flex-col gap-1">
          {slices.map((slice) => (
            <li
              key={slice.id}
              className="flex justify-between gap-4 text-caption"
            >
              <span className="text-ink">{slice.label}</span>
              <span className="text-ink-2 tabular-nums">
                {chartAmount(locale, currencyCode, slice.amountMinor)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  )
}
