/**
 * Converts an amount into the workspace base currency at `booked_on`'s rate.
 *
 * This is not a table repository. Rate lookup order belongs to the workspace-currency
 * repository and is supplied here as {@link ConversionContext.resolveRate}; this module only
 * applies the identity short-circuit, asks for the pair in the documented direction, and
 * refuses a missing rate. Accounts, budgets, goals and transfers import conversion from here
 * rather than from the transactions write path.
 *
 * The rate is asked for as `(base = the amount's currency, quote = the workspace base)`, because
 * `rate_e10` is major-per-major in that direction and `convert` reads it as "units of `to` per unit
 * of `from`". Getting that pair backwards is a silent inversion, so it is spelled out here once and
 * nowhere else.
 *
 * **A missing rate is an error, never a default.** A conversion at an invented rate is worse than
 * a conversion that did not happen, because it is invisible.
 *
 * The identity case short-circuits *before* the resolver: a row already in the base currency gets
 * `ref_amount_minor === amount_minor` and `rate_e10 === 1e10` exactly, with no arithmetic at all
 * and therefore no possibility of rounding drift. The table's
 * `transactions_base_currency_identity_check` asserts the same thing from the other side.
 */

import { IDENTITY_RATE, asRateE10, convert, money } from '#/lib/money'
import { RateUnavailableError } from '#/server/repos/errors'

import type { CurrencyCode, Minor, RateE10 } from '#/lib/money'

/**
 * Resolves the rate for one ordered pair on one calendar day.
 *
 * Supplied by the caller rather than imported, because the resolution order (workspace flat rate →
 * catalogue rate for the day → most recent catalogue rate within the look-back) belongs to the
 * workspace-currency repository and this module must not acquire a second opinion about it.
 * Returning `null` means "no rate exists"; it never means "assume parity".
 */
export type RateResolver = (query: {
  readonly base: CurrencyCode
  readonly quote: CurrencyCode
  readonly date: string
}) => Promise<RateE10 | null>

/** The workspace's base currency and the rate source, as one value the write path carries. */
export interface ConversionContext {
  readonly baseCurrencyCode: CurrencyCode
  readonly resolveRate: RateResolver
}

/** What a conversion needs to know about the amount being converted. */
export interface RefAmountInput {
  readonly amountMinor: Minor
  readonly currencyCode: CurrencyCode
  /** The calendar date the rate is anchored to. `YYYY-MM-DD`, never an instant. */
  readonly bookedOn: string
}

/** The triple that lands on the row: the converted amount, its currency, and the rate used. */
export interface RefAmount {
  readonly refAmountMinor: Minor
  readonly refCurrencyCode: CurrencyCode
  readonly rateE10: RateE10
}

export async function computeRefAmount(
  input: RefAmountInput,
  conversion: ConversionContext,
): Promise<RefAmount> {
  const { baseCurrencyCode, resolveRate } = conversion
  if (input.currencyCode === baseCurrencyCode) {
    return {
      refAmountMinor: input.amountMinor,
      refCurrencyCode: baseCurrencyCode,
      rateE10: IDENTITY_RATE,
    }
  }

  const resolved = await resolveRate({
    base: input.currencyCode,
    quote: baseCurrencyCode,
    date: input.bookedOn,
  })
  if (resolved === null) {
    throw new RateUnavailableError(
      input.currencyCode,
      baseCurrencyCode,
      input.bookedOn,
    )
  }

  const converted = convert({
    amount: money(input.amountMinor, input.currencyCode),
    to: baseCurrencyCode,
    rateE10: asRateE10(resolved),
  })
  return {
    refAmountMinor: converted.amountMinor,
    refCurrencyCode: baseCurrencyCode,
    rateE10: converted.rateE10,
  }
}
