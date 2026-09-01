import { CURRENCIES } from '#/lib/money'

import type { CurrencyEntry } from '#/lib/money'

/**
 * Seed rows for the global `currencies` catalogue table.
 *
 * **The table is not the source of truth for `digits`; this projection is.**
 * The catalogue itself lives in `src/lib/money/currencies.ts` because the
 * browser needs it too — a transaction form has to know that the yen has no
 * minor unit before it can parse what the reader typed, and shipping a second
 * copy of that fact would guarantee the two eventually disagree. This module
 * exists so the D1 rows are *derived* from the same table rather than
 * transcribed beside it.
 *
 * `is_disabled` is the only column an admin edits after seeding: a currency is
 * hidden from the pickers rather than deleted, because accounts and historical
 * transactions denominated in it must keep formatting correctly forever. A
 * migration therefore upserts `code`, `name`, `digits` and `numeric_code` and
 * leaves `is_disabled` alone on rows that already exist.
 */

/** One row of the `currencies` table, in the column names the schema uses. */
export interface CurrencySeedRow {
  readonly code: string
  readonly name: string
  readonly digits: number
  readonly numericCode: number
  readonly isDisabled: boolean
}

/** Every catalogue currency as a seed row, in picker order. */
export const CURRENCY_SEED_ROWS: ReadonlyArray<CurrencySeedRow> = Object.freeze(
  CURRENCIES.map((entry: CurrencyEntry) =>
    Object.freeze({
      code: entry.code,
      name: entry.name,
      digits: entry.digits,
      numericCode: entry.numericCode,
      isDisabled: false,
    }),
  ),
)

/**
 * The currency a workspace starts in when nothing better is known.
 *
 * The first market is Poland, and a base currency is not a decision a reader
 * should have to make before they can add their first account — onboarding
 * offers it, but a workspace provisioned by an invitation accept has to have
 * one already. Changing a workspace's base currency later is a deliberate,
 * audited operation, not a settings toggle, because `ref_amount_minor` on every
 * historical transaction is denominated in it.
 */
export const DEFAULT_BASE_CURRENCY_CODE = 'PLN'

/**
 * Currencies offered first in a fresh workspace's currency list, before the
 * reader adds any of their own. Kept short: an empty picker is a worse first
 * run than a short one, and a long one is a worse first run than a short one
 * too.
 */
export const DEFAULT_WORKSPACE_CURRENCY_CODES: ReadonlyArray<string> =
  Object.freeze(['PLN', 'EUR', 'USD', 'GBP'])
