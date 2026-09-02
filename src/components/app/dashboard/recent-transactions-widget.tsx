import { EmptyState } from '#/components/ui'
import { DirectionalAmount } from '#/components/app/accounts'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'

import { WidgetLink } from './widget-link'

import type { CurrencyCode } from '#/lib/money'
import type { DashboardTransaction } from './types'

/**
 * The last few things that happened.
 *
 * ## Income and expense are told apart four ways
 *
 * `DirectionalAmount` draws an arrow, the direction as a word, the locale's own minus sign, and
 * only then a tint. Green-against-red carries no information here on its own, which is the point:
 * the rows stay readable in greyscale, in a forced-colours theme, and to a reader with
 * deuteranopia (`docs/ACCESSIBILITY.md` §1).
 *
 * ## The row shows the amount that was entered
 *
 * Not its base-currency equivalent. A person recognises the transaction by the figure they typed;
 * the converted figure is what the totals are built from, and it is stated where a total is.
 *
 * ## The date is a calendar date
 *
 * Formatted in UTC from `YYYY-MM-DD` and never given a timezone — a booked date that shifts by a
 * day because the reader is in Auckland is a bug people never report and never trust again.
 *
 * ## Three columns, and the list owns the tracks
 *
 * The type word and the amount used to flow right against each other, so `Expense` and `Income`
 * started at two different x positions and their arrows did too — six rows of a ragged edge in
 * the middle of the panel, and no column of money to read down. The **list** is the grid now and
 * each row is `grid-cols-subgrid` across it, which is the only arrangement that makes the tracks
 * shared: a per-row grid sizes its own columns and aligns with nothing above it. The two content
 * tracks are `auto`, so they take the widest type word and the widest amount in *this* list, in
 * whatever language and currencies it happens to be in, rather than a hard-coded px width that a
 * Polish label or a seven-figure amount overflows.
 */
export interface RecentTransactionsWidgetProps {
  readonly transactions: ReadonlyArray<DashboardTransaction>
  /** Kept for symmetry with the other widgets; the rows are drawn in their own currency. */
  readonly baseCurrencyCode: CurrencyCode
}

export function RecentTransactionsWidget({
  transactions,
}: RecentTransactionsWidgetProps) {
  const t = useTranslate()
  const locale = useLocale()

  if (transactions.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        title={t('transactions.empty.title')}
        description={t('transactions.empty.body')}
        action={
          <WidgetLink to="/transactions">
            {t('transactions.empty.action')}
          </WidgetLink>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ul
        role="list"
        className="grid list-none grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4"
      >
        {transactions.map((entry) => (
          <li
            key={entry.id}
            className="col-span-full grid grid-cols-subgrid items-baseline border-t border-border-subtle py-2.5 first:border-t-0"
          >
            <div className="min-w-0">
              <p className="truncate text-body text-ink">{entry.title}</p>
              <p className="text-caption text-ink-2">
                {formatCalendarDate(locale, entry.bookedOn)}
              </p>
            </div>
            <DirectionalAmount
              layout="cells"
              locale={locale}
              direction={entry.direction}
              amountMinor={entry.amountMinor}
              currencyCode={entry.currencyCode}
              label={t(
                entry.direction === 'income'
                  ? 'transactions.direction.income'
                  : 'transactions.direction.expense',
              )}
            />
          </li>
        ))}
      </ul>
      <p>
        <WidgetLink to="/transactions">
          {t('dashboard.recent.viewAll')}
        </WidgetLink>
      </p>
    </div>
  )
}
