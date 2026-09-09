import { describe, expect, it } from 'vitest'

import {
  TRANSACTION_DETAIL_URL,
  TRANSACTION_ROW_SELECTOR,
} from '../transactions'

/**
 * The guard that would have caught #82 in the fast loop.
 *
 * `openTransactionDetailPanel` asserts the URL after following the ledger's first row. For as long
 * as that assertion accepted `/transactions/new`, a wrong turn onto the entry form was invisible:
 * the spec carried on and failed several lines later, complaining that a refund panel was missing
 * from a screen that has never had one. Both values below are one edit away from admitting the
 * create route again, and neither edit is obviously wrong to read - so they are asserted here
 * rather than only in a browser run that needs a seeded workspace to say anything at all.
 */
describe('TRANSACTION_DETAIL_URL', () => {
  it('matches the address of one transaction', () => {
    for (const url of [
      'http://127.0.0.1:3012/transactions/tx_01H8XYZ',
      'http://localhost:3010/transactions/9f2c4e1a-0000-4000-8000-000000000000',
    ]) {
      expect(TRANSACTION_DETAIL_URL.test(url), url).toBe(true)
    }
  })

  it('refuses the entry form, which is the wrong turn #82 took', () => {
    expect(
      TRANSACTION_DETAIL_URL.test('http://localhost:3010/transactions/new'),
    ).toBe(false)
  })

  it('refuses the ledger it was navigated away from', () => {
    expect(TRANSACTION_DETAIL_URL.test('http://localhost:3010/transactions')) //
      .toBe(false)
  })
})

describe('TRANSACTION_ROW_SELECTOR', () => {
  it('excludes the create stamp the bottom bar renders on a phone', () => {
    // A CSS string cannot be exercised without a DOM, and this project has none - so what is
    // asserted is the one property a reader has to be able to trust at a glance: that the
    // exclusion is still in it, spelled as the href the bottom bar actually ships.
    expect(TRANSACTION_ROW_SELECTOR).toContain(
      ':not([href="/transactions/new"])',
    )
  })
})
