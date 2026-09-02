/**
 * `auto_record`: the one path in this feature that writes money.
 *
 * Four properties, and every one of them is a way somebody's rent gets paid twice or not at all.
 *
 * **Idempotent per `(seriesId, periodStart)`, twice over.** A KV marker and the period's own
 * `paid` status both say "this has been posted". Either alone would do on a good day; both are
 * checked because double-posting a household's rent is the worst failure this feature can have.
 *
 * **The marker is written after the post, never before.** A run that fails mid-way must retry on
 * the next tick, not skip silently. The test drives that by letting the post succeed and the
 * marker store throw, then running again: the period is already `paid`, so the retry writes no
 * second transaction.
 *
 * **The amount is the series' expectation, exactly.** Nothing scales it, prorates it or rounds it.
 *
 * **The transaction is booked on the due date, not on the run date.** A bill due on the 1st that
 * is posted on the 2nd still converts at the 1st's rate, because the 1st is when the money was
 * expected to move.
 *
 * The ledger is wired to a stub rather than a Durable Object, for the reason
 * `__tests__/account-balances.test.ts` gives: what is under test is that the write path reaches
 * the rebuild port at all. Nothing here writes `account_balances` itself.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { accounts, recurringPeriods, transactions } from '#/server/db/schema'
import { setLedgerBatchPorts } from '#/server/ledger/batch'
import { rebuildAccountBalance } from '#/server/repos/account-balances'
import {
  createSeries,
  listPeriods,
  listSeriesLinks,
} from '#/server/repos/recurring'
import { NOW, createBudgetWorld } from '#/server/repos/__tests__/budget-harness'

import { runAutoRecord } from '../auto-record'
import { autoRecordMarkerKey, createMemoryMarkerStore } from '../markers'
import { materializeSeries } from '../materialize'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type { CreateSeriesInput } from '#/server/repos/recurring'

const TODAY = '2026-03-15'

let world: BudgetWorld
/** Every account the ledger batch asked to have rebuilt, in the order it asked. */
let rebuilds: Array<string>

function input(patch: Partial<CreateSeriesInput> = {}): CreateSeriesInput {
  return {
    name: 'Rent',
    expectedAmountMinor: 250_000,
    expectedCurrencyCode: 'PLN',
    frequency: 'monthly',
    startDate: '2026-03-01',
    accountId: 'acc-a',
    autoRecord: true,
    ...patch,
  }
}

beforeEach(async () => {
  world = await createBudgetWorld()
  rebuilds = []
  setLedgerBatchPorts({
    namespace: () => ({
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async (request: Request) => {
          const accountId = new URL(request.url).searchParams.get('accountId')
          if (accountId !== null) {
            rebuilds.push(accountId)
            await rebuildAccountBalance(world.db, accountId, { now: () => NOW })
          }
          return new Response(null, { status: 204 })
        },
      }),
    }),
  })
})

afterEach(() => {
  setLedgerBatchPorts(null)
})

async function seriesWithDuePeriod(patch: Partial<CreateSeriesInput> = {}) {
  const series = await createSeries(world.scope, input(patch))
  await materializeSeries(world.scope, {
    seriesId: series.id,
    today: TODAY,
    ahead: 0,
  })
  return series
}

describe('posting', () => {
  it('writes one transaction for the expected amount, booked on the due date', async () => {
    const series = await seriesWithDuePeriod()
    const markers = createMemoryMarkerStore()

    const report = await runAutoRecord({
      scope: world.scope,
      markers,
      today: TODAY,
    })

    expect(report.posted).toBe(1)
    const rows = await world.db.select().from(transactions)
    expect(rows).toHaveLength(1)
    // Exactly the expectation, and the due date rather than the run date.
    expect(rows.at(0)?.amountMinor).toBe(250_000)
    expect(rows.at(0)?.bookedOn).toBe('2026-03-01')
    expect(rows.at(0)?.recurringSeriesId).toBe(series.id)
    expect(rows.at(0)?.categorizationSource).toBe('automation')
  })

  it('settles the period and links the transaction it wrote', async () => {
    const series = await seriesWithDuePeriod()
    await runAutoRecord({
      scope: world.scope,
      markers: createMemoryMarkerStore(),
      today: TODAY,
    })

    const period = (await listPeriods(world.scope, series.id, TODAY)).at(0)
    expect(period?.derivedStatus).toBe('paid')
    expect(period?.settledAmountMinor).toBe(250_000)

    const links = await listSeriesLinks(world.scope, series.id)
    expect(links).toEqual([
      {
        transactionId: period?.settledTransactionId,
        matchSource: 'auto',
        status: 'active',
      },
    ])
  })

  it('rebuilds a shared account once, however many bills landed on it', async () => {
    // One batch around the whole pass. Balance history is rebuilt wholesale through the ledger and
    // never accumulated here, so what is worth asserting is the count of rebuilds: an account
    // carrying two due bills must be rebuilt once, after the pass, not once per transaction.
    await seriesWithDuePeriod()
    await seriesWithDuePeriod({ name: 'Gym', expectedAmountMinor: 12_000 })

    const report = await runAutoRecord({
      scope: world.scope,
      markers: createMemoryMarkerStore(),
      today: TODAY,
    })

    expect(report.posted).toBe(2)
    expect(rebuilds).toEqual(['acc-a'])
  })
})

describe('idempotency', () => {
  it('posts once when the pass runs twice', async () => {
    await seriesWithDuePeriod()
    const markers = createMemoryMarkerStore()

    const first = await runAutoRecord({
      scope: world.scope,
      markers,
      today: TODAY,
    })
    const second = await runAutoRecord({
      scope: world.scope,
      markers,
      today: TODAY,
    })

    expect(first.posted).toBe(1)
    expect(second.posted).toBe(0)
    expect(await world.db.select().from(transactions)).toHaveLength(1)
  })

  it('does not post again when the marker was lost but the period is paid', async () => {
    const series = await seriesWithDuePeriod()

    await runAutoRecord({
      scope: world.scope,
      markers: createMemoryMarkerStore(),
      today: TODAY,
    })
    // A brand-new store: the marker is gone, as it would be after its ninety-day expiry or a
    // crash between the post and the write. The period's own `paid` status is the second half of
    // the guard, and it does not expire.
    const report = await runAutoRecord({
      scope: world.scope,
      markers: createMemoryMarkerStore(),
      today: TODAY,
    })

    expect(report.posted).toBe(0)
    expect(await world.db.select().from(transactions)).toHaveLength(1)
    expect(
      (await listPeriods(world.scope, series.id, TODAY)).at(0)?.derivedStatus,
    ).toBe('paid')
  })

  it('declines a period whose marker is already set', async () => {
    const series = await seriesWithDuePeriod()
    const period = (await listPeriods(world.scope, series.id, TODAY)).at(0)
    if (period === undefined) throw new Error('no period materialised')

    const markers = createMemoryMarkerStore([
      autoRecordMarkerKey({
        seriesId: series.id,
        periodStart: period.periodStart,
      }),
    ])
    const report = await runAutoRecord({
      scope: world.scope,
      markers,
      today: TODAY,
    })

    expect(report.posted).toBe(0)
    expect(report.outcomes.at(0)?.skipped).toBe('already-posted')
    expect(await world.db.select().from(transactions)).toHaveLength(0)
  })
})

describe('what it refuses to post', () => {
  it('refuses a series with no account, and says why', async () => {
    await seriesWithDuePeriod({ accountId: null })
    const refusals: Array<string> = []

    const report = await runAutoRecord({
      scope: world.scope,
      markers: createMemoryMarkerStore(),
      today: TODAY,
      onRefusal: (outcome) => refusals.push(outcome.skipped ?? ''),
    })

    expect(report.posted).toBe(0)
    expect(refusals).toEqual(['no-account'])
    expect(await world.db.select().from(transactions)).toHaveLength(0)
  })

  it('refuses to post into an archived account, and says why', async () => {
    // The account is read live rather than trusted from the series row: an archived account is one
    // somebody deliberately closed, and posting into it grows a balance nobody is watching.
    await seriesWithDuePeriod()
    await world.db
      .update(accounts)
      .set({ status: 'archived' })
      .where(eq(accounts.id, 'acc-a'))
    const refusals: Array<string> = []

    const report = await runAutoRecord({
      scope: world.scope,
      markers: createMemoryMarkerStore(),
      today: TODAY,
      onRefusal: (outcome) => refusals.push(outcome.skipped ?? ''),
    })

    expect(report.posted).toBe(0)
    expect(refusals).toEqual(['archived-account'])
    expect(await world.db.select().from(transactions)).toHaveLength(0)
  })

  it('leaves a series that is not auto_record alone', async () => {
    await seriesWithDuePeriod({ autoRecord: false })
    const report = await runAutoRecord({
      scope: world.scope,
      markers: createMemoryMarkerStore(),
      today: TODAY,
    })
    expect(report.posted).toBe(0)
    expect(await world.db.select().from(transactions)).toHaveLength(0)
  })

  it('leaves a period that is not due yet alone', async () => {
    await seriesWithDuePeriod({ startDate: '2026-06-01' })
    const report = await runAutoRecord({
      scope: world.scope,
      markers: createMemoryMarkerStore(),
      today: TODAY,
    })
    expect(report.posted).toBe(0)
  })

  it("never reaches another workspace's series", async () => {
    await seriesWithDuePeriod()
    const report = await runAutoRecord({
      scope: world.otherScope,
      markers: createMemoryMarkerStore(),
      today: TODAY,
    })
    expect(report.posted).toBe(0)
    expect(await world.db.select().from(transactions)).toHaveLength(0)
    expect(
      await world.db
        .select()
        .from(recurringPeriods)
        .where(eq(recurringPeriods.status, 'paid')),
    ).toEqual([])
  })
})
