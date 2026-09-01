import { BarChart } from '#/components/charts'
import { EmptyState } from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { isZeroMinor } from '#/lib/money'

import { cashFlowCopy } from './chart-copy'
import { monthLabel } from './month-label'

import type { ChartSeries } from '#/components/charts'
import type { CurrencyCode } from '#/lib/money'
import type { CashFlowBucket } from './types'

/**
 * Money in against money out, one pair of bars per month.
 *
 * ## Grouped, never stacked
 *
 * A stack says "these are parts of one whole". Income and expense are not: stacking them draws a
 * bar whose height is the *volume of activity*, a number nobody asked for and everybody misreads
 * as a total. Side by side, the comparison the widget exists for is the one the eye actually makes.
 *
 * ## Money out is drawn as a positive magnitude
 *
 * The direction is carried by the series name — "Money out" — and by the chart's per-series marker
 * shape and fill pattern, not by a sign that would put half the chart below the axis and halve the
 * resolution of both series. This is the same rule the transaction list follows.
 *
 * ## Every month in the range is a bar
 *
 * The buckets come from the period, not from the transactions, so a month with nothing in it is a
 * visible zero rather than a month the axis silently skips.
 */
export interface CashFlowWidgetProps {
  readonly baseCurrencyCode: CurrencyCode
  readonly buckets: ReadonlyArray<CashFlowBucket>
}

export function CashFlowWidget({
  baseCurrencyCode,
  buckets,
}: CashFlowWidgetProps) {
  const t = useTranslate()
  const locale = useLocale()
  const copy = cashFlowCopy(t)

  const hasMovement = buckets.some(
    (bucket) =>
      !isZeroMinor(bucket.incomeMinor) || !isZeroMinor(bucket.expenseMinor),
  )

  if (!hasMovement) {
    return (
      <EmptyState
        headingLevel={3}
        title={copy.emptyTitle}
        description={copy.emptyBody}
      />
    )
  }

  const series: ReadonlyArray<ChartSeries> = [
    {
      id: 'income',
      name: t('dashboard.income'),
      points: buckets.map((bucket) => ({
        key: `income-${bucket.key}`,
        label: monthLabel(locale, bucket.key),
        amountMinor: bucket.incomeMinor,
      })),
    },
    {
      id: 'expense',
      name: t('dashboard.expenses'),
      points: buckets.map((bucket) => ({
        key: `expense-${bucket.key}`,
        label: monthLabel(locale, bucket.key),
        amountMinor: bucket.expenseMinor,
      })),
    },
  ]

  return (
    <BarChart
      locale={locale}
      currencyCode={baseCurrencyCode}
      series={series}
      copy={copy}
      layout="grouped"
      height={220}
    />
  )
}
