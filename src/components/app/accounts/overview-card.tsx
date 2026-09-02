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
 * ## One hero, and it is twice the mass of anything beside it
 *
 * Net worth is the display step; held and owed are the subtitle step in the secondary ink. They
 * used to be one step apart, and because *what you hold* is numerically the larger figure it won
 * the first fixation on a card whose entire subject is the number above it. Hierarchy here is
 * size, weight and colour together — three channels, all of which survive a greyscale print.
 *
 * ## No card inside the card
 *
 * Held and owed are two columns divided by a hairline, not two filled tiles at the parent's own
 * radius. A rounded box nested in a rounded box at the same radius reads as a component wrapped
 * in itself; the card keeps its radius and is the only rounded box in the block. Side by side at
 * every width, which is also what keeps the first account row on the accounts page above the
 * fold on a phone.
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
      // `h-full` + `mt-auto` on the pair below: the grid stretches this card to the height of
      // the currency card beside it, and without a rule for where the extra height goes it all
      // collected under the last line as orphaned padding. Now the hero sits at the top and the
      // hold/owe pair sits on the floor, so the space between them is deliberate.
      className="flex h-full flex-col gap-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
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
              size="2xl"
              tone="value"
            />
          </p>
          <p className="mt-1 text-caption text-ink-2">
            {t('accounts.overview.basis', { count: overview.countedAccounts })}
          </p>
        </div>

        {/*
          The footnote about what is left out used to be a two-line paragraph at the foot of the
          card, and on a phone those two lines were part of why not one account row survived the
          first viewport. It is a popover rather than a tooltip on purpose: a tooltip opens on
          hover and focus, which is nothing at all on the touch devices this reclaims the space
          for. `target-min` on the button keeps the 44px hit area behind a 32px glyph.
        */}
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

      <dl className="mt-auto grid grid-cols-2">
        <div className="min-w-0 pe-4 sm:pe-6">
          <dt className="text-micro tracking-label uppercase text-ink-2">
            {t('accounts.overview.assets')}
          </dt>
          <dd className="mt-1">
            <Amount
              locale={locale}
              amountMinor={overview.totalBalanceMinor}
              currencyCode={currency}
              size="lg"
              className="font-medium text-ink-2"
            />
          </dd>
        </div>
        <div className="min-w-0 border-s border-border-subtle ps-4 sm:ps-6">
          <dt className="text-micro tracking-label uppercase text-ink-2">
            {t('accounts.overview.liabilities')}
          </dt>
          <dd className="mt-1">
            {/*
              `owedMinor` is a magnitude, never negative, so there is no sign for `tone="value"`
              to tint. The label carries the direction; the figure carries the size.
            */}
            <Amount
              locale={locale}
              amountMinor={owedMinor(overview.liabilitiesMinor)}
              currencyCode={currency}
              size="lg"
              className="font-medium text-ink-2"
            />
          </dd>
        </div>
      </dl>
    </Card>
  )
}
