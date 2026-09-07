import { Info } from 'lucide-react'

import {
  Button,
  Card,
  Popover,
  PopoverDialog,
  PopoverTrigger,
} from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { Amount } from './amount'
import { owedMinor } from './credit-utilisation'

import type { ReactNode } from 'react'
import type { AccountOverview } from '#/server/repos/accounts'

/**
 * The two figures the accounts screen exists for, plus the one they add up to.
 *
 * ## Three typed lines, not a hero over a pair
 *
 * The card used to open with a micro-uppercase "NET WORTH" over a display-sized figure, with
 * held and owed as two columns on the floor: an eyebrow over a title and a big-number tile, the
 * two idioms the form refuses. It is now a `dl` of three lines - the label at the start of each
 * line, the figure at its end, a rule over each - exactly as the dashboard's header sets Money
 * in, Money out and Difference and its net-worth panel sets these same three. Net worth is the
 * head line, one type step above the two under it; hierarchy is position and size, not a wash
 * or a second surface. A screen reader hears "Net worth, 116 235,77 zł" as one pair rather than
 * two strings that happen to sit near each other.
 *
 * The heading the section is labelled by is visually hidden: the first line already says it,
 * and a visible title over a `dt` with the same words is the eyebrow again by another route.
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
      className="flex flex-col gap-3"
    >
      <h2 id={headingId} className="sr-only">
        {t('accounts.netWorth')}
      </h2>

      <dl className="border-b border-border-subtle">
        <Line label={t('accounts.netWorth')}>
          <Amount
            locale={locale}
            amountMinor={overview.netWorthMinor}
            currencyCode={currency}
            size="lg"
            tone="value"
          />
        </Line>
        <Line label={t('accounts.overview.assets')}>
          <Amount
            locale={locale}
            amountMinor={overview.totalBalanceMinor}
            currencyCode={currency}
            size="md"
          />
        </Line>
        <Line label={t('accounts.overview.liabilities')}>
          {/*
            `owedMinor` is a magnitude, never negative, so there is no sign for `tone="value"`
            to tint. The label carries the direction; the figure carries the size.
          */}
          <Amount
            locale={locale}
            amountMinor={owedMinor(overview.liabilitiesMinor)}
            currencyCode={currency}
            size="md"
          />
        </Line>
      </dl>

      {/*
        The basis sits under the lines it qualifies, and the footnote about what is left out sits
        beside it as a popover rather than two more lines of copy: on a phone those two lines were
        part of why not one account row survived the first viewport. A popover rather than a
        tooltip on purpose - a tooltip opens on hover and focus, which is nothing at all on the
        touch devices this reclaims the space for. `target-min` on the button keeps the 44px hit
        area behind a 32px glyph.
      */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-ink-2">
          {t('accounts.overview.basis', { count: overview.countedAccounts })}
        </p>
        <PopoverTrigger>
          <Button
            variant="ghost"
            size="sm"
            shape="icon"
            className="shrink-0"
            label={t('accounts.overview.excluded.label')}
            icon={<Info aria-hidden="true" />}
          />
          <Popover showArrow placement="bottom end" className="max-w-72">
            <PopoverDialog aria-label={t('accounts.overview.excluded.label')}>
              <p className="text-caption text-ink-2">
                {t('accounts.overview.excluded')}
              </p>
            </PopoverDialog>
          </Popover>
        </PopoverTrigger>
      </div>
    </Card>
  )
}

/**
 * One line of the book: the label at the start, the figure at the end, a rule over it. The card
 * has no visible title, so the first line has no rule over it: a hairline 20px under the card's
 * own edge reads as a stray mark rather than as ruling.
 */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border-subtle py-3 first:border-t-0 first:pt-0">
      <dt className="text-micro tracking-label uppercase text-ink-2">
        {label}
      </dt>
      <dd className="min-w-0 text-end">{children}</dd>
    </div>
  )
}
