import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { drawn, reading } from '#/components/app/money/__tests__/channels'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { NetWorthWidget } from '../net-worth-widget'
import { renderWidget } from './harness'

const PLN = asCurrencyCode('PLN')

function renderNetWorth(accountCount: number, liabilitiesMinor = -89050) {
  return renderWidget(
    <NetWorthWidget
      baseCurrencyCode={PLN}
      totalBalanceMinor={asMinor(1782000)}
      liabilitiesMinor={asMinor(liabilitiesMinor)}
      netWorthMinor={asMinor(1782000 + liabilitiesMinor)}
      accountCount={accountCount}
    />,
  )
}

describe('NetWorthWidget', () => {
  it('keeps held and owed under their own labels', () => {
    renderNetWorth(3)

    expect(screen.getAllByRole('term').map((node) => node.textContent)).toEqual(
      ['What you hold', 'What you owe'],
    )
    // The magnitude, not the stored sign. `liabilitiesMinor` is negative while there is debt —
    // that sign is what `netWorth = held + liabilities` is built on — but under a label that
    // already says *owe*, printing it makes the reader negate it back to learn what they owe.
    const values = screen.getAllByRole('definition')
    expect(values.map(drawn)).toEqual(['zł 17,820.00', 'zł 890.50'])
    // …and the figure is spoken with its currency named, not as bare digits.
    expect(values.map(reading)).toEqual([
      '17,820.00 Polish zlotys',
      '890.50 Polish zlotys',
    ])
  })

  it('owes nothing when the liability accounts are collectively in credit', () => {
    // An overpaid card is not a debt of the same size. The one reading that is never right here is
    // restating a credit as the amount owed.
    renderNetWorth(3, 64054)
    expect(screen.getAllByRole('definition').map(drawn)).toEqual([
      'zł 17,820.00',
      'zł 0.00',
    ])
  })

  it('states the currency the figures are counted in', () => {
    renderNetWorth(3)
    expect(
      screen.getByText('Counted in PLN, at the rate stored with each account.'),
    ).toBeTruthy()
  })

  it('shows a designed state rather than three convincing zeros', () => {
    renderNetWorth(0)

    expect(screen.getByText('Nothing to add up yet')).toBeTruthy()
    expect(screen.queryAllByRole('term')).toHaveLength(0)
  })
})
