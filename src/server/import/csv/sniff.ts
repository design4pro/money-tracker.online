/**
 * What shape is this file? The encoding, the delimiter, the quote and whether line 1 is a header.
 *
 * ---------------------------------------------------------------------------
 * THREE DECISIONS, AND WHY EACH IS MADE THE WAY IT IS
 * ---------------------------------------------------------------------------
 *
 * **The encoding is read from the bytes, never from the file name.** A byte-order mark answers it
 * outright; without one, the bytes are checked for being valid UTF-8, and a file that is not falls
 * back to **windows-1250**. That fallback is named rather than left to a general-purpose detector
 * because this product's first market is Poland: a bank export or an Excel "CSV" saved there is
 * windows-1250 far more often than anything else, and the failure it prevents — every `ą`, `ł` and
 * `ż` in a payee name replaced by `�` — is the one people report.
 *
 * **The delimiter is decided by consistency, not by frequency.** Counting characters picks the
 * comma out of `Sklep Żabka, ul. Długa 12;-45,00;2026-01-02` and every row of that file then has
 * the wrong number of fields. So each candidate is *actually scanned* over the first
 * {@link SNIFF_LINES} lines and scored on how many lines agree with its own most common field
 * count. A delimiter that is really the delimiter produces the same field count on every line; one
 * that happens to appear inside free text does not.
 *
 * **The header is decided by type heterogeneity, not by a keyword list.** Line 1 is a header when
 * at least one column holds text there and holds dates or numbers below. A list of expected column
 * names would work for the banks somebody thought of and fail for a bank in another language,
 * which is every bank in the second market.
 *
 * A bank's title row — `Statement for account 1234;;;` before the real table — is handled by the
 * same consistency test: it does not have the table's field count, so it lands in `skipLines` and
 * the header search starts at the first line that does.
 */

import { byteOrderMarkLength, decodeText, scanRecords } from './scan'

import type { CsvDelimiter, FileSniff, ImportEncoding } from '../types'

/**
 * The candidates, in the order a tie is broken.
 *
 * `;` leads because a Polish Excel writes it — in a locale whose decimal separator is the comma,
 * the comma cannot be the field separator, and that is the majority of this product's first market.
 */
const CANDIDATES: ReadonlyArray<CsvDelimiter> = [';', ',', '\t', '|']

/** How many lines of the file the delimiter vote reads. Twenty is the stage's number. */
export const SNIFF_LINES = 20

/** How many lines below the candidate header the type comparison reads. */
const HEADER_COMPARISON_LINES = 9

/** The quote character. Every export that quotes at all quotes with `"`. */
const QUOTE = '"'

/**
 * How many bytes the encoding check reads.
 *
 * A whole 5 MB file would be validated byte by byte for an answer the first few kilobytes already
 * give — and the check is only ever wrong in one direction: a file whose first 64 KiB are ASCII
 * and whose later rows are windows-1250 decodes to a replacement character, which `parse.ts`
 * raises as a warning rather than hiding.
 */
const ENCODING_SAMPLE_BYTES = 64 * 1024

/* -------------------------------------------------------------------------- */
/* Encoding                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Whether `bytes` is well-formed UTF-8, by the encoding's own rules.
 *
 * Written out rather than delegated to `TextDecoder({ fatal: true })` because the answer has to be
 * the same in workerd and in Node, and because the over-long forms and the surrogate range have to
 * be **rejected**: `0xC0 0xB1` is not a `1`, and a decoder that accepts it would call a
 * windows-1250 file valid UTF-8 and hand back mojibake.
 */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let at = 0
  while (at < bytes.length) {
    const byte = bytes[at]

    if (byte < 0x80) {
      at += 1
      continue
    }

    let length: number
    let codePoint: number
    if (byte >= 0xc2 && byte <= 0xdf) {
      length = 2
      codePoint = byte & 0x1f
    } else if (byte >= 0xe0 && byte <= 0xef) {
      length = 3
      codePoint = byte & 0x0f
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      length = 4
      codePoint = byte & 0x07
    } else {
      // `0x80`–`0xC1` and `0xF5`–`0xFF` never begin a sequence.
      return false
    }

    if (at + length > bytes.length) return false
    for (let offset = 1; offset < length; offset += 1) {
      const continuation = bytes[at + offset]
      if ((continuation & 0xc0) !== 0x80) return false
      codePoint = (codePoint << 6) | (continuation & 0x3f)
    }

    if (
      length === 3 &&
      (codePoint < 0x800 || (codePoint >= 0xd800 && codePoint <= 0xdfff))
    ) {
      return false
    }
    if (length === 4 && (codePoint < 0x10000 || codePoint > 0x10ffff)) {
      return false
    }

    at += length
  }
  return true
}

/** The byte-order mark, if there is one, and what it says the encoding is. */
function markedEncoding(bytes: Uint8Array): ImportEncoding | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  return null
}

/** The encoding of `bytes`: the mark if there is one, else UTF-8 if it is valid, else the fallback. */
export function detectEncoding(bytes: Uint8Array): ImportEncoding {
  const marked = markedEncoding(bytes)
  if (marked !== null) return marked

  const sample = bytes.subarray(0, ENCODING_SAMPLE_BYTES)
  // A truncated sample can cut a multi-byte sequence in half, which would fail the check for a
  // reason that is about the sample rather than about the file. Trim back to a boundary.
  let end = sample.length
  while (end > 0 && (sample[end - 1] & 0xc0) === 0x80) end -= 1
  if (end > 0 && sample[end - 1] >= 0x80) end -= 1

  return isValidUtf8(sample.subarray(0, end)) ? 'utf-8' : 'windows-1250'
}

/* -------------------------------------------------------------------------- */
/* Delimiter                                                                  */
/* -------------------------------------------------------------------------- */

/** How well one candidate delimiter explains the sample. */
interface DelimiterScore {
  readonly delimiter: CsvDelimiter
  /** The field count most lines agree on. */
  readonly fields: number
  /** How many of the sampled lines have exactly that many fields. */
  readonly agreeing: number
  /** How many lines were sampled at all. */
  readonly lines: number
}

function scoreDelimiter(text: string, delimiter: CsvDelimiter): DelimiterScore {
  const counts = new Map<number, number>()
  let lines = 0

  for (const record of scanRecords([text], { delimiter, quote: QUOTE })) {
    counts.set(record.length, (counts.get(record.length) ?? 0) + 1)
    lines += 1
    if (lines >= SNIFF_LINES) break
  }

  let fields = 0
  let agreeing = 0
  for (const [count, seen] of counts) {
    // More agreeing lines wins; a tie goes to the wider table, because a delimiter that splits a
    // file into two columns and one that splits it into eight can both be perfectly consistent.
    if (seen > agreeing || (seen === agreeing && count > fields)) {
      fields = count
      agreeing = seen
    }
  }

  return { delimiter, fields, agreeing, lines }
}

/**
 * The delimiter of a sample, and the field count the table settles on.
 *
 * A candidate that never splits a line into more than one field scores nothing — it is not present
 * in the file. When no candidate splits anything (a one-column file), the first candidate is
 * returned with a field count of 1, which is a real answer: the file has one column.
 */
export function detectDelimiter(text: string): DelimiterScore {
  let best: DelimiterScore | null = null

  for (const delimiter of CANDIDATES) {
    const score = scoreDelimiter(text, delimiter)
    if (score.fields < 2) continue
    if (
      best === null ||
      score.agreeing > best.agreeing ||
      (score.agreeing === best.agreeing && score.fields > best.fields)
    ) {
      best = score
    }
  }

  return best ?? { delimiter: CANDIDATES[0], fields: 1, agreeing: 0, lines: 0 }
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

/** What a cell looks like, to the one eye that has to compare two rows. */
type CellKind = 'empty' | 'number' | 'date' | 'text'

const NUMERIC = /^[-+(]?\s*[\d\s.,']*\d[\d\s.,']*\)?\s*[a-zA-Z]{0,3}$/u
const DATE =
  /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/u

export function cellKind(value: string): CellKind {
  const text = value.trim()
  if (text === '') return 'empty'
  if (DATE.test(text)) return 'date'
  if (NUMERIC.test(text) && /\d/u.test(text)) return 'number'
  return 'text'
}

/**
 * Whether the first row of a table names its columns.
 *
 * The test is heterogeneity: a column whose first cell is text and whose body is dates or numbers
 * is a named column. One such column is enough — a statement whose every column is text below
 * (`date;description;note`) is vanishingly rare, and the cost of the two errors is not symmetric:
 * a header read as data becomes one junk row a person deletes, while data read as a header loses a
 * transaction silently.
 */
export function detectHeader(
  first: ReadonlyArray<string>,
  body: ReadonlyArray<ReadonlyArray<string>>,
): boolean {
  if (body.length === 0) return false

  let heterogeneous = 0
  for (let column = 0; column < first.length; column += 1) {
    if (cellKind(first[column] ?? '') !== 'text') continue

    let typed = 0
    let filled = 0
    for (const row of body) {
      const kind = cellKind(row[column] ?? '')
      if (kind === 'empty') continue
      filled += 1
      if (kind !== 'text') typed += 1
    }
    // Every filled cell below has to be a date or a number: one text value in the column and the
    // difference is not a difference of type, it is two rows of prose.
    if (filled > 0 && typed === filled) heterogeneous += 1
  }

  return heterogeneous > 0
}

/**
 * Whether a leading line is preamble rather than part of the table.
 *
 * Two shapes, and a bank writes both. The first is a title row that ignores the table's columns —
 * `Historia rachunku 12 3456 7890` on its own line — which shows up as a different field count.
 * The second is the same row **padded with delimiters** so the file looks rectangular to a
 * spreadsheet, `Historia rachunku 12 3456 7890;;;`, which has the table's field count and one
 * non-empty cell. Neither is a header and neither is a transaction.
 *
 * Only leading lines are tested, and the scan stops at the first line that is not preamble, so a
 * sparse row in the middle of a statement is data like any other.
 */
function isPreamble(record: ReadonlyArray<string>, fields: number): boolean {
  if (record.length !== fields) return true
  const filled = record.filter((cell) => cell.trim() !== '').length
  return record.length > 1 && filled <= 1
}

/* -------------------------------------------------------------------------- */
/* The sniff                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Everything the mapping screen needs before a single cell is mapped.
 *
 * The sample is the first {@link ENCODING_SAMPLE_BYTES} of the file rather than all of it: the
 * questions this answers are all answered by the first twenty lines, and a 5 MB file decoded twice
 * for a preview is 5 MB of work nobody asked for.
 */
export function sniffCsv(bytes: Uint8Array): FileSniff {
  const encoding = detectEncoding(bytes)
  const byteOrderMark = byteOrderMarkLength(bytes) > 0
  const sample = decodeText(
    bytes.subarray(0, ENCODING_SAMPLE_BYTES + byteOrderMarkLength(bytes)),
    encoding,
  )

  const { delimiter, fields } = detectDelimiter(sample)

  const records: Array<Array<string>> = []
  for (const record of scanRecords([sample], { delimiter, quote: QUOTE })) {
    records.push(record)
    if (records.length >= SNIFF_LINES) break
  }

  let skipLines = 0
  while (
    skipLines < records.length - 1 &&
    isPreamble(records[skipLines], fields)
  ) {
    skipLines += 1
  }

  const table = records.slice(skipLines)
  const hasHeader =
    table.length > 0 &&
    detectHeader(table[0], table.slice(1, 1 + HEADER_COMPARISON_LINES))

  return {
    encoding,
    byteOrderMark,
    skipLines,
    hasHeader,
    delimiter,
    quote: QUOTE,
  }
}
