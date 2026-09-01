import { minorUnitScaleBig } from './currencies'
import { divideHalfEven, scaleDecimalString } from './rounding'
import {
  InvalidRateError,
  MoneyError,
  RATE_IDENTITY,
  RATE_SCALE_E10,
  RATE_SCALE_E10_BIG,
  asRateE10,
  minorFromBigInt,
} from './types'

import type { ConvertedMoney, CurrencyCode, Money, RateE10 } from './types'

/**
 * Currency conversion, and the fixed-point rate it runs on.
 *
 * **A rate is an integer scaled by 10^10**, never a float. `1 EUR = 4.3218 PLN`
 * is `43_218_000_000`. The reference product this one replaces stored rates as
 * `FLOAT`, which meant two conversions of the same amount at the same rate
 * could disagree by a minor unit depending on which row the value had passed
 * through — and a report built on that never reconciles with its own rows.
 *
 * **A conversion carries its rate.** `convert` returns the rate and the source
 * amount alongside the result, which is exactly the triple the `transactions`
 * table stores (`amount_minor`/`currency_code`, `ref_amount_minor`/
 * `ref_currency_code`, `rate_e10`). `ref_amount_minor` is a **historical**
 * value: it is computed once at `booked_on`'s rate and never recomputed, so a
 * March expense stays counted at March's rate however the market moves after.
 *
 * The arithmetic is
 *
 * ```
 *   result = round½even( amount × rate × 10^toDigits ,  10^10 × 10^fromDigits )
 * ```
 *
 * which is why `digits` has to be in it: 1.00 EUR at 160.5 is 160 JPY (no minor
 * unit at all), and 1.000 KWD at 3.27 is 3.27 EUR across three digits and two.
 */

/** A conversion was asked for that cannot be made. */
export class ConversionError extends MoneyError {
  constructor(message: string) {
    super(message)
    this.name = 'ConversionError'
  }
}

/** What `convert` needs to know. */
export interface ConversionInput {
  /** The amount as it was recorded, in its own currency. */
  readonly amount: Money
  /** The currency to express it in — usually the workspace base currency. */
  readonly to: CurrencyCode
  /**
   * Units of `to` per unit of `amount.currencyCode`, scaled by 10^10, as
   * `exchange_rates.rate_e10` stores it.
   */
  readonly rateE10: RateE10
}

/**
 * Converts an amount and hands back the result together with the rate that
 * produced it.
 *
 * A conversion into the currency the amount is already in is the identity: the
 * rate must be exactly 1, because anything else is a caller that has looked up
 * the wrong row and would otherwise silently restate a balance.
 */
export function convert(input: ConversionInput): ConvertedMoney {
  const { amount, to, rateE10 } = input
  if (!Number.isSafeInteger(rateE10) || rateE10 <= 0) {
    throw new InvalidRateError(rateE10)
  }

  if (amount.currencyCode === to) {
    if (rateE10 !== RATE_SCALE_E10) {
      throw new ConversionError(
        `A ${to} amount converted to ${to} must use a rate of 1, got ${rateE10 / RATE_SCALE_E10}`,
      )
    }
    return { ...amount, rateE10, source: amount }
  }

  const numerator =
    BigInt(amount.amountMinor) * BigInt(rateE10) * minorUnitScaleBig(to)
  const denominator =
    RATE_SCALE_E10_BIG * minorUnitScaleBig(amount.currencyCode)

  return {
    amountMinor: minorFromBigInt(divideHalfEven(numerator, denominator)),
    currencyCode: to,
    rateE10,
    source: amount,
  }
}

/**
 * The rate for the opposite direction.
 *
 * Inversion is lossy — `1 / 3` has no exact decimal — so a stored rate is
 * always preferred over an inverted one. This exists for the display line
 * ("1 PLN = 0.2314 EUR") and for the FX provider that publishes only one
 * direction of a pair.
 */
export function invertRateE10(rateE10: RateE10): RateE10 {
  if (!Number.isSafeInteger(rateE10) || rateE10 <= 0) {
    throw new InvalidRateError(rateE10)
  }
  const inverted = divideHalfEven(
    RATE_SCALE_E10_BIG * RATE_SCALE_E10_BIG,
    BigInt(rateE10),
  )
  if (inverted <= 0n) {
    throw new InvalidRateError(rateE10)
  }
  return asRateE10(Number(inverted))
}

/**
 * Chains two rates: A→B composed with B→C gives A→C.
 *
 * The FX provider publishes everything against one base, so a PLN→CZK figure is
 * PLN→EUR composed with EUR→CZK. Composing rounds once, which is why the two
 * steps are combined here rather than by converting through an intermediate
 * amount — that would round twice and lose a minor unit on ordinary sums.
 */
export function composeRateE10(first: RateE10, second: RateE10): RateE10 {
  if (!Number.isSafeInteger(first) || first <= 0) {
    throw new InvalidRateError(first)
  }
  if (!Number.isSafeInteger(second) || second <= 0) {
    throw new InvalidRateError(second)
  }
  const composed = divideHalfEven(
    BigInt(first) * BigInt(second),
    RATE_SCALE_E10_BIG,
  )
  if (composed <= 0n) {
    throw new InvalidRateError(`${first} × ${second}`)
  }
  return asRateE10(Number(composed))
}

/**
 * The rate two amounts imply, for the audit line under a converted transaction.
 *
 * Derived from the figures rather than read from a column, so it can never
 * disagree with the numbers printed beside it. Throws on a zero source amount:
 * a rate off a zero receipt is not a rate.
 */
export function deriveRateE10(from: Money, to: Money): RateE10 {
  if (from.amountMinor === 0) {
    throw new ConversionError('Cannot derive a rate from a zero amount')
  }
  const numerator =
    BigInt(to.amountMinor) *
    minorUnitScaleBig(from.currencyCode) *
    RATE_SCALE_E10_BIG
  const denominator =
    BigInt(from.amountMinor) * minorUnitScaleBig(to.currencyCode)
  const derived = divideHalfEven(numerator, denominator)
  if (derived <= 0n) {
    throw new ConversionError(
      `Amounts ${from.amountMinor} ${from.currencyCode} and ${to.amountMinor} ${to.currencyCode} imply a non-positive rate`,
    )
  }
  return asRateE10(Number(derived))
}

/**
 * A rate as it arrives from an FX provider's JSON, scaled exactly.
 *
 * The provider gives a JSON number, so the value is already a float by the time
 * this is called — but `4.3218 * 1e10` is `43218000000.00001` in IEEE 754, and
 * multiplying would carry that error into the stored rate. Scaling the number's
 * own shortest decimal representation instead is exact with respect to what the
 * provider published, which is the best that can be said about a float input.
 */
export function rateFromDecimal(value: number): RateE10 {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidRateError(value)
  }
  const scaled = scaleDecimalString(decimalStringOf(value), 10)
  if (scaled === null || scaled <= 0n) {
    throw new InvalidRateError(value)
  }
  return asRateE10(Number(scaled))
}

/** A rate typed into the workspace's manual-rate form, scaled exactly. */
export function rateFromString(text: string): RateE10 {
  const scaled = scaleDecimalString(text.trim(), 10)
  if (scaled === null || scaled <= 0n) {
    throw new InvalidRateError(text)
  }
  return asRateE10(Number(scaled))
}

/**
 * A rate as a decimal number, **for display and for chart axes only**. Never
 * feed the result back into a conversion; pass the `RateE10` itself.
 */
export function rateToDecimal(rateE10: RateE10): number {
  return rateE10 / RATE_SCALE_E10
}

/** The identity rate, for a conversion between a currency and itself. */
export const IDENTITY_RATE: RateE10 = RATE_IDENTITY

/** `1.234e-7` → `['', '1', '234', '-7']`. Anything else is already plain. */
const EXPONENT_FORM = /^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/

/**
 * The shortest decimal representation of a number, with exponent notation
 * expanded by moving the point through the digit string.
 *
 * `String()` gives the shortest round-tripping form, which is the figure the
 * provider meant. `Number.prototype.toFixed` is the obvious way to flatten the
 * exponent and is banned in this repository for exactly the reason it would be
 * wrong here too: it pads with the float's own noise digits, and its result for
 * a value below 1e-7 is a decimal the provider never published. Shifting the
 * point in the string is exact with respect to the shortest form, and a rate
 * small enough to reach exponent notation is then rejected or rounded to zero
 * by `scaleDecimalString` on its own terms.
 */
function decimalStringOf(value: number): string {
  const text = String(value)
  const match = EXPONENT_FORM.exec(text)
  if (match === null) {
    return text
  }
  const [, sign, whole, fraction = '', exponentText] = match
  const digits = `${whole}${fraction}`
  const pointAt = whole.length + Number(exponentText)
  if (pointAt <= 0) {
    return `${sign}0.${'0'.repeat(-pointAt)}${digits}`
  }
  if (pointAt >= digits.length) {
    return `${sign}${digits}${'0'.repeat(pointAt - digits.length)}`
  }
  return `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`
}
