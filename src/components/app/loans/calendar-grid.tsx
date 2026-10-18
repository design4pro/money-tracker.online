import { cn } from '#/lib/cn'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, isZeroMinor, makeMoney, sumMinor } from '#/lib/money'

import { monthHeadings } from './month-headings'

import type { Locale } from '#/lib/i18n'
import type { Minor } from '#/lib/money'
import type { CalendarCell, ObligationCalendar } from '#/server/loans/calendar'

/**
 * Visible 12 × years table: paid vs remaining per month, in the workspace base currency.
 *
 * This is the passbook grid, not the HTML prototype's coloured sheet. Overdue is a word in the
 * cell. The current month is a recessed ground **and** a heavier weight — two channels, never
 * colour alone. Empty months are an em dash, not a invented 0,00 the eye would add up. Each cell
 * stacks paid over remaining; a visible key above the table says so, and the same words are
 * spoken per amount.
 */

export interface CalendarGridProps {
  readonly calendar: ObligationCalendar
}

function moneyOf(amountMinor: Minor, currencyCode: string, locale: Locale) {
  return formatMoney(locale, makeMoney(amountMinor, currencyCode))
}

function CellAmounts({
  cell,
  currencyCode,
  isCurrent,
}: {
  readonly cell: CalendarCell
  readonly currencyCode: string
  readonly isCurrent: boolean
}) {
  const t = useTranslate()
  const locale = useLocale()
  const empty =
    isZeroMinor(cell.paidRefMinor) && isZeroMinor(cell.remainingRefMinor)

  if (empty) {
    return (
      <span className="text-ink-2">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t('loans.calendar.cell.empty')}</span>
      </span>
    )
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span>
        <span className="sr-only">{t('loans.calendar.paid')} </span>
        {moneyOf(cell.paidRefMinor, currencyCode, locale)}
      </span>
      <span>
        <span className="sr-only">{t('loans.calendar.remaining')} </span>
        {moneyOf(cell.remainingRefMinor, currencyCode, locale)}
      </span>
      {cell.overdueCount === 0 ? null : (
        <span className="text-caption font-semibold text-ink">
          {t('loans.status.overdue')}
          {isCurrent ? (
            <span className="sr-only"> {t('loans.calendar.thisMonth')}</span>
          ) : null}
        </span>
      )}
    </div>
  )
}

export function CalendarGrid({ calendar }: CalendarGridProps) {
  const t = useTranslate()
  const locale = useLocale()
  const headings = monthHeadings(locale)
  const currencyCode = calendar.baseCurrencyCode

  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-ink-2">{t('loans.calendar.key')}</p>
      {/* A scroller has to be a tab stop or the off-screen months are unreachable by keyboard
          (WCAG 2.1.1, axe `scrollable-region-focusable`); it is named and carries a visible ring,
          the same way as the recurring period grid. */}
      <div
        role="region"
        aria-label={t('loans.calendar.title')}
        tabIndex={0}
        className={cn(
          'overflow-x-auto rounded-md outline-focus focus-safe',
          'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2',
        )}
      >
        <table className="w-full min-w-[72rem] text-caption">
          <caption className="mb-3 text-start text-caption text-ink-2">
            {t('loans.calendar.caption')}
          </caption>
          <thead>
            <tr className="border-b border-border-panel text-caption font-semibold tracking-label text-ink-2 uppercase">
              <th scope="col" className="py-2 pe-3 text-start">
                {t('loans.calendar.year')}
              </th>
              {headings.map((heading, index) => (
                <th
                  key={heading}
                  scope="col"
                  className="py-2 pe-3 text-end tabular-nums"
                >
                  {heading}
                  <span className="sr-only">
                    {` (${String(index + 1).padStart(2, '0')})`}
                  </span>
                </th>
              ))}
              <th scope="col" className="py-2 text-end tabular-nums">
                {t('loans.calendar.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {calendar.years.map((year) => {
              const row = calendar.cells.filter((cell) => cell.year === year)
              const paidTotal = sumMinor(row.map((cell) => cell.paidRefMinor))
              const remainingTotal = sumMinor(
                row.map((cell) => cell.remainingRefMinor),
              )
              return (
                <tr key={year} className="border-t border-border-subtle">
                  <th
                    scope="row"
                    className="py-3 pe-3 text-start text-label font-semibold text-ink"
                  >
                    {year}
                  </th>
                  {row.map((cell) => {
                    const isCurrent = cell.key === calendar.todayMonth
                    return (
                      <td
                        key={cell.key}
                        className={cn(
                          'py-3 pe-3 text-end tabular-nums align-top text-ink',
                          isCurrent &&
                            'bg-surface-sunken font-semibold text-ink',
                        )}
                      >
                        {isCurrent ? (
                          <span className="sr-only">
                            {t('loans.calendar.thisMonth')}{' '}
                          </span>
                        ) : null}
                        <CellAmounts
                          cell={cell}
                          currencyCode={currencyCode}
                          isCurrent={isCurrent}
                        />
                      </td>
                    )
                  })}
                  <td className="py-3 text-end tabular-nums align-top text-ink">
                    <div className="flex flex-col items-end gap-0.5">
                      <span>
                        <span className="sr-only">
                          {t('loans.calendar.paid')}{' '}
                        </span>
                        {moneyOf(paidTotal, currencyCode, locale)}
                      </span>
                      <span>
                        <span className="sr-only">
                          {t('loans.calendar.remaining')}{' '}
                        </span>
                        {moneyOf(remainingTotal, currencyCode, locale)}
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
