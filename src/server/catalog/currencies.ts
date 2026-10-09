/**
 * The currency catalogue's server reads.
 *
 * **A global table, so no tenant scope.** `currencies` has no `organization_id`: it is the first
 * stated carve-out of `docs/SPEC.md` §5.2, which is why this module takes a bare {@link Database}
 * and never a `TenantScope`. Handing a catalogue read a scope would suggest there is a tenant
 * predicate to compose, and there is none.
 *
 * **Reads only.** Nothing here inserts, updates or deletes, and nothing under `src` writes the
 * table. The carve-out is guarded by a platform permission plus an audit row, and neither exists
 * yet: the audit table and the platform guard arrive with stages 24-S1 and 24-S3. A write added
 * before then would be unguarded and unaudited, so the write path is that stage's, and the
 * catalogue test fails if one appears here first.
 *
 * **The static table is the source of `digits`; the row is its mirror.** The scale every money
 * function uses is read from `src/lib/money/currencies.ts` (`minorUnitDigits`), which the browser
 * needs too. `currencies.digits` in D1 is loaded from the same table by
 * `drizzle/0002_seed_currency_catalogue.sql` and read by no arithmetic, so the two are kept equal
 * by a parity test (`__tests__/currencies.test.ts`) rather than by a runtime read. For the same
 * reason a currency is added, or its `digits` changed, in the static table first.
 *
 * `digits` is returned as stored. The schema allows `0..4` and `MinorUnitDigits` is `0 | 2 | 3`,
 * so the listing does not narrow it: a row outside the static type shows up as itself instead of
 * being silently coerced.
 */

import { eq } from 'drizzle-orm'

import { CURRENCIES } from '#/lib/money'
import { currencies } from '#/server/db/schema'

import type { CurrencyCode } from '#/lib/money'
import type { Database } from '#/server/repos/base'

/** One enabled catalogue currency, as the `currencies` row stores it. */
export interface CatalogueCurrency {
  readonly code: CurrencyCode
  /** English, as stored. */
  readonly name: string
  /** As stored; never assumed. */
  readonly digits: number
  readonly numericCode: number | null
}

const CATALOGUE_POSITION = new Map<string, number>(
  CURRENCIES.map((entry, index) => [entry.code, index]),
)
/** Where a code the static table lacks sorts: after every known one. */
const UNKNOWN_POSITION = CURRENCIES.length

/**
 * The currencies that are not disabled, in the static catalogue's declaration order.
 *
 * A code the static table does not know sorts after the known ones, by code, and is never
 * dropped: hiding a currency an operator added on purpose would leave a reader unable to find
 * their account's unit. The order is applied here because it is not a column.
 */
export async function listEnabledCurrencies(
  db: Database,
): Promise<ReadonlyArray<CatalogueCurrency>> {
  const rows = await db
    .select({
      code: currencies.code,
      name: currencies.name,
      digits: currencies.digits,
      numericCode: currencies.numericCode,
    })
    .from(currencies)
    .where(eq(currencies.isDisabled, false))

  return rows
    .map((row) => ({ ...row, code: row.code as CurrencyCode }))
    .toSorted(
      (left, right) =>
        (CATALOGUE_POSITION.get(left.code) ?? UNKNOWN_POSITION) -
          (CATALOGUE_POSITION.get(right.code) ?? UNKNOWN_POSITION) ||
        left.code.localeCompare(right.code),
    )
}
