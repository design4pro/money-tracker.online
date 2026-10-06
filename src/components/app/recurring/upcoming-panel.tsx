import { useRef } from 'react'
import { Link } from '@tanstack/react-router'

import { Card } from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import { PeriodActions } from './period-actions'
import { PeriodStatusBadge } from './period-status'
import {
  STACKED_BLOCK,
  STACKED_HEAD,
  STACKED_ROW_HEADER,
  StackedCell,
} from './stacked-table'
import {
  ROW_KEY_ATTRIBUTE,
  useRowFocusRecovery,
} from './use-row-focus-recovery'

import type { UpcomingPeriod } from '#/server/repos/recurring'

/**
 * What is due soon, and what is already late - and the actions to settle it where it is read.
 *
 * A real `<table>`: this is tabular data somebody reads down a column, and it has no sorting, no
 * selection and no cell navigation, so the semantics that matter are the plain ones. The status is
 * a word in its own cell rather than a tint on the row - `docs/ACCESSIBILITY.md` §1 - and the
 * series name is a link, so the row is a route to the thing rather than a dead end.
 *
 * ## The status column is always there
 *
 * It used to appear only when some row was late. `upcoming` and `overdue` carry different urgency
 * and both are reachable here, and a column that comes and goes shifts every other column with it.
 *
 * ## Mark paid and Skip, never Revert
 *
 * The rows come from `getUpcoming`, which returns unsettled periods only, so there is nothing here
 * to revert. The panel passes `PeriodActions` no `onRevert`, which is the whole of that rule. It
 * also passes no read-only flag: only active series are listed, and what a person may do to one
 * is decided by the server functions the callbacks reach, never by this component.
 *
 * The callbacks are the route's, because they perform writes; the panel hands each the whole
 * period so the route can find the series it belongs to.
 *
 * ## Where focus goes when a row leaves
 *
 * Skipping a period or saving the mark-paid dialog removes the row that held focus, and focus
 * would fall to the top of the page. The panel puts it on the Mark paid button of the row that
 * took the removed row's place, on the new last row's, or on its own heading when the list is
 * empty - see {@link useRowFocusRecovery}. The route says which period its dialog is open on with
 * `openPeriod`, which is also how the `?markPaid=` reopen path, which has no trigger to restore
 * to, gets its focus back when the picker closes.
 */

export interface UpcomingPanelProps {
  readonly upcoming: ReadonlyArray<UpcomingPeriod>
  /** The period the route's mark-paid dialog is open on, if any. */
  readonly openPeriod?: Pick<UpcomingPeriod, 'seriesId' | 'periodStart'> | null
  readonly onMarkPaid: (period: UpcomingPeriod) => void
  readonly onSkip: (period: UpcomingPeriod) => void
}

const rowKey = (period: Pick<UpcomingPeriod, 'seriesId' | 'periodStart'>) =>
  `${period.seriesId}:${period.periodStart}`

export function UpcomingPanel({
  upcoming,
  openPeriod = null,
  onMarkPaid,
  onSkip,
}: UpcomingPanelProps) {
  const t = useTranslate()
  const locale = useLocale()
  const rootRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { remember } = useRowFocusRecovery({
    rows: upcoming,
    rowKey,
    openKey: openPeriod === null ? null : rowKey(openPeriod),
    rootRef,
    fallbackRef: headingRef,
  })

  return (
    <Card className="flex flex-col gap-3">
      <h2
        ref={headingRef}
        // Focusable by script only: it is where focus lands when the last row is settled.
        tabIndex={-1}
        className="rounded-sm text-subtitle font-semibold text-ink outline-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
      >
        {t('recurring.upcoming.title')}
      </h2>

      {upcoming.length === 0 ? (
        <p className="text-body text-ink-2">{t('recurring.upcoming.empty')}</p>
      ) : (
        <div
          ref={rootRef}
          role="region"
          aria-label={t('recurring.upcoming.title')}
          tabIndex={0}
          className="overflow-x-auto rounded-md outline-focus focus-safe focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
        >
          <table
            role="table"
            className={cn('w-full border-collapse text-label', STACKED_BLOCK)}
          >
            <caption
              className={cn(
                'pb-3 text-start text-caption text-ink-2',
                STACKED_BLOCK,
              )}
            >
              {t('recurring.upcoming.caption')}
            </caption>
            <thead role="rowgroup" className={STACKED_HEAD}>
              <tr
                role="row"
                className={cn('border-b border-border-subtle', STACKED_BLOCK)}
              >
                <th
                  role="columnheader"
                  scope="col"
                  className={cn(
                    'px-1.5 py-2 text-start font-medium text-ink-2',
                    STACKED_BLOCK,
                  )}
                >
                  {t('recurring.periods.col.due')}
                </th>
                <th
                  role="columnheader"
                  scope="col"
                  className={cn(
                    'px-1.5 py-2 text-start font-medium text-ink-2',
                    STACKED_BLOCK,
                  )}
                >
                  {t('recurring.form.name')}
                </th>
                <th
                  role="columnheader"
                  scope="col"
                  className={cn(
                    'px-1.5 py-2 text-end font-medium text-ink-2',
                    STACKED_BLOCK,
                  )}
                >
                  {t('recurring.periods.col.expected')}
                </th>
                <th
                  role="columnheader"
                  scope="col"
                  className={cn(
                    'px-1.5 py-2 text-start font-medium text-ink-2',
                    STACKED_BLOCK,
                  )}
                >
                  {t('recurring.periods.col.status')}
                </th>
                <th
                  role="columnheader"
                  scope="col"
                  className={cn(
                    'px-1.5 py-2 text-end font-medium text-ink-2',
                    STACKED_BLOCK,
                  )}
                >
                  {t('recurring.periods.col.actions')}
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup" className={STACKED_BLOCK}>
              {upcoming.map((period) => (
                <tr
                  key={rowKey(period)}
                  role="row"
                  {...{ [ROW_KEY_ATTRIBUTE]: rowKey(period) }}
                  className={cn(
                    'border-b border-border-subtle last:border-b-0',
                    STACKED_BLOCK,
                  )}
                >
                  <th
                    role="rowheader"
                    scope="row"
                    className={cn(
                      'px-1.5 py-2 text-start font-medium text-ink',
                      STACKED_ROW_HEADER,
                    )}
                  >
                    {formatCalendarDate(locale, period.dueOn, 'medium')}
                  </th>
                  <StackedCell
                    label={t('recurring.form.name')}
                    className="px-1.5 py-2 max-sm:text-end"
                  >
                    <Link
                      to="/recurring/$seriesId"
                      params={{ seriesId: period.seriesId }}
                      className="inline-flex target-min-h target-min-w items-center rounded-sm text-ink underline-offset-2 outline-focus hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 max-sm:break-words"
                    >
                      {period.seriesName}
                    </Link>
                  </StackedCell>
                  <StackedCell
                    label={t('recurring.periods.col.expected')}
                    className="whitespace-nowrap px-1.5 py-2 text-end tabular text-ink"
                  >
                    {formatMoney(
                      locale,
                      makeMoney(
                        period.expectedAmountMinor,
                        period.expectedCurrencyCode,
                      ),
                    )}
                  </StackedCell>
                  <StackedCell
                    label={t('recurring.periods.col.status')}
                    className="px-1.5 py-2"
                  >
                    <PeriodStatusBadge status={period.derivedStatus} />
                  </StackedCell>
                  <td role="cell" className={cn('px-1.5 py-2', STACKED_BLOCK)}>
                    <PeriodActions
                      period={period}
                      seriesName={period.seriesName}
                      compact
                      onMarkPaid={() => onMarkPaid(period)}
                      onSkip={() => {
                        remember(rowKey(period))
                        onSkip(period)
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
