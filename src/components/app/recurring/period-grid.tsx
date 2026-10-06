import { useRef } from 'react'

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

import type { PeriodView } from '#/server/repos/recurring'

/**
 * The period history - one row per period, and the reason it is a real `<table>`.
 *
 * ## A real `<table>`, with a real `<caption>`
 *
 * Not a grid of `<div>`s and not the RAC `Table`. This is tabular data somebody reads down a
 * column and across a row; it has no sorting, no selection and no cell navigation, so the
 * semantics that matter are the plain ones - a caption naming what the table is, a header row
 * scoped to its columns, and a row header per due date. A screen reader then announces
 * *"Status, 1 March, Overdue"* on the cell that matters, which is the whole point.
 *
 * ## The status is a word in its own cell, not a colour on the row
 *
 * `docs/ACCESSIBILITY.md` §1. Tinting an overdue row red and leaving it at that fails a reader who
 * cannot see the tint, a greyscale print and a high-contrast theme that flattens it. Every row
 * carries {@link PeriodStatusBadge}, which prints the derived status in words; the tint is the
 * second channel.
 *
 * ## The difference column says *more* or *less*, in words
 *
 * A settled amount that differs from the expectation is the one thing on this table somebody acts
 * on, and a signed number alone puts the burden of working out which direction it went on the
 * reader. When the settling transaction is in a different currency the cell says so rather than
 * subtracting two figures that do not share a unit - see `periodVarianceMinor`, which returns
 * `null` for exactly that case and for the same reason.
 *
 * ## The actions are real buttons
 *
 * Every row action is a `<button>` in the table, reachable by Tab in reading order, with an
 * accessible name that opens with the visible label and then carries the row's date - *"Mark paid,
 * period due 1 March"*. Three identical *Mark paid* buttons down a column are three identical
 * announcements, which is not a usable list; the date is what tells them apart.
 *
 * ## Focus follows the button that replaces the one pressed
 *
 * A row here stays when it is acted on - Skip turns its buttons into *Undo*, Undo turns them back
 * - so the pressed button is replaced rather than removed, and the browser would still drop focus
 * on `<body>`. {@link useRowFocusRecovery} puts it on the new button of the same row. The route
 * says which period its dialog is open on with `openPeriodStart`, which also covers the
 * `?markPaid=` reopen path that has no trigger to restore to.
 */

export interface PeriodGridProps {
  readonly periods: ReadonlyArray<PeriodView>
  /** The `periodStart` the route's mark-paid dialog is open on, if any. */
  readonly openPeriodStart?: string | null
  /** Opens the link-a-transaction dialog. Supplied by the route, because it performs a write. */
  readonly onMarkPaid: (period: PeriodView) => void
  readonly onSkip: (period: PeriodView) => void
  readonly onRevert: (period: PeriodView) => void
  /** A paused or finished series shows its history without offering to change it. */
  readonly isReadOnly?: boolean
  readonly className?: string
}

/**
 * The difference between what settled and what was expected, or `null`.
 *
 * `null` when nothing has settled, and `null` when the two amounts are in different currencies:
 * subtracting 40 EUR from 180 PLN produces a number with no unit, and a table cell is the last
 * place a unitless money figure should appear. Integer minor units throughout - the same rule
 * `periodVarianceMinor` follows on the server, deliberately duplicated in four lines rather than
 * importing a value out of `#/server` and pulling Drizzle into the browser bundle.
 */
function varianceOf(period: PeriodView): number | null {
  if (period.settledAmountMinor === null) return null
  if (period.settledCurrencyCode !== period.expectedCurrencyCode) return null
  return period.settledAmountMinor - period.expectedAmountMinor
}

const rowKey = (period: PeriodView) => period.periodStart

export function PeriodGrid({
  periods,
  openPeriodStart = null,
  onMarkPaid,
  onSkip,
  onRevert,
  isReadOnly = false,
  className,
}: PeriodGridProps) {
  const t = useTranslate()
  const locale = useLocale()
  const rootRef = useRef<HTMLDivElement>(null)
  const { remember } = useRowFocusRecovery({
    rows: periods,
    rowKey,
    openKey: openPeriodStart,
    rootRef,
  })

  if (periods.length === 0) {
    return (
      <p className={cn('text-body text-ink-2', className)}>
        {t('recurring.periods.empty')}
      </p>
    )
  }

  return (
    // The table scrolls inside its own container rather than making the page scroll sideways: six
    // columns do not fit a 360px viewport at a legible size, and shrinking the type to make them
    // fit is the wrong trade on a screen whose content is numbers.
    //
    // A scrollable container has to be a **tab stop**, or a keyboard user with no pointer cannot
    // reach the columns that are off-screen (WCAG 2.1.1, and axe's `scrollable-region-focusable`).
    // A focusable region needs a name and a visible ring, so it carries `role="region"` with the
    // section's own heading text, and `focus-safe` reserves the room that stops its own overflow
    // from cropping that ring.
    <div
      ref={rootRef}
      role="region"
      aria-label={t('recurring.periods.title')}
      tabIndex={0}
      className={cn(
        'overflow-x-auto rounded-md outline-focus focus-safe',
        'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2',
        className,
      )}
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
          {t('recurring.periods.caption')}
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
                'px-3 py-2 text-start font-medium text-ink-2',
                STACKED_BLOCK,
              )}
            >
              {t('recurring.periods.col.due')}
            </th>
            <th
              role="columnheader"
              scope="col"
              className={cn(
                'px-3 py-2 text-end font-medium text-ink-2',
                STACKED_BLOCK,
              )}
            >
              {t('recurring.periods.col.expected')}
            </th>
            <th
              role="columnheader"
              scope="col"
              className={cn(
                'px-3 py-2 text-end font-medium text-ink-2',
                STACKED_BLOCK,
              )}
            >
              {t('recurring.periods.col.settled')}
            </th>
            <th
              role="columnheader"
              scope="col"
              className={cn(
                'px-3 py-2 text-start font-medium text-ink-2',
                STACKED_BLOCK,
              )}
            >
              {t('recurring.periods.col.variance')}
            </th>
            <th
              role="columnheader"
              scope="col"
              className={cn(
                'px-3 py-2 text-start font-medium text-ink-2',
                STACKED_BLOCK,
              )}
            >
              {t('recurring.periods.col.status')}
            </th>
            {isReadOnly ? null : (
              <th
                role="columnheader"
                scope="col"
                className={cn(
                  'px-3 py-2 text-end font-medium text-ink-2',
                  STACKED_BLOCK,
                )}
              >
                {t('recurring.periods.col.actions')}
              </th>
            )}
          </tr>
        </thead>
        <tbody role="rowgroup" className={STACKED_BLOCK}>
          {periods.map((period) => {
            const due = formatCalendarDate(locale, period.dueOn, 'medium')
            const variance = varianceOf(period)

            return (
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
                    'whitespace-nowrap px-3 py-2 text-start font-medium text-ink',
                    STACKED_ROW_HEADER,
                  )}
                >
                  {due}
                </th>
                <StackedCell
                  label={t('recurring.periods.col.expected')}
                  className="whitespace-nowrap px-3 py-2 text-end tabular text-ink"
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
                  label={t('recurring.periods.col.settled')}
                  className="whitespace-nowrap px-3 py-2 text-end tabular text-ink"
                >
                  {period.settledAmountMinor === null ||
                  period.settledCurrencyCode === null ? (
                    <span className="text-ink-2">
                      {t('recurring.periods.notSettled')}
                    </span>
                  ) : (
                    formatMoney(
                      locale,
                      makeMoney(
                        period.settledAmountMinor,
                        period.settledCurrencyCode,
                      ),
                    )
                  )}
                </StackedCell>
                <StackedCell
                  // Nothing settled, nothing to compare: no label over an empty value.
                  label={
                    period.settledAmountMinor === null
                      ? undefined
                      : t('recurring.periods.col.variance')
                  }
                  className="px-3 py-2 text-caption"
                >
                  <VarianceCell period={period} variance={variance} />
                </StackedCell>
                <StackedCell
                  label={t('recurring.periods.col.status')}
                  className="px-3 py-2"
                >
                  <PeriodStatusBadge status={period.derivedStatus} />
                </StackedCell>
                {isReadOnly ? null : (
                  <td role="cell" className={cn('px-3 py-2', STACKED_BLOCK)}>
                    <PeriodActions
                      period={period}
                      onMarkPaid={() => onMarkPaid(period)}
                      onSkip={() => {
                        remember(rowKey(period))
                        onSkip(period)
                      }}
                      onRevert={() => {
                        remember(rowKey(period))
                        onRevert(period)
                      }}
                    />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** The difference, in words and in sign, or the reason there is not one. */
function VarianceCell({
  period,
  variance,
}: {
  readonly period: PeriodView
  readonly variance: number | null
}) {
  const t = useTranslate()
  const locale = useLocale()

  if (period.settledAmountMinor === null) return null
  if (variance === null) {
    return (
      <span className="text-ink-2">
        {t('recurring.periods.variance.unavailable')}
      </span>
    )
  }
  if (variance === 0) {
    return (
      <span className="text-ink-2">{t('recurring.periods.variance.none')}</span>
    )
  }

  const amount = formatMoney(
    locale,
    makeMoney(Math.abs(variance), period.expectedCurrencyCode),
  )
  // No tint. "More than expected" is bad news on an expense and good news on an income series, and
  // one colour cannot mean both - the words carry the whole message, which is what §1 asks for.
  return (
    <span className="text-ink-2">
      {t(
        variance > 0
          ? 'recurring.periods.variance.over'
          : 'recurring.periods.variance.under',
        { amount },
      )}
    </span>
  )
}
