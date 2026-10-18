import { Badge, Button } from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { InstalmentView } from '#/server/repos/loans'

/**
 * One row per instalment: due date, total, state, buyout flag, and Mark paid on unpaid rows.
 *
 * Amounts are end-aligned and `tabular-nums`. Overdue is a word in the status cell, never colour
 * alone. The table has a caption and scope-marked headers.
 */

export interface ScheduleTableProps {
  readonly instalments: ReadonlyArray<InstalmentView>
  readonly currencyCode: string
  readonly onMarkPaid: (instalment: InstalmentView) => void
}

export function ScheduleTable({
  instalments,
  currencyCode,
  onMarkPaid,
}: ScheduleTableProps) {
  const t = useTranslate()
  const locale = useLocale()

  if (instalments.length === 0) {
    return <p className="text-body text-ink-2">{t('loans.schedule.missing')}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-xl text-label">
        <caption className="mb-3 text-start text-caption text-ink-2">
          {t('loans.schedule.caption')}
        </caption>
        <thead>
          <tr className="border-b border-border-panel text-caption font-semibold tracking-label text-ink-2 uppercase">
            <th scope="col" className="py-2 pe-3 text-start">
              {t('loans.schedule.sequence')}
            </th>
            <th scope="col" className="py-2 pe-3 text-start">
              {t('loans.schedule.due')}
            </th>
            <th scope="col" className="py-2 pe-3 text-end tabular-nums">
              {t('loans.schedule.amount')}
            </th>
            <th scope="col" className="py-2 pe-3 text-start">
              {t('loans.schedule.status')}
            </th>
            <th scope="col" className="py-2 text-end">
              <span className="sr-only">{t('loans.schedule.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {instalments.map((row) => {
            const statusKey =
              row.derivedStatus === 'paid'
                ? 'loans.status.paid'
                : row.derivedStatus === 'overdue'
                  ? 'loans.status.overdue'
                  : 'loans.status.upcoming'
            const isNextUnpaid =
              row.derivedStatus !== 'paid' &&
              instalments.find(
                (candidate) => candidate.derivedStatus !== 'paid',
              )?.sequence === row.sequence
            return (
              <tr key={row.sequence} className="border-t border-border-subtle">
                <td className="py-3 pe-3 tabular-nums text-ink">
                  {row.sequence}
                </td>
                <td className="py-3 pe-3 text-ink">
                  {formatCalendarDate(locale, row.dueOn, 'medium')}
                </td>
                <td className="py-3 pe-3 text-end tabular-nums text-ink">
                  {formatMoney(
                    locale,
                    makeMoney(row.amountMinor, currencyCode),
                  )}
                </td>
                <td className="py-3 pe-3">
                  <span
                    className={
                      row.derivedStatus === 'overdue'
                        ? 'text-warning'
                        : 'text-ink'
                    }
                  >
                    {t(statusKey)}
                  </span>
                  {isNextUnpaid ? (
                    <>
                      {' '}
                      <Badge tone="info" size="sm">
                        {t('loans.schedule.next')}
                      </Badge>
                    </>
                  ) : null}
                  {row.isBuyout ? (
                    <>
                      {' '}
                      <Badge tone="neutral" size="sm">
                        {t('loans.schedule.buyout')}
                      </Badge>
                    </>
                  ) : null}
                </td>
                <td className="py-3 text-end">
                  {row.derivedStatus === 'paid' ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => onMarkPaid(row)}
                    >
                      {t('loans.markPaid.action', {
                        date: formatCalendarDate(locale, row.dueOn, 'medium'),
                      })}
                    </Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
