/**
 * `matchTransaction` adopts a real row into the earliest unpaid period. When that receipt
 * already settles another period, the matcher declines rather than throwing — a crash here
 * would stop the rest of the import/match pass.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { createSeries, listPeriods, markPaid } from '#/server/repos/recurring'
import {
  createBudgetWorld,
  seedTransaction,
} from '#/server/repos/__tests__/budget-harness'

import { matchTransaction } from '../match'
import { materializeSeries } from '../materialize'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

const TODAY = '2026-03-15'

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
})

describe('matchTransaction', () => {
  it('declines a transaction that already settles another period', async () => {
    const series = await createSeries(world.scope, {
      name: 'Rent',
      expectedAmountMinor: 250_000,
      expectedCurrencyCode: 'PLN',
      frequency: 'monthly',
      startDate: '2026-01-31',
      accountId: 'acc-a',
      matchingRules: {
        payee: [],
        accountId: null,
        amountToleranceMinor: 0,
        dayWindow: 31,
      },
    })
    await materializeSeries(world.scope, {
      seriesId: series.id,
      today: TODAY,
      ahead: 0,
    })
    const periods = await listPeriods(world.scope, series.id, TODAY)
    const first = periods.at(0)
    const second = periods.at(1)
    if (first === undefined || second === undefined) {
      throw new Error('need two materialised periods')
    }
    await seedTransaction(world.db, {
      id: 'txn-rent',
      refAmountMinor: 250_000,
      bookedOn: first.dueOn,
    })
    await markPaid(world.scope, {
      seriesId: series.id,
      periodStart: first.periodStart,
      transactionId: 'txn-rent',
    })

    await expect(
      matchTransaction(world.scope, { transactionId: 'txn-rent' }),
    ).resolves.toEqual({
      transactionId: 'txn-rent',
      seriesId: null,
      periodStart: null,
      matchSource: null,
    })

    const after = await listPeriods(world.scope, series.id, TODAY)
    expect(
      after.find((row) => row.periodStart === second.periodStart)?.status,
    ).not.toBe('paid')
  })
})
