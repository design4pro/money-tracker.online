import { describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'
import { totalsByCurrency } from '../currency-totals'

import type { BalanceBearing } from '../currency-totals'

function account(currencyCode: string, minor: number): BalanceBearing {
  return { currencyCode, currentBalanceMinor: asMinor(minor) }
}

describe('totalsByCurrency', () => {
  it('sums each currency in its own units and never mixes them', () => {
    const totals = totalsByCurrency([
      account('PLN', 120_000),
      account('EUR', 4_50),
      account('PLN', 30_000),
    ])

    expect(totals).toEqual([
      { currencyCode: 'PLN', totalMinor: 150_000, accountCount: 2 },
      { currencyCode: 'EUR', totalMinor: 450, accountCount: 1 },
    ])
  })

  it('orders by the size of the holding, so a debt is not buried at the bottom', () => {
    const totals = totalsByCurrency([
      account('EUR', 100),
      account('GBP', -900_00),
      account('USD', 5_000),
    ])

    expect(totals.map((total) => total.currencyCode)).toEqual([
      'GBP',
      'USD',
      'EUR',
    ])
  })

  it('breaks ties on the code, so equal holdings do not reshuffle between renders', () => {
    const totals = totalsByCurrency([account('USD', 100), account('CHF', 100)])

    expect(totals.map((total) => total.currencyCode)).toEqual(['CHF', 'USD'])
  })

  it('returns nothing for no accounts rather than a zero row', () => {
    expect(totalsByCurrency([])).toEqual([])
  })
})
