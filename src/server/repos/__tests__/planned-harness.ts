/**
 * What the planned-screen cases share: a series seed.
 *
 * The ledger half of the screen needs no stand-in: `ledgerPageFor` takes a scope and is the real
 * body of `loadTransactions`, so a case hands it straight to the composition.
 *
 * A helper, not a spec: `vitest.config.ts` collects `*.test.ts` only.
 */

import { materializeSeries } from '#/server/recurring/materialize'

import { createSeries } from '../recurring'

import type { RecurringSeries } from '#/server/db/types'
import type { CreateSeriesInput } from '../recurring'
import type { TenantScope } from '../scope'

/**
 * A series and its periods up to `today` and one occurrence beyond it.
 *
 * Defaults to a monthly PLN rent due on the 10th, so a case states only what it varies.
 */
export async function seedSeries(
  scope: TenantScope,
  today: string,
  input: Partial<CreateSeriesInput> = {},
): Promise<RecurringSeries> {
  const series = await createSeries(scope, {
    name: 'Rent',
    expectedAmountMinor: 250_000,
    expectedCurrencyCode: 'PLN',
    frequency: 'monthly',
    startDate: '2026-04-10',
    ...input,
  })
  await materializeSeries(scope, { seriesId: series.id, today, ahead: 1 })
  return series
}
