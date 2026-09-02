import { BarChart } from '#/components/charts'
import { EmptyState } from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { asMinor } from '#/lib/money'

import type { ChartSeries } from '#/components/charts'
import type { CurrencyCode } from '#/lib/money'
import type { LedgerRow } from '#/server/budgets/summary'

/**
 * Spending against what was available, one pair of bars per period.
 *
 * ## Grouped, never stacked
 *
 * *Spent* and *available* are not parts of one whole — available already contains spent — so a
 * stack would draw a bar whose height is a number nobody asked for. Side by side, the comparison
 * the chart exists for is the one the eye actually makes: did the darker bar reach the lighter
 * one.
 *
 * ## Available, not limit
 *
 * The second series is `limit + carriedIn`, which is what the meter measures against and what the
 * person actually had to spend. Drawing the bare limit beside a period that opened with 300 zł
 * carried in would show an overspend the reader does not have.
 *
 * ## One period is not a chart
 *
 * A brand-new budget has a single open period. Two bars alone in an empty plot answer "how much"
 * and cannot answer "is that a lot", so the component says so in words rather than drawing a
 * chart with nothing to compare. The plan asks for exactly this.
 *
 * The `BarChart` primitive brings the rest: a visually-hidden data table carrying these same
 * integers, one tab stop per series with arrow keys along it, and a marker shape and fill pattern
 * per series so the two are told apart without colour.
 */

export interface PeriodTimelineProps {
  readonly rows: ReadonlyArray<LedgerRow>
  readonly currencyCode: CurrencyCode
  /** How many periods to draw, newest last. Twelve keeps the bars legible at 360px. */
  readonly limit?: number
}

export function PeriodTimeline({
  rows,
  currencyCode,
  limit = 12,
}: PeriodTimelineProps) {
  const t = useTranslate()
  const locale = useLocale()

  if (rows.length < 2) {
    return (
      <EmptyState
        headingLevel={3}
        title={t('budgets.timeline.empty.title')}
        description={t('budgets.timeline.empty.body')}
      />
    )
  }

  const shown = rows.slice(-limit)
  const label = (row: LedgerRow) =>
    formatCalendarDate(locale, row.periodStart, 'short')

  const series: ReadonlyArray<ChartSeries> = [
    {
      id: 'spent',
      name: t('budgets.timeline.spent'),
      points: shown.map((row) => ({
        key: `spent-${row.periodStart}`,
        label: label(row),
        amountMinor: row.spentMinor,
      })),
    },
    {
      id: 'available',
      name: t('budgets.timeline.available'),
      points: shown.map((row) => ({
        key: `available-${row.periodStart}`,
        label: label(row),
        // Floored at zero for the same reason the meter's range is: a bar cannot draw a negative
        // envelope, and `availableMinor` is the figure the meter already measures against.
        amountMinor: asMinor(Math.max(row.limitMinor + row.carriedInMinor, 0)),
      })),
    },
  ]

  return (
    <BarChart
      locale={locale}
      currencyCode={currencyCode}
      series={series}
      layout="grouped"
      height={220}
      copy={{
        title: t('budgets.timeline.title'),
        categoryHeader: t('budgets.timeline.categoryHeader'),
        emptyTitle: t('budgets.timeline.empty.title'),
        emptyBody: t('budgets.timeline.empty.body'),
        noData: t('budgets.timeline.noData'),
      }}
    />
  )
}
