/**
 * The transaction grid's geometry, its keyboard map and its day grouping — all of it as pure
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

import type { Minor } from '#/lib/money'
import type { LedgerRow, LedgerSort } from './types'

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The five columns, in reading order. Fixed at five in every viewport.
 *
 * Hiding a column below a breakpoint was the obvious alternative and is the wrong one: a column
 * removed by CSS is removed from the accessibility tree too, so `aria-colcount` and the roving
 * tab stop would have to be recomputed from a media query and would disagree with the server-
 * rendered markup for one frame. The account and the category live on the description cell's
 * second line instead — which is what `DESIGN.md`'s ledger row asks for anyway.
 */
export const COLUMN_INDEX = {
  select: 0,
  date: 1,
  description: 2,
  amount: 3,
  actions: 4,
} as const

export const COLUMN_COUNT = 5

/** The header occupies grid row 0; data rows are 1-based below it. */
export const HEADER_ROW = 0

/**
 * Every row is exactly this tall, and the virtualiser is told so rather than measuring.
 *
 * Measurement buys nothing here — the row's content is truncated to two lines by construction — and
 * it costs a `ResizeObserver` per visible row plus a scroll-position correction every time one
 * settles. A fixed height also makes the scrollbar honest at ten thousand rows, which a measured
 * list only becomes after the reader has scrolled past everything once.
 */
export const ROW_HEIGHT_PX = 72

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
): CellPosition | null {
  const lastRow = rowCount
  const jump = event.ctrlKey || event.metaKey

  switch (event.key) {
    case 'ArrowDown':
      return { ...active, row: clamp(active.row + 1, HEADER_ROW, lastRow) }
    case 'ArrowUp':
      return { ...active, row: clamp(active.row - 1, HEADER_ROW, lastRow) }
    case 'ArrowRight':
      return {
        ...active,
        column: clamp(active.column + 1, 0, COLUMN_COUNT - 1),
      }
    case 'ArrowLeft':
      return {
        ...active,
        column: clamp(active.column - 1, 0, COLUMN_COUNT - 1),
      }
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
        ? { row: lastRow, column: COLUMN_COUNT - 1 }
        : { ...active, column: COLUMN_COUNT - 1 }
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
   * Net for each day whose rows are **all** loaded, in the base currency.
   *
   * A day still being paged in is absent rather than partial. A total that grows while somebody
   * reads it is worse than no total, and there is no honest way to label "so far" in a column that
   * looks like a balance.
   */
  readonly netByDay: ReadonlyMap<string, Minor>
}

const NO_GROUPING: DayGrouping = { startsDay: [], netByDay: new Map() }

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
    return { ...NO_GROUPING, startsDay: rows.map(() => false) }
  }

  const startsDay = rows.map(
    (row, index) => index === 0 || rows[index - 1].bookedOn !== row.bookedOn,
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

  return { startsDay, netByDay: running }
}
