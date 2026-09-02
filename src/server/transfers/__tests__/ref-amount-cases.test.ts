/**
 * The four reference-amount cases of `docs/MONEY.md` §4.2, on hand-computed integers.
 *
 * **Every expected value below was computed with a pencil and the arithmetic is in the comment
 * beside it.** An expectation copied out of a failing run proves that the code agrees with itself,
 * which is precisely the property a conversion bug also has. The formula being checked is §2.2's:
 *
 * ```
 * to_minor = round½even( from_minor × rate_e10 × 10^(digits(to) − digits(from)) / 1e10 )
 * ```
 *
 * so the currencies are chosen to make the `digits` term load-bearing — 2, 0 (`JPY`) and 3 (`KWD`)
 * appear as both the leg currency and the workspace base — and one case sits exactly on a half
 * minor unit, where half-to-even and half-up disagree.
 *
 * No database. The four cases are arithmetic about two legs, and a rate resolver is a `Map`.
 */

import { describe, expect, it, vi } from 'vitest'

import { asCurrencyCode, asMinor, asRateE10, convert, money } from '#/lib/money'
import { RateUnavailableError } from '#/server/repos/errors'

import { transferRefAmounts } from '../ref-amount-cases'

import type { ConversionContext, RefAmount } from '#/server/repos/transactions'

const DAY = '2026-03-15'

/** A conversion context over a fixed rate table. Anything not in it resolves to "no rate". */
function conversionOf(
  base: string,
  rates: Record<string, number | undefined> = {},
): ConversionContext {
  return {
    baseCurrencyCode: asCurrencyCode(base),
    resolveRate: async ({ base: from, quote, date }) => {
      const rate = rates[`${from}:${quote}:${date}`]
      return rate === undefined ? null : asRateE10(rate)
    },
  }
}

function leg(amountMinor: number, currencyCode: string) {
  return {
    amountMinor: asMinor(amountMinor),
    currencyCode: asCurrencyCode(currencyCode),
  }
}

const IDENTITY = 10_000_000_000

/* -------------------------------------------------------------------------- */

describe('case 1 — the source is in the base currency', () => {
  it("gives the destination the source's reference amount exactly", async () => {
    // Base PLN. 100,00 zł leaves and €25,00 lands.
    //   source:      in base, so ref = amount = 10 000 and rate = 1.
    //   destination: ref := the source's 10 000, and the rate it implies is
    //                10 000 × 10^2 × 1e10 / (2 500 × 10^2) = 1e14 / 2 500 = 40 000 000 000
    //                — 1 EUR = 4,0000 PLN, the rate this person actually got.
    const result = await transferRefAmounts({
      source: leg(10_000, 'PLN'),
      destination: leg(2_500, 'EUR'),
      bookedOn: DAY,
      conversion: conversionOf('PLN'),
    })

    expect(result.appliedCase).toBe(1)
    expect(result.source).toEqual({
      refAmountMinor: 10_000,
      refCurrencyCode: 'PLN',
      rateE10: IDENTITY,
    })
    expect(result.destination).toEqual({
      refAmountMinor: 10_000,
      refCurrencyCode: 'PLN',
      rateE10: 40_000_000_000,
    })
    expect(result.netMinor).toBe(0)
  })

  it('holds when the base currency has no minor unit at all', async () => {
    // Base JPY (digits 0). ¥12 340 leaves and 617,00 zł lands.
    //   destination rate = 12 340 × 10^2 × 1e10 / (61 700 × 10^0)
    //                    = 1.234e16 / 61 700 = 200 000 000 000 — 1 PLN = 20 JPY.
    // A hard-coded scale of 2 anywhere in this path gives 2 000 000 000 000 and a rate a
    // hundred times wrong, which is `docs/MONEY.md` §8 failure 2.
    const result = await transferRefAmounts({
      source: leg(12_340, 'JPY'),
      destination: leg(61_700, 'PLN'),
      bookedOn: DAY,
      conversion: conversionOf('JPY'),
    })

    expect(result.appliedCase).toBe(1)
    expect(result.source.refAmountMinor).toBe(12_340)
    expect(result.destination).toEqual({
      refAmountMinor: 12_340,
      refCurrencyCode: 'JPY',
      rateE10: 200_000_000_000,
    })
    expect(result.netMinor).toBe(0)
  })
})

describe('case 2 — the destination is in the base currency', () => {
  it("updates the source's reference amount to what actually landed", async () => {
    // The worked example of §4.2, verbatim. Base PLN, €100,00 moved, 428,50 zł landed.
    //   destination: in base, ref = 42 850, rate = 1.
    //   source:      ref := 42 850, rate = 42 850 × 10^2 × 1e10 / (10 000 × 10^2)
    //                = 4.285e14 / 10 000 = 42 850 000 000 — 1 EUR = 4,2850 PLN.
    // Converting the source at a catalogue 4,2803 instead would book 42 803 against 42 850 and
    // move the workspace's net worth by 47 grosz for a movement that changed nothing.
    const result = await transferRefAmounts({
      source: leg(10_000, 'EUR'),
      destination: leg(42_850, 'PLN'),
      bookedOn: DAY,
      conversion: conversionOf('PLN', {
        'EUR:PLN:2026-03-15': 42_803_000_000,
      }),
    })

    expect(result.appliedCase).toBe(2)
    expect(result.source).toEqual({
      refAmountMinor: 42_850,
      refCurrencyCode: 'PLN',
      rateE10: 42_850_000_000,
    })
    expect(result.destination).toEqual({
      refAmountMinor: 42_850,
      refCurrencyCode: 'PLN',
      rateE10: IDENTITY,
    })
    expect(result.netMinor).toBe(0)
  })

  it('holds when the base currency has three minor-unit digits', async () => {
    // Base KWD (digits 3). 600,00 zł leaves and 1,500 KWD lands.
    //   source rate = 1 500 × 10^2 × 1e10 / (60 000 × 10^3)
    //               = 1.5e15 / 6e7 = 25 000 000 — 1 PLN = 0,0025000 KWD.
    const result = await transferRefAmounts({
      source: leg(60_000, 'PLN'),
      destination: leg(1_500, 'KWD'),
      bookedOn: DAY,
      conversion: conversionOf('KWD'),
    })

    expect(result.appliedCase).toBe(2)
    expect(result.source).toEqual({
      refAmountMinor: 1_500,
      refCurrencyCode: 'KWD',
      rateE10: 25_000_000,
    })
    expect(result.destination.rateE10).toBe(IDENTITY)
    expect(result.netMinor).toBe(0)
  })
})

describe('case 3 — both legs are in the base currency', () => {
  it('leaves both legs as their own amounts, at the identity rate', async () => {
    const result = await transferRefAmounts({
      source: leg(10_000, 'PLN'),
      destination: leg(10_000, 'PLN'),
      bookedOn: DAY,
      conversion: conversionOf('PLN'),
    })

    expect(result.appliedCase).toBe(3)
    expect(result.source).toEqual({
      refAmountMinor: 10_000,
      refCurrencyCode: 'PLN',
      rateE10: IDENTITY,
    })
    expect(result.destination).toEqual(result.source)
    expect(result.netMinor).toBe(0)
  })
})

describe('cases 1 to 3 — the invariant this module exists for', () => {
  it('resolves no exchange rate at all, so a missing rate cannot refuse the write', async () => {
    // The mirrored leg's rate is derived from the two amounts the person moved, so no rung of
    // §2.3's resolution order is climbed. A transfer touching a base-currency account therefore
    // cannot fail with `RateUnavailableError` — including at a weekend, and including for a pair
    // the catalogue has never carried.
    const resolveRate = vi.fn(async () => null)
    const conversion: ConversionContext = {
      baseCurrencyCode: asCurrencyCode('PLN'),
      resolveRate,
    }

    for (const pair of [
      { source: leg(10_000, 'PLN'), destination: leg(2_500, 'EUR') },
      { source: leg(10_000, 'EUR'), destination: leg(42_850, 'PLN') },
      { source: leg(10_000, 'PLN'), destination: leg(10_000, 'PLN') },
    ]) {
      const result = await transferRefAmounts({
        ...pair,
        bookedOn: DAY,
        conversion,
      })
      expect(result.netMinor).toBe(0)
    }

    expect(resolveRate).not.toHaveBeenCalled()
  })
})

describe('case 4 — neither leg is in the base currency', () => {
  it('converts each leg independently and surfaces the difference', async () => {
    // Base PLN. €100,00 leaves at 4,3218 and $110,00 lands at 3,9500.
    //   source      = 10 000 × 43 218 000 000 × 10^2 / (1e10 × 10^2) = 10 000 × 4,3218 = 43 218
    //   destination = 11 000 × 39 500 000 000 × 10^2 / (1e10 × 10^2) = 11 000 × 3,95   = 43 450
    //   net         = 43 450 − 43 218 = 232 grosz, and it is real: the two conversions are two
    //                 different pairs on the same day, and no rule can make them agree.
    const result = await transferRefAmounts({
      source: leg(10_000, 'EUR'),
      destination: leg(11_000, 'USD'),
      bookedOn: DAY,
      conversion: conversionOf('PLN', {
        'EUR:PLN:2026-03-15': 43_218_000_000,
        'USD:PLN:2026-03-15': 39_500_000_000,
      }),
    })

    expect(result.appliedCase).toBe(4)
    expect(result.source.refAmountMinor).toBe(43_218)
    expect(result.destination.refAmountMinor).toBe(43_450)
    expect(result.netMinor).toBe(232)
    // The difference is exactly the arithmetic difference of the two conversions, not a residual
    // of anything else.
    expect(result.netMinor).toBe(
      result.destination.refAmountMinor - result.source.refAmountMinor,
    )
  })

  it('carries the scale term across a 0-digit and a 3-digit currency', async () => {
    // Base PLN. ¥12 340 leaves at 0,0263 and 0,100 KWD lands at 13,0.
    //   source      = 12 340 × 263 000 000 × 10^(2−0) / 1e10
    //               = 324 542 000 000 000 / 1e10 = 32 454,2 → 32 454   (§2.2's worked example)
    //   destination = 100 × 130 000 000 000 × 10^(2−3) / 1e10
    //               = 1 300 000 000 000 000 / 1e13 = 130
    //   net         = 130 − 32 454 = −32 324
    // Dropping the 10^(digits(to) − digits(from)) term gives 324 and 1 300 000: a hundred-fold
    // error in one direction and a thousand-fold one in the other, and every same-digit test in
    // the suite passes over both.
    const result = await transferRefAmounts({
      source: leg(12_340, 'JPY'),
      destination: leg(100, 'KWD'),
      bookedOn: DAY,
      conversion: conversionOf('PLN', {
        'JPY:PLN:2026-03-15': 263_000_000,
        'KWD:PLN:2026-03-15': 130_000_000_000,
      }),
    })

    expect(result.appliedCase).toBe(4)
    expect(result.source.refAmountMinor).toBe(32_454)
    expect(result.destination.refAmountMinor).toBe(130)
    expect(result.netMinor).toBe(-32_324)
  })

  it('rounds a conversion that lands on exactly half a minor unit to even', async () => {
    // Base PLN, both legs at a rate of 0,5 — chosen because it puts both conversions exactly on
    // the halfway mark, which is the only place half-to-even and half-up differ.
    //   source      = 5 × 5 000 000 000 / 1e10 = 2,5 → 2 (2 is even; half-up would say 3)
    //   destination = 7 × 5 000 000 000 / 1e10 = 3,5 → 4 (4 is even; half-up also says 4)
    //   net         = 4 − 2 = 2                          (half-up would report 1)
    // Half-up biases every tie upward, and over a portfolio that bias is the workspace whose
    // totals sum to one grosz more than the rows they came from (§1.4).
    const result = await transferRefAmounts({
      source: leg(5, 'EUR'),
      destination: leg(7, 'USD'),
      bookedOn: DAY,
      conversion: conversionOf('PLN', {
        'EUR:PLN:2026-03-15': 5_000_000_000,
        'USD:PLN:2026-03-15': 5_000_000_000,
      }),
    })

    expect(result.source.refAmountMinor).toBe(2)
    expect(result.destination.refAmountMinor).toBe(4)
    expect(result.netMinor).toBe(2)
  })

  it('rounds to even in a base currency that has no minor unit at all', async () => {
    // The same boundary, in a **0-digit base**. This is where a rounding rule written for cents
    // shows itself: with `digits(JPY) = 0` the scale term is 10^(0−2), so the halfway mark sits at
    // a hundredth of where a two-digit base would put it, and the amounts have to be tiny to
    // reach it. That is the point — a rule that only ties on realistic cent amounts has never been
    // tested where a tie actually costs a whole yen.
    //
    //   source      = 4 × 1 625 000 000 000 × 10^(0−2) / 1e10
    //               = 6.5e12 / 1e12 = 6,5 → 6   (6 is even; half-up would say 7)
    //   destination = 20 × 375 000 000 000 × 10^(0−2) / 1e10
    //               = 7.5e12 / 1e12 = 7,5 → 8   (7 is odd, so the tie goes up; half-up agrees)
    //   net         = 8 − 6 = 2                 (half-up would report 8 − 7 = 1)
    //
    // The two legs are chosen to tie in *opposite* parity directions, so the net is what
    // separates the two rounding rules — one leg alone could not.
    const result = await transferRefAmounts({
      source: leg(4, 'EUR'),
      destination: leg(20, 'PLN'),
      bookedOn: DAY,
      conversion: conversionOf('JPY', {
        'EUR:JPY:2026-03-15': 1_625_000_000_000,
        'PLN:JPY:2026-03-15': 375_000_000_000,
      }),
    })

    expect(result.appliedCase).toBe(4)
    expect(result.source.refAmountMinor).toBe(6)
    expect(result.destination.refAmountMinor).toBe(8)
    expect(result.netMinor).toBe(2)
  })

  it('refuses the write when the day has no rate, rather than inventing one', async () => {
    await expect(
      transferRefAmounts({
        source: leg(10_000, 'EUR'),
        destination: leg(11_000, 'USD'),
        bookedOn: DAY,
        conversion: conversionOf('PLN', {
          'EUR:PLN:2026-03-15': 43_218_000_000,
        }),
      }),
    ).rejects.toBeInstanceOf(RateUnavailableError)
  })
})

describe('the stored rate against the stored amount — the round trip', () => {
  /**
   * Pushes a mirrored leg back through §2.2 using the `rate_e10` that was stored beside it.
   *
   * This is what a reconciliation view would do if it recomputed a historical figure instead of
   * reading it, which is exactly what §3.1 forbids. The tests below establish *why* the
   * prohibition has teeth: the recomputation agrees under a bound and disagrees above it.
   */
  function recompute(
    stored: RefAmount,
    amountMinor: number,
    currencyCode: string,
  ): number {
    return convert({
      amount: money(asMinor(amountMinor), asCurrencyCode(currencyCode)),
      to: stored.refCurrencyCode,
      rateE10: stored.rateE10,
    }).amountMinor
  }

  /** Case 1, so `destination` is always the mirrored leg: the one carrying a derived rate. */
  async function mirrored(
    amountMinor: number,
    currencyCode: string,
    refMinor: number,
    base: string,
  ) {
    return transferRefAmounts({
      source: leg(refMinor, base),
      destination: leg(amountMinor, currencyCode),
      bookedOn: DAY,
      conversion: conversionOf(base),
    })
  }

  it('reproduces the stored figure when the derived rate does not divide evenly', async () => {
    // Base PLN. 0,10 zł leaves and €0,03 lands — a ratio with no finite decimal expansion.
    //   derived rate = 10 × 10^2 × 1e10 / (3 × 10^2) = 1e11 / 3
    //                = 33 333 333 333,33… → half-even → 33 333 333 333
    //   back         = 3 × 33 333 333 333 × 10^(2−2) / 1e10
    //                = 99 999 999 999 / 1e10 = 9,9999999999 → 10 ✓
    // The rate lost a third of a unit in its last place and the amount survived anyway, because
    // the error is multiplied by an amount far below the bound.
    const pair = await mirrored(3, 'EUR', 10, 'PLN')

    expect(pair.destination.rateE10).toBe(33_333_333_333)
    expect(recompute(pair.destination, 3, 'EUR')).toBe(10)
  })

  /*
   * The same trip at the three digit shapes the `10^(digits(to) − digits(from))` term can take,
   * so a hard-coded scale of 2 cannot pass by luck. Each rate is half-even to ten places and each
   * recomputation still lands on the stored integer:
   *
   *   ¥7 → 0,19 zł    rate = 19 × 10^0 × 1e10 / (7 × 10^2) ... = 1,9e9 / 7 = 271 428 571,43 → 271 428 571
   *                   back = 7 × 271 428 571 × 10^(2−0) / 1e10 = 18,99999997 → 19 ✓
   *   0,07 zł → ¥3    rate = 3e10 / 0,07 = 428 571 428 571,43 → 428 571 428 571
   *                   back = 7 × 428 571 428 571 × 10^(0−2) / 1e10 = 2,999999999997 → 3 ✓
   *   ¥9 999 999 → 20 000,000 KWD
   *                   rate = 20 000 / 9 999 999 × 1e10 = 20 000 002,0000002 → 20 000 002
   *                   back = 9 999 999 × 20 000 002 × 10^(3−0) / 1e10 = 19 999 999,9999998 → 20 000 000 ✓
   *
   * The last row is a 0-digit leg against a 3-digit base at the bound itself (10^10 × 10^-3 =
   * 10 000 000): the tightest pair the catalogue can produce, one unit under the edge.
   */
  const withinBound = [
    { amountMinor: 7, currencyCode: 'JPY', base: 'PLN', expected: 19 },
    { amountMinor: 7, currencyCode: 'PLN', base: 'JPY', expected: 3 },
    {
      amountMinor: 9_999_999,
      currencyCode: 'JPY',
      base: 'KWD',
      expected: 20_000_000,
    },
  ]

  for (const { amountMinor, currencyCode, base, expected } of withinBound) {
    it(`round-trips a ${currencyCode} leg into a ${base} base`, async () => {
      const pair = await mirrored(amountMinor, currencyCode, expected, base)

      expect(pair.destination.refAmountMinor).toBe(expected)
      expect(recompute(pair.destination, amountMinor, currencyCode)).toBe(
        expected,
      )
    })
  }

  it('drifts by a minor unit past the bound, so the stored amount is the authority', async () => {
    // ¥20 000 000 mirrored onto 40 000,001 KWD — twice the 10 000 000 bound for this pair, and a
    // plausible movement rather than a contrived one (about 130 000 USD at a realistic rate).
    //   derived rate = 40 000,001 / 20 000 000 × 1e10 = 0,00200000005 × 1e10
    //                = 20 000 000,5 → half-even lands on the EVEN neighbour → 20 000 000
    //   back         = 20 000 000 × 20 000 000 × 10^(3−0) / 1e10
    //                = 4e14 × 1e3 / 1e10 = 4e7 = 40 000 000  ✗ one fils short of 40 000 001
    //
    // Nothing here is wrong: the rate is the best ten-place figure for the pair and the stored
    // reference amount is the one the person actually moved. They simply cannot both be exact, and
    // `docs/MONEY.md` §3.1 settles which one a reader may trust — the amount. A screen that
    // re-derived this would report a one-fils discrepancy that does not exist.
    const pair = await mirrored(20_000_000, 'JPY', 40_000_001, 'KWD')

    expect(pair.destination.refAmountMinor).toBe(40_000_001)
    expect(pair.destination.rateE10).toBe(20_000_000)
    expect(pair.netMinor).toBe(0)

    // The recomputation, and the size of its disagreement, pinned rather than left to folklore.
    expect(recompute(pair.destination, 20_000_000, 'JPY')).toBe(40_000_000)
  })
})
