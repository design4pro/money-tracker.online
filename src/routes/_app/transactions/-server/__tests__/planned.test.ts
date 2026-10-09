/**
 * The planned screen's door: one scope per request, handed to both halves of the answer.
 *
 * `plannedScreenFor` is tested against real repositories in `planned-data.test.ts`; what that test
 * cannot say is how many times the door proves membership, because it enters below it. These cases
 * run the real `loadPlannedScreen` handler (and `loadTransactions`, the other caller of the ledger
 * read) over a real SQLite database, with `requireOrg` replaced by a counter that returns the
 * world's scope. Everything between the door and the repositories is the real code, so a handler
 * that went back to wrapping `loadTransactions` - which calls `requireOrg` itself - shows up as a
 * second call.
 *
 * **The handlers are run, the framework is not.** A `createServerFn` value is only callable inside
 * the Start request context, so `createServerFn` is replaced by a builder that hands back the
 * handler as a plain function (the validator still runs, as it would on a request).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createBudgetWorld,
  seedTransaction,
} from '#/server/repos/__tests__/budget-harness'
import { seedSeries } from '#/server/repos/__tests__/planned-harness'
import { loadTransactions } from '#/server/fns/transactions'

import { loadPlannedScreen } from '../planned'

import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'
import type * as LedgerPageModule from '#/server/transactions/ledger-page'
import type * as RecurringModule from '#/server/repos/recurring'

const TODAY = '2026-04-15'

/** What the mocks below record: reset per test, because the world is rebuilt per test. */
const seen = vi.hoisted(() => ({
  requireOrgCalls: 0,
  scope: undefined as unknown,
  ledgerScopes: [] as Array<unknown>,
  upcomingScopes: [] as Array<unknown>,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (data: unknown) => unknown = (data) => data
    const builder = {
      inputValidator(validator: unknown) {
        validate =
          typeof validator === 'function'
            ? (validator as (data: unknown) => unknown)
            : (data) =>
                (validator as { parse: (data: unknown) => unknown }).parse(data)
        return builder
      },
      handler(
        run: (context: { data: unknown }) => Promise<unknown>,
      ): (call: { data: unknown }) => Promise<unknown> {
        return ({ data }) => run({ data: validate(data) })
      },
    }
    return builder
  },
}))

vi.mock('#/server/auth/guards', () => ({
  requireOrg: async () => {
    seen.requireOrgCalls += 1
    return seen.scope
  },
}))

vi.mock('#/server/clock', () => ({ serverToday: () => '2026-04-15' }))

vi.mock('cloudflare:workers', () => ({ env: {} }))

// Both halves stay the real ones; they only report the scope they were handed.
vi.mock('#/server/transactions/ledger-page', async (importOriginal) => {
  const actual = await importOriginal<typeof LedgerPageModule>()
  return {
    ...actual,
    ledgerPageFor: (...args: Parameters<typeof actual.ledgerPageFor>) => {
      seen.ledgerScopes.push(args[0])
      return actual.ledgerPageFor(...args)
    },
  }
})

vi.mock('#/server/repos/recurring', async (importOriginal) => {
  const actual = await importOriginal<typeof RecurringModule>()
  return {
    ...actual,
    getUpcoming: (...args: Parameters<typeof actual.getUpcoming>) => {
      seen.upcomingScopes.push(args[0])
      return actual.getUpcoming(...args)
    },
  }
})

const PLANNED_POLICIES = {
  planned: 'only',
  adjustments: 'exclude',
  transfers: 'include',
  completeness: 'any',
} as const

function planned(cursor: string | null, limit = 1) {
  return {
    data: {
      policies: PLANNED_POLICIES,
      filters: {},
      sort: { field: 'bookedOn', direction: 'desc' },
      cursor,
      limit,
    },
  } as never
}

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
  seen.requireOrgCalls = 0
  seen.scope = world.scope
  seen.ledgerScopes = []
  seen.upcomingScopes = []
  await seedSeries(world.scope, TODAY)
  for (const id of ['plan-1', 'plan-2']) {
    await seedTransaction(world.db, {
      id,
      refAmountMinor: 100_00,
      bookedOn: '2026-04-20',
      isPlanned: true,
    })
  }
})

describe('loadPlannedScreen', () => {
  it('proves membership once on the first page and hands that one scope to both reads', async () => {
    const page = await loadPlannedScreen(planned(null))

    expect(page).toMatchObject({ expectations: { state: 'shown' } })
    expect(seen.requireOrgCalls).toBe(1)
    expect(seen.ledgerScopes).toHaveLength(1)
    expect(seen.upcomingScopes).toHaveLength(1)
    // Identity, not equality: a rebuilt scope carrying the same ids would pass `toEqual`.
    expect(seen.ledgerScopes[0]).toBe(world.scope)
    expect(seen.upcomingScopes[0]).toBe(world.scope)
  })

  it('proves membership once on a cursor page, reads the ledger with it and reads no group', async () => {
    const first = (await loadPlannedScreen(planned(null))) as {
      nextCursor: string | null
    }
    expect(first.nextCursor).not.toBeNull()
    seen.requireOrgCalls = 0
    seen.ledgerScopes = []
    seen.upcomingScopes = []

    const second = await loadPlannedScreen(planned(first.nextCursor))

    expect(second).not.toHaveProperty('expectations')
    expect(second).toMatchObject({ today: TODAY })
    expect(seen.requireOrgCalls).toBe(1)
    expect(seen.ledgerScopes).toEqual([world.scope])
    expect(seen.ledgerScopes[0]).toBe(world.scope)
    expect(seen.upcomingScopes).toEqual([])
  })

  it('refuses a scope, an organisation id or a day in the input', async () => {
    for (const extra of [
      { scope: world.scope },
      { organizationId: 'org-b' },
      { today: '2026-01-01' },
    ]) {
      const call = planned(null) as { data: object }
      // The validator throws before the handler is entered, so wrap the call to get a rejection.
      await expect(
        (async () =>
          loadPlannedScreen({ data: { ...call.data, ...extra } } as never))(),
      ).rejects.toThrow()
    }
    expect(seen.requireOrgCalls).toBe(0)
  })
})

describe('loadTransactions', () => {
  it('keeps its own door: one requireOrg, whose scope reaches the ledger read', async () => {
    const page = await loadTransactions({
      data: {
        policies: PLANNED_POLICIES,
        filters: {},
        sort: { field: 'bookedOn', direction: 'desc' },
        cursor: null,
      },
    } as never)

    expect(page.rows.map((row) => row.id).sort()).toEqual(['plan-1', 'plan-2'])
    expect(seen.requireOrgCalls).toBe(1)
    expect(seen.ledgerScopes).toEqual([world.scope])
    expect(seen.ledgerScopes[0]).toBe(world.scope)
  })
})
