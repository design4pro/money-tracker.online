/**
 * The one dedupe key this stage invents. The other two belong to the modules that sweep.
 */

import { describe, expect, it } from 'vitest'

import { crossingMarkerKey } from '#/server/budgets/thresholds'
import { reminderMarkerKey } from '#/server/recurring/markers'

import { goalReachedDedupeKey } from '../dedupe'

describe('goalReachedDedupeKey', () => {
  it('is the same key however often one goal is reached', () => {
    expect(goalReachedDedupeKey({ goalId: 'goal-1' })).toBe(
      goalReachedDedupeKey({ goalId: 'goal-1' }),
    )
  })

  it('separates two goals', () => {
    expect(goalReachedDedupeKey({ goalId: 'goal-1' })).not.toBe(
      goalReachedDedupeKey({ goalId: 'goal-2' }),
    )
  })

  it('is versioned and namespaced like the two keys it sits beside', () => {
    const goal = goalReachedDedupeKey({ goalId: 'goal-1' })
    const budget = crossingMarkerKey({
      budgetId: 'budget-1',
      periodStart: '2026-03-01',
      threshold: 80,
    })
    const recurring = reminderMarkerKey({
      seriesId: 'series-1',
      periodStart: '2026-03-01',
      offset: '3d',
    })

    for (const key of [goal, budget, recurring]) {
      expect(key).toMatch(/^[a-z]+:[a-z_]+:v1:/)
    }
    // Namespaced, so no two producers can collide inside one workspace's key space.
    expect(new Set([goal, budget, recurring]).size).toBe(3)
  })
})
