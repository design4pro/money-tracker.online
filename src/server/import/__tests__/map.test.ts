/**
 * The confirmed mapping, applied.
 *
 * Two things are being held here and the second is the reason the file exists.
 *
 * **The money rules are `amount.ts`'s** and are tested beside that module; what is asserted here is
 * the shape this layer puts around them — that the sign leaves `amount_minor` and becomes
 * `direction`, that a debit and a credit on one line is a refusal rather than a sum, and that a
 * row in another currency is refused rather than converted.
 *
 * **The date rules are this module's**, and the DMY/MDY case is the one that matters: a sample
 * whose every component is 12 or lower has to come back `ambiguous`, and nothing anywhere may
 * supply a default. The cost of the opposite is up to twelve rows in every thirty-one landing in
 * the wrong month, each individually plausible, discovered months later.
 */

import { describe, expect, it } from 'vitest'

import { isMinor } from '#/lib/money'

import {
  DATE_FORMATS,
  UnknownMappingColumnError,
  decimalConventionOf,
  mapRows,
  mappingSchema,
  parseDateCell,
  suggestDateFormat,
} from '../map'

import type { ImportMappingInput } from '../map'

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const HEADERS = ['data', 'opis', 'kwota', 'waluta', 'ref']

const base: ImportMappingInput = {
  accountId: 'acc-a',
  date: 'data',
  dateFormat: 'YYYY-MM-DD',
  amount: { kind: 'signed', column: 'kwota' },
  decimalSeparator: ',',
  thousandsSeparator: ' ',
  accountingNegatives: false,
  description: 'opis',
}

const mapping = (patch: Partial<ImportMappingInput> = {}) =>
  mappingSchema.parse({ ...base, ...patch })

const run = (
  rows: ReadonlyArray<ReadonlyArray<string>>,
  patch: Partial<ImportMappingInput> = {},
  currencyCode = 'PLN',
) => mapRows({ headers: HEADERS, rows }, mapping(patch), { currencyCode })

/* -------------------------------------------------------------------------- */
/* The schema                                                                  */
/* -------------------------------------------------------------------------- */

describe('mappingSchema', () => {
  it('has no default for the date format, which is the whole DMY/MDY rule', () => {
    const { dateFormat: _dropped, ...withoutFormat } = base
    expect(() => mappingSchema.parse(withoutFormat)).toThrow()
  })

  it('refuses a mapping that names one character as both separators', () => {
    expect(() =>
      mapping({ decimalSeparator: ',', thousandsSeparator: ',' }),
    ).toThrow()
  })

  it('refuses a debit/credit pair that points at one column twice', () => {
    expect(() =>
      mapping({
        amount: {
          kind: 'debit_credit',
          debitColumn: 'kwota',
          creditColumn: 'kwota',
        },
      }),
    ).toThrow()
  })

  it('refuses a key it has never heard of, so a stale client fails loudly', () => {
    expect(() => mapping({ nonsense: 'x' } as never)).toThrow()
  })

  it('keeps every optional target optional', () => {
    const parsed = mapping({ description: undefined })
    expect(parsed.description).toBeUndefined()
    expect(parsed.sourceRef).toBeUndefined()
  })

  it('translates the confirmed separator into the converter’s vocabulary', () => {
    expect(decimalConventionOf(',')).toBe('comma')
    expect(decimalConventionOf('.')).toBe('dot')
  })
})

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

describe('parseDateCell', () => {
  it('reads each named layout into the same calendar date', () => {
    const cells: Record<(typeof DATE_FORMATS)[number], string> = {
      'YYYY-MM-DD': '2026-04-03',
      'DD/MM/YYYY': '03/04/2026',
      'MM/DD/YYYY': '04/03/2026',
      'DD.MM.YYYY': '03.04.2026',
    }
    for (const format of DATE_FORMATS) {
      expect(parseDateCell(cells[format], format)).toEqual({
        ok: true,
        bookedOn: '2026-04-03',
      })
    }
  })

  it('zero-pads, because booked_on is compared as text', () => {
    expect(parseDateCell('3/4/2026', 'DD/MM/YYYY')).toEqual({
      ok: true,
      bookedOn: '2026-04-03',
    })
  })

  it('drops a time the export appended, rather than inventing an instant', () => {
    expect(parseDateCell('2026-04-03 10:31:00', 'YYYY-MM-DD')).toEqual({
      ok: true,
      bookedOn: '2026-04-03',
    })
    expect(parseDateCell('2026-04-03T10:31:00Z', 'YYYY-MM-DD')).toEqual({
      ok: true,
      bookedOn: '2026-04-03',
    })
  })

  it('refuses a two-digit year rather than windowing it into a century', () => {
    expect(parseDateCell('03/04/26', 'DD/MM/YYYY')).toEqual({
      ok: false,
      code: 'date_unparseable',
    })
  })

  it('refuses a date that does not exist, and knows about leap years', () => {
    expect(parseDateCell('31.02.2026', 'DD.MM.YYYY').ok).toBe(false)
    expect(parseDateCell('29.02.2026', 'DD.MM.YYYY')).toEqual({
      ok: false,
      code: 'date_impossible',
    })
    expect(parseDateCell('29.02.2024', 'DD.MM.YYYY')).toEqual({
      ok: true,
      bookedOn: '2024-02-29',
    })
  })

  it('names an empty cell separately from an unreadable one', () => {
    expect(parseDateCell('   ', 'YYYY-MM-DD')).toEqual({
      ok: false,
      code: 'date_empty',
    })
    expect(parseDateCell('wczoraj', 'YYYY-MM-DD')).toEqual({
      ok: false,
      code: 'date_unparseable',
    })
  })
})

describe('suggestDateFormat', () => {
  it('rejects a slash sample whose every component is 12 or lower as ambiguous', () => {
    const suggestion = suggestDateFormat([
      '03/04/2026',
      '01/02/2026',
      '11/12/2026',
    ])
    expect(suggestion.kind).toBe('ambiguous')
    expect(suggestion).toEqual({
      kind: 'ambiguous',
      candidates: ['DD/MM/YYYY', 'MM/DD/YYYY'],
    })
  })

  it('never answers a format for an ambiguous sample, at any sample size', () => {
    const everyDayUnderThirteen = Array.from({ length: 40 }, (_, at) => {
      const day = (at % 12) + 1
      return `${String(day).padStart(2, '0')}/0${(at % 9) + 1}/2026`
    })
    expect(suggestDateFormat(everyDayUnderThirteen).kind).toBe('ambiguous')
  })

  it('settles on day-first the moment one row has a day past the twelfth', () => {
    expect(suggestDateFormat(['03/04/2026', '25/04/2026'])).toEqual({
      kind: 'resolved',
      format: 'DD/MM/YYYY',
    })
  })

  it('settles on month-first the moment one row has a month past the twelfth', () => {
    expect(suggestDateFormat(['04/03/2026', '04/25/2026'])).toEqual({
      kind: 'resolved',
      format: 'MM/DD/YYYY',
    })
  })

  it('gives up rather than choose when the sample contradicts itself', () => {
    expect(suggestDateFormat(['25/04/2026', '04/25/2026'])).toEqual({
      kind: 'unrecognised',
    })
  })

  it('settles a dash and a dot sample by their separator alone', () => {
    expect(suggestDateFormat(['2026-04-03'])).toEqual({
      kind: 'resolved',
      format: 'YYYY-MM-DD',
    })
    expect(suggestDateFormat(['03.04.2026'])).toEqual({
      kind: 'resolved',
      format: 'DD.MM.YYYY',
    })
  })

  it('gives up on a sample it cannot read at all, rather than guessing', () => {
    expect(suggestDateFormat(['', 'wczoraj']).kind).toBe('unrecognised')
    expect(suggestDateFormat([]).kind).toBe('unrecognised')
  })

  it('will not suggest a layout that fails on any one of the sampled cells', () => {
    // Day-first reads row one; row two has a 13 in the day position under no layout that also
    // reads row one. Suggesting either would mean quietly dropping a row later.
    expect(suggestDateFormat(['25/04/2026', '25/13/2026']).kind).toBe(
      'unrecognised',
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

describe('mapRows', () => {
  it('puts the sign in direction and leaves amount_minor strictly positive', () => {
    const mapped = run([
      ['2026-01-02', 'Żabka', '-45,00', '', ''],
      ['2026-01-03', 'Pensja', '1 234,56', '', ''],
    ])
    expect(mapped.errors).toEqual([])
    expect(mapped.rows.map((row) => [row.direction, row.amountMinor])).toEqual([
      ['expense', 4500],
      ['income', 123456],
    ])
    expect(mapped.rows.every((row) => isMinor(row.amountMinor))).toBe(true)
    expect(mapped.rows.every((row) => row.amountMinor > 0)).toBe(true)
  })

  it('never returns a non-integer for an amount', () => {
    const mapped = run([['2026-01-02', 'x', '0,05', '', '']])
    expect(Number.isInteger(mapped.rows[0].amountMinor)).toBe(true)
    expect(mapped.rows[0].amountMinor).toBe(5)
  })

  it('reads the scale from the currency rather than assuming two digits', () => {
    const jpy = run([['2026-01-02', 'x', '1200', '', '']], {}, 'JPY')
    expect(jpy.rows[0].amountMinor).toBe(1200)
    const pln = run([['2026-01-02', 'x', '1200', '', '']])
    expect(pln.rows[0].amountMinor).toBe(120000)
  })

  it('reads accounting negatives only when the mapping confirmed them', () => {
    expect(run([['2026-01-02', 'x', '(45,00)', '', '']]).errors[0].code).toBe(
      'amount_unparseable',
    )
    const on = run([['2026-01-02', 'x', '(45,00)', '', '']], {
      accountingNegatives: true,
    })
    expect([on.rows[0].direction, on.rows[0].amountMinor]).toEqual([
      'expense',
      4500,
    ])
  })

  it('refuses a zero, because amount_minor is strictly positive', () => {
    expect(run([['2026-01-02', 'x', '0,00', '', '']]).errors).toEqual([
      {
        rowIndex: 0,
        code: 'amount_zero',
        raw: ['2026-01-02', 'x', '0,00', '', ''],
      },
    ])
  })

  it('refuses a row whose currency column is not the account’s', () => {
    const mapped = run(
      [
        ['2026-01-02', 'x', '45,00', 'EUR', ''],
        ['2026-01-03', 'y', '45,00', 'PLN', ''],
      ],
      { currency: 'waluta' },
    )
    expect(mapped.errors).toEqual([
      {
        rowIndex: 0,
        code: 'row_currency_mismatch',
        raw: ['2026-01-02', 'x', '45,00', 'EUR', ''],
      },
    ])
    expect(mapped.rows).toHaveLength(1)
  })

  it('refuses a currency code embedded in the amount cell rather than coercing it', () => {
    expect(run([['2026-01-02', 'x', '45,00 EUR', '', '']]).errors[0].code).toBe(
      'amount_currency_mismatch',
    )
  })

  it('refuses more decimals than the currency has, rather than rounding them away', () => {
    expect(run([['2026-01-02', 'x', '45,005', '', '']]).errors[0].code).toBe(
      'amount_too_precise',
    )
  })

  it('keeps every rejected row, with its index and its verbatim source text', () => {
    const mapped = run([
      ['2026-01-02', 'ok', '-45,00', '', ''],
      ['nie-data', 'zła data', '-1,00', '', ''],
      ['2026-01-04', 'ok', '-2,00', '', ''],
    ])
    expect(mapped.rows.map((row) => row.rowIndex)).toEqual([0, 2])
    expect(mapped.errors).toEqual([
      {
        rowIndex: 1,
        code: 'date_unparseable',
        raw: ['nie-data', 'zła data', '-1,00', '', ''],
      },
    ])
  })

  it('carries the optional targets through, and null for a blank cell', () => {
    const mapped = run([['2026-01-02', '  ', '-45,00', '', 'FIT-1']], {
      sourceRef: 'ref',
    })
    expect(mapped.rows[0].description).toBeNull()
    expect(mapped.rows[0].sourceRef).toBe('FIT-1')
    expect(mapped.rows[0].payee).toBeNull()
  })

  it('refuses a mapping naming a column the file does not have, once, for the file', () => {
    expect(() =>
      run([['2026-01-02', 'x', '-45,00', '', '']], { payee: 'kontrahent' }),
    ).toThrow(UnknownMappingColumnError)
  })
})

/* -------------------------------------------------------------------------- */
/* The debit/credit pair                                                       */
/* -------------------------------------------------------------------------- */

describe('a debit and a credit column', () => {
  const PAIR_HEADERS = ['data', 'opis', 'winien', 'ma']

  const pair = (rows: ReadonlyArray<ReadonlyArray<string>>) =>
    mapRows(
      { headers: PAIR_HEADERS, rows },
      mappingSchema.parse({
        ...base,
        amount: {
          kind: 'debit_credit',
          debitColumn: 'winien',
          creditColumn: 'ma',
        },
      }),
      { currencyCode: 'PLN' },
    )

  it('turns the column into the sign and produces one signed integer', () => {
    const mapped = pair([
      ['2026-01-02', 'zakup', '45,00', ''],
      ['2026-01-03', 'wpłata', '', '1 000,00'],
    ])
    expect(mapped.errors).toEqual([])
    expect(mapped.rows.map((row) => [row.direction, row.amountMinor])).toEqual([
      ['expense', 4500],
      ['income', 100000],
    ])
  })

  it('refuses a line carrying both, and never sums them', () => {
    const mapped = pair([['2026-01-02', 'oba', '45,00', '12,00']])
    expect(mapped.rows).toEqual([])
    expect(mapped.errors[0].code).toBe('amount_debit_and_credit')
  })

  it('names an empty pair separately from an unreadable figure', () => {
    expect(pair([['2026-01-02', 'nic', '', '']]).errors[0].code).toBe(
      'amount_both_empty',
    )
    expect(pair([['2026-01-02', 'zła', '1,2,3', '']]).errors[0].code).toBe(
      'amount_unparseable',
    )
  })

  it('treats a minus inside a debit column as decoration, not a second sign', () => {
    const mapped = pair([['2026-01-02', 'zakup', '-45,00', '']])
    expect([mapped.rows[0].direction, mapped.rows[0].amountMinor]).toEqual([
      'expense',
      4500,
    ])
  })
})
