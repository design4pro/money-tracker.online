import { describe, expect, it } from 'vitest'
import { NumberParser } from '@internationalized/number'

import {
  asCurrencyCode,
  asMinor,
  makeMoney,
  minorFromBigInt,
  minorUnitDigits,
  MoneyOverflowError,
  parseMoney,
  scaleDecimalString,
  toAmountInputValue,
} from '#/lib/money'

import type { Locale } from '#/lib/i18n'
import type { CurrencyCode, Minor } from '#/lib/money'

/**
 * The measurement issue #106 asked for before either amount field was allowed to absorb the other,
 * and the record of why {@link MoneyField} converts the way it does.
 *
 * Two components named `amount-field.tsx` used to turn typed text into `Minor`, and each
 * docblock treated the other's approach as the defect:
 *
 * - `app/accounts/amount-field.tsx` handed the raw text to `parseMoney`, which normalises the
 *   separators and then moves the decimal point **inside the string** via `scaleDecimalString`.
 *   No float existed at any point. This is the one that survived, as `ui/money-field.tsx`.
 * - `app/transactions/amount-field.tsx` let React Aria's `NumberField` parse the text into a
 *   decimal `number`, re-serialised that double to its shortest round-tripping decimal, and handed
 *   *that* string to the same `scaleDecimalString`. One float existed, in the middle.
 *
 * Both therefore ended in the same rounding routine, so `parseMoney` and `scaleDecimalString`
 * cannot disagree about a half-way tie: `parseMoney` *is* `scaleDecimalString` plus separator
 * normalisation. What the float in the middle could still cost is a value that no longer names the
 * decimal the person typed, and that is what the second half of this file pins down.
 *
 * The verdict, from the numbers below: the two paths agreed on every amount a person can put in a
 * form, and diverged only at the `MAX_MINOR` boundary — where the string path is right and the
 * float path is wrong by one minor unit, or throws where the string path reports `null`.
 *
 * The float path is gone from the product and is reproduced here rather than imported, so the
 * reason it went stays a thing this suite can check rather than a claim in a commit message. It is
 * a faithful copy of the deleted `toMinor` / `toInputValue`.
 */

const PLN = asCurrencyCode('PLN')
const JPY = asCurrencyCode('JPY')
const KWD = asCurrencyCode('KWD')

/** What React Aria handed the deleted transactions field for a given typed text. */
function asNumberField(locale: Locale, text: string, digits: number): number {
  return new NumberParser(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).parse(text)
}

/**
 * The deleted `toMinor`: a double written out as the shortest plain decimal that round-trips to
 * it, then scaled as a string. `Intl` never produces exponent form, which `scaleDecimalString`
 * would refuse.
 */
const PLAIN_DECIMAL = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 20,
  useGrouping: false,
})

function toMinor(value: number, code: CurrencyCode): Minor | null {
  if (!Number.isFinite(value)) {
    return null
  }
  const scaled = scaleDecimalString(
    PLAIN_DECIMAL.format(value),
    minorUnitDigits(code),
  )
  return scaled === null ? null : minorFromBigInt(scaled)
}

/** The deleted `toInputValue`: one division by the currency's scale. */
function toInputValue(amountMinor: Minor, code: CurrencyCode): number {
  return amountMinor / 10 ** minorUnitDigits(code)
}

describe('parseMoney against scaleDecimalString', () => {
  /**
   * The half-way ties the issue named. `1.015` is the one a float multiplication loses — the
   * `Math.round(1.015 * 100)` route answers 101 — and `0.125` is the one where half-to-even and
   * half-away-from-zero part company.
   */
  it.each([
    { text: '1.015', digits: 2, expected: 102 },
    { text: '0.125', digits: 2, expected: 12 },
    { text: '1.005', digits: 2, expected: 100 },
    { text: '0.375', digits: 2, expected: 38 },
  ])('agrees on $text at $digits digits', ({ text, expected }) => {
    expect(parseMoney('en', text, 'PLN')).toBe(expected)
    expect(scaleDecimalString(text, 2)).toBe(BigInt(expected))
  })

  /**
   * The scale is the currency's, in both directions off two. JPY has no minor unit and KWD has
   * three, so a hard-coded `* 100` would be invisible until one of them is entered.
   */
  it.each([
    { code: 'JPY', text: '5000', expected: 5000 },
    { code: 'JPY', text: '5000.5', expected: 5000 },
    { code: 'KWD', text: '1.2345', expected: 1234 },
    { code: 'KWD', text: '1.2335', expected: 1234 },
  ])('agrees on $text in $code', ({ code, text, expected }) => {
    const digits = minorUnitDigits(code)
    expect(parseMoney('en', text, code)).toBe(expected)
    expect(scaleDecimalString(text, digits)).toBe(BigInt(expected))
  })

  /**
   * The one place they are *supposed* to differ, and it is a division of labour rather than a
   * disagreement: `scaleDecimalString` accepts a canonical decimal only, so a locale-formatted
   * figure is `null` to it. Normalising the separators is `parseMoney`'s half of the job, and it
   * delegates the arithmetic straight back.
   */
  it('splits the work: parseMoney normalises, scaleDecimalString scales', () => {
    expect(parseMoney('pl', '1 234,56', 'PLN')).toBe(123_456)
    expect(scaleDecimalString('1 234,56', 2)).toBeNull()
    expect(scaleDecimalString('1234.56', 2)).toBe(123_456n)

    expect(parseMoney('pl', '1,2345', 'KWD')).toBe(1234)
    expect(scaleDecimalString('1,2345', 3)).toBeNull()
    expect(scaleDecimalString('1.2345', 3)).toBe(1234n)
  })
})

describe('the string path against the float path', () => {
  /**
   * Every amount a household reaches. `Intl` writes the shortest decimal that round-trips to the
   * same double, which for anything a person types is the decimal they typed, so the float in the
   * middle costs nothing here — including on the ties, where a naive `Math.round(value * 100)`
   * would already be wrong.
   */
  it.each<{
    locale: Locale
    text: string
    code: CurrencyCode
    expected: number
  }>([
    { locale: 'en', text: '1.015', code: PLN, expected: 102 },
    { locale: 'en', text: '0.125', code: PLN, expected: 12 },
    { locale: 'en', text: '1.005', code: PLN, expected: 100 },
    { locale: 'en', text: '2.675', code: PLN, expected: 268 },
    { locale: 'en', text: '8.835', code: PLN, expected: 884 },
    { locale: 'pl', text: '1 234,56', code: PLN, expected: 123_456 },
    { locale: 'en', text: '5000', code: JPY, expected: 5000 },
    { locale: 'en', text: '5000.5', code: JPY, expected: 5000 },
    { locale: 'en', text: '1.2345', code: KWD, expected: 1234 },
    { locale: 'pl', text: '1,2345', code: KWD, expected: 1234 },
  ])(
    'agree on $text in $locale for $code',
    ({ locale, text, code, expected }) => {
      const digits = minorUnitDigits(code)
      expect(parseMoney(locale, text, code)).toBe(expected)
      expect(toMinor(asNumberField(locale, text, digits), code)).toBe(expected)
    },
  )

  /**
   * The boundary, and the reason the consolidation goes towards the string.
   *
   * `90071992547409.91` is `MAX_MINOR` written as a decimal. No double names it: the nearest one
   * re-serialises as `90071992547409.9`, so the float path scales a *different* number than the
   * one that was typed and lands one minor unit low. The string path never converts, so it is
   * exact.
   */
  it('diverges by one minor unit at MAX_MINOR, and the string path is the correct one', () => {
    const text = '90071992547409.91'
    expect(parseMoney('en', text, PLN)).toBe(9_007_199_254_740_991)
    expect(toMinor(asNumberField('en', text, 2), PLN)).toBe(
      9_007_199_254_740_990,
    )
  })

  /**
   * Past the boundary the two do not merely differ in value, they differ in kind. `parseMoney`
   * reports `null`, which every caller already handles as "not an amount". `toMinor` reaches
   * `minorFromBigInt` and throws — inside a `NumberField`'s `onChange`, which is a render-path
   * crash rather than a validation message.
   */
  it.each(['90071992547409.92', '999999999999999999'])(
    'refuses %s as null on the string path and throws on the float path',
    (text) => {
      expect(parseMoney('en', text, PLN)).toBeNull()
      expect(() => toMinor(asNumberField('en', text, 2), PLN)).toThrow(
        MoneyOverflowError,
      )
    },
  )

  /**
   * The same boundary on the way out. `toAmountInputValue` pads and slices a string;
   * `toInputValue` divides by `10 ** digits`, and at `MAX_MINOR` that quotient has no exact
   * double either — so the field would show the reader a figure one minor unit below the one
   * that is stored.
   */
  it.each([
    { minor: 101, code: PLN, text: '1.01', float: 1.01 },
    { minor: 1234, code: PLN, text: '12.34', float: 12.34 },
    { minor: 5000, code: JPY, text: '5000', float: 5000 },
    { minor: 1234, code: KWD, text: '1.234', float: 1.234 },
    {
      minor: 900_719_925_474_099,
      code: PLN,
      text: '9007199254740.99',
      float: 9_007_199_254_740.99,
    },
  ])(
    'agree on the way out for $minor in $code',
    ({ minor, code, text, float }) => {
      expect(toAmountInputValue('en', makeMoney(asMinor(minor), code))).toBe(
        text,
      )
      expect(toInputValue(asMinor(minor), code)).toBe(float)
    },
  )

  it('loses a minor unit on the way out at MAX_MINOR, where the string path does not', () => {
    const minor = asMinor(9_007_199_254_740_991)
    expect(toAmountInputValue('en', makeMoney(minor, PLN))).toBe(
      '90071992547409.91',
    )
    expect(toInputValue(minor, PLN)).toBe(90_071_992_547_409.9)
  })
})
