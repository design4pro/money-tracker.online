/**
 * `writeSeries`, against real SQLite and a pinned `today`.
 *
 * The rule under test is *"after any change to a series, materialise its periods"*. Each of the four
 * change kinds is run end to end and must leave the same three facts behind: history is written up to
 * `today`, `ahead` future periods follow, and a second run writes nothing. A series id that belongs to
 * another workspace is refused before anything is written, whichever kind names it.
 *
 * Nothing here reads a clock: `today` is a parameter of the module and a constant of this file.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { recurringPeriods, recurringSeries } from '#/server/db/schema'
import { NotFoundError } from '#/server/repos/errors'
import {
  createSeries,
  listPeriods,
  pauseSeries,
  replacePendingCandidates,
} from '#/server/repos/recurring'
import { createBudgetWorld } from '#/server/repos/__tests__/budget-harness'

import { materializeSeries } from '../materialize'
import { SERIES_AHEAD, writeSeries } from '../series-write'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type { CreateSeriesInput } from '#/server/repos/recurring'

const TODAY = '2026-03-15'

/** Monthly on the month end from 31 January: two periods of history by `TODAY`, then 31 March on. */
const HISTORY = ['2026-01-31', '2026-02-28']
const UPCOMING = ['2026-03-31', '2026-04-30', '2026-05-31']

function seriesInput(
  patch: Partial<CreateSeriesInput> = {},
): CreateSeriesInput {
  return {
    name: 'Rent',
    expectedAmountMinor: 250_000,
    expectedCurrencyCode: 'PLN',
    frequency: 'monthly',
    startDate: '2026-01-31',
    accountId: 'acc-a',
    ...patch,
  }
}

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
})

const dueDates = async (scope: BudgetWorld['scope'], seriesId: string) =>
  (await listPeriods(scope, seriesId, TODAY)).map((period) => period.dueOn)

async function seedCandidate(): Promise<string> {
  const [candidate] = await replacePendingCandidates(world.scope, [
    {
      suggestedName: 'Gym',
      payeeId: null,
      expectedAmountMinor: 12_000,
      expectedCurrencyCode: 'PLN',
      frequency: 'monthly',
      confidence: 80,
      sampleTransactionIds: ['t-1', 't-2', 't-3'],
    },
  ])
  return candidate.id
}

describe('the shared horizon', () => {
  it('is three periods, the widget horizon the list and detail screens already use', () => {
    expect(SERIES_AHEAD).toBe(3)
  })
})

describe('a create', () => {
  it('writes the history up to today and `ahead` periods, and hands back the series id', async () => {
    const written = await writeSeries(world.scope, {
      today: TODAY,
      ahead: 2,
      change: { kind: 'create', input: seriesInput() },
    })

    expect(await dueDates(world.scope, written.seriesId)).toEqual([
      ...HISTORY,
      ...UPCOMING.slice(0, 2),
    ])
  })

  it('writes nothing the second time the same horizon is materialised', async () => {
    const written = await writeSeries(world.scope, {
      today: TODAY,
      ahead: 2,
      change: { kind: 'create', input: seriesInput() },
    })

    const again = await materializeSeries(world.scope, {
      seriesId: written.seriesId,
      today: TODAY,
      ahead: 2,
    })

    expect(again.created).toBe(0)
  })

  it('honours the horizon it is given, not a default', async () => {
    const written = await writeSeries(world.scope, {
      today: TODAY,
      ahead: 0,
      change: { kind: 'create', input: seriesInput() },
    })

    expect(await dueDates(world.scope, written.seriesId)).toEqual(HISTORY)
  })
})

describe('an update', () => {
  it('materialises against the new schedule and leaves the periods already written alone', async () => {
    const created = await writeSeries(world.scope, {
      today: TODAY,
      ahead: 0,
      change: { kind: 'create', input: seriesInput() },
    })

    const updated = await writeSeries(world.scope, {
      today: TODAY,
      ahead: 2,
      change: {
        kind: 'update',
        seriesId: created.seriesId,
        patch: { expectedAmountMinor: 999_999 },
      },
    })

    expect(updated.seriesId).toBe(created.seriesId)
    expect(await dueDates(world.scope, created.seriesId)).toEqual([
      ...HISTORY,
      ...UPCOMING.slice(0, 2),
    ])
    const periods = await listPeriods(world.scope, created.seriesId, TODAY)
    expect(periods.map((period) => Number(period.expectedAmountMinor))).toEqual(
      [250_000, 250_000, 999_999, 999_999],
    )
  })

  it('materialises a paused series too: the write decides, the active state does not', async () => {
    const created = await writeSeries(world.scope, {
      today: TODAY,
      ahead: 0,
      change: { kind: 'create', input: seriesInput() },
    })
    await pauseSeries(world.scope, created.seriesId)

    await writeSeries(world.scope, {
      today: TODAY,
      ahead: 1,
      change: {
        kind: 'update',
        seriesId: created.seriesId,
        patch: { name: 'Rent (paused)' },
      },
    })

    expect(await dueDates(world.scope, created.seriesId)).toEqual([
      ...HISTORY,
      UPCOMING[0],
    ])
  })
})

describe('a resume', () => {
  it('catches a paused series up to today and writes the horizon', async () => {
    const created = await writeSeries(world.scope, {
      today: '2026-01-31',
      ahead: 0,
      change: { kind: 'create', input: seriesInput() },
    })
    await pauseSeries(world.scope, created.seriesId)
    expect(await dueDates(world.scope, created.seriesId)).toEqual([
      '2026-01-31',
    ])

    await writeSeries(world.scope, {
      today: TODAY,
      ahead: 2,
      change: { kind: 'resume', seriesId: created.seriesId },
    })

    expect(await dueDates(world.scope, created.seriesId)).toEqual([
      ...HISTORY,
      ...UPCOMING.slice(0, 2),
    ])
    const [row] = await world.db.select().from(recurringSeries)
    expect(row.isActive).toBe(true)
  })

  it('writes nothing the second time', async () => {
    const created = await writeSeries(world.scope, {
      today: TODAY,
      ahead: 2,
      change: { kind: 'create', input: seriesInput() },
    })
    const before = await world.db.select().from(recurringPeriods)

    await writeSeries(world.scope, {
      today: TODAY,
      ahead: 2,
      change: { kind: 'resume', seriesId: created.seriesId },
    })

    expect(await world.db.select().from(recurringPeriods)).toHaveLength(
      before.length,
    )
  })
})

describe('an accept', () => {
  it('creates the series, materialises it and hands back its id', async () => {
    const candidateId = await seedCandidate()

    const written = await writeSeries(world.scope, {
      today: TODAY,
      ahead: 2,
      change: {
        kind: 'accept',
        candidateId,
        series: seriesInput({ name: 'Gym' }),
      },
    })

    expect(await dueDates(world.scope, written.seriesId)).toEqual([
      ...HISTORY,
      ...UPCOMING.slice(0, 2),
    ])
  })

  it('writes no series when the candidate is not the workspace’s', async () => {
    const candidateId = await seedCandidate()

    await expect(
      writeSeries(world.otherScope, {
        today: TODAY,
        ahead: 2,
        change: {
          kind: 'accept',
          candidateId,
          series: seriesInput({ accountId: 'acc-b' }),
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(await world.db.select().from(recurringSeries)).toHaveLength(0)
  })
})

describe("another workspace's series", () => {
  it.each(['update', 'resume'] as const)(
    'a %s naming it is refused and writes no period',
    async (kind) => {
      const theirs = await createSeries(
        world.otherScope,
        seriesInput({
          accountId: 'acc-b',
        }),
      )

      const change =
        kind === 'update'
          ? { kind, seriesId: theirs.id, patch: { name: 'Mine now' } }
          : { kind, seriesId: theirs.id }

      await expect(
        writeSeries(world.scope, { today: TODAY, ahead: 2, change }),
      ).rejects.toBeInstanceOf(NotFoundError)

      expect(await world.db.select().from(recurringPeriods)).toHaveLength(0)
    },
  )
})
