import { Meter } from '#/components/ui'
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
 * ## Three channels, and the colour is the last of them
 *
 * The threshold colours are paired with a **word** (`Within limit` / `Approaching limit` /
 * `Over limit`) and with the meter's own state icon, and the accessible name is the whole
 * sentence — "1 200,00 zł of 5 000,00 zł used, 24%". The percentage is never the only channel
 * and neither is the hue.
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

  const sentence = t('accounts.credit.valueText', {
    used: formatMoney(locale, makeMoney(utilisation.usedMinor, currencyCode)),
    limit: formatMoney(locale, makeMoney(limitMinor, currencyCode)),
    percent: formatPercent(locale, utilisation.fraction),
  })

  return (
    <div className={className}>
      <p className="text-micro tracking-label uppercase text-ink-2">
        {t('accounts.credit.title')}
      </p>
      <Meter
        className="mt-2"
        // The accessible name is the whole sentence: a meter announced as "24%" alone tells a
        // reader nothing about what is being measured or against what.
        label={sentence}
        value={utilisation.fraction}
        minValue={0}
        maxValue={1}
        warnAt={APPROACHING_AT}
        dangerAt={OVER_AT}
        formatOptions={{ style: 'percent', maximumFractionDigits: 0 }}
        caption={
          <>
            <span className="font-semibold text-ink">
              {t(STATE_KEYS[utilisation.state])}
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
