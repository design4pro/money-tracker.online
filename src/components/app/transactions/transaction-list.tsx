import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp } from 'lucide-react'

import { Button, Checkbox, Spinner } from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'

import { BalanceAmount, NetAmount } from './amount-text'
import {
  DAY_BAND_HEIGHT_PX,
  HEADER_ROW,
  bandSideFor,
  columnIndexFor,
  columnsFor,
  groupByDay,
  nextPosition,
  rowHeightFor,
  samePosition,
} from './grid-model'
import {
  CELL_BASE,
  CELL_RULE,
  CELL_SPINE,
  TransactionRow,
  descriptionTracks,
} from './transaction-row'
import { TYPED_LINE } from './typed-line'
import { nameIndex } from './types'

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { CellPosition } from './grid-model'
import type { TransactionRowActions } from './transaction-row'
import type { LedgerRow, LedgerSort, TransactionReference } from './types'

/**
 * The ledger: a virtualised `role="grid"` over keyset pages, grouped by day, with one tab stop.
 *
 * ## Two books, one grid
 *
 * The all-accounts ledger and the passbook of one account are the same component. The passbook
 * has a balance after every line, so it has one more column (`columnsFor`), its day band carries
 * the balance forward instead of totalling the day, and it names no account since every line is
 * the same one. Everything else - selection, the keyboard map, paging - is shared.
 *
 * ## Virtualisation without lying about the size
 *
 * `@tanstack/react-virtual` keeps roughly thirty rows in the DOM, which is what makes ten thousand
 * of them scroll at frame rate - and what would otherwise tell a screen reader that the table has
 * thirty rows in it. `aria-rowcount` is therefore the count of the **whole filtered set** (from a
 * SQL `COUNT`, not from the page) and every `<tr>` carries its true `aria-rowindex`. The two
 * spacer rows that produce the scroll height are `aria-hidden`, so they occupy pixels and not
 * positions.
 *
 * The header is grid row 1; a transaction at index `i` of the whole set is row `i + 2`.
 *
 * ## One tab stop, and it is never lost
 *
 * A grid with a focusable control in every cell puts fifty thousand stops in the tab order. The
 * pattern instead is a roving `tabindex`: exactly one cell is tabbable, arrow keys move it, and
 * every control inside a cell is `excludeFromTabOrder`. Two consequences are easy to get wrong and
 * are handled explicitly here:
 *
 * - **The tab stop must exist.** If the active row has been scrolled out of the rendered window the
 *   stop falls back to the header cell of the same column, so tabbing into the list always lands
 *   somewhere. Without that fallback the whole grid disappears from the tab order the moment
 *   somebody scrolls with the mouse.
 * - **The grid must not eat keys meant for a widget.** Every handler below returns immediately
 *   unless the event target is a cell itself, so typing in the row menu, toggling a checkbox and
 *   the browser's own find-in-page all still work.
 *
 * Row actions are bound to the whole row rather than to the menu: `e` edits, `d` duplicates,
 * `Delete` deletes, `Space` selects, `Enter` opens. A keyboard reader never has to find the
 * overflow button.
 */

export interface TransactionListProps {
  readonly rows: ReadonlyArray<LedgerRow>
  /** How many rows match the filters in total - the figure `aria-rowcount` reports. */
  readonly totalRows: number
  readonly reference: TransactionReference
  readonly sort: LedgerSort
  readonly onSortChange: (sort: LedgerSort) => void
  readonly selectedIds: ReadonlySet<string>
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void
  readonly hasMore: boolean
  readonly isLoadingMore: boolean
  readonly onLoadMore: () => void
  readonly onOpen: (id: string) => void
  readonly onEdit: (id: string) => void
  readonly onDuplicate: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly hrefFor: (id: string) => string
  /** Names the active filters, so the table's caption says what is being looked at. */
  readonly caption: string
  /** The passbook of one account: every row carries `balanceAfterMinor` and the spine is drawn. */
  readonly hasBalance?: boolean
  /** Whether the rows span more than one account, so naming the account on each says something. */
  readonly showAccount?: boolean
  /**
   * Content that sits above the grid and shares its container: the planned screen's expected
   * group. It is outside the grid, so its controls take no part in the grid's keyboard model. It
   * changes height without the rows changing (a row is settled, a notice appears), so the list
   * watches it and re-measures where the virtualised rows start.
   */
  readonly leading?: ReactNode
}

/**
 * The wide page, where an entry is one rule. Tailwind's `lg`, read once as an external store so
 * the virtualiser's row heights agree with the CSS that draws them. The server has no viewport and
 * reports the wide page; a phone corrects it in the first effect and the virtualiser re-measures.
 */
const WIDE_QUERY = '(min-width: 64rem)'

function subscribeWide(onChange: () => void): () => void {
  const list = window.matchMedia(WIDE_QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  )
}

/**
 * The column headings: one typed rule on `surface-sunken`, pinned directly beneath the app header
 * from `sm` up, over the heavier rule the headings sit on.
 *
 * The offset composes the shell's chrome rather than restating a number: `top-0` alone pinned this
 * row at the *viewport* top, which is inside the 64px app header. Below `sm` the header is two
 * rules (see {@link HEADER_ROW_GRID}) and is not pinned: eighty pixels of headings under sixty-four
 * of chrome would leave a phone a third of its height to read the ledger in.
 */
const HEADER_CELL = cn(
  CELL_BASE,
  'sm:sticky sm:top-[calc(var(--nav-h)+var(--impersonation-h))] z-nav sm:bg-surface-sunken sm:shadow-[inset_0_-1px_0_0_var(--color-border-panel)]',
)

/**
 * The header below `sm`, on the same tracks as the rows: the description heading over the date
 * (which is the sort control) on the left, the amount over the balance on the right, so it mirrors
 * the entry it heads. The heavier rule is drawn by the row there, since its cells draw none (and
 * paint no background, or they would cover it).
 */
const HEADER_ROW_GRID =
  'max-sm:grid max-sm:grid-cols-[2.5rem_minmax(0,1fr)_auto_2.75rem] max-sm:grid-rows-[2.5rem_2.5rem] max-sm:shadow-[inset_0_-1px_0_0_var(--color-border-panel)]'

const HEAD_TEXT = cn(
  'text-micro font-semibold tracking-label uppercase text-ink-2',
  TYPED_LINE,
)

function positionKey(position: CellPosition): string {
  return `${position.row}:${position.column}`
}

interface DayBandProps {
  readonly columnCount: number
  readonly label: ReactNode
  /** The words before the figure: the day's total, or what it carries forward. */
  readonly figureLabel: string
  readonly figure: ReactNode
}

/**
 * The band that opens a day in the ledger and carries the balance forward in the passbook.
 *
 * Two properties it does not get to break:
 *
 * - **It presides over exactly the rows beside it.** Every row under this band and above the next
 *   one shares its date, because the rows are ordered by date and the band is emitted at each
 *   boundary.
 * - **The figure is the sum of those rows.** `groupByDay` nets the day, and it withholds the total
 *   for a day that is still half loaded rather than printing a number that would grow as somebody
 *   read it. In the passbook the figure is the balance after the day's newest line, summed by the
 *   repository from stored amounts, and it is pencil when that line is planned.
 *
 * It is a `<tr aria-hidden>` rather than a row of the grid - like the two virtualiser spacers - so
 * `aria-rowcount` and `aria-rowindex` keep describing transactions and only transactions. Nothing
 * is lost to a listener: every row speaks its own full date, and the totals under the list are the
 * authority on any sum.
 *
 * ## The figure shares a right edge with the column it sums
 *
 * The band spans every column, so `justify-between` alone would park its figure at the table's own
 * edge while every row figure stops short of it by the actions column. The band carries that column
 * back as trailing padding and the select column as leading padding, so the label starts where the
 * titles start and the figure ends where the amounts end. Change a track and this changes with it.
 *
 * ## It is the recessed band, not another page-coloured one
 *
 * `surface-sunken` is the darkest ground in both themes, so the ledger reads band → page → row as
 * three distinct planes. Two near-black fills cannot be pushed far apart without dropping the
 * band's own label below the 7:1 text floor, so the separation is not asked to come from tone
 * alone: the top rule is a full-strength `border-strong` hairline and the bottom one is the heavier
 * `border-panel` rule, both inset so the band stays exactly one rule tall.
 */
function DayBand({ columnCount, label, figureLabel, figure }: DayBandProps) {
  return (
    <tr aria-hidden="true" className="max-sm:block">
      <td colSpan={columnCount} className="p-0 max-sm:block">
        <div
          style={{ height: DAY_BAND_HEIGHT_PX }}
          className="flex justify-between gap-3 bg-surface-sunken ps-12 pe-13 shadow-[inset_0_1px_0_0_var(--color-border-strong),inset_0_-1px_0_0_var(--color-border-panel)] sm:ps-15 sm:pe-14"
        >
          <span
            className={cn(
              'truncate text-caption font-semibold text-ink',
              TYPED_LINE,
            )}
          >
            {label}
          </span>
          {figure === null ? null : (
            <span
              className={cn(
                'text-caption text-ink-2',
                TYPED_LINE,
                'flex shrink-0 gap-1.5',
              )}
            >
              {/* A phone line has room for the date and the figure, not for the word too. */}
              <span className="max-sm:sr-only">{figureLabel}</span>
              {figure}
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}

export function TransactionList({
  rows,
  totalRows,
  reference,
  sort,
  onSortChange,
  selectedIds,
  onSelectionChange,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  hrefFor,
  caption,
  hasBalance = false,
  showAccount = true,
  leading,
}: TransactionListProps) {
  const t = useTranslate()
  const locale = useLocale()
  const isWide = useIsWide()
  const columns = columnsFor(hasBalance)
  const column = columnIndexFor(columns)
  const isGrouped = sort.field === 'bookedOn'
  const bandSide = bandSideFor(sort, hasBalance)

  const containerRef = useRef<HTMLDivElement>(null)
  const leadingRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const cellRefs = useRef(new Map<string, HTMLElement>())
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds

  const [active, setActive] = useState<CellPosition>({
    row: HEADER_ROW,
    column: column.description,
  })
  const [pendingFocus, setPendingFocus] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  // Where the first virtualised row starts: the container's own offset plus whatever `leading`
  // pushes the table down by (the table's offset inside the positioned container).
  const measureScrollMargin = useCallback(() => {
    setScrollMargin(
      (containerRef.current?.offsetTop ?? 0) +
        (tableRef.current?.offsetTop ?? 0),
    )
  }, [])

  useLayoutEffect(measureScrollMargin, [measureScrollMargin, rows.length])

  // The leading content changes height on its own: a settled row leaves it, a notice appears, a
  // narrow screen reflows it. None of that changes `rows.length`, so it is observed directly.
  const hasLeading =
    leading !== undefined && leading !== null && leading !== false
  useEffect(() => {
    const element = leadingRef.current
    if (
      !hasLeading ||
      element === null ||
      typeof ResizeObserver === 'undefined'
    ) {
      return
    }
    const observer = new ResizeObserver(measureScrollMargin)
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasLeading, measureScrollMargin])

  const grouping = useMemo(
    () => groupByDay({ rows, sort, hasMore }),
    [rows, sort, hasMore],
  )

  const bandAt = useCallback(
    (index: number) =>
      bandSide === 'before'
        ? grouping.startsDay[index] === true
        : grouping.endsDay[index] === true,
    [bandSide, grouping],
  )

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    // Still arithmetic rather than measurement - see `rowHeightFor` - but no longer one constant:
    // a row is one rule or two, and the row that opens or closes a day carries that day's band, so
    // its virtual item is taller by exactly the band. Nothing is measured, so the scrollbar stays
    // honest at ten thousand rows.
    estimateSize: (index) =>
      rowHeightFor(rows[index], isWide) +
      (bandAt(index) ? DAY_BAND_HEIGHT_PX : 0),
    overscan: 10,
    scrollMargin,
    // Without a rect the server renders an empty tbody and the first paint has no ledger in it.
    // This is a plausible desktop viewport; the real one replaces it in the first effect.
    initialRect: { width: 1280, height: 960 },
    getItemKey: (index) => rows[index]?.id ?? index,
  })

  // The estimates depend on the page width and on where the bands fall; when either changes the
  // virtualiser is told to forget what it had rather than keep the old offsets.
  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, isWide, bandAt])

  const virtualItems = virtualizer.getVirtualItems()
  const accountNames = useMemo(
    () => nameIndex(reference.accounts),
    [reference.accounts],
  )
  const payeeNames = useMemo(
    () => nameIndex(reference.payees),
    [reference.payees],
  )
  const categories = useMemo(
    () => new Map(reference.categories.map((entry) => [entry.id, entry])),
    [reference.categories],
  )
  /* ---- Selection --------------------------------------------------------- */

  const toggleSelect = useCallback(
    (id: string) => {
      const next = new Set(selectedRef.current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      onSelectionChange(next)
    },
    [onSelectionChange],
  )

  const allLoadedSelected =
    rows.length > 0 && rows.every((row) => selectedIds.has(row.id))
  const someSelected = selectedIds.size > 0 && !allLoadedSelected

  const toggleSelectAll = useCallback(() => {
    onSelectionChange(
      allLoadedSelected ? new Set() : new Set(rows.map((row) => row.id)),
    )
  }, [allLoadedSelected, onSelectionChange, rows])

  /* ---- Sorting ----------------------------------------------------------- */

  const toggleDateSort = useCallback(() => {
    if (sort.field !== 'bookedOn') {
      onSortChange({ field: 'bookedOn', direction: 'desc' })
      return
    }
    onSortChange({
      field: 'bookedOn',
      direction: sort.direction === 'desc' ? 'asc' : 'desc',
    })
  }, [onSortChange, sort])

  /* ---- Focus ------------------------------------------------------------- */

  const registerCell = useCallback(
    (row: number, columnIndex: number, element: HTMLElement | null) => {
      const key = `${row}:${columnIndex}`
      if (element === null) {
        cellRefs.current.delete(key)
        return
      }
      cellRefs.current.set(key, element)
    },
    [],
  )

  const onCellFocus = useCallback((row: number, columnIndex: number) => {
    setActive((current) =>
      current.row === row && current.column === columnIndex
        ? current
        : { row, column: columnIndex },
    )
  }, [])

  const moveTo = useCallback(
    (position: CellPosition) => {
      setActive(position)
      setPendingFocus(true)
      if (position.row !== HEADER_ROW) {
        virtualizer.scrollToIndex(position.row - 1, { align: 'auto' })
      }
    },
    [virtualizer],
  )

  useEffect(() => {
    if (!pendingFocus) {
      return
    }
    const element = cellRefs.current.get(positionKey(active))
    if (element !== undefined) {
      element.focus()
      setPendingFocus(false)
    }
  })

  /* ---- Paging ------------------------------------------------------------ */

  const lastRenderedIndex = virtualItems.at(-1)?.index ?? -1
  useEffect(() => {
    if (!hasMore || isLoadingMore || rows.length === 0) {
      return
    }
    if (lastRenderedIndex >= rows.length - 6) {
      onLoadMore()
    }
  }, [hasMore, isLoadingMore, lastRenderedIndex, onLoadMore, rows.length])

  /* ---- Keyboard ---------------------------------------------------------- */

  const activateHeader = useCallback(() => {
    if (active.column === column.select) {
      toggleSelectAll()
      return
    }
    if (active.column === column.date) {
      toggleDateSort()
    }
  }, [active.column, column, toggleDateSort, toggleSelectAll])

  const activateRow = useCallback(
    (row: LedgerRow) => {
      switch (active.column) {
        case column.select:
          toggleSelect(row.id)
          return
        case column.actions:
          setOpenMenuId(row.id)
          return
        default:
          onOpen(row.id)
      }
    },
    [active.column, column, onOpen, toggleSelect],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTableElement>) => {
      const target = event.target as HTMLElement
      // Anything raised from inside a cell's own widget belongs to that widget.
      if (target.dataset.gridCell !== 'true') {
        return
      }

      const moved = nextPosition(active, event, rows.length, columns.length)
      if (moved !== null) {
        event.preventDefault()
        if (!samePosition(moved, active)) {
          moveTo(moved)
        }
        return
      }

      if (active.row === HEADER_ROW) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activateHeader()
        }
        return
      }

      // `.at` rather than an index: the active row can outlive the array for one render when a
      // filter change shrinks the page under a stop that was already placed.
      const row = rows.at(active.row - 1)
      if (row === undefined) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      switch (event.key) {
        case 'Enter':
          event.preventDefault()
          activateRow(row)
          return
        case ' ':
          event.preventDefault()
          toggleSelect(row.id)
          return
        case 'e':
          event.preventDefault()
          onEdit(row.id)
          return
        case 'd':
          event.preventDefault()
          onDuplicate(row.id)
          return
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          onDelete(row.id)
          return
        default:
      }
    },
    [
      activateHeader,
      activateRow,
      active,
      columns.length,
      moveTo,
      onDelete,
      onDuplicate,
      onEdit,
      rows,
      toggleSelect,
    ],
  )

  /* ---- Rendering --------------------------------------------------------- */

  const renderedRows = useMemo(
    () => new Set(virtualItems.map((item) => item.index + 1)),
    [virtualItems],
  )
  // The tab stop lives on the active cell while it is on screen, and retreats to the header when
  // it is not, so the grid is never absent from the tab order.
  const tabStopOnHeader =
    active.row === HEADER_ROW || !renderedRows.has(active.row)

  const actions: TransactionRowActions = useMemo(
    () => ({
      onToggleSelect: toggleSelect,
      onOpen,
      onEdit,
      onDuplicate,
      onDelete,
      onMenuOpenChange: (id, isOpen) => setOpenMenuId(isOpen ? id : null),
      hrefFor,
    }),
    [hrefFor, onDelete, onDuplicate, onEdit, onOpen, toggleSelect],
  )

  const paddingTop =
    virtualItems.length === 0
      ? 0
      : Math.max(virtualItems[0].start - scrollMargin, 0)
  const paddingBottom =
    virtualItems.length === 0
      ? 0
      : Math.max(
          virtualizer.getTotalSize() -
            (virtualItems[virtualItems.length - 1].end - scrollMargin),
          0,
        )

  const headerCellProps = (columnIndex: number) => ({
    role: 'columnheader' as const,
    scope: 'col' as const,
    'aria-colindex': columnIndex + 1,
    'data-grid-cell': 'true',
    tabIndex: tabStopOnHeader && active.column === columnIndex ? 0 : -1,
    ref: (element: HTMLTableCellElement | null) =>
      registerCell(HEADER_ROW, columnIndex, element),
    onFocus: () => onCellFocus(HEADER_ROW, columnIndex),
  })

  const dateSortState = () => {
    if (sort.field !== 'bookedOn') {
      return 'none' as const
    }
    return sort.direction === 'asc'
      ? ('ascending' as const)
      : ('descending' as const)
  }

  const dayBand = (row: LedgerRow) => {
    const dayLabel = (
      <>
        <span className="sm:hidden">
          {formatCalendarDate(locale, row.bookedOn, 'medium')}
        </span>
        <span className="max-sm:hidden">
          {formatCalendarDate(locale, row.bookedOn, 'long')}
        </span>
      </>
    )
    if (hasBalance) {
      return (
        <DayBand
          columnCount={columns.length}
          label={dayLabel}
          figureLabel={t('transactions.day.carried')}
          figure={
            row.balanceAfterMinor === undefined ? null : (
              <BalanceAmount
                amountMinor={row.balanceAfterMinor}
                currencyCode={row.currencyCode}
                isPlanned={row.isPlanned}
              />
            )
          }
        />
      )
    }
    const net = grouping.netByDay.get(row.bookedOn)
    return (
      <DayBand
        columnCount={columns.length}
        label={dayLabel}
        figureLabel={t('transactions.day.net')}
        figure={
          net === undefined ? null : (
            <NetAmount
              amountMinor={net}
              currencyCode={reference.baseCurrencyCode}
            />
          )
        }
      />
    )
  }

  return (
    <div ref={containerRef} className="relative">
      {hasLeading ? (
        <div ref={leadingRef} className="pb-4">
          {leading}
        </div>
      ) : null}
      <table
        ref={tableRef}
        role="grid"
        aria-label={t('transactions.list.label')}
        aria-rowcount={totalRows + 1}
        aria-colcount={columns.length}
        aria-multiselectable="true"
        aria-busy={isLoadingMore}
        onKeyDown={handleKeyDown}
        // Below `sm` the table parts are blocks and each row lays itself out as a grid; the
        // explicit ARIA roles on every part keep it a table for assistive technology there.
        className="w-full table-fixed border-separate border-spacing-0 max-sm:block"
      >
        <caption className="sr-only">{caption}</caption>
        {/*
          The date track is sized for the string it actually holds: the day of the month under a
          day band, the whole date under any other sort. Below `sm` the row is a grid of its own
          and these widths do not apply.
        */}
        <colgroup>
          <col className="w-12" />
          <col className={isGrouped ? 'w-14' : 'w-28'} />
          <col />
          <col className="w-36" />
          {hasBalance ? <col className="w-40" /> : null}
          <col className="w-11" />
        </colgroup>

        <thead className="max-sm:block">
          <tr
            role="row"
            aria-rowindex={1}
            className={cn(HEADER_ROW_GRID, 'bg-surface-sunken')}
          >
            <th
              {...headerCellProps(column.select)}
              className={cn(
                HEADER_CELL,
                'text-center max-sm:col-start-1 max-sm:row-start-1 max-sm:row-span-2',
              )}
            >
              <span className="flex h-10 items-center justify-center max-sm:h-full">
                <Checkbox
                  excludeFromTabOrder
                  // See `transaction-row.tsx`: a label-less checkbox is 18px wide, and
                  // `target-min-h` only grows the axis that was already big enough.
                  className="target-min"
                  isSelected={allLoadedSelected}
                  isIndeterminate={someSelected}
                  onChange={toggleSelectAll}
                  aria-label={t('transactions.selectAllLoaded')}
                />
              </span>
            </th>
            <th
              {...headerCellProps(column.date)}
              aria-sort={dateSortState()}
              className={cn(
                HEADER_CELL,
                CELL_RULE,
                'text-start max-sm:col-start-2 max-sm:row-start-2',
              )}
            >
              {/* The sort control fills the rule. Its line box is the arrow's height, so the arrow
                  is sized to the type and the box set on the rule, which puts the word on the
                  same baseline as the typed headings beside it. `flex` rather than inline, or the
                  cell's own line box would add a descender under the forty pixels. */}
              <Button
                variant="ghost"
                size="sm"
                excludeFromTabOrder
                onPress={toggleDateSort}
                className="-mx-1 flex h-10 items-end px-1 text-micro leading-none tracking-label uppercase [&_svg]:size-3.5"
                iconAfter={
                  sort.field === 'bookedOn' && sort.direction === 'asc' ? (
                    <ArrowUp />
                  ) : (
                    <ArrowDown />
                  )
                }
              >
                {t('transactions.field.date')}
              </Button>
            </th>
            {/*
              One heading cell, up to three labels - the mirror of the row's own description cell.
              The column still holds the description, the category and the account; from `lg` up
              they are drawn on tracks instead of stacked, and this is what they line up under.
            */}
            <th
              {...headerCellProps(column.description)}
              className={cn(
                HEADER_CELL,
                CELL_RULE,
                'text-start max-sm:col-start-2 max-sm:row-start-1',
              )}
            >
              <div className={descriptionTracks(showAccount)}>
                <span className={cn(HEAD_TEXT, 'truncate')}>
                  {t('transactions.column.description')}
                </span>
                <span className={cn(HEAD_TEXT, 'hidden truncate lg:block')}>
                  {t('transactions.field.category')}
                </span>
                {showAccount ? (
                  <span className={cn(HEAD_TEXT, 'hidden truncate lg:block')}>
                    {t('transactions.field.account')}
                  </span>
                ) : null}
              </div>
            </th>
            <th
              {...headerCellProps(column.amount)}
              className={cn(
                HEADER_CELL,
                CELL_RULE,
                'text-end max-sm:col-start-3 max-sm:row-start-1',
              )}
            >
              <span className={HEAD_TEXT}>
                {t('transactions.field.amount')}
              </span>
            </th>
            {hasBalance ? (
              <th
                {...headerCellProps(column.balance)}
                className={cn(
                  HEADER_CELL,
                  CELL_SPINE,
                  'text-end max-sm:col-start-3 max-sm:row-start-2',
                )}
              >
                <span className={HEAD_TEXT}>
                  {t('transactions.column.balance')}
                </span>
              </th>
            ) : null}
            <th
              {...headerCellProps(column.actions)}
              className={cn(
                HEADER_CELL,
                CELL_RULE,
                'text-center max-sm:col-start-4 max-sm:row-start-1 max-sm:row-span-2',
              )}
            >
              <span className="sr-only">
                {t('transactions.column.actions')}
              </span>
            </th>
          </tr>
        </thead>

        <tbody className="max-sm:block">
          {paddingTop > 0 ? (
            <tr aria-hidden="true" className="max-sm:block">
              <td
                colSpan={columns.length}
                className="max-sm:block"
                style={{ height: paddingTop }}
              />
            </tr>
          ) : null}

          {virtualItems.map((item) => {
            const row = rows.at(item.index)
            if (row === undefined) {
              return null
            }
            const category =
              row.categoryId === null
                ? undefined
                : categories.get(row.categoryId)
            const gridRow = item.index + 1
            const band = bandAt(item.index) ? dayBand(row) : null
            return (
              <Fragment key={row.id}>
                {bandSide === 'before' ? band : null}
                <TransactionRow
                  row={row}
                  rowIndex={gridRow}
                  ariaRowIndex={item.index + 2}
                  isSelected={selectedIds.has(row.id)}
                  activeColumn={active.row === gridRow ? active.column : null}
                  isMenuOpen={openMenuId === row.id}
                  columns={columns}
                  isGrouped={isGrouped}
                  showAccount={showAccount}
                  isWide={isWide}
                  accountName={
                    accountNames.get(row.accountId) ?? t('common.unknown')
                  }
                  categoryName={category?.name ?? null}
                  categoryColor={category?.color ?? null}
                  payeeName={
                    row.payeeId === null
                      ? null
                      : (payeeNames.get(row.payeeId) ?? null)
                  }
                  registerCell={registerCell}
                  onCellFocus={onCellFocus}
                  actions={actions}
                />
                {bandSide === 'after' ? band : null}
              </Fragment>
            )
          })}

          {paddingBottom > 0 ? (
            <tr aria-hidden="true" className="max-sm:block">
              <td
                colSpan={columns.length}
                className="max-sm:block"
                style={{ height: paddingBottom }}
              />
            </tr>
          ) : null}
        </tbody>
      </table>

      {/*
        A visible "load more" as well as the scroll trigger. Infinite scroll alone is unreachable
        for anybody who pages with the keyboard rather than flicking, and it gives the live region
        below something to announce against.
      */}
      <div className="flex items-center justify-center gap-3 py-4">
        {hasMore ? (
          <Button
            variant="secondary"
            isPending={isLoadingMore}
            onPress={onLoadMore}
          >
            {t('transactions.loadMore')}
          </Button>
        ) : null}
        <p role="status" className="text-caption text-ink-2">
          {isLoadingMore ? (
            <span className="inline-flex items-center gap-2">
              <Spinner className="size-3.5" label={null} />
              {t('transactions.loadingMore')}
            </span>
          ) : (
            t('transactions.loadedOf', {
              loaded: rows.length,
              total: totalRows,
            })
          )}
        </p>
      </div>
    </div>
  )
}
