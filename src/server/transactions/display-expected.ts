/**
 * Read-time display conversion of a recurring expected amount.
 *
 * **This does not persist.** An expected amount has no `ref_amount_minor` (`docs/MONEY.md` §3.1,
 * plan 13-S1). The dashboard planned series converts at `due_on` through the same
 * {@link RateResolver} + {@link convert} pair as a booked row, then discards the result.
 *
 * A missing rate or a conversion overflow is a **gap**, never zero and never an invented rate.
 */

import { ConversionError, convert, money } from '#/lib/money'

import type { CurrencyCode, Minor, RateE10 } from '#/lib/money'
import type { RateResolver } from './ref-amount'

export interface ConvertExpectedInput {
  readonly amountMinor: Minor
  readonly currencyCode: CurrencyCode
  readonly dueOn: string
  readonly baseCurrencyCode: CurrencyCode
}

/**
 * Workspace-base minor units for an expected amount, or `null` when no rate exists
 * (or conversion cannot complete) for `dueOn`.
 */
export async function convertExpectedAmount(
  input: ConvertExpectedInput,
  resolveRate: RateResolver,
): Promise<Minor | null> {
  if (input.currencyCode === input.baseCurrencyCode) {
    return input.amountMinor
  }

  let rateE10: RateE10 | null
  try {
    rateE10 = await resolveRate({
      base: input.currencyCode,
      quote: input.baseCurrencyCode,
      date: input.dueOn,
    })
  } catch {
    return null
  }
  if (rateE10 === null) return null

  try {
    return convert({
      amount: money(input.amountMinor, input.currencyCode),
      to: input.baseCurrencyCode,
      rateE10,
    }).amountMinor
  } catch (error) {
    if (error instanceof ConversionError) return null
    throw error
  }
}
