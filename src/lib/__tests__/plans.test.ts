/**
 * The plan catalogue's own invariants — the ones a screen and a quota check both depend on.
 *
 * Nothing here asserts a *price*: prices are a product decision that changes, and a test that
 * restated them would fail on every pricing change without catching a single defect. What is
 * asserted is the shape the rest of the product relies on being true of them.
 */

import { describe, expect, it } from 'vitest'

import {
  BILLING_INTERVALS,
  MissingProductError,
  PLANS,
  PLAN_IDS,
  PLAN_LIST,
  QUOTA_METRICS,
  QUOTA_METRIC_OWNERS,
  UNLIMITED,
  isPlanId,
  isQuotaMetric,
  planForProductId,
  planLimits,
  priceFor,
  requirePrice,
  yearlySavingPercent,
} from '../plans'

describe('every tier sells every metered resource', () => {
  it.each(PLAN_IDS)('%s declares a ceiling for each metric', (planId) => {
    for (const metric of QUOTA_METRICS) {
      const limit = planLimits(planId)[metric]
      expect(
        Number.isInteger(limit) || limit === UNLIMITED,
        `${planId}.${metric} is neither an integer nor unlimited`,
      ).toBe(true)
      expect(limit).toBeGreaterThanOrEqual(0)
    }
  })

  it('names an enforcement point for every metric', () => {
    expect(Object.keys(QUOTA_METRIC_OWNERS).toSorted()).toEqual(
      [...QUOTA_METRICS].toSorted(),
    )
  })

  /**
   * Not a style rule: `resolveLimits` picks a plan and reads its numbers, so a tier that is
   * *smaller* than the one below it on some metric would make an upgrade a downgrade for the
   * person who bought it.
   */
  it('never sells less at a higher tier', () => {
    for (const metric of QUOTA_METRICS) {
      const free = PLANS.free.limits[metric]
      const plus = PLANS.plus.limits[metric]
      const household = PLANS.household.limits[metric]
      expect(plus, `plus.${metric}`).toBeGreaterThanOrEqual(free)
      expect(household, `household.${metric}`).toBeGreaterThanOrEqual(plus)
    }
  })

  it('lists the tiers cheapest first', () => {
    expect(PLAN_LIST.map((plan) => plan.id)).toEqual([...PLAN_IDS])
  })
})

describe('prices are the provider’s money', () => {
  it('is free on exactly one tier, and that tier has no price', () => {
    const free = PLAN_LIST.filter((plan) => plan.free)
    expect(free.map((plan) => plan.id)).toEqual(['free'])
    expect(free[0].prices).toBeNull()
  })

  it('holds every paid amount as a non-negative integer of minor units', () => {
    for (const plan of PLAN_LIST) {
      for (const interval of BILLING_INTERVALS) {
        const price = priceFor(plan.id, interval)
        if (price === null) continue
        expect(Number.isInteger(price.amountMinor)).toBe(true)
        expect(price.amountMinor).toBeGreaterThan(0)
        expect(price.currency).toMatch(/^[A-Z]{3}$/)
      }
    }
  })

  it('reports a yearly saving only when yearly actually costs less', () => {
    for (const plan of PLAN_LIST) {
      const saving = yearlySavingPercent(plan.id)
      if (saving === null) continue
      expect(saving).toBeGreaterThan(0)
      expect(saving).toBeLessThan(100)
    }
  })

  /**
   * Whether a line carries a product id is a fact about the *build* — a developer with a filled-in
   * `.env.local` and CI with none both run this file — so each line is asserted against its own
   * `productId`. An unconfigured line has to fail by name rather than open a checkout against
   * `undefined`; a configured one has to hand back exactly the id it was given.
   */
  it('resolves a checkout only for the lines the build carries a product id for', () => {
    for (const plan of PLAN_LIST) {
      for (const interval of BILLING_INTERVALS) {
        const price = priceFor(plan.id, interval)
        if (price === null) continue
        const variable = `VITE_POLAR_PRODUCT_${plan.id.toUpperCase()}_${interval.toUpperCase()}`

        if (price.productId === null) {
          expect(() => requirePrice(plan.id, interval)).toThrow(
            MissingProductError,
          )
          expect(() => requirePrice(plan.id, interval)).toThrow(variable)
        } else {
          expect(requirePrice(plan.id, interval).productId).toBe(
            price.productId,
          )
        }
      }
    }
  })

  /** The free tier has nothing to buy, so a checkout for it is refused whatever the build carries. */
  it('refuses a checkout for the free tier', () => {
    expect(priceFor('free', 'monthly')).toBeNull()
    expect(() => requirePrice('free', 'monthly')).toThrow(MissingProductError)
  })

  it('maps an unknown product id to no plan at all', () => {
    expect(planForProductId('prod_nothing')).toBeNull()
    expect(planForProductId(null)).toBeNull()
    expect(planForProductId('')).toBeNull()
  })
})

describe('the vocabulary guards', () => {
  it('accepts only the declared plan ids', () => {
    expect(isPlanId('free')).toBe(true)
    expect(isPlanId('enterprise')).toBe(false)
    expect(isPlanId(undefined)).toBe(false)
  })

  it('accepts only the declared metrics', () => {
    expect(isQuotaMetric('accounts')).toBe(true)
    expect(isQuotaMetric('acounts')).toBe(false)
  })
})
