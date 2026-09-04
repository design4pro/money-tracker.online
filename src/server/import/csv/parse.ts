/**
 * Records to rows of text: the CSV half of the format seam.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 * ---------------------------------------------------------------------------
 *
 * `./scan.ts` turns bytes into records of raw fields. This turns those records into the
 * {@link ParsedFile} the rest of the pipeline reads: it drops the lines the sniff said were a
 * preamble, names the columns, squares up the ragged ones, and stops at the row cap.
 *
 * It also carries {@link parser}, the {@link ImportParser} `../registry.ts` resolves. **The export
 * name and this file's path are the convention**: `src/server/import/<source>/parse.ts` exporting
 * `parser` is how a format is registered, and adding OFX means adding a directory rather than
 * editing a file another stage owns.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WILL NOT DO
 * ---------------------------------------------------------------------------
 *
 * **It returns text and only text.** No cell is coerced, trimmed of its meaning, or read as a
 * number here. What an amount column means is confirmed by a person in `19-S2` and applied by
 * `../amount.ts`; a parser that guessed would be guessing about money, and `docs/MONEY.md` starts
 * with not doing that.
 *
 * **It never throws over one bad line.** `warnings` carries the ragged row, the re-encoded byte and
 * the row cap; a file whose line 4 000 is malformed still yields the other 19 999 rows, because
 * "we lost your whole statement because of one line" is not a thing to say to somebody.
 *
 * **It suggests no mapping.** {@link ImportParser.suggestedMapping} is for a format that names its
 * own fields. A delimited file does not: its header is whatever the bank felt like writing, so
 * `csv` leaves the member undefined and the mapping step asks.
 */

import { decodeChunks, REPLACEMENT_CHARACTER, scanRecords } from './scan'
import { sniffCsv } from './sniff'

import type {
  FileSniff,
  ImportParser,
  ImportWarning,
  ParseOptions,
  ParsedFile,
} from '../types'

/* -------------------------------------------------------------------------- */
/* The CSV parser                                                             */
/* -------------------------------------------------------------------------- */

/** `column_1`, `column_2`, … for a file whose first line is already data. */
function synthesizedHeaders(width: number): Array<string> {
  return Array.from({ length: width }, (_, index) => `column_${index + 1}`)
}

/** A header cell, tidied: trimmed, with a stray byte-order-mark character removed. */
function headerName(cell: string, index: number): string {
  const trimmed = cell.replace(/^\uFEFF/, '').trim()
  return trimmed === '' ? `column_${index + 1}` : trimmed
}

/**
 * Rows of text from a stream of chunks, stopping at `maxRows` without reading the rest.
 *
 * Ragged rows are **padded, never truncated**: a short row gets empty cells so every row can be
 * indexed by column position, and a long row keeps its extra cells so nothing a person sent is
 * thrown away silently. Both raise a `ragged_row` warning naming the row.
 */
export function parseCsvChunks(
  chunks: Iterable<string>,
  sniff: FileSniff,
  options: ParseOptions,
): ParsedFile {
  const warnings: Array<ImportWarning> = []
  const rows: Array<Array<string>> = []
  let headers: Array<string> | null = null
  let truncated = false
  let skipped = 0

  const records = scanRecords(chunks, {
    delimiter: sniff.delimiter ?? ',',
    quote: sniff.quote ?? '"',
  })

  for (const record of records) {
    if (skipped < sniff.skipLines) {
      skipped += 1
      continue
    }

    if (headers === null) {
      if (sniff.hasHeader) {
        headers = record.map(headerName)
        continue
      }
      headers = synthesizedHeaders(record.length)
    }

    if (rows.length >= options.maxRows) {
      // One record past the cap is enough to know there was more; the iterable is not advanced
      // again, so the rest of the file is never decoded.
      truncated = true
      warnings.push({
        code: 'row_cap_reached',
        rowIndex: null,
        detail: `Stopped after ${options.maxRows} rows.`,
      })
      break
    }

    if (record.length !== headers.length) {
      warnings.push({
        code: 'ragged_row',
        rowIndex: rows.length,
        detail: `${record.length} fields where the header has ${headers.length}.`,
      })
    }
    while (record.length < headers.length) record.push('')
    rows.push(record)
  }

  return { headers: headers ?? [], rows, warnings, truncated }
}

/**
 * The {@link ImportParser} entry point: bytes in, rows of text out.
 *
 * The two file-level warnings are raised here because this is where the bytes are: a file read
 * through the windows-1250 fallback says so, and a decode that produced a replacement character
 * says so as well. Both are advisory — the rows come back either way.
 */
export function parseCsv(
  bytes: Uint8Array,
  sniff: FileSniff,
  options: ParseOptions,
): ParsedFile {
  // A record rather than a `let`: the flag is written inside a generator and read after it has
  // run, which is a shape narrowing cannot see through.
  const decode = { sawReplacement: false }
  function* watched(): Generator<string> {
    for (const chunk of decodeChunks(bytes, sniff.encoding)) {
      if (!decode.sawReplacement && chunk.includes(REPLACEMENT_CHARACTER)) {
        decode.sawReplacement = true
      }
      yield chunk
    }
  }

  const parsed = parseCsvChunks(watched(), sniff, options)
  const warnings: Array<ImportWarning> = []

  if (sniff.encoding !== 'utf-8') {
    warnings.push({
      code: 're_encoded',
      rowIndex: null,
      detail: `Decoded as ${sniff.encoding}.`,
    })
  }
  if (decode.sawReplacement) {
    warnings.push({
      code: 'replacement_character',
      rowIndex: null,
      detail: `The file contains bytes that are not valid ${sniff.encoding}.`,
    })
  }

  return { ...parsed, warnings: [...warnings, ...parsed.warnings] }
}

/* -------------------------------------------------------------------------- */
/* The registered parser                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What `../registry.ts` finds behind `./csv/parse.ts`.
 *
 * `suggestedMapping` is absent, and that is the honest answer rather than an omission: a delimited
 * file carries no statement about what its columns mean, so anything offered here would be a guess
 * a person would have to notice was wrong.
 */
export const parser: ImportParser = {
  source: 'csv',
  sniff: sniffCsv,
  parse: parseCsv,
}
