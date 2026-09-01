import { Link } from '@tanstack/react-router'

import { cn } from '#/lib/cn'
import { useLocale, useTranslate } from '#/lib/i18n'
import { AccountAvatar } from './account-avatar'
import { AccountCategoryBadge, AccountStateBadges } from './account-badges'
import { Amount } from './amount'
import { CreditUtilisation } from './credit-utilisation'

import type { ReactNode } from 'react'
import type { Account } from '#/server/db/types'

/**
 * One account, as the list renders it.
 *
 * ## Two balances, each under its own label
 *
 * A foreign-currency account shows the amount it actually holds **and** what that is worth in
 * the workspace currency, and there is no state in which one appears under the other's label.
 * The base-currency line is only drawn when the two differ, because "1 234,00 zł · in PLN
 * 1 234,00 zł" is noise that teaches a reader to stop looking at the second line.
 *
 * ## Archived is a surface and a badge, never an opacity
 *
 * Dropping a row to 60% opacity reduces the contrast of its text by the same 60%, and this
 * product claims 7:1. So an archived account moves to the sunken surface and wears a badge —
 * both of which survive greyscale, and neither of which makes the name harder to read.
 *
 * ## The whole row is the link, and the menu is still reachable
 *
 * The account name is a real link with a real accessible name, stretched over the card by a
 * pseudo-element so the pointer target is the whole row. The actions trigger sits above that
 * pseudo-element in the stacking order, so it is pressable by pointer and reachable by keyboard
 * as its own stop — the failure mode of every "clickable card" that wraps its own buttons in an
 * anchor.
 */
export interface AccountCardProps {
  account: Account
  /** The workspace base currency, to decide whether the converted line is worth drawing. */
  baseCurrencyCode: string
  /** The row's menu. Supplied by the route, because it performs writes. */
  actions?: ReactNode
}

export function AccountCard({
  account,
  baseCurrencyCode,
  actions,
}: AccountCardProps) {
  const t = useTranslate()
  const locale = useLocale()

  const isArchived = account.status === 'archived'
  const isForeign = account.currencyCode !== baseCurrencyCode

  return (
    <li
      className={cn(
        'relative flex flex-col gap-3 rounded-xl border p-4',
        isArchived
          ? 'border-border-subtle bg-surface-sunken'
          : 'border-border-subtle bg-surface shadow-card',
      )}
    >
      <div className="flex items-start gap-3">
        <AccountAvatar
          name={account.name}
          locale={locale}
          initials={account.logoInitials}
          color={account.logoColor}
        />

        <div className="min-w-0 flex-1">
          <h3 className="text-subtitle font-semibold text-ink">
            <Link
              to="/accounts/$accountId"
              params={{ accountId: account.id }}
              className={cn(
                'rounded-sm outline-focus',
                'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2',
                // Stretches the hit area over the whole card without nesting anything
                // interactive inside the anchor.
                'after:absolute after:inset-0 after:content-[""] after:rounded-xl',
              )}
            >
              {account.name}
            </Link>
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <AccountCategoryBadge category={account.category} />
            <AccountStateBadges
              status={account.status}
              excludeFromStats={account.excludeFromStats}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-start gap-1">
          <div className="text-end">
            <Amount
              locale={locale}
              amountMinor={account.currentBalanceMinor}
              currencyCode={account.currencyCode}
              size="lg"
              tone="value"
            />
            {isForeign ? (
              <p className="mt-0.5 text-caption text-ink-2">
                <span className="me-1">
                  {t('accounts.balance.inBase', {
                    currency: baseCurrencyCode,
                  })}
                </span>
                <Amount
                  locale={locale}
                  amountMinor={account.refCurrentBalanceMinor}
                  currencyCode={baseCurrencyCode}
                  size="sm"
                  tone="value"
                />
              </p>
            ) : null}
          </div>
          {actions ? <div className="relative">{actions}</div> : null}
        </div>
      </div>

      {account.creditLimitMinor === null ? null : (
        <CreditUtilisation
          balanceMinor={account.currentBalanceMinor}
          limitMinor={account.creditLimitMinor}
          currencyCode={account.currencyCode}
        />
      )}
    </li>
  )
}
