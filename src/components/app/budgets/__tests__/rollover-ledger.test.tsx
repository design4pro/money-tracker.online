import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'

import { asMinor } from '#/lib/money'

import { RolloverLedger } from '../rollover-ledger'
import { ledgerRow, renderBudget } from './harness'

/**
 * The ledger is the argument for materialising `budget_periods` at all: a reader can check the
 * carry chain with a pencil. So it is a real table, and the two facts a colour would carry alone —
 * a negative carry and an absorbed overspend — are also carried by a sign and by a sentence.
 */

describe('RolloverLedger', () => {
  it('is a real table with a caption and a header for every axis', () => {
    renderBudget(
      <RolloverLedger
        rows={[ledgerRow()]}
        policy="carry_surplus"
        currencyCode="PLN"
      />,
    )

    const table = screen.getByRole('table')
    expect(within(table).getByText(/Every period of this budget/i)).toBeTruthy()
    expect(
      screen.getAllByRole('columnheader').map((cell) => cell.textContent),
    ).toEqual([
      'Period',
      'Limit',
      'Carried in',
      'Spent',
      'Carried out',
      'Status',
    ])
    // The period is the row's header, so a screen reader announces which period a cell belongs to.
    expect(screen.getAllByRole('rowheader').length).toBe(1)
  })

  it('signs a negative carry as well as tinting it', () => {
    renderBudget(
      <RolloverLedger
        rows={[
          ledgerRow({
            periodStart: '2026-02-01',
            periodEnd: '2026-02-28',
            carriedInMinor: asMinor(-400_00),
            spentMinor: asMinor(1_000_00),
            carriedOutMinor: asMinor(600_00),
          }),
        ]}
        policy="carry_all"
        currencyCode="PLN"
      />,
    )

    // A real minus sign (U+2212), not only a red cell: the fact survives greyscale, a
    // forced-colours theme and a printed page.
    const cell = screen.getByText(/\u2212.*400\.00/)
    expect(cell.className).toContain('text-negative')
  })

  it('annotates an absorbed overspend in words, because a bare 0,00 hides it', () => {
    renderBudget(
      <RolloverLedger
        rows={[
          ledgerRow({
            spentMinor: asMinor(2_400_00),
            carriedOutMinor: asMinor(0),
            absorbedMinor: asMinor(400_00),
          }),
        ]}
        policy="carry_surplus"
        currencyCode="PLN"
      />,
    )

    // Without this line, "0,00" here and "0,00" for a period that spent exactly its limit are
    // the same cell and different facts.
    expect(screen.getByText(/over by .*400\.00/i)).toBeTruthy()
  })

  it('scrolls sideways inside a named, focusable container rather than pushing the page', () => {
    renderBudget(
      <RolloverLedger rows={[ledgerRow()]} policy="none" currencyCode="PLN" />,
    )

    const region = screen.getByRole('region', { name: 'Rollover history' })
    expect(region.className).toContain('overflow-x-auto')
    // A scroll container a keyboard cannot reach hides its off-screen columns from anybody
    // without a pointer (WCAG 2.1.1).
    expect(region.getAttribute('tabindex')).toBe('0')
  })

  it('says so plainly when there is nothing to show yet', () => {
    renderBudget(<RolloverLedger rows={[]} policy="none" currencyCode="PLN" />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/one period so far/i)).toBeTruthy()
  })
})
