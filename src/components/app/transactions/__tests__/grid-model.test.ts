import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor, asRateE10 } from '#/lib/money'

import {
  COLUMN_COUNT,
  COLUMN_INDEX,
  DAY_HEADER_HEIGHT_PX,
  HEADER_ROW,
  ROW_HEIGHT_PX,
  groupByDay,
  nextPosition,
  samePosition,
  virtualItemHeight,
} from '../grid-model'

import type { CellPosition } from '../grid-model'
import type { LedgerRow, LedgerSort } from '../types'

/**
 * The grid's arithmetic, tested as arithmetic.
 *
 * Every case here is a boundary: the header row, the last row, a key the grid must *not* claim,
 * and a day whose rows are only half loaded. Each one is a bug a rendered-table test would report
 * as "focus went somewhere else" without saying where.
 */

const PLN = asCurrencyCode('PLN')
const DESC = COLUMN_INDEX.description

function at(rowIndex: number, column: number): CellPosition {
  return { row: rowIndex, column }
}

function key(
  name: string,
  modifiers: { readonly ctrlKey?: boolean; readonly metaKey?: boolean } = {},
) {
  return {
    key: name,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
  }
}

const BY_DATE: LedgerSort = { field: 'bookedOn', direction: 'desc' }

function row(
  id: string,
  bookedOn: string,
  minor: number,
  income = false,
): LedgerRow {
  return {
    id,
    direction: income ? 'income' : 'expense',
    amountMinor: asMinor(minor),
    currencyCode: PLN,
    refAmountMinor: asMinor(minor),
    refCurrencyCode: PLN,
    rateE10: asRateE10(10_000_000_000),
    bookedOn,
    accountId: 'acc_1',
    categoryId: null,
    payeeId: null,
    note: null,
    paymentMethod: null,
    isPlanned: false,
    isBalanceAdjustment: false,
    excludeFromStats: false,
    transferKind: 'none',
  }
}

describe('nextPosition', () => {
  it('stops at the header rather than moving above it', () => {
    expect(nextPosition(at(HEADER_ROW, DESC), key('ArrowUp'), 40)).toEqual(
      at(HEADER_ROW, DESC),
    )
    expect(nextPosition(at(1, DESC), key('ArrowUp'), 40)).toEqual(
      at(HEADER_ROW, DESC),
    )
  })

  it('stops at the last loaded row rather than running past the page', () => {
    expect(nextPosition(at(40, DESC), key('ArrowDown'), 40)).toEqual(
      at(40, DESC),
    )
    expect(nextPosition(at(35, DESC), key('PageDown'), 40)).toEqual(
      at(40, DESC),
    )
    expect(nextPosition(at(3, DESC), key('PageUp'), 40)).toEqual(
      at(HEADER_ROW, DESC),
    )
  })

  it('clamps horizontally at both edges', () => {
    expect(nextPosition(at(2, 0), key('ArrowLeft'), 40)).toEqual(at(2, 0))
    expect(
      nextPosition(at(2, COLUMN_COUNT - 1), key('ArrowRight'), 40),
    ).toEqual(at(2, COLUMN_COUNT - 1))
  })

  it('reads Home and End as the row, and with a modifier as the grid', () => {
    expect(nextPosition(at(7, DESC), key('Home'), 40)).toEqual(at(7, 0))
    expect(nextPosition(at(7, DESC), key('End'), 40)).toEqual(
      at(7, COLUMN_COUNT - 1),
    )
    expect(
      nextPosition(at(7, DESC), key('Home', { ctrlKey: true }), 40),
    ).toEqual(at(HEADER_ROW, 0))
    expect(
      nextPosition(at(7, DESC), key('End', { metaKey: true }), 40),
    ).toEqual(at(40, COLUMN_COUNT - 1))
  })

  it('leaves keys it does not own unhandled, so find-in-page still works', () => {
    expect(nextPosition(at(2, DESC), key('f'), 40)).toBeNull()
    expect(nextPosition(at(2, DESC), key('Tab'), 40)).toBeNull()
    expect(nextPosition(at(2, DESC), key('Enter'), 40)).toBeNull()
  })
})

describe('samePosition', () => {
  it('compares both coordinates', () => {
    expect(samePosition(at(2, 1), at(2, 1))).toBe(true)
    expect(samePosition(at(2, 1), at(2, 2))).toBe(false)
    expect(samePosition(at(2, 1), at(3, 1))).toBe(false)
  })
})

describe('virtualItemHeight', () => {
  it('adds the day heading to the row that opens a day, and to no other', () => {
    expect(virtualItemHeight(false)).toBe(ROW_HEIGHT_PX)
    expect(virtualItemHeight(true)).toBe(ROW_HEIGHT_PX + DAY_HEADER_HEIGHT_PX)
  })
})

describe('groupByDay', () => {
  it('marks the first row of each day', () => {
    const rows = [
      row('a', '2026-03-04', 1000),
      row('b', '2026-03-04', 2000),
      row('c', '2026-03-03', 500),
    ]
    expect(
      groupByDay({ rows, sort: BY_DATE, hasMore: false }).startsDay,
    ).toEqual([true, false, true])
  })

  it('nets income against expense in minor units', () => {
    const rows = [
      row('a', '2026-03-04', 2500, true),
      row('b', '2026-03-04', 1000),
      row('c', '2026-03-03', 700),
    ]
    const { netByDay } = groupByDay({ rows, sort: BY_DATE, hasMore: false })
    expect(netByDay.get('2026-03-04')).toBe(1500)
    expect(netByDay.get('2026-03-03')).toBe(-700)
  })

  /**
   * The regression this exists for: a heading that says `Day total` over a run of rows, printing a
   * figure that is the first row's amount rather than that day's. Every day in a loaded page gets
   * its own total, and each total is the sum of that day's rows and of nothing else.
   */
  it('gives every loaded day a total of its own rows only', () => {
    const rows = [
      row('a', '2026-03-04', 1000),
      row('b', '2026-03-03', 2000),
      row('c', '2026-03-03', 500),
      row('d', '2026-03-01', 300, true),
    ]
    const { startsDay, netByDay } = groupByDay({
      rows,
      sort: BY_DATE,
      hasMore: false,
    })
    expect(startsDay).toEqual([true, true, false, true])
    expect(netByDay.size).toBe(3)
    expect(netByDay.get('2026-03-04')).toBe(-1000)
    expect(netByDay.get('2026-03-03')).toBe(-2500)
    expect(netByDay.get('2026-03-01')).toBe(300)
  })

  it('omits the last day while another page is still to come', () => {
    const rows = [row('a', '2026-03-04', 2500), row('b', '2026-03-03', 700)]
    const { netByDay } = groupByDay({ rows, sort: BY_DATE, hasMore: true })
    expect(netByDay.has('2026-03-04')).toBe(true)
    expect(netByDay.has('2026-03-03')).toBe(false)
  })

  it('groups nothing under a sort that is not by date', () => {
    const rows = [row('a', '2026-03-04', 2500), row('b', '2026-03-04', 700)]
    const grouping = groupByDay({
      rows,
      sort: { field: 'payee', direction: 'asc' },
      hasMore: false,
    })
    expect(grouping.startsDay).toEqual([false, false])
    expect(grouping.netByDay.size).toBe(0)
  })
})
