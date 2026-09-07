import { EmptyState } from '#/components/ui'
import { Amount, owedMinor } from '#/components/app/accounts'
import { useLocale, useTranslate } from '#/lib/i18n'

import type { ReactNode } from 'react'
import type { CurrencyCode, Minor } from '#/lib/money'

/**
 * What is held, what is owed, and the difference.
 *
 * ## Three typed lines, and the total is the first of them
 *
 * The panel used to open with a hero figure - the net worth at the display step over a small
 * caption - and put the breakdown on the floor of a card stretched to the chart beside it, which
 * left the middle 40% of the card empty at 1280px. The form refuses the big-number-over-small-
 * label tile: a figure is a line of the book with its label at the start and the figure at the
 * end, the way the header sets Money in, Money out and Difference. Net worth is now the head line
 * of the same `dl` as its breakdown, one step larger than the two lines under it, and the panel
 * ends where its last rule ends (`WidgetFrame height="content"`).
 *
 * The caption stays directly under the lines it qualifies: it says what every figure above is
 * counted in, and a caption two blocks away from the number it qualifies is a caption nobody
 * reads.
 *
 * ## The three figures come from the loader, not from this component
 *
 * There is no arithmetic here at all. Held and owed are split by account **category**, not by the
 * sign of a balance - classifying by sign files an overdrawn current account under debt and a
 * credit card in credit under savings, on exactly the days somebody is looking at those numbers.
 * The repository already does that split, and re-deriving it here would give the dashboard and
 * the accounts screen two chances to disagree.
 *
 * ## Nothing is converted here either
 *
 * Every figure arrives in the base currency at the rate stored with each account. A component
 * that re-converted would produce a total that moves when today's rate moves - the defect
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
    <div className="flex flex-col gap-3">
      <dl className="border-b border-border-subtle">
        <Line label={t('accounts.netWorth')}>
          <Amount
            locale={locale}
            amountMinor={netWorthMinor}
            currencyCode={baseCurrencyCode}
            size="lg"
            tone="value"
          />
        </Line>
        <Line label={t('accounts.overview.assets')}>
          <Amount
            locale={locale}
            amountMinor={totalBalanceMinor}
            currencyCode={baseCurrencyCode}
            size="md"
          />
        </Line>
        <Line label={t('accounts.overview.liabilities')}>
          {/*
            The magnitude, not the stored sign: `liabilitiesMinor` is negative while there is
            debt, and under a label that already says *owe* the minus would make the reader
            negate it back.
          */}
          <Amount
            locale={locale}
            amountMinor={owedMinor(liabilitiesMinor)}
            currencyCode={baseCurrencyCode}
            size="md"
          />
        </Line>
      </dl>
      <p className="text-caption text-ink-2">
        {t('dashboard.netWorth.help', { currency: baseCurrencyCode })}
      </p>
    </div>
  )
}

/** One line of the book: the label at the start, the figure at the end, a rule over it. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border-subtle py-3">
      <dt className="text-micro tracking-label uppercase text-ink-2">
        {label}
      </dt>
      <dd className="min-w-0 text-end">{children}</dd>
    </div>
  )
}
