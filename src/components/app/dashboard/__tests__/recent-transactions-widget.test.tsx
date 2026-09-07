import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { plain } from '#/components/charts/__tests__/plain'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { RecentTransactionsWidget } from '../recent-transactions-widget'
import { renderLinked } from './harness'

import type { DashboardTransaction } from '../types'

const PLN = asCurrencyCode('PLN')

const ROWS: ReadonlyArray<DashboardTransaction> = [
  {
    id: 't1',
    bookedOn: '2026-03-14',
    title: 'Weekly shop',
    direction: 'expense',
    amountMinor: asMinor(21450),
    currencyCode: PLN,
    refAmountMinor: asMinor(21450),
  },
  {
    id: 't2',
    bookedOn: '2026-03-01',
    title: 'Salary',
    direction: 'income',
    amountMinor: asMinor(820000),
    currencyCode: PLN,
    refAmountMinor: asMinor(820000),
  },
]

describe('RecentTransactionsWidget', () => {
  it('states the direction as a word beside the amount, not only as a tint', async () => {
    await renderLinked(
      <RecentTransactionsWidget baseCurrencyCode={PLN} transactions={ROWS} />,
    )

    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('Expense')).toBeTruthy()
    expect(within(rows[1]).getByText('Income')).toBeTruthy()
  })

  it('signs an expense and leaves an income unsigned by the same rule', async () => {
    await renderLinked(
      <RecentTransactionsWidget baseCurrencyCode={PLN} transactions={ROWS} />,
    )

    const rows = screen.getAllByRole('listitem')
    expect(plain(rows[0].textContent)).toContain('−zł 214.50')
    expect(plain(rows[1].textContent)).toContain('+zł 8,200.00')
  })

  it('shows the amount as entered, with the stored base-currency figure under it', async () => {
    await renderLinked(
      <RecentTransactionsWidget
        baseCurrencyCode={PLN}
        transactions={[
          {
            ...ROWS[0],
            currencyCode: asCurrencyCode('EUR'),
            amountMinor: asMinor(5000),
            refAmountMinor: asMinor(21450),
          },
        ]}
      />,
    )

    // €50.00 is what the person typed, so it is the row's figure. The 214.50 zł beneath it is
    // the stored equivalent the totals are built from, never a fresh conversion - and it is
    // spoken as such, so a listener hears which of the two figures is the book's.
    const row = plain(screen.getAllByRole('listitem')[0].textContent)
    expect(row).toContain('−€50.00')
    expect(row).toContain('zł 214.50')
    expect(row).toContain('Amount in')
  })

  it('draws no base-currency caption under a row already in the base currency', async () => {
    await renderLinked(
      <RecentTransactionsWidget baseCurrencyCode={PLN} transactions={ROWS} />,
    )

    // One figure per row: repeating 214.50 zł under 214.50 zł is noise.
    const row = plain(screen.getAllByRole('listitem')[0].textContent)
    expect(row).not.toContain('Amount in')
  })

  it('formats the booked date as a calendar date, with no timezone applied', async () => {
    await renderLinked(
      <RecentTransactionsWidget baseCurrencyCode={PLN} transactions={ROWS} />,
    )

    // A `booked_on` that shifts by a day for a reader in Auckland is a bug nobody reports twice.
    expect(screen.getByText('Mar 14, 2026')).toBeTruthy()
  })

  it('gives a period with nothing in it a designed state and a way to fix it', async () => {
    await renderLinked(
      <RecentTransactionsWidget baseCurrencyCode={PLN} transactions={[]} />,
    )

    expect(screen.getByText('Nothing recorded yet')).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'Record an expense' })
        .getAttribute('href'),
    ).toBe('/transactions')
  })
})
