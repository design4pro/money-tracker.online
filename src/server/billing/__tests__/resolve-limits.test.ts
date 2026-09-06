/**
 * `resolveLimits()` — the five precedence rules, the grace window at its two edges, and the
 * enumeration that stops a new quota shipping unresolved.
 *
 * Against a real SQLite built from `drizzle/*.sql`, because the row this resolver reads is the
 * whole input and a fake would agree with whatever the resolver believed about it.
 */

import { describe, expect, it, beforeEach } from 'vitest'

import { PLANS, QUOTA_METRICS, UNLIMITED, PLAN_IDS } from '#/lib/plans'
import { PLAN_IDS as SCHEMA_PLAN_IDS, subscriptions } from '#/server/db/schema'
import { createBudgetWorld, NOW } from '#/server/repos/__tests__/budget-harness'

import {
  GRACE_DAYS,
  entitlementOf,
  limitsFor,
  parseOverrides,
  resolveLimit,
  resolveLimits,
} from '../resolve-limits'

import type { SubscriptionRow } from '#/server/db/schema'
import type { BudgetWorld } from '#/server/repos/__tests__/budget-harness'

const DAY_MS = 24 * 60 * 60 * 1000

let world: BudgetWorld

beforeEach(async () => {
  world = await createBudgetWorld()
})

/** A stored subscription for workspace A, with only the columns a case is about spelled out. */
async function seedSubscription(
  overrides: Partial<SubscriptionRow> = {},
): Promise<void> {
  await world.db.insert(subscriptions).values({
    id: 'sub-a',
    organizationId: 'org-a',
    plan: 'plus',
    status: 'active',
    providerCustomerId: 'cus_1',
    providerSubscriptionId: 'sub_1',
    providerProductId: null,
    seats: 1,
    cancelAtPeriodEnd: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  })
}

/** A row shaped like the column set, for the pure cases that need no database. */
function row(overrides: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    id: 'sub-a',
    organizationId: 'org-a',
    plan: 'plus',
    status: 'active',
    providerCustomerId: null,
    providerSubscriptionId: null,
    providerProductId: null,
    seats: 1,
    currency: null,
    unitAmountMinor: null,
    interval: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEndsAt: null,
    quotaOverrides: null,
    seatLimit: null,
    storageLimitBytes: null,
    pendingPlan: null,
    pendingInterval: null,
    pendingEffectiveAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('rule 1 — an entitling status selects the subscription’s plan', () => {
  it.each(['active', 'trialing'] as const)('%s entitles', (status) => {
    expect(entitlementOf(row({ status, plan: 'household' }), NOW)).toEqual({
      planId: 'household',
      state: 'entitled',
      graceEndsAt: null,
    })
  })
})

describe('rule 2 — past due keeps the plan through the grace window', () => {
  const periodEnd = new Date('2026-03-10T00:00:00.000Z')

  it('still entitles on day 6', () => {
    const day6 = new Date(periodEnd.getTime() + 6 * DAY_MS)
    const entitlement = entitlementOf(
      row({ status: 'past_due', currentPeriodEnd: periodEnd }),
      day6,
    )
    expect(entitlement.planId).toBe('plus')
    expect(entitlement.state).toBe('grace')
    expect(entitlement.graceEndsAt).toEqual(
      new Date(periodEnd.getTime() + GRACE_DAYS * DAY_MS),
    )
  })

  it('falls back to free on day 8', () => {
    const day8 = new Date(periodEnd.getTime() + 8 * DAY_MS)
    expect(
      entitlementOf(
        row({ status: 'past_due', currentPeriodEnd: periodEnd }),
        day8,
      ),
    ).toEqual({ planId: 'free', state: 'lapsed', graceEndsAt: null })
  })
})

describe('rule 3 — anything else, and no row, is the free plan', () => {
  it.each(['canceled', 'unpaid', 'incomplete', 'paused'] as const)(
    '%s does not entitle',
    (status) => {
      expect(entitlementOf(row({ status }), NOW).planId).toBe('free')
    },
  )

  it('answers free for a workspace that never had a subscription', () => {
    expect(entitlementOf(null, NOW)).toEqual({
      planId: 'free',
      state: 'no-subscription',
      graceEndsAt: null,
    })
  })

  it('answers free for a plan column nobody declared', () => {
    expect(entitlementOf(row({ plan: 'enterprise' }), NOW).planId).toBe('free')
  })
})

describe('rule 4 — the catalogue supplies the numbers', () => {
  it('returns exactly the tier’s ceilings when nothing overrides them', () => {
    expect(limitsFor('plus', {})).toEqual(PLANS.plus.limits)
  })

  /**
   * The mechanism that stops a new quota shipping unresolved: every metric the catalogue declares
   * has to come back from the resolver, for every tier.
   */
  it('resolves every metric the catalogue declares, for every plan', () => {
    for (const planId of PLAN_IDS) {
      const limits = limitsFor(planId, {})
      for (const metric of QUOTA_METRICS) {
        expect(limits[metric], `${planId}.${metric}`).toBeTypeOf('number')
      }
      expect(Object.keys(limits).toSorted()).toEqual(
        [...QUOTA_METRICS].toSorted(),
      )
    }
  })

  it('mirrors the schema’s plan tuple, so the column’s CHECK cannot drift from the catalogue', () => {
    expect([...SCHEMA_PLAN_IDS]).toEqual([...PLAN_IDS])
  })
})

describe('rule 5 — row ceilings win, in both directions', () => {
  it('raises a catalogue limit', () => {
    const overrides = parseOverrides(
      row({ quotaOverrides: JSON.stringify({ accounts: 99 }) }),
    )
    expect(limitsFor('free', overrides).accounts).toBe(99)
    expect(limitsFor('free', overrides).budgets).toBe(PLANS.free.limits.budgets)
  })

  it('lowers one', () => {
    const overrides = parseOverrides(
      row({ quotaOverrides: JSON.stringify({ accounts: 1 }) }),
    )
    expect(limitsFor('household', overrides).accounts).toBe(1)
  })

  it('reads the two dedicated columns as ceilings of their own', () => {
    const overrides = parseOverrides(
      row({ seatLimit: 12, storageLimitBytes: 42 }),
    )
    expect(limitsFor('free', overrides).members).toBe(12)
    expect(limitsFor('free', overrides).storageBytes).toBe(42)
  })

  it('reads an explicit null override as “no ceiling”', () => {
    const overrides = parseOverrides(
      row({ quotaOverrides: JSON.stringify({ accounts: null }) }),
    )
    expect(limitsFor('free', overrides).accounts).toBe(UNLIMITED)
  })

  /** An unreadable operator note must not take a paying workspace's product away. */
  it('ignores malformed JSON and unknown metrics rather than failing', () => {
    expect(parseOverrides(row({ quotaOverrides: 'not json' }))).toEqual({})
    expect(
      parseOverrides(row({ quotaOverrides: JSON.stringify({ acounts: 5 }) })),
    ).toEqual({})
    expect(
      parseOverrides(
        row({ quotaOverrides: JSON.stringify({ accounts: 1.5 }) }),
      ),
    ).toEqual({})
  })
})

describe('against the database', () => {
  it('reads the caller’s own subscription and never another workspace’s', async () => {
    await seedSubscription({ plan: 'household', status: 'active' })

    const a = await resolveLimits(world.scope, NOW)
    const b = await resolveLimits(world.otherScope, NOW)

    expect(a.entitlement.planId).toBe('household')
    // B has no row of its own and must not inherit A's ceilings.
    expect(b.entitlement.planId).toBe('free')
    expect(b.limits.accounts).toBe(PLANS.free.limits.accounts)
  })

  it('reports usage beside the limits, from one call', async () => {
    const effective = await resolveLimits(world.scope, NOW)
    // The harness gives workspace A two accounts and two currencies.
    expect(effective.usage.accounts).toBe(2)
    expect(effective.usage.currencies).toBe(2)
    expect(effective.usage.members).toBe(1)
  })

  it('names the metrics a downgrade left over the line', async () => {
    // Free sells one currency; A holds two, so a downgrade puts it over.
    const effective = await resolveLimits(world.scope, NOW)
    expect(effective.entitlement.planId).toBe('free')
    expect(effective.exceeded).toContain('currencies')
    // And nothing was deleted to make that true.
    expect(effective.usage.currencies).toBe(2)
  })

  it('answers one metric without counting anything', async () => {
    await seedSubscription({ plan: 'household', status: 'active' })
    await expect(resolveLimit(world.scope, 'members', NOW)).resolves.toBe(
      PLANS.household.limits.members,
    )
  })

  /**
   * A metric name nobody declared resolves to *no ceiling*, not to zero: a typo at a call site must
   * not silently refuse every write. The enumeration above is what catches the typo instead.
   */
  it('does not cap a metric the catalogue has never heard of', async () => {
    await expect(resolveLimit(world.scope, 'acounts', NOW)).resolves.toBe(
      UNLIMITED,
    )
  })
})
