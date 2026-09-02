import { EmptyState } from '#/components/ui'
import { Amount, owedMinor } from '#/components/app/accounts'
import { useLocale, useTranslate } from '#/lib/i18n'

import type { CurrencyCode, Minor } from '#/lib/money'

/**
 * What is held, what is owed, and the difference.
 *
 * ## One hero at the top, the pair on the floor, and no card inside the card
 *
 * The panel is stretched to its row rather than ending where its text ends — a grid cell that
 * stops 150px short of the one beside it reads as a panel that failed to load, not as breathing
 * room. `h-full` plus `mt-auto` on the pair is where the recovered height goes: the figure the
 * card is about sits at the top with its own meta line, the pair sits on the floor, and the space
 * between them is composed instead of pooled under the last line.
 *
 * The pair carries **no second surface colour**. It used to be two `surface-sunken` tiles inside a
 * white card on a warm-grey page — three greys inside one 250px column, and a rounded box nested
 * in a rounded box at almost the parent's radius, which reads as a component wrapped in itself.
 * Nesting is expressed by a hairline rule and by spacing, which is what `AccountOverviewCard`
 * already does with the same two figures; the two surfaces now state the same thing the same way.
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
    <div className="flex h-full flex-col gap-6">
      {/* `my-auto`, not a top-aligned block: the panel is stretched to a row set by a 220px chart
          beside it, and pooling all of that slack under the last line is the empty floor a reader
          reads as a panel that failed to load. Split above and below the hero it becomes optical
          centring — the figure the card is about sits in the middle of its own space, with the
          breakdown anchored on the floor. */}
      <div className="my-auto min-w-0">
        <p>
          <Amount
            locale={locale}
            amountMinor={netWorthMinor}
            currencyCode={baseCurrencyCode}
            size="2xl"
            tone="value"
          />
        </p>
        {/* The meta line belongs to the hero, directly under it, rather than at the foot of the
            card: it says what the figure above is counted in, and a caption two blocks away from
            the number it qualifies is a caption nobody reads. */}
        <p className="mt-1 text-caption text-ink-2">
          {t('dashboard.netWorth.help', { currency: baseCurrencyCode })}
        </p>
      </div>

      {/*
        A rule and 12px of space, not a fill. The pair is stacked rather than set side by side
        because this column is a third of the grid: two figures sharing ~120px each wrap the
        moment somebody's net worth passes six digits, and a wrapped money figure is worse than a
        second row. Stacked, each figure gets the full measure and the two amounts land in one
        right-aligned column that the eye can read down — the same treatment the accounts and
        transactions lists get.
      */}
      <dl className="flex flex-col">
        <div className="flex items-baseline justify-between gap-4 border-t border-border-subtle py-4">
          <dt className="text-micro tracking-label uppercase text-ink-2">
            {t('accounts.overview.assets')}
          </dt>
          <dd className="min-w-0">
            <Amount
              locale={locale}
              amountMinor={totalBalanceMinor}
              currencyCode={baseCurrencyCode}
              size="lg"
              align="decimal"
            />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-border-subtle pt-4">
          <dt className="text-micro tracking-label uppercase text-ink-2">
            {t('accounts.overview.liabilities')}
          </dt>
          <dd className="min-w-0">
            <Amount
              locale={locale}
              amountMinor={owedMinor(liabilitiesMinor)}
              currencyCode={baseCurrencyCode}
              size="lg"
              align="decimal"
            />
          </dd>
        </div>
      </dl>
    </div>
  )
}
