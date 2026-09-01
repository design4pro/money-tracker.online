import { EmptyState } from '#/components/ui'
import { Amount, owedMinor } from '#/components/app/accounts'
import { useLocale, useTranslate } from '#/lib/i18n'

import type { CurrencyCode, Minor } from '#/lib/money'

/**
 * What is held, what is owed, and the difference.
 *
 * ## The three figures come from the loader, not from this component
 *
 * There is no arithmetic here at all. Held and owed are split by account **category**, not by the
 * sign of a balance — classifying by sign files an overdrawn current account under debt and a
 * credit card in credit under savings, on exactly the days somebody is looking at those numbers.
 * The repository already does that split, and re-deriving it here would give the dashboard and
 * the accounts screen two chances to disagree.
 *
 * ## Nothing is converted here either
 *
 * Every figure arrives in the base currency at the rate stored with each account. A component
 * that re-converted would produce a total that moves when today's rate moves — the defect
 * `ref_balance_minor` exists to prevent.
 */
export interface NetWorthWidgetProps {
  readonly baseCurrencyCode: CurrencyCode
  readonly totalBalanceMinor: Minor
  readonly liabilitiesMinor: Minor
  readonly netWorthMinor: Minor
  /** Zero means a workspace with nothing in it, which is a designed state rather than three zeros. */
  readonly accountCount: number
}

export function NetWorthWidget({
  baseCurrencyCode,
  totalBalanceMinor,
  liabilitiesMinor,
  netWorthMinor,
  accountCount,
}: NetWorthWidgetProps) {
  const t = useTranslate()
  const locale = useLocale()

  if (accountCount === 0) {
    return (
      <EmptyState
        headingLevel={3}
        title={t('dashboard.netWorth.empty.title')}
        description={t('dashboard.netWorth.empty.body')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p>
        <Amount
          locale={locale}
          amountMinor={netWorthMinor}
          currencyCode={baseCurrencyCode}
          size="xl"
          tone="value"
        />
      </p>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-surface-sunken px-4 py-3">
          <dt className="text-micro tracking-label uppercase text-ink-2">
            {t('accounts.overview.assets')}
          </dt>
          <dd className="mt-1">
            <Amount
              locale={locale}
              amountMinor={totalBalanceMinor}
              currencyCode={baseCurrencyCode}
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
              amountMinor={owedMinor(liabilitiesMinor)}
              currencyCode={baseCurrencyCode}
            />
          </dd>
        </div>
      </dl>

      <p className="text-caption text-ink-2">
        {t('dashboard.netWorth.help', { currency: baseCurrencyCode })}
      </p>
    </div>
  )
}
