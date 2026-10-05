import { useId, useRef } from 'react'
import { Link } from '@tanstack/react-router'

import {
  PeriodActions,
  PeriodStatusBadge,
  ROW_KEY_ATTRIBUTE,
  useRowFocusRecovery,
} from '#/components/app/recurring'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, money } from '#/lib/money'

import { AmountText } from './amount-text'
import { expectedTotals } from './expectation-totals'
import { hasExpectationContent } from './types'

import type {
  ExpectationGroup as ExpectationGroupModel,
  ExpectationRow,
} from './types'

/**
 * The recurring payments that have not settled yet, drawn above the planned transactions.
 *
 * ## A group, never a total
 *
 * An expected payment is a plan: it has no reference amount and no rate until it settles
 * (`ExpectationRow`), and nothing here is added to the ledger's totals. The group says so in words
 * ({@link ExpectationGroupProps}'s hint line), writes each amount in the series' own currency and
 * sets its own per-currency figures under the table, labelled as expectations.
 *
 * ## Its own table, not rows of the ledger grid
 *
 * The ledger is a virtualised `role="grid"` with one tab stop and arrow-key navigation. This group
 * holds at most fifty rows, never pages, never selects, and each row has two real buttons that
 * must be reachable by Tab without hover. Putting those into the grid would either break its
 * one-tab-stop pattern or need a second column model in its keyboard code, so the group is a plain
 * captioned `<table>` under its own heading, outside the grid. Native semantics carry the rest: a
 * header row, the series name as the row header, and the status as a word beside its colour.
 *
 * ## Three states besides "some rows"
 *
 * A group that was **suppressed** (a filter with nothing to narrow it by is active) or **failed**
 * (the read threw while the ledger beside it succeeded) says so in one line instead of showing
 * nothing, and a group that was **capped** keeps its notice even when the filters left no row of
 * the fifty to show, so an empty group never reads as "nothing matches anywhere".
 *
 * Below `sm` a row is a small grid of its own (name and amount, then due date and status, then the
 * actions), because five table columns do not fit a phone without scrolling sideways. The explicit
 * roles keep the table semantics when the display is overridden.
 */

export interface ExpectationGroupProps {
  readonly group: ExpectationGroupModel
  /** The row the route's mark-paid dialog is open on, if any. */
  readonly openRowId?: string | null
  /** Opens the link-a-transaction dialog. The route owns it, because it performs a write. */
  readonly onMarkPaid: (row: ExpectationRow) => void
  readonly onSkip: (row: ExpectationRow) => void
}

const HEAD_CELL =
  'px-2 py-2 text-start text-caption font-medium text-ink-2 sm:px-3'
const CELL = 'px-2 py-2 sm:px-3'

function Notice({ children }: { readonly children: string }) {
  return <p className="text-caption text-ink-2">{children}</p>
}

export function ExpectationGroupView({
  group,
  openRowId = null,
  onMarkPaid,
  onSkip,
}: ExpectationGroupProps) {
  const t = useTranslate()
  const locale = useLocale()
  const headingId = useId()
  const rootRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const rows = group.state === 'shown' ? group.rows : []
  const { remember } = useRowFocusRecovery({
    rows,
    rowKey: (row: ExpectationRow) => row.id,
    openKey: openRowId,
    rootRef,
    fallbackRef: headingRef,
  })

  if (group.state === 'suppressed') {
    return <Notice>{t('transactions.planned.expected.suppressed')}</Notice>
  }
  if (group.state === 'failed') {
    return <Notice>{t('transactions.planned.expected.failed')}</Notice>
  }
  if (!hasExpectationContent(group)) {
    return null
  }

  const totals = expectedTotals(group.rows)

  return (
    <section
      ref={rootRef}
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-sunken p-3 sm:p-4"
    >
      <div className="flex flex-col gap-0.5">
        <h2
          id={headingId}
          ref={headingRef}
          // Focusable by script only: it is where focus lands when the last row is settled.
          tabIndex={-1}
          className="rounded-sm text-label font-semibold text-ink outline-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
        >
          {t('transactions.planned.expected.group', {
            count: group.withinDays,
          })}
        </h2>
        <p className="text-caption text-ink-2">
          {t('transactions.planned.expected.hint')}
        </p>
      </div>

      {group.rows.length === 0 ? null : (
        <table
          role="table"
          aria-labelledby={headingId}
          className="w-full max-sm:block"
        >
          <thead role="rowgroup" className="max-sm:sr-only">
            <tr
              role="row"
              className="shadow-[inset_0_-1px_0_0_var(--color-border-panel)]"
            >
              <th role="columnheader" scope="col" className={HEAD_CELL}>
                {t('recurring.form.name')}
              </th>
              <th role="columnheader" scope="col" className={HEAD_CELL}>
                {t('recurring.periods.col.due')}
              </th>
              <th role="columnheader" scope="col" className={HEAD_CELL}>
                {t('recurring.periods.col.status')}
              </th>
              <th
                role="columnheader"
                scope="col"
                className={cn(HEAD_CELL, 'text-end')}
              >
                {t('transactions.planned.expected')}
              </th>
              <th
                role="columnheader"
                scope="col"
                className={cn(HEAD_CELL, 'text-end')}
              >
                {t('recurring.periods.col.actions')}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="max-sm:block">
            {group.rows.map((row) => (
              <tr
                key={row.id}
                role="row"
                {...{ [ROW_KEY_ATTRIBUTE]: row.id }}
                className="shadow-[inset_0_-1px_0_0_var(--color-border-subtle)] last:shadow-none max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-3"
              >
                <th
                  role="rowheader"
                  scope="row"
                  className={cn(
                    CELL,
                    'text-start font-medium text-ink max-sm:col-start-1 max-sm:row-start-1',
                  )}
                >
                  <Link
                    to="/recurring/$seriesId"
                    params={{ seriesId: row.seriesId }}
                    className="inline-flex target-min-h items-center rounded-sm underline-offset-2 outline-focus hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
                  >
                    {row.seriesName}
                  </Link>
                </th>
                <td
                  role="cell"
                  className={cn(
                    CELL,
                    'text-label text-ink max-sm:col-start-1 max-sm:row-start-2',
                  )}
                >
                  {formatCalendarDate(locale, row.dueOn, 'medium')}
                </td>
                <td
                  role="cell"
                  className={cn(
                    CELL,
                    'max-sm:col-start-2 max-sm:row-start-2 max-sm:justify-self-end',
                  )}
                >
                  <PeriodStatusBadge status={row.status} />
                </td>
                <td
                  role="cell"
                  className={cn(
                    CELL,
                    'text-end text-label max-sm:col-start-2 max-sm:row-start-1',
                  )}
                >
                  <AmountText
                    hideGlyph
                    isPlanned
                    amountMinor={row.expectedAmountMinor}
                    currencyCode={row.currencyCode}
                    direction={row.direction}
                  />
                </td>
                <td
                  role="cell"
                  className={cn(CELL, 'max-sm:col-span-2 max-sm:row-start-3')}
                >
                  <PeriodActions
                    period={{ dueOn: row.dueOn, derivedStatus: row.status }}
                    seriesName={row.seriesName}
                    onMarkPaid={() => onMarkPaid(row)}
                    onSkip={() => {
                      remember(row.id)
                      onSkip(row)
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totals.length === 0 ? null : (
        <div
          role="group"
          aria-label={t('transactions.planned.expected.totals')}
          className="flex flex-col gap-1 border-t border-border-subtle pt-2 text-caption text-ink-2"
        >
          {totals.map((line) => (
            <dl
              key={line.currencyCode}
              className="flex flex-wrap gap-x-4 gap-y-0.5"
            >
              <div className="flex items-baseline gap-1.5">
                <dt>{t('transactions.planned.expected.in')}</dt>
                <dd className="tabular text-ink">
                  {formatMoney(locale, money(line.inMinor, line.currencyCode), {
                    display: 'narrowSymbol',
                  })}
                </dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt>{t('transactions.planned.expected.out')}</dt>
                <dd className="tabular text-ink">
                  {formatMoney(
                    locale,
                    money(line.outMinor, line.currencyCode),
                    {
                      display: 'narrowSymbol',
                    },
                  )}
                </dd>
              </div>
            </dl>
          ))}
        </div>
      )}

      {group.isCapped ? (
        <p className="text-caption text-ink-2">
          <Link
            to="/recurring"
            className="rounded-sm underline underline-offset-2 outline-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
          >
            {t('transactions.planned.expected.capped', { count: group.limit })}
          </Link>
        </p>
      ) : null}
    </section>
  )
}
