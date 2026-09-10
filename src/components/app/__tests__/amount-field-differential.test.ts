import { describe, expect, it } from 'vitest'
import { NumberParser } from '@internationalized/number'

import {
  asCurrencyCode,
  asMinor,
  makeMoney,
  minorUnitDigits,
  MoneyOverflowError,
  parseMoney,
  scaleDecimalString,
  toAmountInputValue,
} from '#/lib/money'

import {
  toInputValue,
  toMinor,
} from '#/components/app/transactions/amount-field'

import type { Locale } from '#/lib/i18n'

/**
 * The measurement issue #106 asked for before either amount field was allowed to absorb the
 * other: do the two conversions the product actually ships agree, and where do they not?
 *
 * Two components named `amount-field.tsx` turn typed text into `Minor`, and each docblock treats
 * the other's approach as the defect:
 *
 * - `app/accounts/amount-field.tsx` hands the raw text to `parseMoney`, which normalises the
 *   separators and then moves the decimal point **inside the string** via `scaleDecimalString`.
 *   No float exists at any point.
 * - `app/transactions/amount-field.tsx` lets React Aria's `NumberField` parse the text into a
 *   decimal `number`, re-serialises that double to its shortest round-tripping decimal, and hands
 *   *that* string to the same `scaleDecimalString`. One float exists, in the middle.
 *
 * Both therefore end in the same rounding routine, so `parseMoney` and `scaleDecimalString` cannot
 * disagree about a half-way tie: `parseMoney` *is* `scaleDecimalString` plus separator
 * normalisation. What the float in the middle can still cost is a value that no longer names the
 * decimal the person typed, and that is what the second half of this file pins down.
 *
 * The verdict, from the numbers below: the two paths agree on every amount a person can put in a
 * form, and diverge only at the `MAX_MINOR` boundary — where the string path is right and the
 * float path is wrong by one minor unit, or throws where the string path reports `null`.
 */

const PLN = asCurrencyCode('PLN')
const JPY = asCurrencyCode('JPY')
const KWD = asCurrencyCode('KWD')

/** What React Aria hands the transactions field for a given typed text. */
function asNumberField(locale: Locale, text: string, digits: number): number {
  return new NumberParser(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).parse(text)
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
  it.each([
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
    { minor: 101, text: '1.01', float: 1.01 },
    { minor: 1234, text: '12.34', float: 12.34 },
    {
      minor: 900_719_925_474_099,
      text: '9007199254740.99',
      float: 9_007_199_254_740.99,
    },
  ])('agree on the way out for $minor', ({ minor, text, float }) => {
    expect(toAmountInputValue('en', makeMoney(asMinor(minor), PLN))).toBe(text)
    expect(toInputValue(asMinor(minor), PLN)).toBe(float)
  })

  it('loses a minor unit on the way out at MAX_MINOR, where the string path does not', () => {
    const minor = asMinor(9_007_199_254_740_991)
    expect(toAmountInputValue('en', makeMoney(minor, PLN))).toBe(
      '90071992547409.91',
    )
    expect(toInputValue(minor, PLN)).toBe(90_071_992_547_409.9)
  })
})
