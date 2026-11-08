import { BarChart, chartAmount, usePlotSize } from '#/components/charts'
import { EmptyState } from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { isZeroMinor } from '#/lib/money'

import { cashFlowCopy } from './chart-copy'
import { monthLabel } from './month-label'

import type { ChartSeries, ChartTableRow } from '#/components/charts'
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
 *
 * ## A single month is drawn against the months before it
 *
 * When the period resolves to one bucket the loader sends the trailing months with it, marked
 * `inPeriod: false`. Two bars alone in an empty plot answer "how much" and cannot answer "is that
 * a lot" — which is the only question anyone brings to this panel. The selected month is
 * **promoted** rather than the context dimmed: a recessed band behind it, its axis label at the
 * primary ink and a heavier weight, and a sentence under the legend saying which month the panel
 * is about. Dimming the context bars to a third would have been the cheaper drawing and would have
 * put real data below the 3:1 floor a graphical object is held to.
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
  const plotHeight = usePlotSize()

  const hasMovement = buckets.some(bucketHasMovement)

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
    {
      id: 'planned-income',
      name: t('dashboard.plannedIncome'),
      points: buckets.map((bucket) => ({
        key: `planned-income-${bucket.key}`,
        label: monthLabel(locale, bucket.key),
        amountMinor: bucket.plannedIncomeMinor,
      })),
    },
    {
      id: 'planned-expense',
      name: t('dashboard.plannedExpenses'),
      points: buckets.map((bucket) => ({
        key: `planned-expense-${bucket.key}`,
        label: monthLabel(locale, bucket.key),
        amountMinor: bucket.plannedExpenseMinor,
      })),
    },
  ]

  const emphasis = buckets.map((bucket) => bucket.inPeriod)
  const context = buckets.filter((bucket) => !bucket.inPeriod).length > 0
  const selected = buckets.find((bucket) => bucket.inPeriod)
  const hasPlan = buckets.some(bucketHasPlan)
  const converted = buckets.some((bucket) => bucket.nativePlan.length > 0)
  const rateMissing = buckets.some((bucket) => bucket.plannedRateMissing)

  const notes = [
    context && selected !== undefined
      ? t('dashboard.cashFlow.context', {
          month: monthLabel(locale, selected.key),
        })
      : undefined,
    hasPlan ? t('dashboard.cashFlow.plannedNote') : undefined,
    converted ? t('dashboard.cashFlow.convertedNote') : undefined,
    rateMissing ? t('dashboard.cashFlow.rateMissingNote') : undefined,
  ].filter((note): note is string => note !== undefined)

  const extraTableRows: ReadonlyArray<ChartTableRow> = buckets.flatMap(
    (bucket) =>
      bucket.nativePlan.map((line) => ({
        key: `${bucket.key}-${line.currencyCode}`,
        header: `${monthLabel(locale, bucket.key)} · ${line.currencyCode}`,
        cells: [
          copy.noData,
          copy.noData,
          chartAmount(locale, line.currencyCode, line.incomeMinor),
          chartAmount(locale, line.currencyCode, line.expenseMinor),
        ],
      })),
  )

  return (
    <BarChart
      locale={locale}
      currencyCode={baseCurrencyCode}
      series={series}
      copy={copy}
      layout="grouped"
      height={plotHeight}
      emphasis={emphasis}
      extraTableRows={extraTableRows}
      footnote={
        notes.length === 0 ? undefined : (
          <div className="flex flex-col gap-1">
            {notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        )
      }
    />
  )
}

function bucketHasPlan(bucket: CashFlowBucket): boolean {
  return (
    bucket.plannedIncomeMinor === null ||
    bucket.plannedExpenseMinor === null ||
    !isZeroMinor(bucket.plannedIncomeMinor) ||
    !isZeroMinor(bucket.plannedExpenseMinor) ||
    bucket.nativePlan.length > 0
  )
}

function bucketHasMovement(bucket: CashFlowBucket): boolean {
  return (
    !isZeroMinor(bucket.incomeMinor) ||
    !isZeroMinor(bucket.expenseMinor) ||
    bucketHasPlan(bucket)
  )
}
