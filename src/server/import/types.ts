/**
 * The format seam: what every import parser is, and how a batch's `source` finds one.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * `IMPORT_SOURCES` in `src/server/db/schema.ts` enumerates six formats and the `CHECK` constraint
 * on `import_batches.source` already carries them. **The list of formats therefore has exactly one
 * home and it is the schema**; this file adds no second list, it only says what a format has to
 * *do* to be usable: sniff bytes, and turn bytes into rows of text.
 *
 * The pipeline downstream of it — mapping, preview, dedupe, commit — is written against
 * {@link ImportParser} and never against CSV. A format is one directory under `src/server/import/`
 * and no consumer of this module changes when it lands: `./registry.ts` finds the directory by
 * convention, so nothing here and nothing in another stage's file is edited to add one. That is
 * what lets `19-S4` (OFX, QIF) and `19-S5` (the two tracker migrations) be written beside `19-S2`
 * and `19-S3` rather than after them.
 *
 * **This file carries the type surface and nothing that runs.** Resolution lives next door for the
 * reason `src/lib/i18n/` splits the same way: `./registry.ts` is a lazy `import.meta.glob` and the
 * types have to be importable without pulling every format's module behind them.
 *
 * It sits under `src/server/` rather than `src/lib/` because the interface takes a byte stream and
 * returns parsed rows. It is server-only, and `src/lib/` is reachable from the client bundle.
 *
 * ---------------------------------------------------------------------------
 * WHAT A PARSER MAY AND MAY NOT DO
 * ---------------------------------------------------------------------------
 *
 * A parser returns **text**. It never returns an amount, never returns a date and never decides
 * what a column means: the decimal convention, the date order and the column map are confirmed by
 * a person in `19-S2` and applied after this layer. A parser that guessed would be guessing about
 * money, and the money invariant this area is held to (`docs/MONEY.md`) starts with not doing that.
 *
 * A parser also never throws over one bad line. `warnings` carries the ragged row and the
 * re-encoded byte; a file whose line 4 000 is malformed still yields the other 19 999 rows,
 * because "we lost your whole statement because of one line" is not a thing to say to somebody.
 */

import type { ImportSource } from '#/server/db/schema'

/* -------------------------------------------------------------------------- */
/* The two caps                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The largest file that may be uploaded: 5 MB, counted in bytes and not in "megabytes" of an
 * unstated base.
 *
 * It is a size an isolate can hold while it parses. A bank statement of a whole year is a few
 * hundred kilobytes of CSV, so this is roughly a decade of one account — past that the honest
 * answer is "split the file", not an import that dies halfway with the rows already written.
 */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024

/**
 * The largest number of **data** rows one batch may carry — `IMPORT_MAX_ROWS`, the job size
 * `00-S12` enforces on the queue side.
 *
 * A job size rather than a quota: it bounds one unit of work so the consumer's batches stay
 * predictable, and it is the same number on every plan.
 */
export const IMPORT_MAX_ROWS = 20_000

/* -------------------------------------------------------------------------- */
/* What a sniff learns                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The encodings this product reads.
 *
 * `windows-1250` is named rather than left to chance: it is what a Polish bank's export and a
 * Polish Excel still write, and a file read as UTF-8 by mistake turns every `ą`, `ł` and `ż` in a
 * payee name into a replacement character. That is the single most common real-world encoding
 * failure in this market, so it is the documented fallback.
 */
export type ImportEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1250'

/**
 * The delimiters a delimited export uses.
 *
 * A type rather than a list: the candidate order belongs to the sniffer that votes over them
 * (`./csv/sniff.ts`), and this module carries no values a format's implementation would import.
 */
export type CsvDelimiter = ';' | ',' | '\t' | '|'

/**
 * What was learned about a file before anything was mapped.
 *
 * `delimiter` and `quote` are `null` for a format that has neither (OFX is SGML, QIF is
 * line-tagged): the shape is common because the *pipeline* is common, and a format that does not
 * use a field says so rather than inventing a value nobody may read.
 */
export interface FileSniff {
  readonly encoding: ImportEncoding
  /** Whether the file began with a byte-order mark. The mark itself is never part of a cell. */
  readonly byteOrderMark: boolean
  /** Lines dropped before the table starts — a bank's title row, a blank line, a preamble. */
  readonly skipLines: number
  /** Whether the first line of the table names the columns rather than carrying data. */
  readonly hasHeader: boolean
  readonly delimiter: CsvDelimiter | null
  readonly quote: string | null
}

/* -------------------------------------------------------------------------- */
/* What a parse produces                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Something worth telling a person about a row, which is **not** a reason to lose the file.
 *
 * - `ragged_row` — the row had a different number of fields than the header. Short rows are padded
 *   and long ones are kept whole; nothing is dropped, and the warning says which row it was.
 * - `re_encoded` — the bytes were not UTF-8 and were decoded through the fallback, so a character
 *   somewhere may not be the one the bank meant.
 * - `replacement_character` — the decode produced U+FFFD: a byte that means nothing in the encoding
 *   that was chosen. Usually the encoding guess, occasionally a corrupt file.
 * - `row_cap_reached` — the file has more rows than {@link IMPORT_MAX_ROWS} and the rest were not
 *   read. Stated, never silent: an import that quietly stops at row 20 000 loses the year.
 */
export type ImportWarningCode =
  'ragged_row' | 're_encoded' | 'replacement_character' | 'row_cap_reached'

export interface ImportWarning {
  readonly code: ImportWarningCode
  /** Zero-based index into `rows`, or `null` for a warning about the file as a whole. */
  readonly rowIndex: number | null
  /** Developer-facing detail. The sentence a person reads is chosen from `code` by the surface. */
  readonly detail?: string
}

/** Rows of text, and what was odd about them. No amount, no date, no decision. */
export interface ParsedFile {
  /** The column names, or synthesised `column_1…` positions when the file has no header. */
  readonly headers: ReadonlyArray<string>
  /** One entry per data row, each already padded to the width of {@link headers}. */
  readonly rows: ReadonlyArray<ReadonlyArray<string>>
  readonly warnings: ReadonlyArray<ImportWarning>
  /** Whether reading stopped at the row cap with bytes left over. */
  readonly truncated: boolean
}

/** How much a parse may read. Passed in rather than defaulted, so the cap has one owner. */
export interface ParseOptions {
  readonly maxRows: number
}

/* -------------------------------------------------------------------------- */
/* The seam                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One file format.
 *
 * `sniff` reads the leading bytes and answers how the file is shaped; `parse` reads all of them
 * and answers what it contains. They are separate because the person sees the sniff — the
 * delimiter, the encoding, whether line 1 is a header — and may correct it before the parse that
 * matters runs.
 */
export interface ImportParser {
  readonly source: ImportSource
  readonly sniff: (bytes: Uint8Array) => FileSniff
  readonly parse: (
    bytes: Uint8Array,
    sniff: FileSniff,
    options: ParseOptions,
  ) => ParsedFile
  /**
   * What this format says its own columns are, for the mapping step to **pre-fill**.
   *
   * Optional because only some formats can answer. An interchange format names its fields, so it
   * knows which one is the date and which is the amount; a delimited file knows nothing beyond
   * whatever the bank wrote on line 1, and `csv` therefore leaves this undefined rather than
   * inventing a default nobody asked for.
   *
   * **Offered, never applied.** It goes through the same door a fingerprint-matched preset goes
   * through and obeys the same rule: a person confirms it before a single row is written. A
   * mapping applied silently is a mapping nobody checked, and what it maps is money.
   *
   * The keys are mapping targets and the values are column names out of {@link ParsedFile.headers}.
   * The target vocabulary is `19-S2`'s to state; this member only has to not stand in its way.
   */
  readonly suggestedMapping?: (
    headers: ReadonlyArray<string>,
    sniff: FileSniff,
  ) => Readonly<Record<string, string>> | undefined
}
