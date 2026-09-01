import { describe, expect, it } from 'vitest'

import {
  CURRENCIES,
  CURRENCY_CODES,
  currenciesForPicker,
  currencyEntry,
  currencyName,
  currencySymbol,
  isKnownCurrency,
  minorUnitDigits,
  minorUnitScale,
  minorUnitScaleBig,
  parseCurrencyCode,
  requireCurrency,
} from '../money'
import {
  CURRENCY_SEED_ROWS,
  DEFAULT_BASE_CURRENCY_CODE,
  DEFAULT_WORKSPACE_CURRENCY_CODES,
} from '#/server/catalog/data/currencies'

describe('the catalogue', () => {
  it('covers what a European household needs, first-class and first', () => {
    expect(CURRENCY_CODES.slice(0, 11)).toEqual([
      'PLN',
      'EUR',
      'USD',
      'GBP',
      'CHF',
      'CZK',
      'SEK',
      'NOK',
      'DKK',
      'HUF',
      'UAH',
    ])
    expect(CURRENCIES.length).toBeGreaterThanOrEqual(40)
  })

  it('has no duplicate alphabetic or numeric code', () => {
    expect(new Set(CURRENCIES.map((entry) => entry.code)).size).toBe(
      CURRENCIES.length,
    )
    expect(new Set(CURRENCIES.map((entry) => entry.numericCode)).size).toBe(
      CURRENCIES.length,
    )
  })

  it('spells every code as three uppercase letters', () => {
    for (const entry of CURRENCIES) {
      expect(entry.code, entry.code).toMatch(/^[A-Z]{3}$/)
      expect(entry.numericCode).toBeGreaterThan(0)
      expect(entry.numericCode).toBeLessThan(1000)
    }
  })

  it('names every currency in both languages, with Polish diacritics intact', () => {
    for (const entry of CURRENCIES) {
      expect(entry.name.length, entry.code).toBeGreaterThan(2)
      expect(entry.namePl.length, entry.code).toBeGreaterThan(2)
    }
    expect(currencyName('PLN', 'pl')).toBe('Złoty polski')
    expect(currencyName('CZK', 'pl')).toBe('Korona czeska')
    expect(currencyName('ZAR', 'pl')).toContain('południowoafrykański')
    expect(currencyName('PLN', 'en')).toBe('Polish złoty')
  })

  it('carries no metal, fund or placeholder code', () => {
    for (const banned of ['XAU', 'XAG', 'XPT', 'XPD', 'XDR', 'XXX', 'XTS']) {
      expect(isKnownCurrency(banned), banned).toBe(false)
    }
  })

  it('is frozen at both levels', () => {
    expect(Object.isFrozen(CURRENCIES)).toBe(true)
    expect(Object.isFrozen(CURRENCIES[0])).toBe(true)
  })
})

describe('minor units', () => {
  it('knows the zero-decimal currencies', () => {
    for (const code of ['JPY', 'KRW', 'VND', 'CLP', 'ISK']) {
      expect(minorUnitDigits(code), code).toBe(0)
      expect(minorUnitScale(code), code).toBe(1)
      expect(minorUnitScaleBig(code), code).toBe(1n)
    }
  })

  it('knows the three-decimal currencies', () => {
    for (const code of ['KWD', 'BHD', 'OMR', 'JOD', 'TND']) {
      expect(minorUnitDigits(code), code).toBe(3)
      expect(minorUnitScale(code), code).toBe(1000)
      expect(minorUnitScaleBig(code), code).toBe(1000n)
    }
  })

  it('gives the ordinary currencies two', () => {
    for (const code of ['PLN', 'EUR', 'USD', 'GBP', 'CHF', 'HUF', 'UAH']) {
      expect(minorUnitDigits(code), code).toBe(2)
    }
  })

  /**
   * The table stores the **ISO 4217 accounting** scale; CLDR stores what a
   * shop rounds to. They differ for four codes, and this test pins exactly
   * which four so a fifth cannot appear unnoticed.
   *
   * The ISO value is the one a ledger needs: the forint's fillér is gone from
   * circulation but not from a bank statement, and a stored amount that cannot
   * express the second digit cannot be reconciled against one that can. The
   * display side never sees the difference, because every formatter in
   * `./money/format.ts` passes the table's `digits` explicitly.
   */
  const CLDR_DIVERGENCE: Readonly<Record<string, number>> = {
    HUF: 0,
    IDR: 0,
    ALL: 0,
    COP: 0,
  }

  it('agrees with the platform CLDR data except where ISO deliberately differs', () => {
    const disagreements: Array<string> = []
    for (const entry of CURRENCIES) {
      const fromIntl = new Intl.NumberFormat('en', {
        style: 'currency',
        currency: entry.code,
      }).resolvedOptions().minimumFractionDigits
      const expected = CLDR_DIVERGENCE[entry.code] ?? entry.digits
      if (fromIntl !== expected) {
        disagreements.push(
          `${entry.code}: expected Intl ${expected}, got ${fromIntl}`,
        )
      }
    }
    expect(disagreements).toEqual([])
  })

  it('keeps the ISO scale for the four codes CLDR rounds away', () => {
    for (const code of Object.keys(CLDR_DIVERGENCE)) {
      expect(minorUnitDigits(code), code).toBe(2)
    }
  })

  it('falls back to two for a well-formed code the table has not caught up with', () => {
    expect(minorUnitDigits('ZZZ')).toBe(2)
  })
})

describe('lookups', () => {
  it('finds a row, or answers undefined', () => {
    expect(currencyEntry('PLN')?.symbol).toBe('zł')
    expect(currencyEntry('pln')).toBeUndefined()
    expect(currencyEntry('ZZZ')).toBeUndefined()
  })

  it('throws at a write boundary rather than storing an unknown currency', () => {
    expect(() => requireCurrency('ZZZ')).toThrow(/Unknown currency code/)
    expect(requireCurrency('EUR').digits).toBe(2)
  })

  it('normalises what an import file or a form supplies', () => {
    expect(parseCurrencyCode(' eur ')).toBe('EUR')
    expect(parseCurrencyCode('pln')).toBe('PLN')
    expect(parseCurrencyCode('EURO')).toBeNull()
    expect(parseCurrencyCode('ZZZ')).toBeNull()
    expect(parseCurrencyCode('')).toBeNull()
  })

  it('falls back to the code when there is no glyph or name to show', () => {
    expect(currencySymbol('ZZZ')).toBe('ZZZ')
    expect(currencyName('ZZZ', 'pl')).toBe('ZZZ')
  })
})

describe('the picker order', () => {
  it('keeps the first-class currencies at the top and sorts the rest by name', () => {
    const polish = currenciesForPicker('pl')
    expect(polish.slice(0, 3).map((entry) => entry.code)).toEqual([
      'PLN',
      'EUR',
      'USD',
    ])
    expect(polish.length).toBe(CURRENCIES.length)

    const tail = polish.slice(11).map((entry) => currencyName(entry.code, 'pl'))
    expect(tail).toEqual([...tail].toSorted(new Intl.Collator('pl').compare))
  })

  it('sorts the tail differently in each language, which is the point', () => {
    const inPolish = currenciesForPicker('pl').map((entry) => entry.code)
    const inEnglish = currenciesForPicker('en').map((entry) => entry.code)
    expect(inPolish).not.toEqual(inEnglish)
  })
})

describe('the D1 seed projection', () => {
  it('derives one row per catalogue currency rather than restating the table', () => {
    expect(CURRENCY_SEED_ROWS.length).toBe(CURRENCIES.length)
    for (const [index, row] of CURRENCY_SEED_ROWS.entries()) {
      const entry = CURRENCIES[index]
      expect(row.code).toBe(entry.code)
      expect(row.name).toBe(entry.name)
      expect(row.digits).toBe(entry.digits)
      expect(row.numericCode).toBe(entry.numericCode)
      expect(row.isDisabled).toBe(false)
    }
  })

  it('starts a workspace in a currency the catalogue actually carries', () => {
    expect(isKnownCurrency(DEFAULT_BASE_CURRENCY_CODE)).toBe(true)
    for (const code of DEFAULT_WORKSPACE_CURRENCY_CODES) {
      expect(isKnownCurrency(code), code).toBe(true)
    }
    expect(DEFAULT_WORKSPACE_CURRENCY_CODES).toContain(
      DEFAULT_BASE_CURRENCY_CODE,
    )
  })
})
