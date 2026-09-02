import { useMemo } from 'react'

import { BarChart } from '#/components/charts'
import { useLocale, useTranslate } from '#/lib/i18n'
import { asCurrencyCode } from '#/lib/money'

import type { ContributionMonth } from '#/server/goals/history'

/**
 * What went in, month by month — the evidence the projection is a median of.
 *
 * ## Why bars, and why monthly rather than cumulative
 *
 * A cumulative line only ever goes up and to the right, which makes every goal look like it is
 * going well. The question the detail screen is actually answering is *at what pace*, and the pace
 * is the thing the projected date is computed from — so the chart draws the same monthly figures
 * the median was taken over. A reader who doubts the projection can see, in one glance, whether
 * the months behind it look like a habit or like three good weeks.
 *
 * ## A missing bar is a real zero
 *
 * `#/server/goals/history` fills every month between the first contribution and today, so a month
 * with nothing in it is `0` rather than absent. That is the truth for this measurement — not
 * saving in March is a fact about March — and it is the opposite of the convention the line chart
 * uses, where `null` is a gap. The footnote says which of the two this is, because a reader cannot
 * be expected to know a chart's null convention by looking at it.
 *
 * ## Everything accessible about it comes from the primitive
 *
 * `BarChart` ships the visually-hidden data table, one tab stop per series with arrow-key
 * traversal along the bars, and a non-colour encoding — see `components/charts/index.ts`. This
 * component's whole job is to hand it integers and strings.
 */

export interface ContributionChartProps {
  readonly series: ReadonlyArray<ContributionMonth>
  readonly currencyCode: string
  readonly className?: string
}

export function ContributionChart({
  series,
  currencyCode,
  className,
}: ContributionChartProps) {
  const t = useTranslate()
  const locale = useLocale()

  /**
   * The axis labels.
   *
   * A month-and-year formatter, built here rather than taken from `#/lib/i18n/format`, which has
   * no month style — the same call `transactions/detail-summary` makes for its own one-off shape.
   * `useMemo` because constructing an `Intl` object is the expensive part and this renders one per
   * column. `timeZone: 'UTC'` because `monthStart` is a calendar day with no instant behind it.
   */
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    [locale],
  )

  const points = series.map((month) => ({
    key: month.monthStart,
    label: monthLabel.format(new Date(`${month.monthStart}T00:00:00.000Z`)),
    amountMinor: month.addedMinor,
  }))

  return (
    <BarChart
      locale={locale}
      currencyCode={asCurrencyCode(currencyCode)}
      layout="grouped"
      showLegend={false}
      className={className}
      footnote={t('goals.chart.zeroNote')}
      series={[
        {
          id: 'contributions',
          name: t('goals.chart.series.monthly'),
          points,
        },
      ]}
      copy={{
        title: t('goals.chart.title'),
        categoryHeader: t('goals.chart.category'),
        emptyTitle: t('goals.chart.empty.title'),
        emptyBody: t('goals.chart.empty.body'),
        noData: t('goals.chart.noData'),
      }}
    />
  )
}
