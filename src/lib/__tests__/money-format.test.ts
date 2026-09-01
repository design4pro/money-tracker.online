import { describe, expect, it } from 'vitest'

import {
  asRateE10,
  formatMoney,
  formatMoneyPlain,
  formatRateE10,
  formatSignedMoney,
  makeMoney,
  parseMoney,
  toAmountInputValue,
} from '../money'

import type { Locale } from '../i18n'
import type { Money } from '../money'

/**
 * Whitespace inside a formatted figure is a non-breaking space in Polish and an
 * ordinary one in English, and CLDR has moved which it uses before. Comparisons
 * that are about the digits rather than about the spacing run through this.
 */
function tight(value: string): string {
  return value.replace(/\s/g, '')
}

/** U+00A0, which is what Polish groups thousands with. */
const NBSP = ' '

describe('formatMoney', () => {
  it('puts the symbol where each language puts it', () => {
    expect(formatMoney('en', makeMoney(123_456, 'USD'))).toBe('$1,234.56')
    expect(tight(formatMoney('pl', makeMoney(123_456, 'PLN')))).toBe(
      '1234,56zł',
    )
  })

  it('renders a zero-decimal currency in whole units', () => {
    // The reference product stored 5000 JPY as 500000 and showed ¥50.00.
    expect(formatMoney('en', makeMoney(5000, 'JPY'))).toBe('¥5,000')
    expect(tight(formatMoney('pl', makeMoney(5000, 'JPY')))).toBe('5000¥')
  })

  it('renders a three-decimal currency with all three', () => {
    expect(tight(formatMoney('en', makeMoney(1234, 'KWD')))).toBe('KWD1.234')
    expect(tight(formatMoney('pl', makeMoney(1234, 'KWD')))).toBe('1,234KWD')
  })

  it('groups thousands in both languages, and stops when asked to', () => {
    expect(formatMoney('pl', makeMoney(12_345_678, 'PLN'))).toContain(
      `123${NBSP}456`,
    )
    expect(formatMoney('en', makeMoney(12_345_678, 'USD'))).toContain('123,456')
    expect(
      formatMoney('en', makeMoney(12_345_678, 'USD'), { grouping: false }),
    ).toBe('$123456.78')
  })

  it('names the currency the way the caller asked', () => {
    const amount = makeMoney(123_456, 'USD')
    expect(tight(formatMoney('en', amount, { display: 'code' }))).toBe(
      'USD1,234.56',
    )
    expect(formatMoney('en', amount, { display: 'name' })).toContain(
      'US dollar',
    )
    expect(formatMoney('en', amount, { display: 'none' })).toBe('1,234.56')
    expect(formatMoneyPlain('en', amount)).toBe('1,234.56')
  })

  it('shows a sign only when the caller wants one', () => {
    expect(formatMoney('en', makeMoney(-123_456, 'USD'))).toBe('-$1,234.56')
    expect(
      formatMoney('en', makeMoney(123_456, 'USD'), { signDisplay: 'always' }),
    ).toBe('+$1,234.56')
  })

  it('renders zero without inventing a direction for it', () => {
    expect(formatMoney('en', makeMoney(0, 'USD'))).toBe('$0.00')
    expect(formatMoney('en', makeMoney(0, 'JPY'))).toBe('¥0')
  })
})

describe('formatSignedMoney', () => {
  it('uses a typographic minus, not a hyphen, so a column stays a column', () => {
    expect(formatSignedMoney('en', makeMoney(-123_456, 'USD'))).toBe(
      '−$1,234.56',
    )
    expect(formatSignedMoney('en', makeMoney(-123_456, 'USD'))).not.toContain(
      '-',
    )
  })

  it('marks a credit with a plus', () => {
    expect(formatSignedMoney('en', makeMoney(123_456, 'USD'))).toBe(
      '+$1,234.56',
    )
  })

  it('leaves zero unsigned, because a settled balance is not a direction', () => {
    expect(formatSignedMoney('en', makeMoney(0, 'USD'))).toBe('$0.00')
    expect(tight(formatSignedMoney('pl', makeMoney(0, 'PLN')))).toBe('0,00zł')
  })
})

describe('toAmountInputValue', () => {
  it('is exact at every magnitude, because it moves the point in a string', () => {
    expect(toAmountInputValue('en', makeMoney(123_456, 'USD'))).toBe('1234.56')
    expect(toAmountInputValue('pl', makeMoney(123_456, 'PLN'))).toBe('1234,56')
    expect(
      toAmountInputValue('en', makeMoney(9_007_199_254_740_991, 'USD')),
    ).toBe('90071992547409.91')
  })

  it('pads a value smaller than one major unit', () => {
    expect(toAmountInputValue('en', makeMoney(5, 'USD'))).toBe('0.05')
    expect(toAmountInputValue('en', makeMoney(0, 'USD'))).toBe('0.00')
    expect(toAmountInputValue('pl', makeMoney(1, 'PLN'))).toBe('0,01')
  })

  it('writes no fraction at all for a zero-decimal currency', () => {
    expect(toAmountInputValue('en', makeMoney(5000, 'JPY'))).toBe('5000')
    expect(toAmountInputValue('pl', makeMoney(0, 'JPY'))).toBe('0')
  })

  it('writes all three digits of a three-decimal currency', () => {
    expect(toAmountInputValue('en', makeMoney(1234, 'KWD'))).toBe('1.234')
    expect(toAmountInputValue('pl', makeMoney(1234, 'KWD'))).toBe('1,234')
  })

  it('keeps a sign and no grouping, because the reader is editing this', () => {
    expect(toAmountInputValue('en', makeMoney(-123_456, 'USD'))).toBe(
      '-1234.56',
    )
    expect(toAmountInputValue('en', makeMoney(12_345_678, 'USD'))).toBe(
      '123456.78',
    )
  })
})

describe('parseMoney', () => {
  it('reads the separators the reader types', () => {
    expect(parseMoney('pl', `1${NBSP}234,56`, 'PLN')).toBe(123_456)
    expect(parseMoney('pl', '1 234,56', 'PLN')).toBe(123_456)
    expect(parseMoney('en', '1,234.56', 'USD')).toBe(123_456)
  })

  it('reads a figure pasted out of the other language', () => {
    // Three digits after a character Polish never uses as a decimal point.
    expect(parseMoney('pl', '1.234', 'PLN')).toBe(123_400)
    expect(parseMoney('en', '1,234', 'USD')).toBe(123_400)
    // …but two digits after it is a decimal point, not a grouping mark.
    expect(parseMoney('pl', '1.2', 'PLN')).toBe(120)
    expect(parseMoney('en', '1,2', 'USD')).toBe(120)
  })

  it('takes the last of the two characters as the decimal point', () => {
    expect(parseMoney('pl', '1.234,56', 'PLN')).toBe(123_456)
    expect(parseMoney('en', '1,234.56', 'USD')).toBe(123_456)
    expect(parseMoney('pl', '1,234.56', 'PLN')).toBe(123_456)
  })

  it('lets the local separator win a genuine ambiguity', () => {
    // `1,234` in Polish is one and twenty-three hundredths, rounded from 1.234.
    expect(parseMoney('pl', '1,234', 'PLN')).toBe(123)
  })

  it('reads a repeated separator as grouping', () => {
    expect(parseMoney('en', '1.234.567', 'USD')).toBe(123_456_700)
    expect(parseMoney('pl', '1 234 567', 'PLN')).toBe(123_456_700)
  })

  it('discards a currency symbol, code or label on either end', () => {
    expect(parseMoney('pl', '12,34 zł', 'PLN')).toBe(1234)
    expect(parseMoney('pl', 'PLN 12,34', 'PLN')).toBe(1234)
    expect(parseMoney('en', '$1,234.56', 'USD')).toBe(123_456)
    expect(parseMoney('en', '1,234.56 USD', 'USD')).toBe(123_456)
  })

  it('reads a sign at either end, and the accounting parentheses an export writes', () => {
    expect(parseMoney('en', '-12.34', 'USD')).toBe(-1234)
    expect(parseMoney('en', '12.34-', 'USD')).toBe(-1234)
    expect(parseMoney('en', '−12.34', 'USD')).toBe(-1234)
    expect(parseMoney('en', '(12.34)', 'USD')).toBe(-1234)
    expect(parseMoney('en', '+12.34', 'USD')).toBe(1234)
  })

  it('scales to the currency digits, not to two', () => {
    expect(parseMoney('en', '5000', 'JPY')).toBe(5000)
    expect(parseMoney('en', '5,000', 'JPY')).toBe(5000)
    expect(parseMoney('en', '1.234', 'KWD')).toBe(1234)
    expect(parseMoney('pl', '1,234', 'KWD')).toBe(1234)
  })

  it('rounds what does not fit half to even, never by a float multiplication', () => {
    // `1.005 * 100` is 100.49999999999999 in IEEE 754.
    expect(parseMoney('en', '1.005', 'USD')).toBe(100)
    expect(parseMoney('en', '1.015', 'USD')).toBe(102)
    expect(parseMoney('en', '160.5', 'JPY')).toBe(160)
    expect(parseMoney('en', '161.5', 'JPY')).toBe(162)
  })

  it('answers null for anything that is not a single decimal number', () => {
    for (const text of ['', '   ', 'abc', '1a2', '12-34', '()', '.']) {
      expect(parseMoney('en', text, 'USD'), text).toBeNull()
    }
  })

  /**
   * Reading `1.2.3,4` as 123.4 — strip the dots, take the comma as the point —
   * is what the separator rules do on their own. An import row that guesses is
   * worse than one that reports an error.
   */
  it('answers null for grouping that is not grouping', () => {
    for (const text of ['1.2.3,4', '1,23,456.78', '1.2.3', '12,34,56']) {
      expect(parseMoney('en', text, 'USD'), text).toBeNull()
    }
  })

  it('answers null rather than an amount that has left the safe range', () => {
    expect(parseMoney('en', '999999999999999999.99', 'USD')).toBeNull()
  })
})

/**
 * The round trip is the property the transaction editor leans on: what a reader
 * sees in the field, edits and submits has to be the amount that was stored.
 */
describe('the parse/format round trip', () => {
  /**
   * Above this, the major-unit float inside the formatter can no longer name
   * the last minor unit; see the test at the bottom of this block.
   */
  const DISPLAY_EXACT_TO = 1_000_000_000_000_000

  const CASES: ReadonlyArray<Money> = [
    makeMoney(0, 'USD'),
    makeMoney(1, 'USD'),
    makeMoney(5, 'PLN'),
    makeMoney(-1, 'PLN'),
    makeMoney(123_456, 'PLN'),
    makeMoney(-123_456, 'EUR'),
    makeMoney(12_345_678, 'USD'),
    makeMoney(0, 'JPY'),
    makeMoney(5000, 'JPY'),
    makeMoney(-5000, 'JPY'),
    makeMoney(1234, 'KWD'),
    makeMoney(-1_000_000, 'KWD'),
    makeMoney(9_007_199_254_740_991, 'USD'),
  ]

  for (const locale of ['en', 'pl'] as ReadonlyArray<Locale>) {
    it(`survives an edit in ${locale}`, () => {
      for (const amount of CASES) {
        const typed = toAmountInputValue(locale, amount)
        expect(
          parseMoney(locale, typed, amount.currencyCode),
          `${locale}: ${amount.amountMinor} ${amount.currencyCode} rendered as "${typed}"`,
        ).toBe(amount.amountMinor)
      }
    })

    it(`survives a copy of the displayed figure in ${locale}`, () => {
      for (const amount of CASES) {
        if (amount.amountMinor > DISPLAY_EXACT_TO) {
          continue
        }
        const displayed = formatMoney(locale, amount)
        expect(
          parseMoney(locale, displayed, amount.currencyCode),
          `${locale}: ${amount.amountMinor} ${amount.currencyCode} shown as "${displayed}"`,
        ).toBe(amount.amountMinor)
      }
    })
  }

  /**
   * The one place a major-unit float exists is inside the formatter, and this
   * is the magnitude at which it stops being harmless: the double nearest
   * 90 071 992 547 409.91 is …409.90625, and rendering that to two places
   * loses the last grosz. The stored amount is unaffected, `toAmountInputValue`
   * is exact at every magnitude, and no household reaches ninety trillion — but
   * the limit is real and is pinned here rather than discovered.
   */
  it('is exact in the field but not on screen past ~10^15 minor units', () => {
    const enormous = makeMoney(9_007_199_254_740_991, 'USD')
    expect(parseMoney('en', toAmountInputValue('en', enormous), 'USD')).toBe(
      enormous.amountMinor,
    )
    const displayed = parseMoney('en', formatMoney('en', enormous), 'USD') ?? 0
    expect(displayed).not.toBe(enormous.amountMinor)
    expect(Math.abs(displayed - enormous.amountMinor)).toBeLessThanOrEqual(1)
  })
})

describe('formatRateE10', () => {
  it('reads as a bank quote, in the local separators', () => {
    expect(formatRateE10('en', asRateE10(43_218_000_000), 'EUR', 'PLN')).toBe(
      '1 EUR = 4.3218 PLN',
    )
    expect(
      tight(formatRateE10('pl', asRateE10(43_218_000_000), 'EUR', 'PLN')),
    ).toBe('1EUR=4,3218PLN')
  })

  it('keeps four digits on a round rate and six on a small one', () => {
    expect(formatRateE10('en', asRateE10(10_000_000_000), 'EUR', 'EUR')).toBe(
      '1 EUR = 1.0000 EUR',
    )
    expect(formatRateE10('en', asRateE10(2_313_851), 'PLN', 'JPY')).toBe(
      '1 PLN = 0.000231 JPY',
    )
  })
})
