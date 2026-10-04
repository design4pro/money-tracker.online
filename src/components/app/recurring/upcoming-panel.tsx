import { Link } from '@tanstack/react-router'

import { Card } from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import { PeriodActions } from './period-actions'
import { PeriodStatusBadge } from './period-status'

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
 */

export interface UpcomingPanelProps {
  readonly upcoming: ReadonlyArray<UpcomingPeriod>
  readonly onMarkPaid: (period: UpcomingPeriod) => void
  readonly onSkip: (period: UpcomingPeriod) => void
}

export function UpcomingPanel({
  upcoming,
  onMarkPaid,
  onSkip,
}: UpcomingPanelProps) {
  const t = useTranslate()
  const locale = useLocale()

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-subtitle font-semibold text-ink">
        {t('recurring.upcoming.title')}
      </h2>

      {upcoming.length === 0 ? (
        <p className="text-body text-ink-2">{t('recurring.upcoming.empty')}</p>
      ) : (
        <div
          role="region"
          aria-label={t('recurring.upcoming.title')}
          tabIndex={0}
          className="overflow-x-auto rounded-md outline-focus focus-safe focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
        >
          <table className="w-full border-collapse text-label">
            <caption className="pb-3 text-start text-caption text-ink-2">
              {t('recurring.upcoming.caption')}
            </caption>
            <thead>
              <tr className="border-b border-border-subtle">
                <th
                  scope="col"
                  className="px-1.5 py-2 text-start font-medium text-ink-2"
                >
                  {t('recurring.periods.col.due')}
                </th>
                <th
                  scope="col"
                  className="px-1.5 py-2 text-start font-medium text-ink-2"
                >
                  {t('recurring.form.name')}
                </th>
                <th
                  scope="col"
                  className="px-1.5 py-2 text-end font-medium text-ink-2"
                >
                  {t('recurring.periods.col.expected')}
                </th>
                <th
                  scope="col"
                  className="px-1.5 py-2 text-start font-medium text-ink-2"
                >
                  {t('recurring.periods.col.status')}
                </th>
                <th
                  scope="col"
                  className="px-1.5 py-2 text-end font-medium text-ink-2"
                >
                  {t('recurring.periods.col.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((period) => (
                <tr
                  key={`${period.seriesId}:${period.periodStart}`}
                  className="border-b border-border-subtle last:border-b-0"
                >
                  <th
                    scope="row"
                    className="px-1.5 py-2 text-start font-medium text-ink"
                  >
                    {formatCalendarDate(locale, period.dueOn, 'medium')}
                  </th>
                  <td className="px-1.5 py-2">
                    <Link
                      to="/recurring/$seriesId"
                      params={{ seriesId: period.seriesId }}
                      className="rounded-sm text-ink underline-offset-2 outline-focus hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
                    >
                      {period.seriesName}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-2 text-end tabular text-ink">
                    {formatMoney(
                      locale,
                      makeMoney(
                        period.expectedAmountMinor,
                        period.expectedCurrencyCode,
                      ),
                    )}
                  </td>
                  <td className="px-1.5 py-2">
                    <PeriodStatusBadge status={period.derivedStatus} />
                  </td>
                  <td className="px-1.5 py-2">
                    <PeriodActions
                      period={period}
                      seriesName={period.seriesName}
                      compact
                      onMarkPaid={() => onMarkPaid(period)}
                      onSkip={() => onSkip(period)}
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
