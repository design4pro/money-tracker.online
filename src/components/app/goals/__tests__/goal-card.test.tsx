import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { asMinor } from '#/lib/money'

import { GoalCard } from '../goal-card'
import { goalSummary, renderLinkedGoal } from './harness'

/**
 * One row of the list, and the three things it must not get wrong.
 */

describe('GoalCard', () => {
  it('makes the whole row one target with one accessible name', async () => {
    await renderLinkedGoal(<GoalCard goal={goalSummary()} />)
    const link = screen.getByRole('link', { name: 'Emergency fund' })
    expect(link.getAttribute('href')).toBe('/goals/goal-1')
  })

  it('counts the days to the deadline rather than only colouring it', async () => {
    await renderLinkedGoal(
      <GoalCard goal={goalSummary({ daysToTarget: 12 })} />,
    )
    expect(screen.getByText(/12 days to the target date/u)).toBeTruthy()
  })

  it('says how late it is, in words, once the date has passed', async () => {
    await renderLinkedGoal(
      <GoalCard
        goal={goalSummary({
          daysToTarget: -40,
          isOverdue: true,
          targetDate: '2026-01-31',
        })}
      />,
    )
    expect(screen.getByText(/40 days past the target date/u)).toBeTruthy()
    // And the meter's own word changes with it — the state is never carried by hue alone.
    expect(screen.getByText(/Past its date/u)).toBeTruthy()
  })

  it('says a goal has no deadline rather than leaving the line blank', async () => {
    await renderLinkedGoal(
      <GoalCard goal={goalSummary({ targetDate: null, daysToTarget: null })} />,
    )
    expect(screen.getByText(/No target date/u)).toBeTruthy()
  })

  it('keeps the base-currency line secondary, and omits it when no rate exists', async () => {
    const withBase = await renderLinkedGoal(
      <GoalCard
        goal={goalSummary({
          currencyCode: 'EUR',
          base: {
            baseCurrencyCode: 'PLN',
            targetMinor: asMinor(43_000_00),
            contributedMinor: asMinor(10_750_00),
          },
        })}
      />,
    )
    expect(screen.getByText(/10,750\.00.*43,000\.00.*PLN/u)).toBeTruthy()
    withBase.unmount()

    // `null` means no rate for the day. Nothing is drawn — never a zero, which would read as
    // "nothing saved" rather than "not known".
    await renderLinkedGoal(
      <GoalCard goal={goalSummary({ currencyCode: 'EUR', base: null })} />,
    )
    expect(screen.queryByText(/PLN/u)).toBeNull()
  })

  it('marks an archived row with a badge and a surface, never an opacity', async () => {
    const { container } = await renderLinkedGoal(
      <GoalCard goal={goalSummary({ status: 'archived' })} />,
    )
    expect(screen.getAllByText(/Archived/u).length).toBeGreaterThan(0)
    const row = container.querySelector('li')
    expect(row?.className).toContain('bg-surface-sunken')
    // A 60% opacity would drop the contrast of the name by the same 60%, and this product claims
    // 7:1. Nothing here is allowed to reach for one.
    expect(row?.className).not.toMatch(/opacity-/u)
  })

  it('announces pending suggestions as a count somebody can act on', async () => {
    await renderLinkedGoal(
      <GoalCard
        goal={goalSummary({
          suggestions: [
            {
              transaction: { id: 'tx-1' } as never,
              fromAccountId: 'acc-1',
            },
          ],
        })}
      />,
    )
    expect(screen.getByText(/1 transfer to review/u)).toBeTruthy()
  })
})
