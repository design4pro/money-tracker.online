/**
 * What the planned-screen cases share: a ledger reader that is the real thing, and a series seed.
 *
 * `loadTransactions` is a `createServerFn` value and is only callable inside the Start request
 * context, so a test cannot hand it to the composition. {@link ledgerReaderFor} is the same three
 * repository calls it makes - the page, the count and the totals, over the same query arguments -
 * so what a test reads back is what the screen's ledger half would have been, and the composition
 * on top of it is the real one.
 *
 * A helper, not a spec: `vitest.config.ts` collects `*.test.ts` only.
 */

import { materializeSeries } from '#/server/recurring/materialize'

import {
  countTransactions,
  pageTransactions,
  sumTransactions,
} from '../transaction-queries'
import { createSeries } from '../recurring'
import { conversionContextFor } from '../workspace-currencies'

import type { LedgerReader } from '#/routes/_app/transactions/-server/planned-data'
import type { RecurringSeries } from '#/server/db/types'
import type { CreateSeriesInput } from '../recurring'
import type { TenantScope } from '../scope'

export function ledgerReaderFor(scope: TenantScope): LedgerReader {
  return async (input) => {
    const conversion = await conversionContextFor(scope)
    const query = {
      scope,
      policies: input.policies,
      filters: input.filters,
      historyFloor: null,
    }
    const [page, total, totals] = await Promise.all([
      pageTransactions({
        ...query,
        sort: input.sort,
        cursor: input.cursor,
        limit: input.limit,
      }),
      countTransactions(query),
      sumTransactions({
        ...query,
        baseCurrencyCode: conversion.baseCurrencyCode,
      }),
    ])
    return { ...page, total, totals }
  }
}

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
