import { Card } from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { Amount } from './amount'
import { owedMinor } from './credit-utilisation'

import type { AccountOverview } from '#/server/repos/accounts'

/**
 * The two figures the accounts screen exists for, plus the one they add up to.
 *
 * ## It is a description list, not a grid of divs
 *
 * Each figure is a `<dt>`/`<dd>` pair, so a screen reader hears "What you hold, 12 480,00 zł"
 * rather than two unrelated strings that happen to sit near each other. The plan asks for this
 * by name and it is the cheapest accessibility win on the page.
 *
 * ## Held and owed are split by category, not by sign
 *
 * The repository does the splitting (`isLiabilityCategory`), and the reason is worth repeating
 * here so nobody "simplifies" it back: classifying by the sign of the balance files an overdrawn
 * current account under debt and a credit card in credit under savings — on exactly the days
 * somebody is looking at those two numbers.
 *
 * ## Nothing is converted in this component
 *
 * Every figure arrives already denominated in the workspace base currency, converted at each
 * transaction's own booked rate. A component that re-converted would produce a total that moves
 * when today's rate moves, which is the defect `ref_amount_minor` exists to prevent.
 */
export interface AccountOverviewCardProps {
  overview: AccountOverview
  /** The id the surrounding `section` is labelled by, so the card can own the heading. */
  headingId: string
}

export function AccountOverviewCard({
  overview,
  headingId,
}: AccountOverviewCardProps) {
  const t = useTranslate()
  const locale = useLocale()
  const currency = overview.baseCurrencyCode

  return (
    <Card
      as="section"
      aria-labelledby={headingId}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2
            id={headingId}
            className="text-micro tracking-label uppercase text-ink-2"
          >
            {t('accounts.netWorth')}
          </h2>
          <p className="mt-1">
            <Amount
              locale={locale}
              amountMinor={overview.netWorthMinor}
              currencyCode={currency}
              size="xl"
              tone="value"
            />
          </p>
        </div>
        <p className="text-caption text-ink-2">
          {t('accounts.overview.basis', { count: overview.countedAccounts })}
        </p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-surface-sunken px-4 py-3">
          <dt className="text-micro tracking-label uppercase text-ink-2">
            {t('accounts.overview.assets')}
          </dt>
          <dd className="mt-1">
            <Amount
              locale={locale}
              amountMinor={overview.totalBalanceMinor}
              currencyCode={currency}
              size="lg"
            />
          </dd>
        </div>
        <div className="rounded-lg bg-surface-sunken px-4 py-3">
          <dt className="text-micro tracking-label uppercase text-ink-2">
            {t('accounts.overview.liabilities')}
          </dt>
          <dd className="mt-1">
            <Amount
              locale={locale}
              amountMinor={owedMinor(overview.liabilitiesMinor)}
              currencyCode={currency}
              size="lg"
              tone="value"
            />
          </dd>
        </div>
      </dl>

      <p className="text-caption text-ink-2">
        {t('accounts.overview.excluded')}
      </p>
    </Card>
  )
}
