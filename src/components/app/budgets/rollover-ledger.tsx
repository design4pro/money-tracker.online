import { Badge } from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatCalendarDateRange, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { BudgetRolloverPolicy } from '#/server/db/schema'
import type { LedgerRow } from '#/server/budgets/summary'

/**
 * The rollover ledger — one row per period, and the reason the table is materialised at all.
 *
 * ## A real `<table>`, with a real `<caption>`
 *
 * Not a grid of `<div>`s and not the RAC `Table`. This is tabular data somebody reads down a
 * column and across a row; it has no sorting, no selection and no cell navigation, so the
 * semantics that matter are the plain ones — a caption naming what the table is, a header row
 * scoped to its columns, and a row header per period. A screen reader then announces
 * *"Carried out, March, 0,00 zł"* on the cell that matters, which is the whole point.
 *
 * ## Every figure carries its currency, and a negative carry says *over*
 *
 * `docs/ACCESSIBILITY.md` §1 again: a `−400,00 zł` painted red is one channel. Here the minus
 * sign is drawn by `formatMoney` (U+2212, from the locale), the negative token tints it, **and**
 * the *Carried out* cell of an absorbed overspend carries an "over by X" annotation in words. A
 * `carry_surplus` budget that overran shows `0,00 zł` in that column — which without the
 * annotation would be indistinguishable from a period that spent exactly its limit, and that is
 * precisely the information the policy must not be allowed to swallow.
 *
 * ## The numbers come from the stored rows
 *
 * `rolloverLedger` computes each row's carry with the same `rolloverOf` the write path applied,
 * over the figures the period actually stores. A row whose *Carried out* does not equal the next
 * row's *Carried in* is therefore a visible bug rather than an invisible one.
 */

export interface RolloverLedgerProps {
  readonly rows: ReadonlyArray<LedgerRow>
  readonly policy: BudgetRolloverPolicy
  readonly currencyCode: string
  readonly className?: string
}

export function RolloverLedger({
  rows,
  currencyCode,
  className,
}: RolloverLedgerProps) {
  const t = useTranslate()
  const locale = useLocale()

  if (rows.length === 0) {
    return (
      <p className={cn('text-body text-ink-2', className)}>
        {t('budgets.ledger.empty')}
      </p>
    )
  }

  const money = (amountMinor: number) =>
    formatMoney(locale, makeMoney(amountMinor, currencyCode))

  return (
    // The table scrolls inside its own container rather than making the page scroll sideways:
    // six money columns do not fit a 360px viewport at a legible size, and shrinking the type to
    // make them fit is the wrong trade on a screen whose content is numbers.
    //
    // A scrollable container has to be a **tab stop**, or a keyboard user with no pointer cannot
    // reach the columns that are off-screen (WCAG 2.1.1, and axe's `scrollable-region-focusable`
    // — which this failed at a phone width before the `tabIndex` was added). A focusable region
    // needs a name and a visible ring, so it carries `role="region"` with the section's own
    // heading text, and `focus-safe` reserves the room that stops its own overflow from cropping
    // that ring.
    <div
      role="region"
      aria-label={t('budgets.ledger.title')}
      tabIndex={0}
      className={cn(
        'overflow-x-auto rounded-md outline-focus focus-safe',
        'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2',
        className,
      )}
    >
      <table className="w-full border-collapse text-label">
        <caption className="pb-3 text-start text-caption text-ink-2">
          {t('budgets.ledger.caption')}
        </caption>
        <thead>
          <tr className="border-b border-border-subtle">
            <th
              scope="col"
              className="px-3 py-2 text-start font-medium text-ink-2"
            >
              {t('budgets.ledger.col.period')}
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-end font-medium text-ink-2"
            >
              {t('budgets.ledger.col.limit')}
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-end font-medium text-ink-2"
            >
              {t('budgets.ledger.col.carriedIn')}
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-end font-medium text-ink-2"
            >
              {t('budgets.ledger.col.spent')}
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-end font-medium text-ink-2"
            >
              {t('budgets.ledger.col.carriedOut')}
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-start font-medium text-ink-2"
            >
              {t('budgets.ledger.col.status')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.periodStart}
              className="border-b border-border-subtle last:border-b-0"
            >
              <th
                scope="row"
                className="whitespace-nowrap px-3 py-2 text-start font-medium text-ink"
              >
                {formatCalendarDateRange(
                  locale,
                  row.periodStart,
                  row.periodEnd,
                  'medium',
                )}
              </th>
              <td className="px-3 py-2 text-end tabular text-ink">
                {money(row.limitMinor)}
              </td>
              <td
                className={cn(
                  'px-3 py-2 text-end tabular',
                  row.carriedInMinor < 0 ? 'text-negative' : 'text-ink',
                )}
              >
                {money(row.carriedInMinor)}
              </td>
              <td className="px-3 py-2 text-end tabular text-ink">
                {money(row.spentMinor)}
              </td>
              <td
                className={cn(
                  'px-3 py-2 text-end tabular',
                  row.carriedOutMinor < 0 ? 'text-negative' : 'text-ink',
                )}
              >
                {money(row.carriedOutMinor)}
                {row.absorbedMinor > 0 ? (
                  // The annotation the `carry_surplus` floor would otherwise hide. Words, not a
                  // colour: a `0,00 zł` here is not the same fact as a period that spent exactly
                  // its limit, and nothing else on the row says which one this is.
                  <span className="ms-1 block text-caption font-medium text-negative">
                    {t('budgets.ledger.overBy', {
                      amount: money(row.absorbedMinor),
                    })}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                <Badge tone={row.closed ? 'neutral' : 'brand'}>
                  {t(
                    row.closed
                      ? 'budgets.status.closed'
                      : 'budgets.status.open',
                  )}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
