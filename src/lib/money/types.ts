/**
 * The money vocabulary: branded scalars, the value objects that carry them, and
 * the errors the arithmetic throws.
 *
 * **Every amount in this product is an integer in the minor unit of its own
 * currency.** 12.34 EUR is `1234`; 5000 JPY is `5000`, not `500000`, because
 * the yen has no minor unit; 1.234 KWD is `1234`. The scale is
 * `currencies.digits`, never a hard-coded 2.
 *
 * **The branding is the point.** A minor-unit integer and a major-unit float
 * are both `number` to JavaScript, and the bug they produce — an amount off by
 * a factor of a hundred, or a hundred and *sometimes* one — is silent, survives
 * a round trip through D1, and is discovered by a user reconciling a bank
 * statement. `Minor` and `RateE10` are nominal types: a plain `number` will not
 * assign to either, so the only way into the money path is through a
 * constructor that has checked the value.
 *
 * There is deliberately **no `Major` type**. A major-unit value is a float, a
 * float cannot represent 0.1, and giving one a name invites someone to do
 * arithmetic on it. Major units exist for exactly two instants — inside a
 * formatter on the way out, and inside a parser on the way in — and both live
 * behind `./format`.
 */

declare const MINOR: unique symbol
declare const RATE_E10: unique symbol
declare const CURRENCY: unique symbol

/**
 * An integer number of minor units, in some currency's own scale.
 *
 * Carries no currency of its own: pairing an amount with its code is the
 * `Money` value object's job, and the arithmetic in `./arithmetic` refuses to
 * add two `Money` values that disagree.
 */
export type Minor = number & { readonly [MINOR]: 'minor' }

/**
 * An exchange rate as an integer, scaled by 10^10.
 *
 * `1 EUR = 4.3218 PLN` is `43_218_000_000`. Ten fractional digits is what the
 * `exchange_rates.rate_e10` column stores, and it is enough for every currency
 * pair a personal-finance product meets: the widest realistic ratio (a
 * zero-decimal currency against a three-decimal one) still leaves six
 * significant digits of rate. Rates are never floats — the reference product
 * this one replaces stored them as `FLOAT`, and that is one of the two defects
 * this module exists to fix.
 */
export type RateE10 = number & { readonly [RATE_E10]: 'rate_e10' }

/** A validated ISO 4217 alphabetic code. Uppercase, three letters. */
export type CurrencyCode = string & { readonly [CURRENCY]: 'iso4217' }

/** The `rate_e10` scale: 10^10. */
export const RATE_SCALE_E10 = 10_000_000_000

/** `RATE_SCALE_E10` as a `bigint`, for the exact arithmetic in `./convert`. */
export const RATE_SCALE_E10_BIG = 10_000_000_000n

/** An exchange rate of exactly 1, for a conversion between identical currencies. */
export const RATE_IDENTITY = RATE_SCALE_E10 as RateE10

/** Zero minor units. */
export const ZERO_MINOR = 0 as Minor

/**
 * The largest magnitude an amount may take: `Number.MAX_SAFE_INTEGER`.
 *
 * D1 stores an `INTEGER` as a signed 64-bit value, which is wider — but the
 * value crosses a JSON boundary on every request, and a `number` past 2^53 - 1
 * silently loses its last digits there. The bound is enforced at every write
 * into a `Minor`, so an overflow is an exception at the point of the mistake
 * rather than a wrong balance two screens later. At 2 digits that is ninety
 * trillion units of currency, which is not a limit any household meets.
 */
export const MAX_MINOR = Number.MAX_SAFE_INTEGER

/** Base class for everything this module throws, so a caller can catch one type. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyError'
  }
}

/** A value that was supposed to be an integer number of minor units and was not. */
export class InvalidAmountError extends MoneyError {
  constructor(value: unknown) {
    super(`Not an integer minor-unit amount: ${String(value)}`)
    this.name = 'InvalidAmountError'
  }
}

/** An amount that left the safe-integer range. */
export class MoneyOverflowError extends MoneyError {
  constructor(value: unknown) {
    super(
      `Amount ${String(value)} is outside the safe integer range; money must stay exact`,
    )
    this.name = 'MoneyOverflowError'
  }
}

/** Two amounts in different currencies met in an operation that needs one. */
export class CurrencyMismatchError extends MoneyError {
  constructor(left: string, right: string) {
    super(`Cannot combine ${left} and ${right} without an explicit conversion`)
    this.name = 'CurrencyMismatchError'
  }
}

/** A string that was supposed to be an ISO 4217 alphabetic code and was not. */
export class InvalidCurrencyCodeError extends MoneyError {
  constructor(value: unknown) {
    super(`Not an ISO 4217 alphabetic code: ${String(value)}`)
    this.name = 'InvalidCurrencyCodeError'
  }
}

/** A rate that is not a positive integer in the `rate_e10` scale. */
export class InvalidRateError extends MoneyError {
  constructor(value: unknown) {
    super(`Not a positive rate_e10 value: ${String(value)}`)
    this.name = 'InvalidRateError'
  }
}

const CODE_PATTERN = /^[A-Z]{3}$/

/** Whether a number is a usable minor-unit amount. */
export function isMinor(value: unknown): value is Minor {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_MINOR
  )
}

/**
 * Brands a number as a minor-unit amount, or throws.
 *
 * This is the only door into the money path. Every value read from D1, parsed
 * from an import file or typed into a form goes through here, which is what
 * makes "no float ever reaches an amount" a property rather than a convention.
 */
export function asMinor(value: number): Minor {
  if (!Number.isInteger(value)) {
    throw new InvalidAmountError(value)
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyOverflowError(value)
  }
  return value as Minor
}

/**
 * Narrows a `bigint` computed by the exact arithmetic back to a `Minor`.
 *
 * The intermediate products in `./convert` and `./allocate` routinely exceed
 * 2^53 — an amount times a rate scaled by 10^10 does so at four figures — so
 * they are computed in `bigint` and land here once, at the end, where the
 * result is either a safe integer or an error.
 */
export function minorFromBigInt(value: bigint): Minor {
  if (value > BigInt(MAX_MINOR) || value < -BigInt(MAX_MINOR)) {
    throw new MoneyOverflowError(value)
  }
  return Number(value) as Minor
}

/** Whether a string is a syntactically valid ISO 4217 alphabetic code. */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CODE_PATTERN.test(value)
}

/**
 * Normalises and brands a currency code, or throws.
 *
 * Trimming and upper-casing are done here because import files and pasted
 * values arrive as `' eur '`, and the alternative is every call site doing it
 * slightly differently.
 */
export function asCurrencyCode(value: string): CurrencyCode {
  const code = value.trim().toUpperCase()
  if (!CODE_PATTERN.test(code)) {
    throw new InvalidCurrencyCodeError(value)
  }
  return code as CurrencyCode
}

/** Whether a number is a usable `rate_e10`. */
export function isRateE10(value: unknown): value is RateE10 {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Brands a number as a `rate_e10`, or throws. A rate is strictly positive. */
export function asRateE10(value: number): RateE10 {
  if (!isRateE10(value)) {
    throw new InvalidRateError(value)
  }
  return value
}

/**
 * An amount and the currency it is denominated in. The unit of every balance,
 * every transaction line and every budget limit in the product.
 */
export interface Money {
  readonly amountMinor: Minor
  readonly currencyCode: CurrencyCode
}

/**
 * A converted amount that has not forgotten where it came from.
 *
 * `transactions` stores exactly this triple — `amount_minor`/`currency_code`,
 * `ref_amount_minor`/`ref_currency_code` and `rate_e10` — so a March expense
 * can be re-derived at March's rate years later without a join. The rate
 * travelling with the result is what makes a report auditable.
 */
export interface ConvertedMoney extends Money {
  /** The rate applied, in the `rate_e10` scale. */
  readonly rateE10: RateE10
  /** The amount this was converted from. */
  readonly source: Money
}

/** Builds a `Money` from an already-branded amount and code. */
export function money(amountMinor: Minor, currencyCode: CurrencyCode): Money {
  return { amountMinor, currencyCode }
}

/** Builds a `Money` from raw values, validating both. */
export function makeMoney(amountMinor: number, currencyCode: string): Money {
  return {
    amountMinor: asMinor(amountMinor),
    currencyCode: asCurrencyCode(currencyCode),
  }
}

/** Whether two `Money` values are denominated in the same currency. */
export function sameCurrency(left: Money, right: Money): boolean {
  return left.currencyCode === right.currencyCode
}

/** Throws unless both amounts are in the same currency. */
export function assertSameCurrency(left: Money, right: Money): void {
  if (left.currencyCode !== right.currencyCode) {
    throw new CurrencyMismatchError(left.currencyCode, right.currencyCode)
  }
}
