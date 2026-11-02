/**
 * Conversion at `booked_on`'s rate, independent of the transactions table repository.
 */

import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor, asRateE10 } from '#/lib/money'
import { computeRefAmount } from '../ref-amount'

import type { RateE10 } from '#/lib/money'
import type { ConversionContext } from '../ref-amount'

function conversionOf(
  rates: Map<string, RateE10>,
  base = 'EUR',
): ConversionContext {
  return {
    baseCurrencyCode: asCurrencyCode(base),
    resolveRate: async ({ base: from, quote, date }) =>
      rates.get(`${from}:${quote}:${date}`) ?? null,
  }
}

describe('computeRefAmount', () => {
  it('rounds half to even at the single final step', async () => {
    const quarter = conversionOf(
      new Map([['PLN:EUR:2026-03-15', asRateE10(2_500_000_000)]]),
      'EUR',
    )
    const half = await computeRefAmount(
      {
        amountMinor: asMinor(2),
        currencyCode: asCurrencyCode('PLN'),
        bookedOn: '2026-03-15',
      },
      quarter,
    )
    const oneAndAHalf = await computeRefAmount(
      {
        amountMinor: asMinor(6),
        currencyCode: asCurrencyCode('PLN'),
        bookedOn: '2026-03-15',
      },
      quarter,
    )

    expect(half.refAmountMinor).toBe(0)
    expect(oneAndAHalf.refAmountMinor).toBe(2)
  })
})
