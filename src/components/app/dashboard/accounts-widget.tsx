import { Badge, EmptyState } from '#/components/ui'
import { Amount } from '#/components/app/accounts'
import { useLocale, useTranslate } from '#/lib/i18n'

import { WidgetLink } from './widget-link'

import type { CurrencyCode } from '#/lib/money'
import type { DashboardAccount } from './types'

/**
 * What each account holds, in the currency the account is actually denominated in.
 *
 * ## The account's own currency comes first
 *
 * A euro account says `€1,240.00`, because that is the figure the person's bank shows them. The
 * base-currency equivalent is a second line **under its own label**, and it is drawn only when
 * the two currencies differ — repeating the same number twice teaches a reader to stop looking
 * at the second line.
 *
 * ## The column aligns on the decimal separator, not on its right edge
 *
 * Flush right is not aligned: `zł 72 328,33`, `$7 785,32` and `−zł 1 692,11` put their digits at
 * three different offsets, because the two currency marks are different widths and the minus adds
 * a fourth. `align="decimal"` cuts each figure after its integer digits and reserves a fixed
 * measure for what follows, so the separator lands at one x for every row and the sign hangs to
 * the left of the column instead of pushing the digits sideways.
 *
 * ## "Owed" is a word, not a colour
 *
 * A credit card and a current account are told apart by a badge that says so and by the sign the
 * balance already carries. Both survive greyscale and a forced-colours theme, which a red tint
 * does not (`docs/ACCESSIBILITY.md` §1).
 */
export interface AccountsWidgetProps {
  readonly baseCurrencyCode: CurrencyCode
  readonly accounts: ReadonlyArray<DashboardAccount>
}

export function AccountsWidget({
  baseCurrencyCode,
  accounts,
}: AccountsWidgetProps) {
  const t = useTranslate()
  const locale = useLocale()

  if (accounts.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        title={t('accounts.empty.title')}
        description={t('accounts.empty.body')}
        action={
          <WidgetLink to="/accounts">{t('accounts.empty.action')}</WidgetLink>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ul
        role="list"
        className="flex list-none flex-col divide-y divide-border-subtle"
      >
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex items-start justify-between gap-3 py-2.5"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-body text-ink">
                {account.name}
              </span>
              {account.isLiability ? (
                <Badge size="sm" tone="neutral">
                  {t('dashboard.accounts.owed')}
                </Badge>
              ) : null}
            </div>
            <div className="shrink-0 text-end">
              <Amount
                locale={locale}
                amountMinor={account.balanceMinor}
                currencyCode={account.currencyCode}
                tone="value"
                align="decimal"
              />
              {account.currencyCode === baseCurrencyCode ? null : (
                <span className="mt-0.5 block text-caption text-ink-2">
                  {t('accounts.balance.inBase', { currency: baseCurrencyCode })}
                  {': '}
                  <Amount
                    locale={locale}
                    amountMinor={account.refBalanceMinor}
                    currencyCode={baseCurrencyCode}
                    size="sm"
                  />
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p>
        <WidgetLink to="/accounts">
          {t('dashboard.accounts.viewAll')}
        </WidgetLink>
      </p>
    </div>
  )
}
