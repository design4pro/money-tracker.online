import { describe, expect, it } from 'vitest'

import {
  ConversionError,
  IDENTITY_RATE,
  InvalidRateError,
  MAX_MINOR,
  MoneyOverflowError,
  RATE_SCALE_E10,
  asCurrencyCode,
  asMinor,
  asRateE10,
  composeRateE10,
  convert,
  deriveRateE10,
  invertRateE10,
  makeMoney,
  rateFromDecimal,
  rateFromString,
  rateToDecimal,
} from '../money'

import type { RateE10 } from '../money'

/** `4.3218` as the `exchange_rates.rate_e10` column stores it. */
const EUR_PLN = asRateE10(43_218_000_000)
/** `160.5` — a rate into a currency with no minor unit at all. */
const EUR_JPY = asRateE10(1_605_000_000_000)
/** `2.5` — chosen because it puts conversions exactly on a rounding boundary. */
const TWO_AND_A_HALF = asRateE10(25_000_000_000)

const PLN = asCurrencyCode('PLN')
const EUR = asCurrencyCode('EUR')
const JPY = asCurrencyCode('JPY')
const KWD = asCurrencyCode('KWD')

describe('the rate scale', () => {
  it('is 10^10, which is what the column stores', () => {
    expect(RATE_SCALE_E10).toBe(10_000_000_000)
    expect(IDENTITY_RATE).toBe(RATE_SCALE_E10)
  })

  it('scales a typed rate exactly, where a float multiplication would not', () => {
    // `4.3218 * 1e10` is 43218000000.00001 in IEEE 754.
    expect(rateFromString('4.3218')).toBe(43_218_000_000)
    expect(rateFromString(' 4.3218 ')).toBe(43_218_000_000)
    expect(rateFromString('1')).toBe(RATE_SCALE_E10)
    expect(rateFromString('0.0062')).toBe(62_000_000)
  })

  it('scales a rate from a provider JSON number by its shortest decimal form', () => {
    expect(rateFromDecimal(4.3218)).toBe(43_218_000_000)
    expect(rateFromDecimal(1)).toBe(RATE_SCALE_E10)
    // `String()` gives `1.2e-7`; the exponent is expanded by moving the point.
    expect(rateFromDecimal(0.00000012)).toBe(1200)
  })

  it('refuses a rate that is not strictly positive', () => {
    expect(() => rateFromString('0')).toThrow(InvalidRateError)
    expect(() => rateFromString('-1.5')).toThrow(InvalidRateError)
    expect(() => rateFromString('abc')).toThrow(InvalidRateError)
    expect(() => rateFromString('')).toThrow(InvalidRateError)
    expect(() => rateFromDecimal(0)).toThrow(InvalidRateError)
    expect(() => rateFromDecimal(-1)).toThrow(InvalidRateError)
    expect(() => rateFromDecimal(Number.NaN)).toThrow(InvalidRateError)
    expect(() => rateFromDecimal(Number.POSITIVE_INFINITY)).toThrow(
      InvalidRateError,
    )
  })

  it('refuses a rate that rounds away to nothing at ten digits', () => {
    // `1e-11` has no representation in the `rate_e10` scale, and a rate of zero
    // would turn every converted amount into zero without saying so.
    expect(() => rateFromDecimal(1e-11)).toThrow(InvalidRateError)
    expect(() => rateFromString('0.00000000001')).toThrow(InvalidRateError)
  })

  /**
   * `String(1e21)` is `'1e+21'`, and the scaler expands that exponent by moving
   * the point through the digit string rather than through `toFixed`, whose
   * padding would invent digits the provider never published. The expanded
   * figure is then refused for leaving the safe-integer range, which is the
   * right answer: a rate that cannot be stored exactly is not stored at all.
   */
  it('refuses a provider figure too large to be a rate, exponent form and all', () => {
    expect(() => rateFromDecimal(1e21)).toThrow(InvalidRateError)
    expect(() => rateFromDecimal(1.234e21)).toThrow(InvalidRateError)
  })

  it('gives a decimal back for a display line, and nothing to convert with', () => {
    expect(rateToDecimal(EUR_PLN)).toBe(4.3218)
    expect(rateToDecimal(IDENTITY_RATE)).toBe(1)
  })
})

describe('convert', () => {
  it('converts between two two-digit currencies', () => {
    // 12.34 EUR at 4.3218 is 53.331012 PLN, which is 53.33.
    const result = convert({
      amount: makeMoney(1234, 'EUR'),
      to: PLN,
      rateE10: EUR_PLN,
    })
    expect(result.amountMinor).toBe(5333)
    expect(result.currencyCode).toBe('PLN')
  })

  it('carries the rate and the source amount with the result', () => {
    const source = makeMoney(1234, 'EUR')
    const result = convert({ amount: source, to: PLN, rateE10: EUR_PLN })
    expect(result.rateE10).toBe(EUR_PLN)
    expect(result.source).toEqual(source)
  })

  /**
   * The reference product this one replaces stored rates as `FLOAT` and
   * hard-coded two digits. Both halves of that defect are one test: 1.00 EUR at
   * 160.5 is 160 yen, not 16050 and not 160.50.
   */
  it('reads the target currency digits, so a zero-decimal currency is whole', () => {
    expect(
      convert({ amount: makeMoney(100, 'EUR'), to: JPY, rateE10: EUR_JPY })
        .amountMinor,
    ).toBe(160)
  })

  it('reads the source currency digits too', () => {
    // 5000 JPY at 0.0062 is 31.00 EUR: the source has no minor unit to divide by.
    expect(
      convert({
        amount: makeMoney(5000, 'JPY'),
        to: EUR,
        rateE10: asRateE10(62_000_000),
      }).amountMinor,
    ).toBe(3100)
  })

  it('crosses three digits and two without losing the third', () => {
    // 1.000 KWD at 3.27 is 3.27 EUR.
    expect(
      convert({
        amount: makeMoney(1000, 'KWD'),
        to: EUR,
        rateE10: asRateE10(32_700_000_000),
      }).amountMinor,
    ).toBe(327)
    // …and back: 3.27 EUR at 0.3058 is 0.999966 KWD, which is 1.000.
    expect(
      convert({
        amount: makeMoney(327, 'EUR'),
        to: KWD,
        rateE10: asRateE10(3_058_000_000),
      }).amountMinor,
    ).toBe(1000)
  })

  it('rounds a conversion half to even, in both directions', () => {
    const at = (amountMinor: number) =>
      convert({
        amount: makeMoney(amountMinor, 'EUR'),
        to: PLN,
        rateE10: TWO_AND_A_HALF,
      }).amountMinor
    expect(at(1)).toBe(2)
    expect(at(3)).toBe(8)
    expect(at(-1)).toBe(-2)
    expect(at(-3)).toBe(-8)
  })

  it('converts a negative amount as the mirror of the positive one', () => {
    const positive = convert({
      amount: makeMoney(1234, 'EUR'),
      to: PLN,
      rateE10: EUR_PLN,
    })
    const negative = convert({
      amount: makeMoney(-1234, 'EUR'),
      to: PLN,
      rateE10: EUR_PLN,
    })
    expect(negative.amountMinor).toBe(-positive.amountMinor)
  })

  it('converts zero to zero, whatever the rate', () => {
    expect(
      convert({ amount: makeMoney(0, 'EUR'), to: PLN, rateE10: EUR_PLN })
        .amountMinor,
    ).toBe(0)
  })

  it('is the identity for a currency converted into itself', () => {
    const amount = makeMoney(1234, 'EUR')
    const result = convert({ amount, to: EUR, rateE10: IDENTITY_RATE })
    expect(result.amountMinor).toBe(1234)
    expect(result.currencyCode).toBe('EUR')
    expect(result.source).toEqual(amount)
  })

  /**
   * A caller that has looked up the wrong row would otherwise silently restate
   * a balance in its own currency.
   */
  it('refuses a same-currency conversion at any rate but one', () => {
    expect(() =>
      convert({ amount: makeMoney(1234, 'EUR'), to: EUR, rateE10: EUR_PLN }),
    ).toThrow(ConversionError)
  })

  it('refuses a rate that is not a positive integer in the scale', () => {
    for (const rate of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        convert({
          amount: makeMoney(100, 'EUR'),
          to: PLN,
          rateE10: rate as RateE10,
        }),
      ).toThrow(InvalidRateError)
    }
  })

  it('throws at the boundary rather than returning an amount that lost its digits', () => {
    expect(() =>
      convert({
        amount: makeMoney(MAX_MINOR, 'EUR'),
        to: PLN,
        rateE10: asRateE10(20_000_000_000),
      }),
    ).toThrow(MoneyOverflowError)
  })

  it('stays exact where the intermediate passes 2^53 many times over', () => {
    // Ten trillion euro at 4.3218: the numerator is ~4.3 × 10^27, which a
    // double could not hold to the unit, and the answer is exact to the grosz.
    const result = convert({
      amount: makeMoney(1_000_000_000_000_000, 'EUR'),
      to: PLN,
      rateE10: EUR_PLN,
    })
    expect(result.amountMinor).toBe(4_321_800_000_000_000)
    expect(Number.isSafeInteger(result.amountMinor)).toBe(true)
  })
})

describe('rate algebra', () => {
  it('inverts a rate, and leaves the identity alone', () => {
    expect(invertRateE10(IDENTITY_RATE)).toBe(IDENTITY_RATE)
    expect(invertRateE10(asRateE10(20_000_000_000))).toBe(5_000_000_000)
    // 1 / 4.3218 = 0.2313850710…
    expect(invertRateE10(EUR_PLN)).toBe(2_313_850_710)
  })

  /**
   * Inversion is lossy — `1 / 4.3218` has no exact decimal — which is why a
   * stored rate is always preferred over an inverted one. The drift is bounded
   * at one part in the tenth digit, not zero, and saying so here is the point.
   */
  it('round-trips an inversion back to within a rounding step', () => {
    const back = invertRateE10(invertRateE10(EUR_PLN))
    expect(back).not.toBe(EUR_PLN)
    expect(Math.abs(back - EUR_PLN)).toBeLessThan(1000)
  })

  it('refuses to invert something that is not a rate', () => {
    expect(() => invertRateE10(0 as RateE10)).toThrow(InvalidRateError)
    expect(() => invertRateE10(-1 as RateE10)).toThrow(InvalidRateError)
    expect(() => invertRateE10(1.5 as RateE10)).toThrow(InvalidRateError)
  })

  it('composes two legs into one, rounding once rather than twice', () => {
    expect(composeRateE10(IDENTITY_RATE, EUR_PLN)).toBe(EUR_PLN)
    expect(composeRateE10(EUR_PLN, IDENTITY_RATE)).toBe(EUR_PLN)
    // 4.3218 × 0.2314 = 1.00006452
    expect(composeRateE10(EUR_PLN, asRateE10(2_314_000_000))).toBe(
      10_000_645_200,
    )
  })

  it('refuses to compose with something that is not a rate', () => {
    expect(() => composeRateE10(0 as RateE10, EUR_PLN)).toThrow(
      InvalidRateError,
    )
    expect(() => composeRateE10(EUR_PLN, 0 as RateE10)).toThrow(
      InvalidRateError,
    )
    // Two rates whose product is below one part in 10^10 have no representation.
    expect(() => composeRateE10(asRateE10(1), asRateE10(1))).toThrow(
      InvalidRateError,
    )
  })

  it('derives the rate two amounts imply, for the audit line', () => {
    expect(deriveRateE10(makeMoney(100, 'EUR'), makeMoney(160, 'JPY'))).toBe(
      1_600_000_000_000,
    )
    // The derived rate is what the printed figures actually imply, which is not
    // quite the stored 4.3218 once both sides have been rounded to a cent.
    expect(deriveRateE10(makeMoney(1234, 'EUR'), makeMoney(5333, 'PLN'))).toBe(
      43_217_179_903,
    )
  })

  it('refuses to derive a rate from a zero on either side', () => {
    expect(() =>
      deriveRateE10(makeMoney(0, 'EUR'), makeMoney(100, 'PLN')),
    ).toThrow(ConversionError)
    expect(() =>
      deriveRateE10(makeMoney(100, 'EUR'), makeMoney(0, 'PLN')),
    ).toThrow(ConversionError)
  })
})

/**
 * `ref_amount_minor` is a historical value: it is computed once, at the rate of
 * `booked_on`, and never recomputed. These are the properties the ledger leans
 * on when it sums a report out of that column.
 */
describe('the ref-amount invariants', () => {
  it('reproduces the same figure from the stored rate alone, without a join', () => {
    const booked = convert({
      amount: makeMoney(1234, 'EUR'),
      to: PLN,
      rateE10: EUR_PLN,
    })
    const replayed = convert({
      amount: booked.source,
      to: PLN,
      rateE10: booked.rateE10,
    })
    expect(replayed.amountMinor).toBe(booked.amountMinor)
  })

  it('leaves a base-currency leg untouched, so a transfer nets to zero', () => {
    const leg = makeMoney(50_000, 'PLN')
    const ref = convert({ amount: leg, to: PLN, rateE10: IDENTITY_RATE })
    const counter = convert({
      amount: { ...leg, amountMinor: asMinor(-leg.amountMinor) },
      to: PLN,
      rateE10: IDENTITY_RATE,
    })
    expect(ref.amountMinor + counter.amountMinor).toBe(0)
  })
})
