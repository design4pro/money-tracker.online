/**
 * The one thing this whole area is judged on: the money.
 *
 * **A parse produces integer minor units or it produces an error - never a float.** Every case
 * `docs/plans/19-import.md` names under "Money invariant" is here, including the type-level one:
 * `parseAmountCell` returns a branded `Minor`, and the runtime assertion beside it is
 * `Number.isInteger`, because a branded type is a compile-time promise and this file is where it
 * becomes evidence.
 *
 * The file sits beside `../amount.ts` rather than under `./csv/` because the module does. A cell
 * becomes an amount in exactly one function, and the OFX and QIF cells `19-S4` adds go through the
 * same one: their cases belong next to these, in a file no other stage has to reach into.
 */

import { describe, expect, it } from 'vitest'

import { isMinor } from '#/lib/money'
import { parseAmountCell } from '../amount'

import type { Minor } from '#/lib/money'

/* -------------------------------------------------------------------------- */
/* The money invariant                                                         */
/* -------------------------------------------------------------------------- */

/**
 * These cases are about `../amount.ts` and not about any one format's scanner: a scanner returns
 * text by design, and the single place a cell becomes an amount is the one function below.
 */
describe('the amount of a cell is minor units or an error, never a float', () => {
  const pln = { currencyCode: 'PLN', decimal: 'comma' } as const
  const usd = { currencyCode: 'USD', decimal: 'dot' } as const

  function minorOf(
    cell: string,
    options: Parameters<typeof parseAmountCell>[1],
  ) {
    const result = parseAmountCell(cell, options)
    if (!result.ok) throw new Error(`expected an amount, got ${result.code}`)
    return result.amountMinor
  }

  it('reads every grouping and decimal convention to the same 123456, under the stated one', () => {
    expect(minorOf('1 234,56', pln)).toBe(123_456)
    expect(minorOf('1.234,56', pln)).toBe(123_456)
    expect(minorOf('1234,56', pln)).toBe(123_456)
    expect(minorOf('1,234.56', usd)).toBe(123_456)
    expect(minorOf('1234.56', usd)).toBe(123_456)
    // A non-breaking space is what `Intl` itself emits for Polish grouping.
    expect(minorOf('1 234,56', pln)).toBe(123_456)
  })

  it('never guesses the convention: the same cell means two different things and is told which', () => {
    // The 100× error this parameter exists to prevent, demonstrated in two assertions: under the
    // comma convention `1.234` is a thousand-and-something, and under the dot convention it is one
    // point two three four — which a two-digit currency cannot hold, so it is refused rather than
    // quietly rounded to 1.23.
    expect(minorOf('1.234', pln)).toBe(123_400)
    expect(
      parseAmountCell('1.234', { currencyCode: 'USD', decimal: 'dot' }),
    ).toEqual({ ok: false, code: 'amount_too_precise' })
  })

  it('reads both spellings of a negative when accounting negatives are on', () => {
    const accounting = { ...usd, accountingNegatives: true } as const
    expect(minorOf('(45.00)', accounting)).toBe(-4500)
    expect(minorOf('-45.00', accounting)).toBe(-4500)
    // A trailing minus, which several exports write.
    expect(minorOf('45.00-', accounting)).toBe(-4500)
  })

  it('refuses parentheses when accounting negatives are off rather than inventing a sign', () => {
    expect(parseAmountCell('(45.00)', usd)).toEqual({
      ok: false,
      code: 'amount_unparseable',
    })
  })

  it('strips a currency symbol and a non-breaking space on either side', () => {
    expect(minorOf('45,00 zł', pln)).toBe(4500)
    expect(minorOf('zł 45,00', pln)).toBe(4500)
    expect(minorOf('$45.00', usd)).toBe(4500)
    expect(minorOf('45.00 USD', usd)).toBe(4500)
  })

  it('refuses a different currency in the cell instead of coercing it', () => {
    expect(
      parseAmountCell('45.00 EUR', { currencyCode: 'PLN', decimal: 'dot' }),
    ).toEqual({
      ok: false,
      code: 'amount_currency_mismatch',
    })
  })

  it('refuses more decimal places than the currency has, never rounding them away', () => {
    expect(parseAmountCell('45,005', pln)).toEqual({
      ok: false,
      code: 'amount_too_precise',
    })
    // The zero-decimal case: a yen has no fraction at all, so even one place is too many.
    expect(
      parseAmountCell('1200.5', { currencyCode: 'JPY', decimal: 'dot' }),
    ).toEqual({ ok: false, code: 'amount_too_precise' })
  })

  it('scales by the currency’s own digits, so 1200 JPY is 1200 and not 120000', () => {
    expect(minorOf('1200', { currencyCode: 'JPY', decimal: 'dot' })).toBe(1200)
    expect(minorOf('1200', usd)).toBe(120_000)
    // Three-digit currencies exist and the scale follows them too: 1.234 KWD is 1234 fils, while
    // the same digits grouped rather than fractional are a thousand dinars.
    expect(minorOf('1.234', { currencyCode: 'KWD', decimal: 'dot' })).toBe(1234)
    expect(minorOf('1,234', { currencyCode: 'KWD', decimal: 'dot' })).toBe(
      1_234_000,
    )
  })

  it('refuses a malformed figure rather than reading something out of it', () => {
    for (const cell of ['1.2.3,4', '45,', 'abc', '--45,00', '', '   ']) {
      expect(parseAmountCell(cell, pln).ok).toBe(false)
    }
    // Grouping that is not grouping: `12.34.56` is not a number in any locale.
    expect(parseAmountCell('12.34.56', pln)).toEqual({
      ok: false,
      code: 'amount_unparseable',
    })
  })

  it('refuses an amount past the exact-integer range instead of losing its last digits', () => {
    expect(parseAmountCell('99999999999999999,99', pln)).toEqual({
      ok: false,
      code: 'amount_out_of_range',
    })
  })

  it('never returns a JavaScript number for an amount', () => {
    const result = parseAmountCell('1 234,56', pln)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The type-level half: `amountMinor` is `Minor`, and a plain `number` does not satisfy it.
    const typed: Minor = result.amountMinor
    // @ts-expect-error — a bare number is not a `Minor`, which is the whole point of the brand.
    const untyped: Minor = 123_456
    void untyped

    // The runtime half: it is an exact integer, and it came from the money module's own guard.
    expect(isMinor(typed)).toBe(true)
    expect(Number.isInteger(typed)).toBe(true)
    expect(typed).toBe(123_456)
  })

  it('produces an integer for every cell it accepts, over the whole fixture set', () => {
    const cells = ['0,00', '0,01', '-0,01', '9,99', '1 000 000,01', '12,10']
    for (const cell of cells) {
      const result = parseAmountCell(cell, pln)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(Number.isInteger(result.amountMinor)).toBe(true)
        expect(isMinor(result.amountMinor)).toBe(true)
      }
    }
  })
})
