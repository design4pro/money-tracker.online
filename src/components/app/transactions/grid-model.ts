/**
 * The transaction grid's geometry, its keyboard map and its day grouping - all of it as pure
 * functions, none of it touching the DOM.
 *
 * The list is the one screen in this product where the keyboard contract is genuinely intricate: a
 * `role="grid"` with a roving tab stop has to know where the next cell is before it knows which
 * element to focus, and every one of those decisions is a two-line function with a boundary case.
 * Keeping them here means they are tested as arithmetic rather than as a rendered table with a
 * simulated key press, which is the difference between a test that catches an off-by-one and a test
 * that catches a re-render.
 */

import { ZERO_MINOR, addMinor, subtractMinor } from '#/lib/money'

import { LINE_PX } from './typed-line'

import type { Minor } from '#/lib/money'
import type { LedgerRow, LedgerSort } from './types'

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/** The cells a row can have, in reading order. */
export type LedgerColumn =
  'select' | 'date' | 'description' | 'amount' | 'balance' | 'actions'

/**
 * The two books the grid draws, as column lists. Fixed per book in every viewport.
 *
 * Hiding a column below a breakpoint was the obvious alternative and is the wrong one: a column
 * removed by CSS is removed from the accessibility tree too, so `aria-colcount` and the roving
 * tab stop would have to be recomputed from a media query and would disagree with the server-
 * rendered markup for one frame. The account and the category live inside the description cell
 * instead - which is what `DESIGN.md`'s typed line asks for anyway.
 *
 * The balance column is the one genuine difference: the passbook of one account has a running
 * balance and the all-accounts ledger, which mixes currencies, has none. That is a difference in
 * what the table *is*, so it is a difference in the column list rather than a CSS one.
 */
const LEDGER_COLUMNS: ReadonlyArray<LedgerColumn> = [
  'select',
  'date',
  'description',
  'amount',
  'actions',
]
const PASSBOOK_COLUMNS: ReadonlyArray<LedgerColumn> = [
  'select',
  'date',
  'description',
  'amount',
  'balance',
  'actions',
]

/** The column list for a book, by reference-stable constant so a memoised row can take it. */
export function columnsFor(hasBalance: boolean): ReadonlyArray<LedgerColumn> {
  return hasBalance ? PASSBOOK_COLUMNS : LEDGER_COLUMNS
}

/** `column → index` for one book; a column the book does not have is `-1`. */
export function columnIndexFor(
  columns: ReadonlyArray<LedgerColumn>,
): Readonly<Record<LedgerColumn, number>> {
  return {
    select: columns.indexOf('select'),
    date: columns.indexOf('date'),
    description: columns.indexOf('description'),
    amount: columns.indexOf('amount'),
    balance: columns.indexOf('balance'),
    actions: columns.indexOf('actions'),
  }
}

/** The header occupies grid row 0; data rows are 1-based below it. */
export const HEADER_ROW = 0

/**
 * How tall one row is, and the virtualiser is told so rather than measuring.
 *
 * Measurement buys nothing here - the row's content is truncated by construction - and it costs a
 * `ResizeObserver` per visible row plus a scroll-position correction every time one settles. A
 * fixed height also makes the scrollbar honest at ten thousand rows, which a measured list only
 * becomes after the reader has scrolled past everything once.
 *
 * The row is on the pitch of the form: a whole number of {@link LINE_PX} rules. From `lg` up an
 * entry is one typed line - description, category and account on tracks beside the date and the
 * amount - and a second rule only where a converted figure sits under a foreign-currency amount.
 * Below `lg` the category (and the date, below `sm`) move under the description, so every entry is
 * two rules, and the converted figure shares the amount's cell without adding a third.
 */
export function rowHeightFor(
  row: Pick<LedgerRow, 'currencyCode' | 'refCurrencyCode'>,
  isWide: boolean,
): number {
  if (!isWide) {
    return LINE_PX * 2
  }
  return row.currencyCode === row.refCurrencyCode ? LINE_PX : LINE_PX * 2
}

/** The band that opens or closes a day is one rule too, so the pitch holds across it. */
export const DAY_BAND_HEIGHT_PX = LINE_PX

/** How many rows a Page Up / Page Down moves. */
const PAGE_ROWS = 10

/* -------------------------------------------------------------------------- */
/* Keyboard map                                                                */
/* -------------------------------------------------------------------------- */

export interface CellPosition {
  /** 0 is the header row; 1…`rowCount` are the loaded transactions. */
  readonly row: number
  readonly column: number
}

export interface NavigationKey {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/**
 * Where a navigation key moves the roving tab stop, or `null` when the key is not one of ours.
 *
 * `null` matters as much as the position: a grid that swallows every key it receives eats the
 * browser's own find-in-page and the screen reader's pass-through, so anything not listed here is
 * returned unhandled and left to bubble.
 */
export function nextPosition(
  active: CellPosition,
  event: NavigationKey,
  rowCount: number,
  columnCount: number,
): CellPosition | null {
  const lastRow = rowCount
  const lastColumn = columnCount - 1
  const jump = event.ctrlKey || event.metaKey

  switch (event.key) {
    case 'ArrowDown':
      return { ...active, row: clamp(active.row + 1, HEADER_ROW, lastRow) }
    case 'ArrowUp':
      return { ...active, row: clamp(active.row - 1, HEADER_ROW, lastRow) }
    case 'ArrowRight':
      return { ...active, column: clamp(active.column + 1, 0, lastColumn) }
    case 'ArrowLeft':
      return { ...active, column: clamp(active.column - 1, 0, lastColumn) }
    case 'PageDown':
      return {
        ...active,
        row: clamp(active.row + PAGE_ROWS, HEADER_ROW, lastRow),
      }
    case 'PageUp':
      return {
        ...active,
        row: clamp(active.row - PAGE_ROWS, HEADER_ROW, lastRow),
      }
    case 'Home':
      // Ctrl+Home is "the first cell of the grid"; plain Home is "the first cell of this row".
      return jump ? { row: HEADER_ROW, column: 0 } : { ...active, column: 0 }
    case 'End':
      return jump
        ? { row: lastRow, column: lastColumn }
        : { ...active, column: lastColumn }
    default:
      return null
  }
}

/** Two positions are the same cell. */
export function samePosition(left: CellPosition, right: CellPosition): boolean {
  return left.row === right.row && left.column === right.column
}

/* -------------------------------------------------------------------------- */
/* Day grouping                                                                */
/* -------------------------------------------------------------------------- */

export interface DayGrouping {
  /** Per loaded row: does a new calendar day start here? */
  readonly startsDay: ReadonlyArray<boolean>
  /**
   * Per loaded row: is this the row a day's group ends on, with nothing of that day still to page
   * in? While another page is due, the last loaded day may continue on it, so its last loaded row
   * does not end it.
   */
  readonly endsDay: ReadonlyArray<boolean>
  /**
   * Net for each day whose rows are **all** loaded, in the base currency.
   *
   * A day still being paged in is absent rather than partial. A total that grows while somebody
   * reads it is worse than no total, and there is no honest way to label "so far" in a column that
   * looks like a balance.
   */
  readonly netByDay: ReadonlyMap<string, Minor>
}

export interface GroupByDayArgs {
  readonly rows: ReadonlyArray<LedgerRow>
  readonly sort: LedgerSort
  /** Whether another page is still to come. The last loaded day is partial while it is. */
  readonly hasMore: boolean
}

/**
 * Day boundaries and day nets, for the date sort only.
 *
 * Grouping by day is a property of ordering by day: under a sort by payee name the rows of one
 * Tuesday are scattered through the list, and drawing a day rule between two of them would claim a
 * grouping that is not there.
 */
export function groupByDay({
  rows,
  sort,
  hasMore,
}: GroupByDayArgs): DayGrouping {
  if (sort.field !== 'bookedOn' || rows.length === 0) {
    return {
      startsDay: rows.map(() => false),
      endsDay: rows.map(() => false),
      netByDay: new Map(),
    }
  }

  const startsDay = rows.map(
    (row, index) => index === 0 || rows[index - 1].bookedOn !== row.bookedOn,
  )
  const endsDay = rows.map((row, index) =>
    index === rows.length - 1
      ? !hasMore
      : rows[index + 1].bookedOn !== row.bookedOn,
  )

  const running = new Map<string, Minor>()
  for (const row of rows) {
    const carried = running.get(row.bookedOn) ?? ZERO_MINOR
    running.set(
      row.bookedOn,
      row.direction === 'income'
        ? addMinor(carried, row.refAmountMinor)
        : subtractMinor(carried, row.refAmountMinor),
    )
  }

  if (hasMore) {
    const lastDay = rows[rows.length - 1].bookedOn
    running.delete(lastDay)
  }

  return { startsDay, endsDay, netByDay: running }
}

/**
 * Where the passbook's carried-forward band sits: beside the day's chronologically last entry, the
 * one whose balance-after is what the day hands to the next. Read newest first that is the row a
 * day opens on, so the band goes before it; read oldest first it is the row the day closes on, so
 * the band goes after it. The all-accounts ledger's day-total band always opens the day.
 */
export function bandSideFor(
  sort: LedgerSort,
  hasBalance: boolean,
): 'before' | 'after' {
  return hasBalance && sort.direction === 'asc' ? 'after' : 'before'
}
