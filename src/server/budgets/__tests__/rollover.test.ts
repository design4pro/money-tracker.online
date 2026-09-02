/**
 * The three rollover policies, and the chain they build.
 *
 * There is no database in this file on purpose. Rollover is arithmetic over four integers, and a
 * fixture would only make the assertions slower to read without making them stronger — the
 * repository test (`repos/__tests__/budget-periods.test.ts`) is where the *stored* numbers are
 * checked against these same functions.
 *
 * The case that earns its place is the overspend, in both directions across a boundary:
 * `carry_all` must carry it forward as a negative opening balance and `carry_surplus` must absorb
 * it **and report it**, because an absorbed overspend nobody is told about is the difference
 * between a budgeting tool and a tool that agrees with you.
 */

import { describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'
import {
  availableMinor,
  carriedOutMinor,
  periodBalanceMinor,
  rolloverChain,
  rolloverOf,
} from '../rollover'

const minor = (value: number) => asMinor(value)

/** A 2 000,00 zł envelope that opened clean. */
const CLEAN = {
  limitMinor: minor(2_000_00),
  carriedInMinor: minor(0),
  spentMinor: minor(0),
}

describe('periodBalanceMinor', () => {
  it('is limit plus carry less spend, signed', () => {
    expect(periodBalanceMinor({ ...CLEAN, spentMinor: minor(1_500_00) })).toBe(
      500_00,
    )
    expect(periodBalanceMinor({ ...CLEAN, spentMinor: minor(2_400_00) })).toBe(
      -400_00,
    )
    expect(
      periodBalanceMinor({
        limitMinor: minor(2_000_00),
        carriedInMinor: minor(-400_00),
        spentMinor: minor(1_000_00),
      }),
    ).toBe(600_00)
  })
})

describe('none', () => {
  it('carries nothing forward, whichever way the period went', () => {
    expect(
      carriedOutMinor('none', { ...CLEAN, spentMinor: minor(1_500_00) }),
    ).toBe(0)
    expect(
      carriedOutMinor('none', { ...CLEAN, spentMinor: minor(2_400_00) }),
    ).toBe(0)
  })

  it('still reports the overspend rather than pretending the month balanced', () => {
    // A `none` budget forgets the money; it does not get to forget that it happened. The ledger
    // prints "over by 400,00 zł" against the period that overspent.
    expect(
      rolloverOf('none', { ...CLEAN, spentMinor: minor(2_400_00) }),
    ).toEqual({ carriedOutMinor: 0, absorbedMinor: 400_00 })
  })
})

describe('carry_surplus', () => {
  it('rolls an underspend forward whole', () => {
    expect(
      rolloverOf('carry_surplus', { ...CLEAN, spentMinor: minor(1_500_00) }),
    ).toEqual({ carriedOutMinor: 500_00, absorbedMinor: 0 })
  })

  it('floors an overspend at zero and reports what it absorbed', () => {
    expect(
      rolloverOf('carry_surplus', { ...CLEAN, spentMinor: minor(2_400_00) }),
    ).toEqual({ carriedOutMinor: 0, absorbedMinor: 400_00 })
  })

  it('opens the next period clean after an overspend, in both directions', () => {
    // The boundary, walked forwards: overspend, then a normal month.
    const chain = rolloverChain('carry_surplus', [
      { limitMinor: minor(2_000_00), spentMinor: minor(2_400_00) },
      { limitMinor: minor(2_000_00), spentMinor: minor(1_800_00) },
    ])
    expect(chain[0]?.carriedOutMinor).toBe(0)
    expect(chain[0]?.absorbedMinor).toBe(400_00)
    expect(chain[1]?.carriedInMinor).toBe(0)
    expect(chain[1]?.carriedOutMinor).toBe(200_00)

    // And backwards: a surplus month, then an overspend that eats it and more.
    const other = rolloverChain('carry_surplus', [
      { limitMinor: minor(2_000_00), spentMinor: minor(1_700_00) },
      { limitMinor: minor(2_000_00), spentMinor: minor(2_500_00) },
    ])
    expect(other[1]?.carriedInMinor).toBe(300_00)
    // 2 000 + 300 − 2 500 = −200, absorbed rather than carried.
    expect(other[1]?.carriedOutMinor).toBe(0)
    expect(other[1]?.absorbedMinor).toBe(200_00)
  })
})

describe('carry_all', () => {
  it('carries an overspend forward as a negative opening balance', () => {
    expect(
      rolloverOf('carry_all', { ...CLEAN, spentMinor: minor(2_400_00) }),
    ).toEqual({ carriedOutMinor: -400_00, absorbedMinor: 0 })
  })

  it('lets a negative period be repaid by the next one', () => {
    const chain = rolloverChain('carry_all', [
      { limitMinor: minor(2_000_00), spentMinor: minor(2_400_00) },
      { limitMinor: minor(2_000_00), spentMinor: minor(1_000_00) },
    ])
    expect(chain[1]?.carriedInMinor).toBe(-400_00)
    // 2 000 − 400 − 1 000 = 600 back in the black.
    expect(chain[1]?.carriedOutMinor).toBe(600_00)
  })

  /**
   * The telescoping property, which is the whole reason the chain is integers all the way down:
   * over six periods, the final carry equals Σ(limit) − Σ(spent) exactly, with no rounding step
   * anywhere. If a ratio ever crept into this arithmetic, this is the assertion that would fail.
   */
  it('telescopes over six periods', () => {
    const periods = [
      { limitMinor: minor(1_000_00), spentMinor: minor(900_33) },
      { limitMinor: minor(1_000_00), spentMinor: minor(1_100_67) },
      { limitMinor: minor(1_000_00), spentMinor: minor(999_99) },
      { limitMinor: minor(1_200_00), spentMinor: minor(1_500_01) },
      { limitMinor: minor(1_200_00), spentMinor: minor(400_00) },
      { limitMinor: minor(1_200_00), spentMinor: minor(1_111_11) },
    ]
    const chain = rolloverChain('carry_all', periods)

    for (const [index, row] of chain.entries()) {
      expect(row.carriedOutMinor).toBe(
        row.limitMinor + row.carriedInMinor - row.spentMinor,
      )
      if (index + 1 < chain.length) {
        expect(chain[index + 1].carriedInMinor).toBe(row.carriedOutMinor)
      }
    }

    const totalLimit = periods.reduce((sum, p) => sum + p.limitMinor, 0)
    const totalSpent = periods.reduce((sum, p) => sum + p.spentMinor, 0)
    expect(chain.at(-1)?.carriedOutMinor).toBe(totalLimit - totalSpent)
  })

  it('does not telescope under carry_surplus, and that is the difference', () => {
    const periods = [
      { limitMinor: minor(1_000_00), spentMinor: minor(1_400_00) },
      { limitMinor: minor(1_000_00), spentMinor: minor(500_00) },
    ]
    const all = rolloverChain('carry_all', periods)
    const surplus = rolloverChain('carry_surplus', periods)

    expect(all.at(-1)?.carriedOutMinor).toBe(100_00)
    expect(surplus.at(-1)?.carriedOutMinor).toBe(500_00)
    // The 400,00 zł the surplus policy dropped is reported, not lost.
    expect(surplus[0]?.absorbedMinor).toBe(400_00)
  })
})

describe('availableMinor', () => {
  it('adds the carry to the limit', () => {
    expect(availableMinor(minor(2_000_00), minor(300_00))).toBe(2_300_00)
    expect(availableMinor(minor(2_000_00), minor(-400_00))).toBe(1_600_00)
  })

  it('floors at zero, because a meter cannot run backwards', () => {
    expect(availableMinor(minor(2_000_00), minor(-2_500_00))).toBe(0)
  })
})
