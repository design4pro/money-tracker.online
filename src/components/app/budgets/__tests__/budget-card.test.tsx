import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { asMinor } from '#/lib/money'

import { BudgetCard } from '../budget-card'
import { budgetSummary, ledgerRow, renderLinkedBudget } from './harness'

/**
 * The list row. Its whole job is to let somebody scan five envelopes and know which one is in
 * trouble, so the assertions are about what a scan can pick up.
 */

describe('BudgetCard', () => {
  it('makes the whole row the target while keeping the actions their own tab stop', async () => {
    await renderLinkedBudget(
      <BudgetCard
        budget={budgetSummary()}
        actions={<button type="button">Actions for Groceries</button>}
      />,
    )

    const link = screen.getByRole('link', { name: 'Groceries' })
    expect(link.getAttribute('href')).toBe('/budgets/bud-1')
    // A stretched pseudo-element, not a wrapper: the button inside stays reachable.
    expect(link.className).toContain('after:absolute')
    expect(
      screen.getByRole('button', { name: 'Actions for Groceries' }),
    ).toBeTruthy()
  })

  it('marks an archived budget with a surface and a badge, never with opacity', async () => {
    const { container } = await renderLinkedBudget(
      <BudgetCard budget={budgetSummary({ status: 'archived' })} />,
    )

    const row = container.querySelector('li')
    expect(row?.className).toContain('bg-surface-sunken')
    // Dropping the row to 60% opacity would drop its contrast by the same 60%.
    expect(row?.className).not.toMatch(/\bopacity-/)
    expect(screen.getByText('Archived')).toBeTruthy()
  })

  it('says which way a carried balance went, in words as well as in a sign', async () => {
    await renderLinkedBudget(
      <BudgetCard
        budget={budgetSummary({
          current: ledgerRow({ carriedInMinor: asMinor(-400_00) }),
        })}
      />,
    )
    expect(
      screen.getByText(/400\.00 carried in from an overspend/i),
    ).toBeTruthy()
  })

  it('replaces the meter with a reason rather than drawing an empty bar', async () => {
    await renderLinkedBudget(
      <BudgetCard
        budget={budgetSummary({
          startDate: '2099-01-01',
          current: null,
          utilisation: null,
        })}
      />,
    )
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByText(/Starts .*2099/)).toBeTruthy()
  })
})
