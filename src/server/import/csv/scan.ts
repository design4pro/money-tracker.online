/**
 * Bytes to records: the decoder and the RFC 4180 scanner, written here rather than installed.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS HAND-ROLLED
 * ---------------------------------------------------------------------------
 *
 * `docs/SPEC.md` §3.1 freezes the dependency set, and the CSV libraries in it are built for a DOM
 * or for Node streams. This runs in **workerd**, where there is no `Buffer`, no `stream` module and
 * no `iconv`. What is left is a character-level state machine, which is two hundred lines and is
 * the part of an importer nobody should outsource anyway: the failure mode of a third-party parser
 * on a malformed line is an exception carrying no row number, and the row number is exactly the
 * information the preview screen exists to show.
 *
 * ---------------------------------------------------------------------------
 * THE THREE PROPERTIES
 * ---------------------------------------------------------------------------
 *
 * 1. **It streams.** {@link scanRecords} pulls text chunks from an iterable and yields records as
 *    it completes them. When the caller stops - at the row cap - the iterable is never advanced
 *    again, so a file with a million rows costs twenty thousand rows of memory and the bytes it
 *    took to find them, not the whole file's worth of records. The decoder is a generator for the
 *    same reason.
 *
 * 2. **It never throws over content.** A ragged row, an unterminated quote at end of file, a stray
 *    quote in the middle of an unquoted field: every one of them is a row that comes back. Naming
 *    what was odd is `./parse.ts`'s job; refusing a file is nobody's.
 *
 * 3. **Decoding is exhaustive and self-contained.** `TextDecoder` in workerd is guaranteed for
 *    UTF-8 and nothing else, so UTF-16 and windows-1250 are decoded from tables here. The
 *    alternative is a decoder that works in the Node test and returns mojibake in production.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS ITS OWN FILE
 * ---------------------------------------------------------------------------
 *
 * Both neighbours need it and they need each other in one direction only. `./sniff.ts` decides the
 * delimiter by running **this** scanner over each candidate, and `./parse.ts` runs it once over the
 * delimiter the sniff settled on - and `./parse.ts` also imports `./sniff.ts`, because the parser
 * object the registry resolves carries both halves. Leaving the scanner in `./parse.ts` would make
 * that pair a cycle; here the graph is `scan → sniff → parse` and nothing points back.
 */

import type { ImportEncoding } from '../types'

/* -------------------------------------------------------------------------- */
/* Decoding                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * windows-1250, bytes `0x80`–`0xFF`, in order. Index `n` is the character for byte `0x80 + n`.
 *
 * Written as a table because it is one: the code page is a fixed mapping published in 1993 and it
 * does not have an algorithm. `�` marks the five byte values the code page leaves undefined,
 * which is also what a conforming decoder substitutes for them.
 *
 * The lower half (`0x00`–`0x7F`) is ASCII and needs no table.
 */
const WINDOWS_1250_HIGH =
  '€�‚�„…†‡�‰Š‹ŚŤŽŹ' +
  '�‘’“”•–—�™š›śťžź' +
  ' ˇ˘Ł¤Ą¦§¨©Ş«¬­®Ż' +
  '°±˛ł´µ¶·¸ąş»Ľ˝ľż' +
  'ŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎ' +
  'ĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢß' +
  'ŕáâăäĺćçčéęëěíîď' +
  'đńňóôőö÷řůúűüýţ˙'

/** How many bytes a decode step takes at a time. 64 KiB is one D1 row of slack, not a tuning knob. */
const DECODE_CHUNK_BYTES = 64 * 1024

/** The character a decoder substitutes for a byte sequence that means nothing in its encoding. */
export const REPLACEMENT_CHARACTER = '�'

/** How many bytes of byte-order mark precede the text, given what the sniffer decided. */
export function byteOrderMarkLength(bytes: Uint8Array): number {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 3
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 2
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 2
  return 0
}

/** Two bytes as one UTF-16 code unit, in the endianness asked for. */
function codeUnit(
  bytes: Uint8Array,
  at: number,
  littleEndian: boolean,
): number {
  return littleEndian
    ? bytes[at] | (bytes[at + 1] << 8)
    : (bytes[at] << 8) | bytes[at + 1]
}

/**
 * The file's text, a chunk at a time, with any byte-order mark already gone.
 *
 * A generator rather than a string so the scanner above can stop reading a large file the moment
 * it has the rows it was allowed to take. Nothing here concatenates the whole decode.
 *
 * Surrogate pairs survive a chunk boundary without special handling: UTF-16 code units are decoded
 * one at a time and JavaScript strings hold lone surrogates, so a pair split across two chunks is
 * a pair again once the two strings meet.
 */
export function* decodeChunks(
  bytes: Uint8Array,
  encoding: ImportEncoding,
  chunkBytes: number = DECODE_CHUNK_BYTES,
): Generator<string> {
  const start = byteOrderMarkLength(bytes)

  if (encoding === 'utf-8') {
    // The one encoding workerd's `TextDecoder` is guaranteed to have. `stream: true` carries a
    // multi-byte sequence split across two chunks into the next call.
    const decoder = new TextDecoder('utf-8')
    for (let at = start; at < bytes.length; at += chunkBytes) {
      const end = Math.min(at + chunkBytes, bytes.length)
      yield decoder.decode(bytes.subarray(at, end), { stream: true })
    }
    const tail = decoder.decode()
    if (tail !== '') yield tail
    return
  }

  if (encoding === 'windows-1250') {
    for (let at = start; at < bytes.length; at += chunkBytes) {
      const end = Math.min(at + chunkBytes, bytes.length)
      let out = ''
      for (let index = at; index < end; index += 1) {
        const byte = bytes[index]
        out +=
          byte < 0x80
            ? String.fromCharCode(byte)
            : WINDOWS_1250_HIGH[byte - 0x80]
      }
      yield out
    }
    return
  }

  const littleEndian = encoding === 'utf-16le'
  // A trailing odd byte cannot be half of anything; it is dropped rather than decoded as a NUL.
  const usable = bytes.length - ((bytes.length - start) % 2)
  // An odd chunk size would split a code unit, so every step stays on a unit boundary.
  const step = chunkBytes - (chunkBytes % 2)
  for (let at = start; at < usable; at += step) {
    const end = Math.min(at + step, usable)
    let out = ''
    for (let index = at; index < end; index += 2) {
      out += String.fromCharCode(codeUnit(bytes, index, littleEndian))
    }
    yield out
  }
}

/** The whole file as text. For the sniffer's first twenty lines, never for a parse. */
export function decodeText(
  bytes: Uint8Array,
  encoding: ImportEncoding,
): string {
  let out = ''
  for (const chunk of decodeChunks(bytes, encoding)) out += chunk
  return out
}

/** A string as an iterable of chunks, so a caller with text in hand can use the streaming path. */
export function* chunkString(
  text: string,
  size: number = DECODE_CHUNK_BYTES,
): Generator<string> {
  for (let at = 0; at < text.length; at += size) {
    yield text.slice(at, at + size)
  }
}

/* -------------------------------------------------------------------------- */
/* The RFC 4180 scanner                                                       */
/* -------------------------------------------------------------------------- */

export interface ScanOptions {
  readonly delimiter: string
  readonly quote: string
}

/**
 * Records of raw fields, pulled from a stream of text chunks.
 *
 * The grammar is RFC 4180 with the three relaxations every real export needs:
 *
 * - **Any of `\r\n`, `\n` and a lone `\r` ends a record.** A file written on a classic Mac and a
 *   file written by a Linux cron both arrive, and refusing one of them is refusing a statement.
 * - **A quote inside an unquoted field is a character**, not a syntax error. `O"Brien Ltd` is a
 *   payee, and a strict parser turns the rest of the file into one enormous field.
 * - **An unterminated quote at end of file closes itself.** The alternative is losing every row
 *   after the mistake, which is the opposite of what somebody uploading a statement wants.
 *
 * A blank line yields nothing: it is whitespace between records in every export that emits one,
 * and treating it as a one-field record would make every trailing newline a ragged row.
 */
export function* scanRecords(
  chunks: Iterable<string>,
  options: ScanOptions,
): Generator<Array<string>> {
  const { delimiter, quote } = options

  let field = ''
  let row: Array<string> = []
  let inQuotes = false
  /** The previous character was a quote **inside** a quoted field: either an escape or the end. */
  let quotePending = false
  /** The previous character was a CR, so a following LF is the same line ending. */
  let carriageReturn = false
  /** Anything at all has been read for the record being built. */
  let started = false

  function endField(): void {
    row.push(field)
    field = ''
  }

  function takeRecord(): Array<string> | null {
    endField()
    const record = row
    row = []
    started = false
    // A blank line: one empty field and nothing else.
    if (record.length === 1 && record[0] === '') return null
    return record
  }

  for (const chunk of chunks) {
    for (const character of chunk) {
      if (carriageReturn) {
        carriageReturn = false
        // `\r\n` is one ending; the record was already emitted on the `\r`.
        if (character === '\n') continue
      }

      if (quotePending) {
        quotePending = false
        if (character === quote) {
          // `""` inside a quoted field is one literal quote.
          field += quote
          continue
        }
        inQuotes = false
        // Falls through: the character after the closing quote is read as unquoted.
      }

      if (inQuotes) {
        if (character === quote) {
          quotePending = true
        } else {
          field += character
        }
        continue
      }

      if (character === quote && field === '') {
        // A quote only opens a field at its start. Anywhere else it is a character.
        inQuotes = true
        started = true
        continue
      }

      if (character === delimiter) {
        endField()
        started = true
        continue
      }

      if (character === '\n' || character === '\r') {
        carriageReturn = character === '\r'
        const record = takeRecord()
        if (record !== null) yield record
        continue
      }

      field += character
      started = true
    }
  }

  // The ragged final line: a file that ends without a newline still has a last record, and an
  // unterminated quote is closed here rather than swallowing everything before it.
  if (started || field !== '' || row.length > 0) {
    const record = takeRecord()
    if (record !== null) yield record
  }
}

/* -------------------------------------------------------------------------- */
/* The CSV parser                                                             */
/* -------------------------------------------------------------------------- */
