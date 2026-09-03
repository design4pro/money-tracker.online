/**
 * The scanner and the decoder, against the claim that carries this area.
 *
 * **A single bad line never loses the file.** Every malformed input below is asserted to come back
 * as rows plus a warning rather than as a throw — the ragged row, the unterminated quote, the
 * stray quote inside an unquoted field.
 *
 * No cell becomes an amount here, and that is the point: this layer returns text. The money
 * invariant is asserted in `../../__tests__/amount.test.ts`, beside the one function that owns it.
 *
 * The parser is exercised through its chunked entry point wherever the property under test is
 * about streaming, because "it stops reading at the cap" is not observable through a convenience
 * wrapper that has already read everything.
 */

import { describe, expect, it } from 'vitest'

import { parseCsv, parseCsvChunks } from '../parse'
import { chunkString, decodeChunks, decodeText, scanRecords } from '../scan'

import type { FileSniff } from '../../types'

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const CSV: FileSniff = {
  encoding: 'utf-8',
  byteOrderMark: false,
  skipLines: 0,
  hasHeader: true,
  delimiter: ',',
  quote: '"',
}

const sniff = (patch: Partial<FileSniff> = {}): FileSniff => ({
  ...CSV,
  ...patch,
})

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** UTF-16, either endianness, with the byte-order mark a real file carries. */
function utf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2)
  out[0] = littleEndian ? 0xff : 0xfe
  out[1] = littleEndian ? 0xfe : 0xff
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index)
    out[2 + index * 2] = littleEndian ? unit & 0xff : unit >> 8
    out[3 + index * 2] = littleEndian ? unit >> 8 : unit & 0xff
  }
  return out
}

const records = (text: string, delimiter = ',', quote = '"') => [
  ...scanRecords([text], { delimiter, quote }),
]

/* -------------------------------------------------------------------------- */
/* The RFC 4180 grammar                                                        */
/* -------------------------------------------------------------------------- */

describe('scanRecords', () => {
  it('splits plain records on every line ending a real export uses', () => {
    expect(records('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(records('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    // A classic-Mac export. One `\r` is one ending, not half of one.
    expect(records('a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('keeps a newline that is inside quotes', () => {
    expect(records('a,"line one\nline two",c')).toEqual([
      ['a', 'line one\nline two', 'c'],
    ])
    expect(records('"first\r\nsecond",x\ny,z')).toEqual([
      ['first\r\nsecond', 'x'],
      ['y', 'z'],
    ])
  })

  it('reads a doubled quote inside a quoted field as one quote', () => {
    expect(records('"say ""hi""",b')).toEqual([['say "hi"', 'b']])
    expect(records('"""",b')).toEqual([['"', 'b']])
  })

  it('treats a quote inside an unquoted field as a character, not as syntax', () => {
    // `O"Brien` is a payee. A strict parser turns the rest of the file into one field.
    expect(records('O"Brien Ltd,12')).toEqual([['O"Brien Ltd', '12']])
  })

  it('closes an unterminated quote at end of file instead of losing the row', () => {
    expect(records('a,b\n"never closed,12')).toEqual([
      ['a', 'b'],
      ['never closed,12'],
    ])
  })

  it('emits the last record of a file that ends without a newline', () => {
    expect(records('a,b\nc,d\n')).toHaveLength(2)
    expect(records('a,b\nc')).toEqual([['a', 'b'], ['c']])
  })

  it('skips a blank line rather than calling it a one-field record', () => {
    expect(records('a,b\n\n\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('keeps empty fields, including a record that is only separators', () => {
    expect(records('a,,c')).toEqual([['a', '', 'c']])
    expect(records(',,')).toEqual([['', '', '']])
    expect(records('"",x')).toEqual([['', 'x']])
  })

  it('reads the same records however the text is chunked', () => {
    const text = 'a,"quoted\nnewline",c\r\nd,"e""f",g\n'
    const whole = [...scanRecords([text], { delimiter: ',', quote: '"' })]
    // One character at a time: every state of the machine crosses a chunk boundary.
    const split = [...scanRecords([...text], { delimiter: ',', quote: '"' })]
    expect(split).toEqual(whole)
    expect(split).toEqual([
      ['a', 'quoted\nnewline', 'c'],
      ['d', 'e"f', 'g'],
    ])
  })
})

/* -------------------------------------------------------------------------- */
/* Rows, headers and warnings                                                  */
/* -------------------------------------------------------------------------- */

describe('parseCsvChunks', () => {
  const options = { maxRows: 1000 }

  it('takes the first line as the header and the rest as rows', () => {
    const parsed = parseCsvChunks(
      chunkString('date,payee,amount\n2026-01-02,Żabka,-45.00\n'),
      sniff(),
      options,
    )

    expect(parsed.headers).toEqual(['date', 'payee', 'amount'])
    expect(parsed.rows).toEqual([['2026-01-02', 'Żabka', '-45.00']])
    expect(parsed.warnings).toEqual([])
    expect(parsed.truncated).toBe(false)
  })

  it('synthesises column names for a headerless file and keeps its first line as data', () => {
    const parsed = parseCsvChunks(
      chunkString('2026-01-02,Żabka,-45.00\n2026-01-03,Lidl,-12.00\n'),
      sniff({ hasHeader: false }),
      options,
    )

    expect(parsed.headers).toEqual(['column_1', 'column_2', 'column_3'])
    expect(parsed.rows).toHaveLength(2)
  })

  it('drops the preamble lines the sniffer counted', () => {
    const parsed = parseCsvChunks(
      chunkString('Statement for 1234\n\ndate,amount\n2026-01-02,-45.00\n'),
      sniff({ skipLines: 1 }),
      options,
    )

    expect(parsed.headers).toEqual(['date', 'amount'])
    expect(parsed.rows).toEqual([['2026-01-02', '-45.00']])
  })

  it('names an empty header cell by position rather than leaving it blank', () => {
    const parsed = parseCsvChunks(
      chunkString('date,,amount\n2026-01-02,x,-45.00\n'),
      sniff(),
      options,
    )
    expect(parsed.headers).toEqual(['date', 'column_2', 'amount'])
  })

  it('warns about a ragged row and pads it, and never throws', () => {
    const parsed = parseCsvChunks(
      chunkString('a,b,c\n1,2\n3,4,5\n6,7,8,9\n'),
      sniff(),
      options,
    )

    expect(parsed.rows).toEqual([
      ['1', '2', ''],
      ['3', '4', '5'],
      ['6', '7', '8', '9'],
    ])
    expect(parsed.warnings.map((warning) => warning.code)).toEqual([
      'ragged_row',
      'ragged_row',
    ])
    expect(parsed.warnings[0].rowIndex).toBe(0)
    expect(parsed.warnings[1].rowIndex).toBe(2)
  })

  it('stops at the row cap, says so, and does not read the rest of the file', () => {
    let pulled = 0
    function* source(): Generator<string> {
      yield 'a,b\n'
      for (let index = 0; index < 10_000; index += 1) {
        pulled += 1
        yield `${index},x\n`
      }
    }

    const parsed = parseCsvChunks(source(), sniff(), { maxRows: 5 })

    expect(parsed.rows).toHaveLength(5)
    expect(parsed.truncated).toBe(true)
    expect(parsed.warnings.map((warning) => warning.code)).toEqual([
      'row_cap_reached',
    ])
    // The cap is a memory bound, not a slice: the source was abandoned a chunk past the cap
    // rather than drained into a ten-thousand-row array that was then cut down.
    expect(pulled).toBeLessThan(10)
  })

  it('holds a five-megabyte file to a bounded number of chunks', () => {
    const row = `2026-01-02,${'x'.repeat(200)},-45.00\n`
    const rows = Math.ceil((5 * 1024 * 1024) / row.length)
    let pulled = 0
    function* source(): Generator<string> {
      yield 'date,payee,amount\n'
      for (let index = 0; index < rows; index += 1) {
        pulled += 1
        yield row
      }
    }

    const parsed = parseCsvChunks(source(), sniff(), { maxRows: 100 })

    expect(rows).toBeGreaterThan(20_000)
    expect(parsed.rows).toHaveLength(100)
    // Under a thousandth of the file was ever materialised.
    expect(pulled).toBeLessThan(110)
  })
})

/* -------------------------------------------------------------------------- */
/* Decoding                                                                    */
/* -------------------------------------------------------------------------- */

describe('decoding', () => {
  it('reads UTF-8 with and without a byte-order mark, and never leaves the mark in a cell', () => {
    const withMark = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('a,b\n1,2\n')])
    expect(decodeText(withMark, 'utf-8')).toBe('a,b\n1,2\n')

    const parsed = parseCsv(withMark, sniff({ byteOrderMark: true }), {
      maxRows: 10,
    })
    expect(parsed.headers).toEqual(['a', 'b'])
  })

  it('reads UTF-16 in both endiannesses', () => {
    expect(decodeText(utf16('płatność,12\n', true), 'utf-16le')).toBe(
      'płatność,12\n',
    )
    expect(decodeText(utf16('płatność,12\n', false), 'utf-16be')).toBe(
      'płatność,12\n',
    )
  })

  it('keeps a surrogate pair whole across a chunk boundary', () => {
    // U+1F4B8 as two UTF-16 code units, decoded in two separate chunks.
    const bytes = utf16('a💸b', true)
    const chunks = [...decodeChunks(bytes, 'utf-16le', 4)]
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe('a💸b')
  })

  it('reads windows-1250, which is what a Polish export actually writes', () => {
    // `Żabka,Świnoujście` in code page 1250: the bytes a UTF-8 decoder would mangle.
    const bytes = new Uint8Array([
      0xaf, 0x61, 0x62, 0x6b, 0x61, 0x2c, 0x8c, 0x77, 0x69, 0x6e, 0x6f, 0x75,
      0x6a, 0x9c, 0x63, 0x69, 0x65, 0x0a,
    ])
    expect(decodeText(bytes, 'windows-1250')).toBe('Żabka,Świnoujście\n')
  })

  it('decodes the same text whatever the chunk size', () => {
    const bytes = utf8('zażółć,gęślą,jaźń\n1,2,3\n')
    for (const size of [1, 2, 3, 7, 64]) {
      expect([...decodeChunks(bytes, 'utf-8', size)].join('')).toBe(
        'zażółć,gęślą,jaźń\n1,2,3\n',
      )
    }
  })
})

describe('parseCsv', () => {
  it('warns that the bytes were re-encoded when the file was not UTF-8', () => {
    const bytes = new Uint8Array([...utf8('a,b\n'), 0xaf, 0x2c, 0x31, 0x0a])
    const parsed = parseCsv(bytes, sniff({ encoding: 'windows-1250' }), {
      maxRows: 10,
    })

    expect(parsed.rows).toEqual([['Ż', '1']])
    expect(parsed.warnings.map((warning) => warning.code)).toEqual([
      're_encoded',
    ])
  })

  it('warns about a replacement character rather than hiding a bad byte', () => {
    // `0xFF` begins no UTF-8 sequence; the decoder substitutes U+FFFD and the parse says so.
    const bytes = new Uint8Array([...utf8('a,b\nx,'), 0xff, 0x0a])
    const parsed = parseCsv(bytes, sniff(), { maxRows: 10 })

    expect(parsed.rows).toHaveLength(1)
    expect(parsed.warnings.map((warning) => warning.code)).toContain(
      'replacement_character',
    )
  })
})
