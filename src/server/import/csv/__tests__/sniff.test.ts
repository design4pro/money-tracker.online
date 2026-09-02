/**
 * The sniffer, against the files people actually upload.
 *
 * Every fixture here is a real shape rather than a synthetic one: a Polish bank writes
 * windows-1250 with `;` and a title row above the table, a spreadsheet writes UTF-8 with a
 * byte-order mark, an older export writes UTF-16LE, and somebody's script writes tab-separated
 * with no header at all. The heuristics are only worth anything against those.
 *
 * The two failure modes worth naming, because both are tested for directly:
 *
 * - **A comma inside an address wins a frequency vote and loses a consistency vote.** The
 *   `;`-delimited fixture below has more commas than semicolons, which is exactly why the
 *   delimiter is decided by field-count agreement rather than by counting characters.
 * - **A file read as the wrong encoding does not fail, it produces mojibake** — so the encoding
 *   assertions check the decoded diacritics rather than only the label.
 */

import { describe, expect, it } from 'vitest'

import { decodeText } from '../scan'
import {
  cellKind,
  detectDelimiter,
  detectEncoding,
  detectHeader,
  isValidUtf8,
  sniffCsv,
} from '../sniff'

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

const withBom = (text: string): Uint8Array =>
  new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)])

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

/**
 * The reverse of the decoder's table, for building a fixture the way a Polish Excel would.
 *
 * Deriving it from the decoder rather than writing a second table means the two cannot disagree —
 * and a test that round-trips through the module under test still proves the thing that matters
 * here, which is that the *bytes* are not UTF-8 and are read anyway.
 */
function windows1250(text: string): Uint8Array {
  const high = decodeText(
    new Uint8Array(Array.from({ length: 128 }, (_, index) => 0x80 + index)),
    'windows-1250',
  )
  const out = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const code = character.charCodeAt(0)
    if (code < 0x80) {
      out[index] = code
      continue
    }
    const at = high.indexOf(character)
    if (at === -1) throw new Error(`${character} is not in windows-1250`)
    out[index] = 0x80 + at
  }
  return out
}

/**
 * A Polish bank's export: a title row padded with delimiters, `;` between the columns, commas as
 * decimal separators, and commas inside every description.
 *
 * There are more commas in it than semicolons, which is the whole point — see the delimiter test.
 */
const POLISH_BANK = [
  'Historia rachunku 12 3456 7890;;;',
  'Data;Opis;Kwota;Saldo',
  '2026-01-02;Sklep Żabka, ul. Długa 12, Warszawa, PL;-45,00;1 200,00',
  '2026-01-03;Przelew, tytułem: czynsz, styczeń, mieszkanie;-1 800,00;-600,00',
  '2026-01-04;Wypłata, bankomat, ul. Krótka 3, Gdańsk;-200,00;-800,00',
  '2026-01-05;Zakupy, Biedronka, Kraków, ul. Nowa;-88,10;-888,10',
].join('\n')

/* -------------------------------------------------------------------------- */
/* Encoding                                                                    */
/* -------------------------------------------------------------------------- */

describe('detectEncoding', () => {
  it('believes a byte-order mark over everything else', () => {
    expect(detectEncoding(withBom('a,b\n'))).toBe('utf-8')
    expect(detectEncoding(utf16('a,b\n', true))).toBe('utf-16le')
    expect(detectEncoding(utf16('a,b\n', false))).toBe('utf-16be')
  })

  it('reads UTF-8 without a mark as UTF-8', () => {
    expect(
      detectEncoding(utf8('data,opis\n2026-01-02,zażółć gęślą jaźń\n')),
    ).toBe('utf-8')
    expect(detectEncoding(utf8('a,b\n1,2\n'))).toBe('utf-8')
  })

  it('falls back to windows-1250 for a Polish export that is not UTF-8', () => {
    const bytes = windows1250(POLISH_BANK)
    expect(detectEncoding(bytes)).toBe('windows-1250')
    // And the fallback is the *right* one: the diacritics survive.
    expect(decodeText(bytes, 'windows-1250')).toContain('Sklep Żabka')
    expect(decodeText(bytes, 'windows-1250')).toContain('tytułem')
  })

  it('does not accept an over-long form or a surrogate as valid UTF-8', () => {
    // `0xC0 0xB1` is an over-long `1`. Accepting it would call a windows-1250 file UTF-8.
    expect(isValidUtf8(new Uint8Array([0xc0, 0xb1]))).toBe(false)
    // A surrogate half, which UTF-8 may not encode.
    expect(isValidUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toBe(false)
    // A truncated sequence.
    expect(isValidUtf8(new Uint8Array([0xc3]))).toBe(false)
    expect(isValidUtf8(utf8('zażółć'))).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* Delimiter                                                                   */
/* -------------------------------------------------------------------------- */

describe('detectDelimiter', () => {
  it('picks the semicolon of a Polish export even though commas are more frequent', () => {
    const commas = (POLISH_BANK.match(/,/gu) ?? []).length
    const semicolons = (POLISH_BANK.match(/;/gu) ?? []).length
    expect(commas).toBeGreaterThan(semicolons)

    expect(detectDelimiter(POLISH_BANK).delimiter).toBe(';')
  })

  it('picks the comma of an ordinary CSV', () => {
    expect(
      detectDelimiter('date,payee,amount\n2026-01-02,Lidl,-12.00\n').delimiter,
    ).toBe(',')
  })

  it('picks the tab of a tab-separated export', () => {
    const tsv = 'date\tpayee\tamount\n2026-01-02\tLidl, sp. z o.o.\t-12.00\n'
    expect(detectDelimiter(tsv).delimiter).toBe('\t')
  })

  it('picks the pipe of a pipe-separated export', () => {
    expect(detectDelimiter('a|b|c\n1|2|3\n4|5|6\n').delimiter).toBe('|')
  })

  it('answers a one-column file with one field rather than inventing a delimiter', () => {
    const single = detectDelimiter('amount\n-45.00\n-12.00\n')
    expect(single.fields).toBe(1)
  })

  it('prefers the candidate every line agrees on over one that splits some lines', () => {
    // The comma appears on two of the three lines; the semicolon splits all three the same way.
    const text = 'a;b;c\n1;2, x;3\n4;5;6\n'
    expect(detectDelimiter(text).delimiter).toBe(';')
    expect(detectDelimiter(text).agreeing).toBe(3)
  })
})

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

describe('detectHeader', () => {
  it('reads a row of words above rows of dates and numbers as a header', () => {
    expect(
      detectHeader(
        ['Data', 'Opis', 'Kwota'],
        [
          ['2026-01-02', 'Żabka', '-45,00'],
          ['2026-01-03', 'Lidl', '-12,00'],
        ],
      ),
    ).toBe(true)
  })

  it('reads a first row that looks like every other row as data', () => {
    expect(
      detectHeader(
        ['2026-01-02', 'Żabka', '-45,00'],
        [
          ['2026-01-03', 'Lidl', '-12,00'],
          ['2026-01-04', 'Biedronka', '-30,00'],
        ],
      ),
    ).toBe(false)
  })

  it('does not call a text column a header just because the first row is text too', () => {
    expect(
      detectHeader(
        ['Żabka', 'zakupy'],
        [
          ['Lidl', 'zakupy'],
          ['Orlen', 'paliwo'],
        ],
      ),
    ).toBe(false)
  })

  it('has no opinion about a file with a single line', () => {
    expect(detectHeader(['Data', 'Kwota'], [])).toBe(false)
  })

  it('classifies a cell by what it looks like, not by what a column is called', () => {
    expect(cellKind('2026-01-02')).toBe('date')
    expect(cellKind('02.01.2026')).toBe('date')
    expect(cellKind('-1 234,56')).toBe('number')
    expect(cellKind('(45.00)')).toBe('number')
    expect(cellKind('Kwota')).toBe('text')
    expect(cellKind('   ')).toBe('empty')
  })
})

/* -------------------------------------------------------------------------- */
/* The whole sniff                                                             */
/* -------------------------------------------------------------------------- */

describe('sniffCsv', () => {
  it('reads a Polish bank export end to end: encoding, title row, delimiter and header', () => {
    const result = sniffCsv(windows1250(POLISH_BANK))

    expect(result).toEqual({
      encoding: 'windows-1250',
      byteOrderMark: false,
      // The title row is not part of the table: it does not have the table's field count.
      skipLines: 1,
      hasHeader: true,
      delimiter: ';',
      quote: '"',
    })
  })

  it('reads a spreadsheet CSV with a byte-order mark', () => {
    const result = sniffCsv(
      withBom(
        'date,payee,amount\n2026-01-02,Lidl,-12.00\n2026-01-03,Orlen,-200.00\n',
      ),
    )

    expect(result.encoding).toBe('utf-8')
    expect(result.byteOrderMark).toBe(true)
    expect(result.delimiter).toBe(',')
    expect(result.hasHeader).toBe(true)
    expect(result.skipLines).toBe(0)
  })

  it('reads a UTF-16LE export', () => {
    const result = sniffCsv(
      utf16(
        'data;opis;kwota\n2026-01-02;Żabka;-45,00\n2026-01-03;Lidl;-12,00\n',
        true,
      ),
    )

    expect(result.encoding).toBe('utf-16le')
    expect(result.byteOrderMark).toBe(true)
    expect(result.delimiter).toBe(';')
    expect(result.hasHeader).toBe(true)
  })

  it('reads a headerless tab-separated file as headerless', () => {
    const result = sniffCsv(
      utf8('2026-01-02\tLidl\t-12.00\n2026-01-03\tOrlen\t-200.00\n'),
    )

    expect(result.delimiter).toBe('\t')
    expect(result.hasHeader).toBe(false)
    expect(result.skipLines).toBe(0)
  })

  it('drops a title row that does not carry the table’s columns at all', () => {
    // The unpadded shape: three fields where the table has four.
    const result = sniffCsv(
      utf8(
        'Wyciag za styczen 2026\ndata;opis;kwota\n2026-01-02;Żabka;-45,00\n2026-01-03;Lidl;-12,00\n',
      ),
    )

    expect(result.skipLines).toBe(1)
    expect(result.hasHeader).toBe(true)
    expect(result.delimiter).toBe(';')
  })

  it('does not mistake a quoted delimiter for a column boundary', () => {
    const result = sniffCsv(
      utf8(
        'date,payee,amount\n2026-01-02,"Lidl, sp. z o.o.",-12.00\n2026-01-03,"Orlen, S.A.",-200.00\n',
      ),
    )

    expect(result.delimiter).toBe(',')
    expect(result.hasHeader).toBe(true)
  })
})
