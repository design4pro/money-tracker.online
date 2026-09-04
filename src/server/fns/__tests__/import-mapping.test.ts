import { describe, expect, it } from 'vitest'

import { netAmountMinor } from '../import-mapping'

import type { ImportPreviewRow } from '../import-mapping'

/**
 * The one figure on the preview a person decides on.
 *
 * The screen says what the file would do before it does it, so the number under it has to be what
 * the balance would move by. `amountMinor` is strictly positive by the schema decision `map.ts`
 * states and the sign lives in `direction` — a sum that reads only the first field answers with a
 * magnitude, which is a number no account will ever move by.
 *
 * **Every case here mixes both directions on purpose.** A statement of expenses alone passes with
 * or without the sign, which is exactly how the wrong figure survived to a browser.
 */

type Row = Pick<ImportPreviewRow, 'direction' | 'amountMinor'>

const expense = (amountMinor: number): Row => ({
  direction: 'expense',
  amountMinor,
})
const income = (amountMinor: number): Row => ({
  direction: 'income',
  amountMinor,
})

describe('netAmountMinor', () => {
  it('subtracts expenses and adds income', () => {
    // The statement the browser was showing: −45,00, −12,50, +1500,00. Summed as magnitudes it
    // comes out at 1 557,50; the balance moves by 1 442,50.
    expect(netAmountMinor([expense(4500), expense(1250), income(150000)])).toBe(
      144250,
    )
  })

  it('answers with a negative when the month spent more than it took', () => {
    expect(netAmountMinor([income(20000), expense(35000)])).toBe(-15000)
  })

  it('answers zero when the two directions cancel, and not by luck of order', () => {
    expect(netAmountMinor([expense(9900), income(9900)])).toBe(0)
    expect(netAmountMinor([income(9900), expense(9900)])).toBe(0)
  })

  it('stays an integer of minor units', () => {
    const net = netAmountMinor([expense(1), income(2), expense(4)])
    expect(net).toBe(-3)
    expect(Number.isInteger(net)).toBe(true)
  })

  it('is zero for no rows at all', () => {
    expect(netAmountMinor([])).toBe(0)
  })

  it('reads the currency scale from nothing: 3-digit minor units are just integers', () => {
    // A dinar has three digits, so 1,500 KWD is 1_500_000 minor units. Nothing here divides or
    // scales, which is what lets the same expression serve every currency.
    expect(netAmountMinor([income(1_500_000), expense(45_000)])).toBe(1_455_000)
  })
})
