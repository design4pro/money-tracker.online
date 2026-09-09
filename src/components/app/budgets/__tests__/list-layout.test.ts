import { describe, expect, it } from 'vitest'

import { budgetListClass } from '../list-layout'

/**
 * The one case a browser cannot be pointed at.
 *
 * The seeded workspace holds three budgets and the e2e suite only reads it, so "what a workspace
 * with exactly one budget looks like" has no screen to measure — and the decision is not a property
 * of the rendered card but of the class the list is given, which is exactly what this function is.
 * The paired case is asserted in the browser instead (`e2e/desktop-density.spec.ts`).
 */

describe('budgetListClass', () => {
  it('caps a lone budget at the list band instead of leaving half the page empty', () => {
    // A single card in a two-column grid is the void the pairing exists to close, moved to the
    // right-hand half rather than removed.
    expect(budgetListClass(1)).toContain('max-w-list')
    expect(budgetListClass(1)).not.toContain('grid-cols-2')
  })

  it('pairs from two budgets up', () => {
    for (const count of [2, 3, 12]) {
      expect(budgetListClass(count)).toContain('lg:grid-cols-2')
      expect(budgetListClass(count)).not.toContain('max-w-list')
    }
  })
})
