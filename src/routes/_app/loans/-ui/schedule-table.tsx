import { ROW_KEY_ATTRIBUTE } from '#/components/app/recurring'
import {
  STACKED_BLOCK,
  STACKED_HEAD,
  STACKED_ROW_HEADER,
  StackedCell,
} from '#/components/app/recurring/stacked-table'
import { Badge, Button } from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { InstalmentView } from '#/server/repos/loans'

/**
 * One row per instalment: due date, total, state, buyout flag, and Mark paid on unpaid rows.
 *
 * Amounts are end-aligned and `tabular-nums`. Overdue is a word in the status cell, never colour
 * alone. The table has a caption and scope-marked headers.
 *
 * From `sm` up it scrolls sideways in its own focusable region; below `sm` each row stacks into a
 * block so Mark paid is reachable at 360px (`DESIGN.md` -> Reflow, the same classes as the
 * recurring period grid). Rows carry `ROW_KEY_ATTRIBUTE` so focus can be put back after a save.
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
    // A scrollable region has to be a tab stop, or a keyboard user cannot reach the columns that
    // are off-screen (WCAG 2.1.1); a focusable region needs a name and a visible ring.
    <div
      role="region"
      aria-label={t('loans.schedule.title')}
      tabIndex={0}
      className="overflow-x-auto rounded-md outline-focus focus-safe focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
    >
      <table
        role="table"
        className={cn('w-full border-collapse text-label', STACKED_BLOCK)}
      >
        <caption
          className={cn(
            'mb-3 text-start text-caption text-ink-2',
            STACKED_BLOCK,
          )}
        >
          {t('loans.schedule.caption')}
        </caption>
        <thead role="rowgroup" className={STACKED_HEAD}>
          <tr
            role="row"
            className={cn(
              'border-b border-border-panel text-caption font-semibold tracking-label text-ink-2 uppercase',
              STACKED_BLOCK,
            )}
          >
            <th
              role="columnheader"
              scope="col"
              className={cn('py-2 pe-3 text-start', STACKED_BLOCK)}
            >
              {t('loans.schedule.due')}
            </th>
            <th
              role="columnheader"
              scope="col"
              className={cn('py-2 pe-3 text-start', STACKED_BLOCK)}
            >
              {t('loans.schedule.sequence')}
            </th>
            <th
              role="columnheader"
              scope="col"
              className={cn('py-2 pe-3 text-end', STACKED_BLOCK)}
            >
              {t('loans.schedule.amount')}
            </th>
            <th
              role="columnheader"
              scope="col"
              className={cn('py-2 pe-3 text-start', STACKED_BLOCK)}
            >
              {t('loans.schedule.status')}
            </th>
            <th
              role="columnheader"
              scope="col"
              className={cn('py-2 text-end', STACKED_BLOCK)}
            >
              <span className="sr-only">{t('loans.schedule.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup" className={STACKED_BLOCK}>
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
              <tr
                key={row.sequence}
                role="row"
                {...{ [ROW_KEY_ATTRIBUTE]: String(row.sequence) }}
                className={cn('border-t border-border-subtle', STACKED_BLOCK)}
              >
                <th
                  role="rowheader"
                  scope="row"
                  className={cn(
                    'py-3 pe-3 text-start font-normal text-ink',
                    STACKED_ROW_HEADER,
                  )}
                >
                  {formatCalendarDate(locale, row.dueOn, 'medium')}
                </th>
                <StackedCell
                  label={t('loans.schedule.sequence')}
                  className="py-3 pe-3 tabular-nums text-ink"
                >
                  {row.sequence}
                </StackedCell>
                <StackedCell
                  label={t('loans.schedule.amount')}
                  className="py-3 pe-3 text-end tabular-nums text-ink"
                >
                  {formatMoney(
                    locale,
                    makeMoney(row.amountMinor, currencyCode),
                  )}
                </StackedCell>
                <StackedCell
                  label={t('loans.schedule.status')}
                  className="py-3 pe-3"
                >
                  <span>
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
                  </span>
                </StackedCell>
                <td role="cell" className={cn('py-3 text-end', STACKED_BLOCK)}>
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
