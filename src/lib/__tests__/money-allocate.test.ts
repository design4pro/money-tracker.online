import { describe, expect, it } from 'vitest'

import {
  AllocationError,
  allocate,
  allocateEvenly,
  allocateMoney,
  allocateMoneyEvenly,
  asMinor,
  makeMoney,
  remainderOf,
  sumMinor,
} from '../money'

import type { Minor } from '../money'

function total(shares: ReadonlyArray<Minor>): number {
  return sumMinor(shares)
}

describe('allocate', () => {
  it('loses not one minor unit, which is the entire contract', () => {
    // 10.00 EUR three ways is 3.34 / 3.33 / 3.33, never 3.33 three times.
    expect(allocate(asMinor(1000), [1, 1, 1])).toEqual([334, 333, 333])
  })

  it('splits proportionally to the weights', () => {
    expect(allocate(asMinor(1000), [1, 2, 1])).toEqual([250, 500, 250])
    expect(allocate(asMinor(999), [1, 1, 1])).toEqual([333, 333, 333])
    expect(allocate(asMinor(100), [50, 30, 20])).toEqual([50, 30, 20])
  })

  it('hands the leftover to the largest discarded fraction first', () => {
    // 1.00 across 3, 1, 1: exact shares are 60, 20, 20 — nothing to hand out.
    expect(allocate(asMinor(100), [3, 1, 1])).toEqual([60, 20, 20])
    // 0.10 across 3, 3, 3, 1: exact 3.0, 3.0, 3.0, 1.0 — again nothing.
    expect(allocate(asMinor(10), [3, 3, 3, 1])).toEqual([3, 3, 3, 1])
    // 0.07 three ways: 2.33 each, so one unit goes to the first by the tie rule.
    expect(allocate(asMinor(7), [1, 1, 1])).toEqual([3, 2, 2])
  })

  it('breaks a tie by weight and then by position, so a split never shuffles', () => {
    const first = allocate(asMinor(1000), [1, 1, 1])
    const again = allocate(asMinor(1000), [1, 1, 1])
    expect(again).toEqual(first)
    // A larger weight takes the leftover ahead of an equal remainder.
    expect(allocate(asMinor(5), [1, 4])).toEqual([1, 4])
  })

  it('splits a negative amount as the mirror image of the positive one', () => {
    const positive = allocate(asMinor(1000), [1, 1, 1])
    const negative = allocate(asMinor(-1000), [1, 1, 1])
    expect(negative).toEqual(positive.map((share) => -share))
    expect(total(negative)).toBe(-1000)
  })

  it('handles a zero amount and a zero-weight share', () => {
    expect(allocate(asMinor(0), [1, 1, 1])).toEqual([0, 0, 0])
    expect(allocate(asMinor(1000), [1, 0, 1])).toEqual([500, 0, 500])
    expect(allocate(asMinor(0), [])).toEqual([])
    expect(allocate(asMinor(0), [0, 0])).toEqual([0, 0])
  })

  it('refuses an allocation that cannot be made', () => {
    expect(() => allocate(asMinor(100), [])).toThrow(AllocationError)
    expect(() => allocate(asMinor(100), [0, 0])).toThrow(AllocationError)
    expect(() => allocate(asMinor(100), [-1, 1])).toThrow(AllocationError)
    expect(() => allocate(asMinor(100), [1.5, 1])).toThrow(AllocationError)
  })

  it('sums back to the input for every shape worth worrying about', () => {
    const amounts = [0, 1, 7, 99, 100, 1000, 123_456_789, -1, -7, -123_456_789]
    const weightSets = [
      [1, 1, 1],
      [1, 2, 3],
      [1, 1, 1, 1, 1, 1, 1],
      [7, 11, 13],
      [1, 0, 0, 1],
      [999_999, 1],
    ]
    for (const amount of amounts) {
      for (const weights of weightSets) {
        const shares = allocate(asMinor(amount), weights)
        expect(total(shares), `${amount} across ${weights.join('/')}`).toBe(
          amount,
        )
        expect(shares.length).toBe(weights.length)
      }
    }
  })

  it('stays exact where the intermediate passes 2^53', () => {
    const amount = asMinor(9_007_199_254_740_991)
    const shares = allocate(amount, [1, 1, 1])
    expect(total(shares)).toBe(9_007_199_254_740_991)
    expect(shares).toEqual([
      3_002_399_751_580_331, 3_002_399_751_580_330, 3_002_399_751_580_330,
    ])
  })
})

describe('allocateEvenly', () => {
  it('is allocate with equal weights', () => {
    expect(allocateEvenly(asMinor(1000), 3)).toEqual([334, 333, 333])
    expect(allocateEvenly(asMinor(0), 0)).toEqual([])
  })

  it('refuses a nonsensical share count', () => {
    expect(() => allocateEvenly(asMinor(100), -1)).toThrow(AllocationError)
    expect(() => allocateEvenly(asMinor(100), 2.5)).toThrow(AllocationError)
    expect(() => allocateEvenly(asMinor(100), 0)).toThrow(AllocationError)
  })
})

describe('allocating Money', () => {
  it('keeps the currency on every share', () => {
    expect(allocateMoney(makeMoney(1000, 'PLN'), [1, 1, 1])).toEqual([
      { amountMinor: 334, currencyCode: 'PLN' },
      { amountMinor: 333, currencyCode: 'PLN' },
      { amountMinor: 333, currencyCode: 'PLN' },
    ])
  })

  it('splits a zero-decimal currency in whole units', () => {
    const shares = allocateMoneyEvenly(makeMoney(1000, 'JPY'), 3)
    expect(shares.map((share) => share.amountMinor)).toEqual([334, 333, 333])
  })

  it('splits a three-decimal currency in thousandths', () => {
    // 1.000 KWD three ways: 0.334 / 0.333 / 0.333.
    const shares = allocateMoneyEvenly(makeMoney(1000, 'KWD'), 3)
    expect(shares.map((share) => share.amountMinor)).toEqual([334, 333, 333])
  })
})

describe('remainderOf', () => {
  it('is what a split editor puts under the rows', () => {
    expect(
      remainderOf(makeMoney(1000, 'EUR'), [
        makeMoney(600, 'EUR'),
        makeMoney(300, 'EUR'),
      ]),
    ).toBe(100)
    expect(remainderOf(makeMoney(1000, 'EUR'), [])).toBe(1000)
  })

  it('is zero exactly when the split satisfies the repository invariant', () => {
    const parts = allocateMoney(makeMoney(1000, 'EUR'), [1, 1, 1])
    expect(remainderOf(makeMoney(1000, 'EUR'), parts)).toBe(0)
  })

  it('goes negative when the lines add up to more than the total', () => {
    expect(remainderOf(makeMoney(1000, 'EUR'), [makeMoney(1200, 'EUR')])).toBe(
      -200,
    )
  })

  it('refuses a split line in another currency', () => {
    expect(() =>
      remainderOf(makeMoney(1000, 'EUR'), [makeMoney(100, 'PLN')]),
    ).toThrow(AllocationError)
  })
})
