import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { plain } from '#/components/charts/__tests__/plain'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { AccountsWidget } from '../accounts-widget'
import { renderLinked } from './harness'

import type { DashboardAccount } from '../types'

const PLN = asCurrencyCode('PLN')

const CURRENT: DashboardAccount = {
  id: 'a1',
  name: 'Current account',
  balanceMinor: asMinor(1248000),
  currencyCode: PLN,
  refBalanceMinor: asMinor(1248000),
  isLiability: false,
}

const EURO: DashboardAccount = {
  id: 'a2',
  name: 'Holiday savings',
  balanceMinor: asMinor(124000),
  currencyCode: asCurrencyCode('EUR'),
  refBalanceMinor: asMinor(534000),
  isLiability: false,
}

const CARD: DashboardAccount = {
  id: 'a3',
  name: 'Credit card',
  balanceMinor: asMinor(-89050),
  currencyCode: PLN,
  refBalanceMinor: asMinor(-89050),
  isLiability: true,
}

describe('AccountsWidget', () => {
  it('shows each account in the currency the account is actually in', async () => {
    await renderLinked(
      <AccountsWidget baseCurrencyCode={PLN} accounts={[EURO]} />,
    )

    const row = screen.getAllByRole('listitem')[0]
    // The figure the person's bank shows them comes first…
    expect(plain(row.textContent)).toContain('€1,240.00')
    // …and the base-currency equivalent is a second line under its own label.
    expect(plain(row.textContent)).toContain('In PLN: zł 5,340.00')
  })

  it('does not repeat the same number twice for an account already in the base currency', async () => {
    await renderLinked(
      <AccountsWidget baseCurrencyCode={PLN} accounts={[CURRENT]} />,
    )

    const row = screen.getAllByRole('listitem')[0]
    expect(plain(row.textContent)).toContain('zł 12,480.00')
    expect(row.textContent).not.toContain('In PLN')
  })

  it('tells a liability apart with a word, not with a colour', async () => {
    await renderLinked(
      <AccountsWidget baseCurrencyCode={PLN} accounts={[CURRENT, CARD]} />,
    )

    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).queryByText('Owed')).toBeNull()
    expect(within(rows[1]).getByText('Owed')).toBeTruthy()
    // The sign is the second non-colour channel, and it is whichever minus this locale uses —
    // `en` writes a hyphen-minus, `pl` a U+2212 — so it comes from the formatter, never from a
    // string this file composed.
    expect(plain(rows[1].textContent)).toContain('-zł 890.50')
  })

  it('offers a way to all of them', async () => {
    await renderLinked(
      <AccountsWidget baseCurrencyCode={PLN} accounts={[CURRENT]} />,
    )

    expect(
      screen.getByRole('link', { name: 'All accounts' }).getAttribute('href'),
    ).toBe('/accounts')
  })

  it('gives an empty workspace a designed state with one real action', async () => {
    await renderLinked(<AccountsWidget baseCurrencyCode={PLN} accounts={[]} />)

    expect(screen.getByText('No accounts yet')).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'Add your first account' })
        .getAttribute('href'),
    ).toBe('/accounts')
  })
})
