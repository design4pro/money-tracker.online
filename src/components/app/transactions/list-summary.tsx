import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'

import { useLocale, useTranslate } from '#/lib/i18n'
import { currencyName } from '#/lib/money'

import { AmountText, NetAmount } from './amount-text'

import type { LedgerTotals } from './types'

/**
 * The figures under the list: income, expense and the difference, over the **whole filtered set**.
 *
 * Two properties this strip has to keep, and both are stated in `07-S2`'s money invariant:
 *
 * - **The totals are not the page.** They come from a SQL `SUM` over everything the filters match,
 *   not from adding up what is on screen. A footer that changes every time somebody scrolls is
 *   worse than no footer.
 * - **The total names its currency.** Every figure here is the sum of `ref_amount_minor`, which is
 *   denominated in the workspace base currency whatever the rows themselves are in. A mixed-currency
 *   set has exactly one honest total and it is this one — so the strip says which currency it is in,
 *   in words, rather than leaving a bare number for the reader to guess at.
 *
 * ## One of these four is the answer
 *
 * The strip used to set the row count, money in, money out and the difference at one size and one
 * weight, which made "600 transactions" exactly as loud as the only figure anybody filters a ledger
 * to find out. The difference now leads at `subtitle`, in the primary ink, under a `micro` label;
 * money in and money out follow at `label` in their own hues; the count drops to `caption` in the
 * muted ink and sits at the far left as the metadata it is.
 */

export interface ListSummaryProps {
  readonly totals: LedgerTotals
  /** How many rows match, over the whole filtered set. */
  readonly matchCount: number
}

export function ListSummary({ totals, matchCount }: ListSummaryProps) {
  const t = useTranslate()
  const locale = useLocale()

  return (
    <section
      aria-label={t('transactions.totals.label')}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3"
    >
      {/* On a phone the count and the currency note share the top line rather than taking one
          each — `sm:contents` dissolves the wrapper from `sm` up, so the strip is a single row of
          five items on a wide screen and two tidy lines on a narrow one. */}
      <div className="flex w-full items-baseline justify-between gap-3 sm:contents">
        <p className="text-caption text-ink-2">
          {t('transactions.count', { count: matchCount })}
        </p>
        <p className="text-caption text-ink-2 sm:order-last sm:ms-auto">
          {t('transactions.totals.currency', {
            currency: currencyName(totals.currencyCode, locale),
          })}
        </p>
      </div>

      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div className="flex flex-col">
          <dt className="text-micro tracking-label uppercase text-ink-2">
            {t('dashboard.net')}
          </dt>
          <dd>
            <NetAmount
              amountMinor={totals.netMinor}
              currencyCode={totals.currencyCode}
              className="text-subtitle font-semibold"
            />
          </dd>
        </div>

        <div className="flex items-baseline gap-2">
          {/* The arrow is on the label, never on the figure: it says which way this row of the
              strip runs without giving the numbers beside it two left edges. */}
          <dt className="inline-flex items-center gap-1 text-caption text-ink-2">
            <ArrowDownLeft aria-hidden="true" className="size-3.5" />
            {t('dashboard.income')}
          </dt>
          <dd>
            <AmountText
              hideGlyph
              amountMinor={totals.incomeMinor}
              currencyCode={totals.currencyCode}
              direction="income"
              className="text-label"
            />
          </dd>
        </div>

        <div className="flex items-baseline gap-2">
          <dt className="inline-flex items-center gap-1 text-caption text-ink-2">
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
            {t('dashboard.expenses')}
          </dt>
          <dd>
            <AmountText
              hideGlyph
              amountMinor={totals.expenseMinor}
              currencyCode={totals.currencyCode}
              direction="expense"
              className="text-label"
            />
          </dd>
        </div>
      </dl>
    </section>
  )
}
