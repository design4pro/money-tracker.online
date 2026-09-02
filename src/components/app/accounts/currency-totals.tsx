import { Card } from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { absMinor, sumMinor } from '#/lib/money'
import { Amount } from './amount'

import type { Minor } from '#/lib/money'

/**
 * What the workspace holds, currency by currency, in each currency's own units.
 *
 * ## Why this is not the same information as the overview
 *
 * The overview converts everything to the base currency at each transaction's booked rate, which
 * answers "how much is this worth". This answers a different and equally practical question:
 * "how many euro do I actually have". A person holding PLN, EUR and GBP needs both, and neither
 * can be derived from the other.
 *
 * **Nothing is converted here and nothing may be.** Adding a EUR balance to a PLN balance is
 * meaningless, so the grouping key is the currency and the sum never crosses it — which is also
 * why `sumMinor` is safe to use: every value in a group is already in the same scale.
 */

/** One currency's line. */
export interface CurrencyTotal {
  readonly currencyCode: string
  /** Integer minor units in that currency's own scale. */
  readonly totalMinor: Minor
  readonly accountCount: number
}

/** The subset of an account row this aggregation reads. */
export interface BalanceBearing {
  readonly currencyCode: string
  readonly currentBalanceMinor: Minor
}

/**
 * Groups balances by currency and sums each group.
 *
 * Ordered by the size of the holding rather than alphabetically, so the currency somebody
 * actually lives in is first and the €4 left over from a holiday is last. Ties break on the code
 * so the order is total and a re-render never reshuffles two equal rows.
 */
export function totalsByCurrency(
  accounts: ReadonlyArray<BalanceBearing>,
): ReadonlyArray<CurrencyTotal> {
  const groups = new Map<string, Array<Minor>>()
  for (const account of accounts) {
    const existing = groups.get(account.currencyCode)
    if (existing === undefined) {
      groups.set(account.currencyCode, [account.currentBalanceMinor])
    } else {
      existing.push(account.currentBalanceMinor)
    }
  }

  return [...groups.entries()]
    .map(([currencyCode, values]) => ({
      currencyCode,
      totalMinor: sumMinor(values),
      accountCount: values.length,
    }))
    .sort((left, right) => {
      const bySize = absMinor(right.totalMinor) - absMinor(left.totalMinor)
      return bySize === 0
        ? left.currencyCode.localeCompare(right.currencyCode)
        : bySize
    })
}

export interface CurrencyTotalsCardProps {
  totals: ReadonlyArray<CurrencyTotal>
  headingId: string
}

export function CurrencyTotalsCard({
  totals,
  headingId,
}: CurrencyTotalsCardProps) {
  const t = useTranslate()
  const locale = useLocale()

  return (
    <Card
      as="section"
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
    >
      <div>
        <h2
          id={headingId}
          className="text-micro tracking-label uppercase text-ink-2"
        >
          {t('accounts.byCurrency.title')}
        </h2>
        <p className="mt-1 text-caption text-ink-2">
          {t('accounts.byCurrency.help')}
        </p>
      </div>

      <dl className="flex flex-col">
        {totals.map((total) => (
          <div
            key={total.currencyCode}
            className="flex items-baseline justify-between gap-4 border-b border-border-subtle py-2 last:border-b-0"
          >
            <dt className="min-w-0">
              <span className="text-label font-medium text-ink">
                {total.currencyCode}
              </span>{' '}
              {/* A real space, not only the margin: `ms-2` is CSS, and CSS is not
                  in the accessibility tree — without it a reader hears "PLN3 accounts". */}
              <span className="ms-1 text-caption text-ink-2">
                {t('accounts.count', { count: total.accountCount })}
              </span>
            </dt>
            <dd>
              <Amount
                locale={locale}
                amountMinor={total.totalMinor}
                currencyCode={total.currencyCode}
                tone="value"
              />
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
