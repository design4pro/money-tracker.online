/**
 * One cell of text to one integer number of minor units, or a named refusal.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE RULES, AND WHAT EACH ONE COSTS WHEN IT IS BROKEN
 * ---------------------------------------------------------------------------
 *
 * 1. **The decimal convention is told to this function, never guessed by it.** `1.234` is one
 *    thousand two hundred thirty-four in Warsaw and one point two three four in Boston, and a file
 *    containing both `1.234` and `56,78` is ambiguous no matter how cleverly it is read. A wrong
 *    guess is a **100× error in somebody's ledger**, so the convention is a parameter, confirmed by
 *    a person on the mapping step (`19-S2`), and there is no default.
 *
 * 2. **The scale is the currency's own `digits`.** `"1200"` in JPY is twelve hundred yen — `1200`,
 *    not `120000`. Reading `minorUnitDigits` rather than assuming 2 is the single defect this
 *    product's money module exists to have fixed.
 *
 * 3. **More decimals than the currency has is an error, never a rounding.** `"45.005"` in a
 *    two-digit currency is not 45.00 and not 45.01: it is a cell this importer does not understand,
 *    and quietly rounding somebody's data on the way in is data loss they cannot see. It is a
 *    `skip_invalid` row with {@link AmountErrorCode} `amount_too_precise`.
 *
 * 4. **A currency code inside the cell that is not the column's currency is an error.** `"45.00
 *    EUR"` in a PLN column is a euro amount, and writing 45.00 PLN because the digits matched is a
 *    silent coercion of one currency into another. `amount_currency_mismatch`.
 *
 * 5. **No float ever holds the value.** The digits move in the string and the arithmetic is
 *    `bigint`, through `scaleDecimalString` in `#/lib/money` — the product's one rounding function.
 *    The return type is `Minor`, which a plain `number` does not satisfy.
 *
 * This module is under `src/server/import/` rather than under `csv/` because it is not about CSV:
 * `19-S4`'s OFX and QIF amounts and `19-S5`'s tracker exports come through here too, and a second
 * amount parser living next to a second format is exactly the duplication `docs/SPEC.md` §8 calls
 * a defect.
 */

import {
  MAX_MINOR,
  asMinor,
  isCurrencyCode,
  minorUnitDigits,
  scaleDecimalString,
} from '#/lib/money'

import type { Minor } from '#/lib/money'

/**
 * Which character separates the whole part from the fraction **in this file**.
 *
 * The other one is then grouping, and is validated as grouping rather than merely stripped.
 */
export type DecimalConvention = 'dot' | 'comma'

/** Why a cell did not become an amount. Codes, never sentences: the surface owns the wording. */
export type AmountErrorCode =
  /** The cell is empty or holds no digit at all. */
  | 'amount_empty'
  /** The characters do not form a number under the stated convention. */
  | 'amount_unparseable'
  /** The cell names a currency other than the column's. */
  | 'amount_currency_mismatch'
  /** More decimal places than the currency has. Never rounded. */
  | 'amount_too_precise'
  /** Past the safe-integer range money is kept exact in. */
  | 'amount_out_of_range'

export type AmountResult =
  | { readonly ok: true; readonly amountMinor: Minor }
  | { readonly ok: false; readonly code: AmountErrorCode }

export interface ParseAmountOptions {
  /** The currency of the column. Its `digits` is the scale and its code is the mismatch test. */
  readonly currencyCode: string
  /** Which separator this file uses for the fraction. Confirmed by a person, never inferred. */
  readonly decimal: DecimalConvention
  /** Whether `(45.00)` means −45.00, as accounting exports and several banks write it. */
  readonly accountingNegatives?: boolean
}

/**
 * Everything that is decoration around a figure.
 *
 * `\s` covers every space a spreadsheet emits — ordinary, non-breaking (which is what `Intl`
 * itself produces for Polish grouping, and therefore what a copied figure carries), narrow
 * non-breaking and thin. The apostrophes are Swiss grouping. The glyphs are the currency symbols
 * that sit against an amount; alphabetic symbols like `zł` are letters and go with {@link LETTERS}.
 */
const DECORATION = /[\s'\u2018\u2019\u00b4`\u20ac$\u00a3\u00a5\u00a4]/gu

/** A run of letters left after the decoration is gone. A currency code, or something unreadable. */
const LETTERS = /[\p{L}]+/gu

/**
 * A cell as an amount, or a named refusal.
 *
 * The order of the steps is the order of the refusals, and each one is separate so the person's
 * error report can say *which* thing was wrong with the row rather than "invalid amount".
 */
export function parseAmountCell(
  cell: string,
  options: ParseAmountOptions,
): AmountResult {
  const digits = minorUnitDigits(options.currencyCode)

  // NFKC folds the full-width digits and the several Unicode spaces a spreadsheet emits into their
  // ordinary forms, so the rest of this function has one shape of input to reason about.
  let work = cell.normalize('NFKC').trim()
  if (work === '') return { ok: false, code: 'amount_empty' }

  let negative = false

  const parenthesised = /^\((.*)\)$/su.exec(work)
  if (parenthesised !== null) {
    // Accounting negatives are an option rather than an assumption: `(1)` is a footnote marker in
    // some exports, and reading it as −1 would invent a transaction.
    if (options.accountingNegatives !== true) {
      return { ok: false, code: 'amount_unparseable' }
    }
    negative = true
    work = parenthesised[1].trim()
  }

  // U+2212 MINUS SIGN is what this product draws and therefore what a copied figure carries.
  work = work.replaceAll('−', '-')
  for (const sign of ['-', '+'] as const) {
    if (work.startsWith(sign) || work.endsWith(sign)) {
      // A sign may sit on either end: `-12,34` and `12,34-` both occur in real exports.
      negative = negative !== (sign === '-')
      work = (work.startsWith(sign) ? work.slice(1) : work.slice(0, -1)).trim()
    }
  }

  const currencyCheck = currencyIn(work, options.currencyCode)
  if (currencyCheck !== null) return { ok: false, code: currencyCheck }

  const bare = work.replace(LETTERS, '').replace(DECORATION, '')
  if (bare === '' || !/\d/u.test(bare)) {
    return { ok: false, code: 'amount_empty' }
  }

  const canonical = canonicalise(bare, options.decimal)
  if (canonical === null) return { ok: false, code: 'amount_unparseable' }
  if (canonical.fraction.length > digits) {
    return { ok: false, code: 'amount_too_precise' }
  }

  const scaled = scaleDecimalString(
    `${negative ? '-' : ''}${canonical.whole}.${canonical.fraction}`,
    digits,
  )
  if (scaled === null) return { ok: false, code: 'amount_unparseable' }
  if (scaled > BigInt(MAX_MINOR) || scaled < -BigInt(MAX_MINOR)) {
    return { ok: false, code: 'amount_out_of_range' }
  }

  // `asMinor` is the only door into the money path, and it throws on a non-integer. Nothing above
  // divides or multiplies, so it cannot be handed one — this is the assertion, not the conversion.
  return { ok: true, amountMinor: asMinor(Number(scaled)) }
}

/**
 * Whether the cell names a currency, and whether that is a problem.
 *
 * A code equal to the column's own currency is redundant but harmless — `45,00 PLN` in a PLN
 * column is forty-five złoty. Any **other** ISO code is the refusal rule 4 exists for. A letter run
 * that is not a currency code at all (`DR`, `CR`, `saldo`) makes the cell unreadable rather than
 * mismatched: this function will not decide what a bank meant by a word.
 */
function currencyIn(
  work: string,
  currencyCode: string,
): AmountErrorCode | null {
  const runs = work.match(LETTERS)
  if (runs === null) return null

  for (const run of runs) {
    const upper = run.toUpperCase()
    // `zł` and `ZŁ` are the złoty's symbol, not a code; the decoration expression removes them.
    if (upper === 'ZŁ' || upper === 'ZL') continue
    if (!isCurrencyCode(upper)) return 'amount_unparseable'
    if (upper !== currencyCode.toUpperCase()) return 'amount_currency_mismatch'
  }
  return null
}

/**
 * `1.234,56` (comma convention) → `{ whole: '1234', fraction: '56' }`.
 *
 * The separator the convention names is the decimal point and may appear **once**; the other is
 * grouping and is checked for being real grouping — one to three digits, then groups of exactly
 * three. Without that check the function would happily read `1.2.3` as a number, and an import row
 * that guesses is worse than one that reports an error.
 */
function canonicalise(
  bare: string,
  convention: DecimalConvention,
): { whole: string; fraction: string } | null {
  const decimalChar = convention === 'comma' ? ',' : '.'
  const groupChar = convention === 'comma' ? '.' : ','

  const parts = bare.split(decimalChar)
  if (parts.length > 2) return null

  const whole = parts[0]
  const fraction = parts[1] ?? ''
  // A separator with nothing after it (`45,`) is a typo, not a whole number.
  if (parts.length === 2 && fraction === '') return null
  if (fraction !== '' && !/^\d+$/u.test(fraction)) return null

  const grouped = whole.split(groupChar)
  if (grouped.length === 1) {
    return /^\d+$/u.test(whole) ? { whole, fraction } : null
  }
  if (!/^\d{1,3}$/u.test(grouped[0])) return null
  for (const group of grouped.slice(1)) {
    if (!/^\d{3}$/u.test(group)) return null
  }

  return { whole: grouped.join(''), fraction }
}
