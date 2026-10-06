/**
 * The currency catalogue's server half: what the seeded `currencies` table holds, and what
 * `listEnabledCurrencies` reads from it.
 *
 * The static table in `src/lib/money/currencies.ts` is the source of `digits`, names and codes. The
 * D1 row is its **mirror**, loaded by `drizzle/0002_seed_currency_catalogue.sql` and read by no
 * arithmetic, so the only thing keeping the two equal is the parity test below. A later migration
 * that changes a currency must change the static table in the same pull request.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { CURRENCIES } from '#/lib/money'
import { currencies } from '#/server/db/schema'
import { openTestDb } from '#/server/repos/__tests__/db-harness'

import * as catalogueModule from '../currencies'
import { listEnabledCurrencies } from '../currencies'

const NON_CURRENCIES = ['XAU', 'XAG', 'XPT', 'XPD', 'XDR', 'XXX', 'XTS']

const SEED_DRIFT_MESSAGE =
  'The seeded `currencies` table differs from the static catalogue. ' +
  'A catalogue change is made in `src/lib/money/currencies.ts` and in a new migration that ' +
  'changes `drizzle/0002_seed_currency_catalogue.sql`’s rows, in the same pull request.'

const WRITE_GUARD_MESSAGE =
  'This is a tripwire, not an authorisation guard. A write to the `currencies` table needs the ' +
  'platform guard and the audit row of stage 24-S3 first (docs/plans/24-console.md).'

/** The catalogue's rows as the table stores them, in code order so two lists compare. */
const STATIC_ROWS = CURRENCIES.map(
  ({ code, name, digits, numericCode }) =>
    ({ code, name, digits, numericCode }) as const,
).toSorted((left, right) => left.code.localeCompare(right.code))

describe('the seeded currencies table', () => {
  it('equals the static catalogue in code, English name, digits and numeric code', async () => {
    const db = openTestDb()

    const rows = await db
      .select({
        code: currencies.code,
        name: currencies.name,
        digits: currencies.digits,
        numericCode: currencies.numericCode,
        isDisabled: currencies.isDisabled,
      })
      .from(currencies)
      .orderBy(currencies.code)

    // Both counts are read, never a literal: the catalogue grows by adding a row, not by editing
    // this test.
    expect(rows.length, SEED_DRIFT_MESSAGE).toBe(CURRENCIES.length)
    expect(
      rows.map(({ code, name, digits, numericCode }) => ({
        code,
        name,
        digits,
        numericCode,
      })),
      SEED_DRIFT_MESSAGE,
    ).toEqual(STATIC_ROWS)
    expect(
      rows.filter((row) => row.isDisabled),
      'Every seeded currency ships enabled (OPEN-6 in docs/plans/03-money-and-currency.md).',
    ).toEqual([])
  })

  it('holds no metal, fund, special-drawing-right or placeholder code', async () => {
    const db = openTestDb()

    const rows = await db
      .select({ code: currencies.code })
      .from(currencies)
      .where(inArray(currencies.code, NON_CURRENCIES))

    // A metal with `digits: 0` would silently behave like the yen (docs/MONEY.md §1.2).
    expect(rows).toEqual([])
  })
})

describe('listEnabledCurrencies', () => {
  it('returns every seeded row as stored, in the static catalogue’s order', async () => {
    const db = openTestDb()

    const listed = await listEnabledCurrencies(db)

    expect(listed).toEqual(
      CURRENCIES.map(({ code, name, digits, numericCode }) => ({
        code,
        name,
        digits,
        numericCode,
      })),
    )
  })

  it('leaves a disabled row out and keeps the order of the rest', async () => {
    const db = openTestDb()
    // A test fixture: nothing in production can set the flag before stage 24-S3.
    await db
      .update(currencies)
      .set({ isDisabled: true })
      .where(eq(currencies.code, 'EUR'))

    const listed = await listEnabledCurrencies(db)

    expect(listed.map((row) => row.code)).toEqual(
      CURRENCIES.map((entry) => entry.code).filter((code) => code !== 'EUR'),
    )
  })

  it('returns a code the static table lacks after the known ones, by code, and does not narrow digits', async () => {
    const db = openTestDb()
    await db.insert(currencies).values([
      { code: 'ZZZ', name: 'Zed', digits: 4, numericCode: null },
      { code: 'AAA', name: 'Ay', digits: 2, numericCode: 1 },
    ])

    const listed = await listEnabledCurrencies(db)

    expect(listed.map((row) => row.code)).toEqual([
      ...CURRENCIES.map((entry) => entry.code),
      'AAA',
      'ZZZ',
    ])
    expect(listed.at(-1)).toEqual({
      code: 'ZZZ',
      name: 'Zed',
      digits: 4,
      numericCode: null,
    })
  })

  it('returns an empty list from an empty table', async () => {
    const db = openTestDb()
    await db.delete(currencies)

    expect(await listEnabledCurrencies(db)).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* Nothing writes the catalogue                                                */
/* -------------------------------------------------------------------------- */

const SRC = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Block and line comments removed, so a docblock may say "reads only, no update here yet" without
 * tripping a scan. A regex stripper, not a parser: a `//` or `/*` inside a string literal confuses
 * it, which can only hide a write, never invent one. That is one of the gaps named below.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const DRIZZLE_WRITE = /\.(?:insert|update|delete)\(\s*currencies\b/
const RAW_SQL_WRITE =
  /\b(?:insert\s+into\s+currencies|update\s+currencies|delete\s+from\s+currencies)\b/i

function writesCurrencies(source: string): boolean {
  const code = stripComments(source)
  return DRIZZLE_WRITE.test(code) || RAW_SQL_WRITE.test(code)
}

function isProductionSource(relative: string): boolean {
  return (
    /\.tsx?$/.test(relative) &&
    !relative.split(path.sep).includes('__tests__') &&
    !/\.test\.[^/]+$/.test(relative)
  )
}

// Scanned once, before anything asserts on it.
const SCANNED = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
  isProductionSource,
)
const WRITERS = SCANNED.filter((relative) =>
  writesCurrencies(readFileSync(path.join(SRC, relative), 'utf8')),
)

/**
 * Both tripwires below are **tripwires, not an authorisation guard**. Known gaps, stated so nobody
 * reads a green run as a guarantee:
 *
 * - `drizzle/0002_seed_currency_catalogue.sql` is not scanned, and it writes with backticked
 *   identifiers and `insert or ignore into`.
 * - `.insert(schema.currencies)`, an aliased import and a table reached through a variable do not
 *   match.
 * - A comment marker inside a string literal can make the stripper swallow real code.
 *
 * What stands in for the guard is stage 24-S3's platform permission and audit row. Until it
 * ships, the catalogue has no writer, and these two assertions say so.
 */
describe('nothing writes the currencies table', () => {
  it('exports exactly listEnabledCurrencies and its source holds no write call', () => {
    const source = stripComments(
      readFileSync(new URL('../currencies.ts', import.meta.url), 'utf8'),
    )

    expect(Object.keys(catalogueModule), WRITE_GUARD_MESSAGE).toEqual([
      'listEnabledCurrencies',
    ])
    for (const call of [
      '.insert(',
      '.update(',
      '.delete(',
      '.run(',
      '.batch(',
    ]) {
      expect(source.includes(call), `${call} ${WRITE_GUARD_MESSAGE}`).toBe(
        false,
      )
    }
  })

  it('has no writer under src outside tests', () => {
    expect(SCANNED.length).toBeGreaterThan(0)
    expect(WRITERS, WRITE_GUARD_MESSAGE).toEqual([])
  })

  it('notices a write in code and ignores one in a comment', () => {
    expect(writesCurrencies('await db.insert(currencies).values(rows)')).toBe(
      true,
    )
    expect(writesCurrencies('db.delete( currencies )')).toBe(true)
    expect(writesCurrencies('await db.run(sql`DELETE FROM currencies`)')).toBe(
      true,
    )
    expect(writesCurrencies('/** reads only: no update currencies */')).toBe(
      false,
    )
    expect(writesCurrencies('// db.update(currencies)')).toBe(false)
    expect(writesCurrencies('db.update(organizationCurrencies)')).toBe(false)
  })
})
