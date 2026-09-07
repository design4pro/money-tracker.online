import { Link } from '@tanstack/react-router'

import { cn } from '#/lib/cn'
import { useLocale, useTranslate } from '#/lib/i18n'
import { AccountStateBadges } from './account-badges'
import { Amount } from './amount'
import { accountCategoryFacts, isAccountCategory } from './categories'
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
 * ## A row in a table, not a card on a plank
 *
 * The row draws no border, no radius and no shadow of its own: the group's list is one card and
 * this is one line inside it, separated from its neighbours by a single hairline. Three floating
 * sheets with 14px of air between them read as three unrelated objects, which is the opposite of
 * what a list of comparable balances is; the hairline says *same set, next item* and buys back
 * ~40% of the vertical space at the same type sizes.
 *
 * ## Two-line block on the left, one figure on the right
 *
 * The kind of account sits directly under the name, left-aligned to it, at the label step in the
 * secondary ink. It used to hold a column of its own at ~45% of the width, which aligned with
 * nothing on the page and cut the row into three unrelated fragments; under the name it is what
 * it actually is — a qualifier on the name — and the row collapses to a 64px band whose only
 * right-hand element is the amount.
 *
 * The kind is a plain muted label rather than a bordered pill. A full stroked box is a lot of
 * chrome for the least important fact in the row; `Archived` and `Outside reports` keep their
 * badges, because those two change what the row *means* and are meant to interrupt.
 *
 * ## Below 640px the figure takes a line of its own
 *
 * Sharing one line with a fixed-width amount left the name a ~100px measure, so `Konto osobiste`
 * wrapped and the row grew taller than the two-line stack it was avoiding. On a phone the name
 * and the kind own the full width, the amount is right-aligned beneath them, and the actions
 * trigger keeps the row's right edge with its 44px target intact.
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
        // No border, no radius, no shadow: the list around it is the card. The hairline is drawn
        // on the top edge of every row but the first, so the group reads as one object with
        // inset rules rather than as a stack of sheets.
        'relative flex min-h-16 flex-col justify-center gap-3 border-t border-border-subtle px-4 py-3 first:rounded-t-xl first:border-t-0 last:rounded-b-xl',
        // The row no longer floats on a sheet of its own, so the wash is what says *this whole
        // band is one target*. It is a hover affordance only — the link inside still draws the
        // product's one focus ring, and nothing here depends on the wash being seen.
        'transition-colors duration-fast hover:bg-hover',
        // Archived is a surface, never an opacity — see the docblock.
        isArchived && 'bg-surface-sunken',
      )}
    >
      {/*
        One grid, two shapes. Every cell is a single node placed by its column and row start
        rather than rendered twice behind a `hidden`/`sm:block` pair, so there is one element in
        the accessibility tree and one place to change it.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        {/* No initials square before the name: the name identifies the row, and a coloured
            monogram beside every line was a second identity system the form never asked for. */}
        <div className="col-start-1 row-start-1 min-w-0">
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
        </div>

        <div className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {isAccountCategory(account.category) ? (
            <span className="text-label text-ink-2">
              {t(accountCategoryFacts(account.category).labelKey)}
            </span>
          ) : null}
          <AccountStateBadges
            status={account.status}
            excludeFromStats={account.excludeFromStats}
          />
        </div>

        {/*
          Line three on a phone, the right-hand column from 640px up. `justify-self-end` rather
          than a second copy of the node behind a breakpoint.
        */}
        <div className="col-start-1 col-span-2 row-start-3 mt-1 justify-self-end text-end sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:row-span-2 sm:mt-0 sm:self-center">
          <Amount
            locale={locale}
            amountMinor={account.currentBalanceMinor}
            currencyCode={account.currencyCode}
            size="lg"
            tone="value"
          />
          {isForeign ? (
            <p className="mt-0.5 text-caption text-ink-2">
              <span>
                {t('accounts.balance.inBase', {
                  currency: baseCurrencyCode,
                })}
              </span>
              {/* A real separator rather than `me-1`: margin is CSS and CSS is not in
                    the accessibility tree, so the label and the figure ran together as
                    "In PLN24,255.60". The dashboard's accounts panel writes the same pair
                    the same way. */}
              {': '}
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

        {actions ? (
          <div className="relative col-start-2 row-start-1 row-span-2 self-center sm:col-start-3">
            {actions}
          </div>
        ) : null}
      </div>

      {account.creditLimitMinor === null ? null : (
        /* Full content width, and inside this row rather than in an island of its own. A track
           that stops at an arbitrary measure gives 100% no meaning a reader can point at; run to
           the same edge as the amounts above it, the fill's stopping point is readable against
           the card itself. The sentence sits directly above the track, so the figure and the
           mark that draws it are still adjacent. */
        <CreditUtilisation
          balanceMinor={account.currentBalanceMinor}
          limitMinor={account.creditLimitMinor}
          currencyCode={account.currencyCode}
        />
      )}
    </li>
  )
}
