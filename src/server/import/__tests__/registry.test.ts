/**
 * Finding a format's module, and refusing to invent one.
 *
 * Two properties are worth a file of their own. **A `source` with no module is a typed refusal**,
 * because the alternative - reading a QIF file as comma-separated text - produces rows, and rows
 * that parse are rows that get written into somebody's ledger. And **the glob is lazy**: the keys
 * are static, so asking whether a format exists evaluates nothing, and resolving one format
 * evaluates one module.
 *
 * The shipped glob cannot demonstrate the second one - this build ships a single format - so
 * `createParserRegistry` takes its importers as a parameter and the fixtures below stand in. That
 * is the same reason `src/lib/i18n/catalogue.ts` parameterises `createCatalogueLoader`.
 */

import { describe, expect, it } from 'vitest'

import {
  UnsupportedImportSourceError,
  createParserRegistry,
  hasParser,
  resolveParser,
} from '../registry'
import { IMPORT_MAX_ROWS } from '../types'

/** A small `;`-delimited file with a header, the shape a Polish export arrives in. */
const FILE =
  'data;opis;kwota\n2026-01-02;Żabka;-45,00\n2026-01-03;Lidl;-12,00\n'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('the parser registry', () => {
  it('resolves csv to a parser that sniffs and parses', async () => {
    const parser = await resolveParser('csv')
    expect(parser.source).toBe('csv')

    const sniff = parser.sniff(bytes(FILE))
    expect(sniff.delimiter).toBe(';')
    const parsed = parser.parse(bytes(FILE), sniff, {
      maxRows: IMPORT_MAX_ROWS,
    })
    expect(parsed.headers).toEqual(['data', 'opis', 'kwota'])
    expect(parsed.rows).toHaveLength(2)
  })

  it('offers no mapping for csv, because a delimited file states nothing about its columns', async () => {
    const parser = await resolveParser('csv')
    expect(parser.suggestedMapping).toBeUndefined()
  })

  it('fails a source whose module is absent instead of falling back to csv', async () => {
    // `ofx` is a real member of `IMPORT_SOURCES` — the enum is migrated — and `19-S4` writes it.
    // Reading it as comma-separated text would produce rows, and rows that parse get written.
    await expect(resolveParser('ofx')).rejects.toBeInstanceOf(
      UnsupportedImportSourceError,
    )
    expect(hasParser('ofx')).toBe(false)
    expect(hasParser('csv')).toBe(true)
    // A source that is not in the schema's enum at all is the same refusal, not a crash.
    await expect(resolveParser('xlsx')).rejects.toBeInstanceOf(
      UnsupportedImportSourceError,
    )
    expect(hasParser('xlsx')).toBe(false)
  })

  it('finds a format by its directory and evaluates only the one asked for', async () => {
    // The shipped glob cannot prove laziness — there is one format in this build — so the seam
    // takes its importers as a parameter and the counters below are the assertion.
    const evaluated: Array<string> = []
    const stub = (source: string) => async () => {
      evaluated.push(source)
      return {
        parser: {
          source,
          sniff: () => {
            throw new Error('not called')
          },
          parse: () => {
            throw new Error('not called')
          },
        },
      }
    }
    const registry = createParserRegistry({
      './csv/parse.ts': stub('csv'),
      './qif/parse.ts': stub('qif'),
    } as never)

    expect(registry.hasParser('qif')).toBe(true)
    expect(evaluated).toEqual([])

    await registry.resolveParser('qif')
    expect(evaluated).toEqual(['qif'])

    // Twice for the same source is one evaluation: the registry caches per isolate.
    await registry.resolveParser('qif')
    expect(evaluated).toEqual(['qif'])
  })

  it('refuses a module whose parser disagrees with its own directory', async () => {
    const registry = createParserRegistry({
      './qif/parse.ts': async () => ({
        parser: {
          source: 'csv',
          sniff: () => undefined,
          parse: () => undefined,
        },
      }),
    } as never)

    await expect(registry.resolveParser('qif')).rejects.toBeInstanceOf(
      UnsupportedImportSourceError,
    )
  })

  it('hands back a parser that reads text and nothing that reads an amount', async () => {
    // The seam's whole surface. There is no member here that turns a cell into money: that is
    // `../amount.ts`, applied after a person has confirmed the mapping, and `./amount.test.ts`
    // is where it is held to `docs/MONEY.md`.
    expect(Object.keys(await resolveParser('csv'))).toEqual([
      'source',
      'sniff',
      'parse',
    ])
  })
})
