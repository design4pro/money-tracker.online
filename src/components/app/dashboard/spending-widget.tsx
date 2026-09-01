import { DonutChart } from '#/components/charts'
import { EmptyState } from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'

import { spendingCopy } from './chart-copy'

import type { ChartSlice } from '#/components/charts'
import type { CurrencyCode } from '#/lib/money'
import type { CategorySpend } from './types'

/**
 * Where the period's money went, as parts of one whole.
 *
 * ## An empty ring is not a state this widget has
 *
 * Until the classification repository lands, this list arrives empty for every workspace, and an
 * empty donut is a grey circle that reads as a failure. The designed empty state says what would
 * fill it — which is the difference between "broken" and "not yet".
 *
 * ## The chart owns the maths, not this file
 *
 * Shares are allocated by largest remainder inside `DonutChart`, so they sum to exactly 100 and
 * the ring's arcs are cut from the same integers the table prints. Nothing is rounded here.
 */
export interface SpendingWidgetProps {
  readonly baseCurrencyCode: CurrencyCode
  readonly spending: ReadonlyArray<CategorySpend>
}

export function SpendingWidget({
  baseCurrencyCode,
  spending,
}: SpendingWidgetProps) {
  const t = useTranslate()
  const locale = useLocale()
  const copy = spendingCopy(t, locale)

  if (spending.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        title={copy.emptyTitle}
        description={copy.emptyBody}
      />
    )
  }

  const slices: ReadonlyArray<ChartSlice> = spending.map((entry) => ({
    id: entry.id,
    label: entry.label,
    amountMinor: entry.amountMinor,
  }))

  return (
    <DonutChart
      locale={locale}
      currencyCode={baseCurrencyCode}
      slices={slices}
      copy={copy}
      size={220}
    />
  )
}
