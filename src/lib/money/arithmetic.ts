import { divideHalfEven } from './rounding'
import {
  MoneyOverflowError,
  asMinor,
  assertSameCurrency,
  minorFromBigInt,
} from './types'

import type { CurrencyCode, Minor, Money } from './types'

/**
 * Arithmetic on minor units.
 *
 * **No operation here produces a fraction of a minor unit and none of them
 * touches a float.** Addition and subtraction stay in `number` because two safe
 * integers whose true sum is itself within the safe range add exactly — and
 * when the true sum is not, the double result is provably ≥ 2^53 and
 * `Number.isSafeInteger` rejects it. Multiplication and division cannot make
 * that argument, so they go through `bigint`.
 *
 * An overflow throws at the point of the mistake rather than propagating a
 * quietly wrong number into a balance.
 */

/** `a + b`. Throws rather than returning a value that has lost its last digits. */
export function addMinor(left: Minor, right: Minor): Minor {
  return asMinorChecked(left + right)
}

/** `a - b`. */
export function subtractMinor(left: Minor, right: Minor): Minor {
  return asMinorChecked(left - right)
}

/** `-a`. */
export function negateMinor(value: Minor): Minor {
  return -value as Minor
}

/** `|a|`. */
export function absMinor(value: Minor): Minor {
  return Math.abs(value) as Minor
}

/**
 * The total of a list.
 *
 * The running total is checked at every step, so a pair of enormous amounts
 * that happen to cancel is reported rather than silently producing a rounded
 * intermediate that no longer cancels.
 */
export function sumMinor(values: Iterable<Minor>): Minor {
  let total = 0
  for (const value of values) {
    total += value
    if (!Number.isSafeInteger(total)) {
      throw new MoneyOverflowError(total)
    }
  }
  return total as Minor
}

/** `-1`, `0` or `1`, for sorting a column of amounts. */
export function compareMinor(left: Minor, right: Minor): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0
}

/** The sign of an amount, as a number. */
export function signOfMinor(value: Minor): -1 | 0 | 1 {
  return value < 0 ? -1 : value > 0 ? 1 : 0
}

export function isZeroMinor(value: Minor): boolean {
  return value === 0
}

export function isNegativeMinor(value: Minor): boolean {
  return value < 0
}

export function isPositiveMinor(value: Minor): boolean {
  return value > 0
}

/**
 * `amount × numerator / denominator`, rounded half to even.
 *
 * This is the only multiplication in the module that a feature calls directly:
 * a budget's 80% alert threshold, a goal's monthly contribution, an
 * apportioned fee. Both parts of the ratio must be integers — a float ratio has
 * no exact meaning in minor units and is exactly the door this module keeps
 * shut. Express 12.5% as `125 / 1000`.
 */
export function applyRatioMinor(
  amount: Minor,
  numerator: number,
  denominator: number,
): Minor {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new TypeError(
      `A ratio applied to money must be a pair of integers, got ${numerator}/${denominator}`,
    )
  }
  return minorFromBigInt(
    divideHalfEven(BigInt(amount) * BigInt(numerator), BigInt(denominator)),
  )
}

/**
 * `part / whole` as a fraction between 0 and 1, **for display only**.
 *
 * A progress bar's width and a "72% of budget used" label are the entire
 * legitimate use. The result is a float and must never be multiplied back into
 * an amount — `applyRatioMinor` exists for that. `null` when the whole is zero,
 * because a share of nothing is not 0% and not 100%.
 */
export function ratioOfMinor(part: Minor, whole: Minor): number | null {
  if (whole === 0) {
    return null
  }
  return part / whole
}

/* -------------------------------------------------------------------------- */
/* The same operations on `Money`                                             */
/* -------------------------------------------------------------------------- */

/** `a + b`, refusing two different currencies. */
export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right)
  return {
    amountMinor: addMinor(left.amountMinor, right.amountMinor),
    currencyCode: left.currencyCode,
  }
}

/** `a - b`, refusing two different currencies. */
export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right)
  return {
    amountMinor: subtractMinor(left.amountMinor, right.amountMinor),
    currencyCode: left.currencyCode,
  }
}

/** `-a`. */
export function negateMoney(value: Money): Money {
  return {
    amountMinor: negateMinor(value.amountMinor),
    currencyCode: value.currencyCode,
  }
}

/** `|a|`. */
export function absMoney(value: Money): Money {
  return {
    amountMinor: absMinor(value.amountMinor),
    currencyCode: value.currencyCode,
  }
}

/**
 * The total of a list of amounts in one currency.
 *
 * The currency is a parameter rather than read off the first element, because
 * the empty list is the common case — a workspace with no transactions yet — and
 * a zero has to be denominated in something.
 */
export function sumMoney(
  values: Iterable<Money>,
  currencyCode: CurrencyCode,
): Money {
  let total = 0
  for (const value of values) {
    if (value.currencyCode !== currencyCode) {
      assertSameCurrency({ amountMinor: 0 as Minor, currencyCode }, value)
    }
    total += value.amountMinor
    if (!Number.isSafeInteger(total)) {
      throw new MoneyOverflowError(total)
    }
  }
  return { amountMinor: total as Minor, currencyCode }
}

/** `-1`, `0` or `1`, refusing two different currencies. */
export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  assertSameCurrency(left, right)
  return compareMinor(left.amountMinor, right.amountMinor)
}

/** Whether two amounts are the same figure in the same currency. */
export function equalsMoney(left: Money, right: Money): boolean {
  return (
    left.currencyCode === right.currencyCode &&
    left.amountMinor === right.amountMinor
  )
}

/** `amount × numerator / denominator`, half to even, keeping the currency. */
export function applyRatioMoney(
  amount: Money,
  numerator: number,
  denominator: number,
): Money {
  return {
    amountMinor: applyRatioMinor(amount.amountMinor, numerator, denominator),
    currencyCode: amount.currencyCode,
  }
}

/** Narrows a plain sum back to a `Minor`, with the overflow message money needs. */
function asMinorChecked(value: number): Minor {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyOverflowError(value)
  }
  return asMinor(value)
}
