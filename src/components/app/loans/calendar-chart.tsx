import { BarChart } from '#/components/charts'
import { asCurrencyCode, isZeroMinor } from '#/lib/money'
import { useLocale, useTranslate } from '#/lib/i18n'

import { monthHeadings } from './month-headings'

import type { ChartSeries } from '#/components/charts'
import type { ObligationCalendar } from '#/server/loans/calendar'

/**
 * Paid vs remaining for one year, stacked: they are parts of that month's planned obligation.
 *
 * `BarChart` already ships the visually-hidden data table, keyboard points, and a non-colour
 * encoding per series. This file only picks the year and names the two series.
 */

export interface CalendarChartProps {
  readonly calendar: ObligationCalendar
  readonly year: number
}

export function CalendarChart({ calendar, year }: CalendarChartProps) {
  const t = useTranslate()
  const locale = useLocale()
  const headings = monthHeadings(locale)
  const row = calendar.cells.filter((cell) => cell.year === year)
  const hasObligations = row.some(
    (cell) =>
      !isZeroMinor(cell.paidRefMinor) || !isZeroMinor(cell.remainingRefMinor),
  )
  const emphasis = row.map((cell) => cell.key === calendar.todayMonth)

  const series: ReadonlyArray<ChartSeries> = [
    {
      id: 'paid',
      name: t('loans.calendar.paid'),
      points: row.map((cell, index) => ({
        key: `paid-${cell.key}`,
        label: headings[index] ?? cell.key,
        amountMinor: cell.paidRefMinor,
      })),
    },
    {
      id: 'remaining',
      name: t('loans.calendar.remaining'),
      points: row.map((cell, index) => ({
        key: `remaining-${cell.key}`,
        label: headings[index] ?? cell.key,
        amountMinor: cell.remainingRefMinor,
      })),
    },
  ]

  return (
    <BarChart
      locale={locale}
      currencyCode={asCurrencyCode(calendar.baseCurrencyCode)}
      series={hasObligations ? series : []}
      copy={{
        title: t('loans.calendar.chart.title', { year }),
        categoryHeader: t('loans.calendar.chart.category'),
        emptyTitle: t('loans.calendar.chart.emptyTitle'),
        emptyBody: t('loans.calendar.chart.emptyBody'),
        noData: t('loans.calendar.chart.noData'),
      }}
      layout="stacked"
      totalLabel={t('loans.calendar.chart.total')}
      height={240}
      emphasis={emphasis}
    />
  )
}
