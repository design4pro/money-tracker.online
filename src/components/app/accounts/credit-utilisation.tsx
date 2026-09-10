import { AlertTriangle, TrendingUp } from 'lucide-react'

import { Meter, rowWashSecondary } from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatPercent, useLocale, useTranslate } from '#/lib/i18n'
import {
  ZERO_MINOR,
  absMinor,
  formatMoney,
  makeMoney,
  ratioOfMinor,
  subtractMinor,
} from '#/lib/money'

import type { Minor } from '#/lib/money'

/**
 * How much of a credit limit is gone.
 *
 * ## The one invariant this component is about
 *
 * **Utilisation is computed in the account's own currency, from integers.** A card with a
 * 5 000 EUR limit and 1 200 EUR drawn is at 24% today, was at 24% yesterday, and will be at 24%
 * tomorrow. Converting either figure to the workspace base first and dividing produces a
 * percentage that moves when the exchange rate moves, which is absurd for a credit card and is
 * the reason `ref_credit_limit_minor` is never touched on this path.
 *
 * The division itself is `ratioOfMinor`, which the money module marks display-only: the result
 * is a float, it drives a bar's width and a label, and it is never multiplied back into an
 * amount.
 *
 * ## One line, and each fact stated once
 *
 * Everything the block has to say sits on a single 12px line at the bar's origin, directly above
 * the track: *how much of how much · what share that is · what is left*. It used to say the same
 * thing three times in three registers — the sentence, a percentage set flush right a row-width
 * away from the fill that encodes it, and a verdict underneath — and the one number the bar
 * exists to communicate was the one orphaned furthest from it.
 *
 * ## Green is not the colour of debt
 *
 * The fill is `tone="neutral"`: the foreground token while the balance is within its limit, amber
 * from 80%, negative past 100%. Credit drawn is not an achievement, and the palette's only
 * positive colour is worth more held back for a figure that is actually good news.
 *
 * ## Three channels, and the colour is the last of them
 *
 * A colour change is always a word change too. Within the limit the line is figures only; at 80%
 * a warning triangle and **Approaching limit** join it, past 100% a rising arrow and **Over
 * limit**. So the amber and the negative are reinforcement for readers who can see them, never
 * the channel the meaning travels on — and the accessible name carries the same verdict in the
 * same order, "Approaching limit · 4 000,00 zł of 5 000,00 zł used, 80%".
 *
 * ## Over the limit
 *
 * The bar caps at full, because a bar that overflows its track says nothing a full bar does not.
 * The sentence does not cap: it reports the real figures and the real percentage, so 130% reads
 * as 130% even while the bar reads as full.
 */

/** Where a balance sits against its limit. */
export type UtilisationState = 'within' | 'approaching' | 'over'

export interface Utilisation {
  /** What is drawn, always positive. A card in credit draws nothing. */
  readonly usedMinor: Minor
  /** Limit less drawn. Negative once the limit is passed. */
  readonly availableMinor: Minor
  /** `used / limit`, for display only. */
  readonly fraction: number
  readonly state: UtilisationState
}

/** The amber and the negative thresholds, stated once. */
const APPROACHING_AT = 0.8
const OVER_AT = 1

/**
 * What a signed liability balance means under a *"what you owe"* label.
 *
 * `AccountOverview.liabilitiesMinor` is documented as "a signed sum — negative while there is
 * debt", which is the sign `netWorth = held + liabilities` needs. It is **not** the number to print
 * under a heading that already says "owe": a card carrying 889,46 zł of debt rendered as
 * `−889,46 zł` beside *Ile jesteś winien* is a double negative, and a reader has to do the
 * arithmetic twice to get back to what they actually owe.
 *
 * So the label carries the direction and this carries the magnitude — and, for the case that makes
 * a plain `abs()` a lie, a workspace whose liability accounts are collectively **in credit** owes
 * nothing, and this answers zero rather than restating the credit as a debt. That is the same rule
 * {@link creditUtilisation} applies one account at a time, written once.
 */
export function owedMinor(liabilitiesMinor: Minor): Minor {
  return liabilitiesMinor < 0 ? absMinor(liabilitiesMinor) : ZERO_MINOR
}

/**
 * Reads a limit and a balance into the four display facts.
 *
 * `balanceMinor` is signed the way the ledger stores it: negative is money owed. Anything at or
 * above zero has drawn nothing, which is the correct reading of a card that has been overpaid.
 * `null` when there is no limit — a share of nothing is not 0% and not 100%.
 */
export function creditUtilisation(
  balanceMinor: Minor,
  limitMinor: Minor | null,
): Utilisation | null {
  if (limitMinor === null || limitMinor <= 0) {
    return null
  }
  const usedMinor = balanceMinor < 0 ? absMinor(balanceMinor) : ZERO_MINOR
  const fraction = ratioOfMinor(usedMinor, limitMinor)
  if (fraction === null) {
    return null
  }

  let state: UtilisationState = 'within'
  if (fraction >= OVER_AT) {
    state = 'over'
  } else if (fraction >= APPROACHING_AT) {
    state = 'approaching'
  }

  return {
    usedMinor,
    availableMinor: subtractMinor(limitMinor, usedMinor),
    fraction,
    state,
  }
}

const STATE_KEYS = {
  within: 'accounts.credit.within',
  approaching: 'accounts.credit.approaching',
  over: 'accounts.credit.over',
} as const

/**
 * The glyph that rides with each verdict.
 *
 * `within` deliberately has none: it is the resting state, and a tick beside every ordinary card
 * is a congratulation nobody asked for. What matters for §1.4.1 is that the two states which
 * *change* the fill colour also change what is written — an icon appears and a word appears with
 * it — so the escalation survives greyscale and forced colours.
 */
const STATE_ICONS = {
  within: null,
  approaching: AlertTriangle,
  over: TrendingUp,
} as const

export interface CreditUtilisationProps {
  balanceMinor: Minor
  limitMinor: Minor | null
  /** The account's own currency. Never the workspace base. */
  currencyCode: string
  className?: string
}

export function CreditUtilisation({
  balanceMinor,
  limitMinor,
  currencyCode,
  className,
}: CreditUtilisationProps) {
  const t = useTranslate()
  const locale = useLocale()

  const utilisation = creditUtilisation(balanceMinor, limitMinor)
  if (utilisation === null || limitMinor === null) {
    return <p className="text-body text-ink-2">{t('accounts.credit.none')}</p>
  }

  const used = formatMoney(
    locale,
    makeMoney(utilisation.usedMinor, currencyCode),
  )
  const limit = formatMoney(locale, makeMoney(limitMinor, currencyCode))
  const percent = formatPercent(locale, utilisation.fraction)
  const verdict = t(STATE_KEYS[utilisation.state])
  const StateIcon = STATE_ICONS[utilisation.state]

  const sentence = t('accounts.credit.valueText', { used, limit, percent })
  /**
   * The verdict goes in **front** of the sentence rather than after it. A reader who has to act
   * hears "Over limit" first, and the sentence keeps its shape — which is also what
   * `e2e/accessibility.spec.ts` asserts the name ends with.
   */
  const accessibleName =
    utilisation.state === 'within' ? sentence : `${verdict} · ${sentence}`

  return (
    <div className={className}>
      {/* Inside the account row, so on a washed ground under the pointer — see `rowWash`. */}
      <p
        className={cn('text-micro tracking-label uppercase', rowWashSecondary)}
      >
        {t('accounts.credit.title')}
      </p>
      <Meter
        // `gap-2` puts 8px of clearance between the sentence and the track it describes, and the
        // track runs the full width of the row so the fill's stopping point is read against the
        // card's own edge rather than against an arbitrary measure.
        className="mt-2 gap-2"
        // The accessible name is the whole sentence: a meter announced as "24%" alone tells a
        // reader nothing about what is being measured or against what. It is `aria-label` rather
        // than a visible `<Label>` because the caption below already writes it out — two visible
        // copies of one sentence is the defect this block was rebuilt to remove.
        aria-label={accessibleName}
        showValue={false}
        tone="neutral"
        captionPlacement="above"
        value={utilisation.fraction}
        minValue={0}
        maxValue={1}
        warnAt={APPROACHING_AT}
        dangerAt={OVER_AT}
        formatOptions={{ style: 'percent', maximumFractionDigits: 0 }}
        caption={
          <>
            {StateIcon === null ? null : (
              <span
                className={cn(
                  'me-1 inline-flex items-center gap-1 font-semibold',
                  utilisation.state === 'over'
                    ? 'text-negative'
                    : 'text-warning',
                )}
              >
                <StateIcon aria-hidden="true" className="size-3.5 shrink-0" />
                {verdict}
                {' ·'}
              </span>
            )}
            {t('accounts.credit.ofLimit', { used, limit })}
            {' · '}
            <span className="font-semibold text-ink">
              {t('accounts.credit.percentUsed', { percent })}
            </span>
            {' · '}
            {t('accounts.credit.available', {
              amount: formatMoney(
                locale,
                makeMoney(utilisation.availableMinor, currencyCode),
              ),
            })}
          </>
        }
      />
    </div>
  )
}
