import { ArrowDownLeft, ArrowUpRight, Equal } from 'lucide-react'

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
      <p className="text-caption text-ink-2">
        {t('transactions.count', { count: matchCount })}
      </p>

      <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-caption">
        <div className="flex items-center gap-2">
          <dt className="inline-flex items-center gap-1 text-ink-2">
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

        <div className="flex items-center gap-2">
          <dt className="inline-flex items-center gap-1 text-ink-2">
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

        <div className="flex items-center gap-2">
          <dt className="inline-flex items-center gap-1 text-ink-2">
            <Equal aria-hidden="true" className="size-3.5" />
            {t('dashboard.net')}
          </dt>
          <dd>
            <NetAmount
              amountMinor={totals.netMinor}
              currencyCode={totals.currencyCode}
              className="text-label"
            />
          </dd>
        </div>
      </dl>

      <p className="ms-auto text-caption text-ink-2">
        {t('transactions.totals.currency', {
          currency: currencyName(totals.currencyCode, locale),
        })}
      </p>
    </section>
  )
}
