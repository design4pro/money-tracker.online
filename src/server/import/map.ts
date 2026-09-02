/**
 * The confirmed mapping, applied to rows of text.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS FOR
 * ---------------------------------------------------------------------------
 *
 * `19-S1`'s parsers answer *what the file says*: headers and rows of text, no amount, no date, no
 * opinion about what a column means. This module answers *what the person said it means*. Between
 * the two there is one artefact — the {@link ImportMapping} confirmed on the mapping step and
 * stored on `import_batches.mapping` — and it is the second half of what the preview and the commit
 * both parse from. One mapping, one parse function, run twice over the same bytes: that is the
 * mechanism behind "the preview's numbers are the numbers that will be written".
 *
 * ---------------------------------------------------------------------------
 * THE DMY/MDY REJECTION IS THE POINT OF THIS FILE
 * ---------------------------------------------------------------------------
 *
 * `03/04/2026` is the third of April in Warsaw and the fourth of March in Boston, and a file whose
 * every sampled day is 12 or lower contains no evidence either way. {@link suggestDateFormat}
 * answers {@link AmbiguousDateFormat} for that file and **nothing in this module has a default** —
 * `dateFormat` is a required field of {@link mappingSchema} with no `.default()` and no fallback
 * branch, so a mapping that never made the choice does not parse.
 *
 * The cost of getting this wrong is why it is worth a paragraph and a hard refusal rather than a
 * heuristic: guessing wrongly misdates up to twelve rows in every thirty-one, each one landing in
 * the wrong month, each one individually plausible. Nobody notices for months, and by then the
 * budget history, the cash-flow chart and every monthly total are quietly wrong.
 *
 * ---------------------------------------------------------------------------
 * MONEY
 * ---------------------------------------------------------------------------
 *
 * There is no second amount converter here. Every cell goes through `./amount`'s
 * {@link parseAmountCell}, which is the one module that turns source text into `Minor`, reads the
 * scale from `currencies.digits` and refuses rather than rounds. This module adds exactly two
 * things on top of it, and both are about *shape* rather than about arithmetic:
 *
 * - **`transactions.amount_minor` is strictly positive and the sign lives in `direction`**
 *   (`schema.ts`, `transactions_amount_minor_check`). A signed column's minus becomes
 *   `direction: 'expense'`; a debit/credit pair's *column* is the sign.
 * - **A debit and a credit on one line is a refusal, never a sum.** Two populated columns mean the
 *   file does not say what one transaction this line is, and adding them would invent an amount
 *   that appears nowhere in the source.
 */

import { z } from 'zod'

import { asMinor } from '#/lib/money'
import { RepositoryError } from '#/server/repos/errors'

import { parseAmountCell } from './amount'

import type { Minor } from '#/lib/money'
import type { TransactionDirection } from '#/server/db/schema'
import type { AmountErrorCode, DecimalConvention } from './amount'
import type { ParsedFile } from './types'

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The date layouts a person may confirm.
 *
 * A closed list of **named patterns** rather than a format string a person types: a free-text
 * pattern is a second parser nobody tested, and the four below are what bank and spreadsheet
 * exports in this market actually write. A file in a fifth layout is a file this product asks the
 * person to re-export, which is honest, rather than one it half-reads.
 */
export const DATE_FORMATS = [
  'YYYY-MM-DD',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD.MM.YYYY',
] as const

export type DateFormat = (typeof DATE_FORMATS)[number]

/** The two layouts a sample of `d/m/y` triples cannot tell apart. */
export const AMBIGUOUS_DATE_FORMATS: ReadonlyArray<DateFormat> = [
  'DD/MM/YYYY',
  'MM/DD/YYYY',
]

/** Which positions a layout puts the day, the month and the year in, and what separates them. */
const DATE_LAYOUTS: Readonly<
  Record<DateFormat, { separator: string; day: number; month: number }>
> = {
  'YYYY-MM-DD': { separator: '-', day: 2, month: 1 },
  'DD/MM/YYYY': { separator: '/', day: 0, month: 1 },
  'MM/DD/YYYY': { separator: '/', day: 1, month: 0 },
  'DD.MM.YYYY': { separator: '.', day: 0, month: 1 },
}

/**
 * The date part of a cell that may also carry a time.
 *
 * `booked_on` is a calendar date and nothing in the product truncates an instant to get one, so a
 * trailing `10:31:00` or an ISO `T`-suffix is dropped here rather than being carried into a
 * timestamp nobody asked for.
 */
function datePartOf(cell: string): string {
  return cell.trim().split(/[T\s]/u)[0] ?? ''
}

/** `2026`, `2`, `4` → `'2026-02-04'`. Zero-padded, because `booked_on` is compared as text. */
function isoDate(year: number, month: number, day: number): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

/** Whether `year-month-day` is a date that exists. February 30th is not a date. */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  // `Date.UTC(y, m, 0)` is the last day of month `m`, which is how February gets its leap year.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export type DateResult =
  | { readonly ok: true; readonly bookedOn: string }
  | { readonly ok: false; readonly code: DateErrorCode }

/** Why a cell did not become a calendar date. Codes, never sentences. */
export type DateErrorCode =
  /** The cell is empty. */
  | 'date_empty'
  /** The cell does not have the shape the confirmed format describes. */
  | 'date_unparseable'
  /** The shape matched but the date does not exist — `31.02.2026`, `2026-13-01`. */
  | 'date_impossible'

/**
 * One cell to `YYYY-MM-DD` under the **confirmed** layout, or a named refusal.
 *
 * The layout is a parameter and is never inferred from the cell: a function that read `13/04/2026`
 * as day-first and `04/13/2026` as month-first would read one file two ways.
 */
export function parseDateCell(cell: string, format: DateFormat): DateResult {
  const text = datePartOf(cell)
  if (text === '') return { ok: false, code: 'date_empty' }

  const layout = DATE_LAYOUTS[format]
  const parts = text.split(layout.separator)
  if (parts.length !== 3 || parts.some((part) => !/^\d{1,4}$/u.test(part))) {
    return { ok: false, code: 'date_unparseable' }
  }

  const yearIndex = 3 - layout.day - layout.month
  const year = Number(parts[yearIndex])
  const month = Number(parts[layout.month])
  const day = Number(parts[layout.day])
  // A two-digit year is not accepted rather than being windowed into a century: `12/03/26` under a
  // window is a guess about somebody's date, and this module has one rule about guessing.
  if (parts[yearIndex].length !== 4) {
    return { ok: false, code: 'date_unparseable' }
  }
  if (!isRealDate(year, month, day)) {
    return { ok: false, code: 'date_impossible' }
  }

  return { ok: true, bookedOn: isoDate(year, month, day) }
}

/** A layout the sample settles. */
export interface ResolvedDateFormat {
  readonly kind: 'resolved'
  readonly format: DateFormat
}

/**
 * A sample of `d/m/y` triples in which **every** first and second component is 12 or lower.
 *
 * There is no evidence in the file, so there is no answer here: the person chooses between
 * {@link candidates} on the mapping step and the flow does not continue until they have.
 */
export interface AmbiguousDateFormat {
  readonly kind: 'ambiguous'
  readonly candidates: ReadonlyArray<DateFormat>
}

/** No layout in {@link DATE_FORMATS} reads the sample, or two of them contradict each other. */
export interface UnrecognisedDateFormat {
  readonly kind: 'unrecognised'
}

export type DateFormatSuggestion =
  ResolvedDateFormat | AmbiguousDateFormat | UnrecognisedDateFormat

/**
 * What the file's own date column says its layout is, or that it does not say.
 *
 * **Offered, never applied** — the same rule the parser's `suggestedMapping` and a
 * fingerprint-matched preset obey. This function pre-fills a `Select`; a person confirms it, and
 * `mappingSchema` is what actually decides.
 */
export function suggestDateFormat(
  samples: ReadonlyArray<string>,
): DateFormatSuggestion {
  const triples = samples
    .map((sample) => datePartOf(sample))
    .filter((text) => text !== '')
    .map((text) => {
      const separator = ['-', '/', '.'].find((candidate) =>
        text.includes(candidate),
      )
      if (separator === undefined) return null
      const parts = text.split(separator)
      if (
        parts.length !== 3 ||
        parts.some((part) => !/^\d{1,4}$/u.test(part))
      ) {
        return null
      }
      return { separator, parts: parts.map(Number) }
    })
    .filter(
      (triple): triple is { separator: string; parts: Array<number> } =>
        triple !== null,
    )

  if (triples.length === 0) return { kind: 'unrecognised' }

  const separators = new Set(triples.map((triple) => triple.separator))
  if (separators.size !== 1) return { kind: 'unrecognised' }
  const separator = [...separators][0]

  // One dash layout and one dot layout exist, so those files are settled by their separator alone.
  if (separator === '-') return decided(triples, 'YYYY-MM-DD')
  if (separator === '.') return decided(triples, 'DD.MM.YYYY')

  // The slash file is the whole reason this function exists.
  const dayFirst = triples.some((triple) => triple.parts[0] > 12)
  const monthFirst = triples.some((triple) => triple.parts[1] > 12)
  if (dayFirst && monthFirst) return { kind: 'unrecognised' }
  if (dayFirst) return decided(triples, 'DD/MM/YYYY')
  if (monthFirst) return decided(triples, 'MM/DD/YYYY')
  return { kind: 'ambiguous', candidates: AMBIGUOUS_DATE_FORMATS }
}

/** A layout is only suggested when it reads **every** sampled cell, not merely most of them. */
function decided(
  triples: ReadonlyArray<{ parts: Array<number> }>,
  format: DateFormat,
): DateFormatSuggestion {
  const layout = DATE_LAYOUTS[format]
  const yearIndex = 3 - layout.day - layout.month
  const readsAll = triples.every((triple) =>
    isRealDate(
      triple.parts[yearIndex],
      triple.parts[layout.month],
      triple.parts[layout.day],
    ),
  )
  return readsAll ? { kind: 'resolved', format } : { kind: 'unrecognised' }
}

/* -------------------------------------------------------------------------- */
/* The mapping                                                                 */
/* -------------------------------------------------------------------------- */

/** A column is named by its header text, which is what the mapping step shows the person. */
const columnField = z.string().min(1).max(200)

const idField = z.string().trim().min(1).max(64)

/** The character that separates the whole part from the fraction **in this file**. */
export const DECIMAL_SEPARATORS = ['.', ','] as const
export type DecimalSeparator = (typeof DECIMAL_SEPARATORS)[number]

/**
 * The grouping character, `'none'` for a file that groups with nothing.
 *
 * It is confirmed alongside the decimal separator and is the complement of it, which is why the
 * schema refuses a mapping naming the same character twice. `./amount` derives grouping from the
 * decimal convention rather than reading this field — one statement of the convention, applied in
 * one place — so this is what the person confirmed, not a second input the converter obeys.
 */
export const THOUSANDS_SEPARATORS = ['.', ',', ' ', 'none'] as const
export type ThousandsSeparator = (typeof THOUSANDS_SEPARATORS)[number]

/** A single column carrying a signed figure: `-45,00` is money out. */
const signedAmountSchema = z.strictObject({
  kind: z.literal('signed'),
  column: columnField,
})

/** Two columns, where the **column** is the sign and the figures in them are unsigned. */
const debitCreditAmountSchema = z
  .strictObject({
    kind: z.literal('debit_credit'),
    debitColumn: columnField,
    creditColumn: columnField,
  })
  .refine((value) => value.debitColumn !== value.creditColumn, {
    message: 'The debit and credit columns must be two different columns.',
    path: ['creditColumn'],
  })

export const amountMappingSchema = z.union([
  signedAmountSchema,
  debitCreditAmountSchema,
])

/**
 * The confirmed column map. Stored as JSON on `import_batches.mapping`.
 *
 * `accountId` lives here because `import_batches` has no account column (`19-S1`) and the batch has
 * to remember which account the person chose between the upload and the commit. It is re-validated
 * through the scoped read on every use, so a stored id from another workspace is a not-found rather
 * than a way in.
 *
 * `dateFormat` has **no default**, and that absence is the DMY/MDY rule expressed in a type.
 */
export const mappingSchema = z
  .strictObject({
    accountId: idField,
    date: columnField,
    dateFormat: z.enum(DATE_FORMATS),
    amount: amountMappingSchema,
    decimalSeparator: z.enum(DECIMAL_SEPARATORS),
    thousandsSeparator: z.enum(THOUSANDS_SEPARATORS),
    accountingNegatives: z.boolean(),
    description: columnField.optional(),
    payee: columnField.optional(),
    category: columnField.optional(),
    reference: columnField.optional(),
    notes: columnField.optional(),
    currency: columnField.optional(),
    /**
     * A column whose values the file's own producer promises are stable per row.
     *
     * When it is set, `./dedupe` stops scoring and starts matching. See that module: the promise is
     * only as good as the column, so a value that repeats inside the file degrades the file back to
     * the scorer rather than dropping rows.
     */
    sourceRef: columnField.optional(),
  })
  .refine((value) => value.thousandsSeparator !== value.decimalSeparator, {
    message:
      'The decimal and thousands separators must be different characters.',
    path: ['thousandsSeparator'],
  })

export type ImportMapping = z.infer<typeof mappingSchema>
export type ImportMappingInput = z.input<typeof mappingSchema>

/** `mappingSchema`'s `decimalSeparator` in the vocabulary `./amount` takes. */
export function decimalConventionOf(
  separator: DecimalSeparator,
): DecimalConvention {
  return separator === ',' ? 'comma' : 'dot'
}

/* -------------------------------------------------------------------------- */
/* Resolving columns                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A mapping names a column the file does not have.
 *
 * A whole-file refusal rather than twenty thousand identical row errors: every row would fail for
 * the same reason, and an error report that says so once is the one a person can act on. It happens
 * when a preset from a previous statement is applied to a file whose bank has renamed a column,
 * which is exactly the case presets are *offered* rather than applied for.
 */
export class UnknownMappingColumnError extends RepositoryError {
  readonly columns: ReadonlyArray<string>

  constructor(columns: ReadonlyArray<string>) {
    super(
      `The mapping names columns this file does not have: ${columns.join(', ')}.`,
      'UNKNOWN_MAPPING_COLUMN',
    )
    this.columns = columns
  }
}

/** Every mapping target that points at a column, in one place so nothing is forgotten. */
function columnsOf(mapping: ImportMapping): ReadonlyArray<string> {
  const optional = [
    mapping.description,
    mapping.payee,
    mapping.category,
    mapping.reference,
    mapping.notes,
    mapping.currency,
    mapping.sourceRef,
  ].filter((column): column is string => column !== undefined)

  const amount =
    mapping.amount.kind === 'signed'
      ? [mapping.amount.column]
      : [mapping.amount.debitColumn, mapping.amount.creditColumn]

  return [mapping.date, ...amount, ...optional]
}

/**
 * Header name to position.
 *
 * A repeated header keeps its **first** position, which is what a spreadsheet does with a duplicate
 * column name and what the sample values on the mapping step were read from.
 */
function indexOf(
  headers: ReadonlyArray<string>,
  column: string,
): number | undefined {
  const at = headers.indexOf(column)
  return at === -1 ? undefined : at
}

/** Throws {@link UnknownMappingColumnError} unless every mapped column exists in `headers`. */
export function assertColumnsExist(
  headers: ReadonlyArray<string>,
  mapping: ImportMapping,
): void {
  const missing = [...new Set(columnsOf(mapping))].filter(
    (column) => indexOf(headers, column) === undefined,
  )
  if (missing.length > 0) throw new UnknownMappingColumnError(missing)
}

/* -------------------------------------------------------------------------- */
/* What a mapped row is                                                        */
/* -------------------------------------------------------------------------- */

/** Why a row did not become a transaction. `./amount`'s codes plus this module's own. */
export type MappedRowErrorCode =
  | AmountErrorCode
  | DateErrorCode
  /** A debit **and** a credit on one line. Never summed — the file does not say what this is. */
  | 'amount_debit_and_credit'
  /** Neither the debit nor the credit column carries a figure. */
  | 'amount_both_empty'
  /** The figure is zero, and `transactions.amount_minor` is strictly positive. */
  | 'amount_zero'
  /**
   * The row's own currency column names a currency other than the account's.
   *
   * Refused rather than converted: the conversion would need the rate of a historical `booked_on`
   * the file does not supply, and inventing one is worse than saying no.
   */
  | 'row_currency_mismatch'

/** One row of the file, as the transaction it would become. No decision yet — that is `./dedupe`. */
export interface MappedRow {
  /** Zero-based index into the parsed file's rows. The number the error report points at. */
  readonly rowIndex: number
  readonly bookedOn: string
  readonly direction: TransactionDirection
  /** Strictly positive minor units in the account's currency. The sign is {@link direction}. */
  readonly amountMinor: Minor
  readonly description: string | null
  readonly payee: string | null
  readonly category: string | null
  readonly reference: string | null
  readonly notes: string | null
  /** The value of the `sourceRef` column, when one was mapped and the cell was not empty. */
  readonly sourceRef: string | null
}

/** One row the mapping refused, and the source text a person will read to understand why. */
export interface MappedRowError {
  readonly rowIndex: number
  readonly code: MappedRowErrorCode
  /**
   * The row's own cells, verbatim.
   *
   * **This is the file's text and it is not in minor units** — comma decimal separator, currency
   * symbol and all. It exists for a human to read. Nothing parses it back into the money path.
   */
  readonly raw: ReadonlyArray<string>
}

export interface MappedFile {
  readonly rows: ReadonlyArray<MappedRow>
  readonly errors: ReadonlyArray<MappedRowError>
}

export interface MapRowsOptions {
  /** The target account's currency. Its `digits` is the scale, and its code is the row check. */
  readonly currencyCode: string
}

/* -------------------------------------------------------------------------- */
/* Applying it                                                                 */
/* -------------------------------------------------------------------------- */

/** A cell, trimmed, or `null` when the column was not mapped or the cell was blank. */
function cellOf(
  row: ReadonlyArray<string>,
  headers: ReadonlyArray<string>,
  column: string | undefined,
): string | null {
  if (column === undefined) return null
  const at = indexOf(headers, column)
  if (at === undefined) return null
  const value = row[at]?.trim() ?? ''
  return value === '' ? null : value
}

/** The signed figure, split into the sign the schema stores and the magnitude it stores. */
type Signed =
  | {
      readonly ok: true
      readonly direction: TransactionDirection
      readonly amountMinor: Minor
    }
  | { readonly ok: false; readonly code: MappedRowErrorCode }

/**
 * `Minor` to `(direction, positive Minor)`.
 *
 * `Math.abs` on an integer is an integer: no division, no scaling, nothing that could produce a
 * fraction, and `asMinor` re-asserts it before the value leaves.
 */
function split(amountMinor: Minor): Signed {
  if (amountMinor === 0) return { ok: false, code: 'amount_zero' }
  return {
    ok: true,
    direction: amountMinor < 0 ? 'expense' : 'income',
    amountMinor: asMinor(Math.abs(amountMinor)),
  }
}

/** The amount of one row, under whichever of the two shapes the mapping confirmed. */
function amountOf(
  row: ReadonlyArray<string>,
  headers: ReadonlyArray<string>,
  mapping: ImportMapping,
  options: MapRowsOptions,
): Signed {
  const amountOptions = {
    currencyCode: options.currencyCode,
    decimal: decimalConventionOf(mapping.decimalSeparator),
    accountingNegatives: mapping.accountingNegatives,
  }

  if (mapping.amount.kind === 'signed') {
    const cell = cellOf(row, headers, mapping.amount.column)
    if (cell === null) return { ok: false, code: 'amount_empty' }
    const parsed = parseAmountCell(cell, amountOptions)
    return parsed.ok
      ? split(parsed.amountMinor)
      : { ok: false, code: parsed.code }
  }

  const debit = cellOf(row, headers, mapping.amount.debitColumn)
  const credit = cellOf(row, headers, mapping.amount.creditColumn)
  if (debit === null && credit === null) {
    return { ok: false, code: 'amount_both_empty' }
  }
  // Two figures on one line is a line whose meaning the file does not state. Summing them would
  // put a number in somebody's ledger that appears nowhere in their statement.
  if (debit !== null && credit !== null) {
    return { ok: false, code: 'amount_debit_and_credit' }
  }

  const cell = debit ?? credit
  if (cell === null) return { ok: false, code: 'amount_both_empty' }
  const parsed = parseAmountCell(cell, amountOptions)
  if (!parsed.ok) return { ok: false, code: parsed.code }
  if (parsed.amountMinor === 0) return { ok: false, code: 'amount_zero' }

  // The **column** is the sign here, so a minus inside a debit column is decoration on a figure
  // whose direction the file already stated. `Math.abs` of an integer stays an integer.
  return {
    ok: true,
    direction: debit !== null ? 'expense' : 'income',
    amountMinor: asMinor(Math.abs(parsed.amountMinor)),
  }
}

/**
 * The whole file, mapped.
 *
 * Every row lands in exactly one of the two lists and nothing is dropped: a rejected row is an
 * {@link MappedRowError} carrying its index and its source text, which is what
 * `import_row_errors` stores and what a person comes back to read. One bad line never costs the
 * file, which is the same rule the parser layer holds itself to.
 */
export function mapRows(
  parsed: Pick<ParsedFile, 'headers' | 'rows'>,
  mapping: ImportMapping,
  options: MapRowsOptions,
): MappedFile {
  assertColumnsExist(parsed.headers, mapping)

  const rows: Array<MappedRow> = []
  const errors: Array<MappedRowError> = []
  const account = options.currencyCode.toUpperCase()

  parsed.rows.forEach((row, rowIndex) => {
    const reject = (code: MappedRowErrorCode): void => {
      errors.push({ rowIndex, code, raw: row })
    }

    const currency = cellOf(row, parsed.headers, mapping.currency)
    if (currency !== null && currency.toUpperCase() !== account) {
      reject('row_currency_mismatch')
      return
    }

    const date = parseDateCell(
      cellOf(row, parsed.headers, mapping.date) ?? '',
      mapping.dateFormat,
    )
    if (!date.ok) {
      reject(date.code)
      return
    }

    const amount = amountOf(row, parsed.headers, mapping, options)
    if (!amount.ok) {
      reject(amount.code)
      return
    }

    rows.push({
      rowIndex,
      bookedOn: date.bookedOn,
      direction: amount.direction,
      amountMinor: amount.amountMinor,
      description: cellOf(row, parsed.headers, mapping.description),
      payee: cellOf(row, parsed.headers, mapping.payee),
      category: cellOf(row, parsed.headers, mapping.category),
      reference: cellOf(row, parsed.headers, mapping.reference),
      notes: cellOf(row, parsed.headers, mapping.notes),
      sourceRef: cellOf(row, parsed.headers, mapping.sourceRef),
    })
  })

  return { rows, errors }
}
