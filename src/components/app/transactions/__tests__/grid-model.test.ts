import { describe, expect, it } from 'vitest'

import { asCurrencyCode, asMinor, asRateE10 } from '#/lib/money'

import {
  HEADER_ROW,
  bandSideFor,
  columnIndexFor,
  columnsFor,
  groupByDay,
  nextPosition,
  rowHeightFor,
  samePosition,
} from '../grid-model'
import { LINE_PX } from '../typed-line'

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
const EUR = asCurrencyCode('EUR')
const LEDGER = columnsFor(false)
const PASSBOOK = columnsFor(true)
const DESC = columnIndexFor(LEDGER).description
const COLUMN_COUNT = LEDGER.length

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
    kind: 'transaction',
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
    expect(
      nextPosition(at(HEADER_ROW, DESC), key('ArrowUp'), 40, COLUMN_COUNT),
    ).toEqual(at(HEADER_ROW, DESC))
    expect(nextPosition(at(1, DESC), key('ArrowUp'), 40, COLUMN_COUNT)).toEqual(
      at(HEADER_ROW, DESC),
    )
  })

  it('stops at the last loaded row rather than running past the page', () => {
    expect(
      nextPosition(at(40, DESC), key('ArrowDown'), 40, COLUMN_COUNT),
    ).toEqual(at(40, DESC))
    expect(
      nextPosition(at(35, DESC), key('PageDown'), 40, COLUMN_COUNT),
    ).toEqual(at(40, DESC))
    expect(nextPosition(at(3, DESC), key('PageUp'), 40, COLUMN_COUNT)).toEqual(
      at(HEADER_ROW, DESC),
    )
  })

  it('clamps horizontally at both edges', () => {
    expect(nextPosition(at(2, 0), key('ArrowLeft'), 40, COLUMN_COUNT)).toEqual(
      at(2, 0),
    )
    expect(
      nextPosition(
        at(2, COLUMN_COUNT - 1),
        key('ArrowRight'),
        40,
        COLUMN_COUNT,
      ),
    ).toEqual(at(2, COLUMN_COUNT - 1))
  })

  it('reads Home and End as the row, and with a modifier as the grid', () => {
    expect(nextPosition(at(7, DESC), key('Home'), 40, COLUMN_COUNT)).toEqual(
      at(7, 0),
    )
    expect(nextPosition(at(7, DESC), key('End'), 40, COLUMN_COUNT)).toEqual(
      at(7, COLUMN_COUNT - 1),
    )
    expect(
      nextPosition(
        at(7, DESC),
        key('Home', { ctrlKey: true }),
        40,
        COLUMN_COUNT,
      ),
    ).toEqual(at(HEADER_ROW, 0))
    expect(
      nextPosition(
        at(7, DESC),
        key('End', { metaKey: true }),
        40,
        COLUMN_COUNT,
      ),
    ).toEqual(at(40, COLUMN_COUNT - 1))
  })

  it('leaves keys it does not own unhandled, so find-in-page still works', () => {
    expect(nextPosition(at(2, DESC), key('f'), 40, COLUMN_COUNT)).toBeNull()
    expect(nextPosition(at(2, DESC), key('Tab'), 40, COLUMN_COUNT)).toBeNull()
    expect(nextPosition(at(2, DESC), key('Enter'), 40, COLUMN_COUNT)).toBeNull()
  })
})

describe('samePosition', () => {
  it('compares both coordinates', () => {
    expect(samePosition(at(2, 1), at(2, 1))).toBe(true)
    expect(samePosition(at(2, 1), at(2, 2))).toBe(false)
    expect(samePosition(at(2, 1), at(3, 1))).toBe(false)
  })
})

describe('columnsFor', () => {
  it('gives the passbook a balance column between amount and actions, and the ledger none', () => {
    expect(PASSBOOK).toEqual([
      'select',
      'date',
      'description',
      'amount',
      'balance',
      'actions',
    ])
    expect(LEDGER).toEqual([
      'select',
      'date',
      'description',
      'amount',
      'actions',
    ])
    expect(columnIndexFor(LEDGER).balance).toBe(-1)
    expect(columnIndexFor(PASSBOOK).balance).toBe(4)
  })

  it('lets the keyboard reach the balance column only where there is one', () => {
    const amount = { row: 2, column: columnIndexFor(PASSBOOK).amount }
    expect(nextPosition(amount, key('End'), 40, PASSBOOK.length)).toEqual(
      at(2, 5),
    )
    expect(nextPosition(amount, key('End'), 40, LEDGER.length)).toEqual(
      at(2, 4),
    )
  })
})

describe('rowHeightFor', () => {
  it('keeps every row on the pitch: one rule wide, two rules where the type wraps', () => {
    const same = row('a', '2026-03-04', 1000)
    const foreign = { ...same, currencyCode: EUR }
    expect(rowHeightFor(same, true)).toBe(LINE_PX)
    expect(rowHeightFor(foreign, true)).toBe(LINE_PX * 2)
    expect(rowHeightFor(same, false)).toBe(LINE_PX * 2)
    expect(rowHeightFor(foreign, false)).toBe(LINE_PX * 2)
  })
})

describe('bandSideFor', () => {
  it("puts the carried-forward line beside the day's newest entry, and the day total on top", () => {
    const asc: LedgerSort = { field: 'bookedOn', direction: 'asc' }
    expect(bandSideFor(BY_DATE, true)).toBe('before')
    expect(bandSideFor(asc, true)).toBe('after')
    expect(bandSideFor(asc, false)).toBe('before')
  })
})

describe('groupByDay', () => {
  it('marks the first row of each day', () => {
    const rows = [
      row('a', '2026-03-04', 1000),
      row('b', '2026-03-04', 2000),
      row('c', '2026-03-03', 500),
    ]
    const grouping = groupByDay({ rows, sort: BY_DATE, hasMore: false })
    expect(grouping.startsDay).toEqual([true, false, true])
    expect(grouping.endsDay).toEqual([false, true, true])
  })

  it('does not end the last loaded day while another page may continue it', () => {
    const rows = [row('a', '2026-03-04', 1000), row('b', '2026-03-03', 500)]
    expect(groupByDay({ rows, sort: BY_DATE, hasMore: true }).endsDay).toEqual([
      true,
      false,
    ])
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
    expect(grouping.endsDay).toEqual([false, false])
    expect(grouping.netByDay.size).toBe(0)
  })
})
