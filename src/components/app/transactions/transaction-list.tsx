import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp } from 'lucide-react'

import { Button, Checkbox, Spinner } from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'

import { NetAmount } from './amount-text'
import {
  COLUMN_COUNT,
  COLUMN_INDEX,
  DAY_HEADER_HEIGHT_PX,
  HEADER_ROW,
  groupByDay,
  nextPosition,
  samePosition,
  virtualItemHeight,
} from './grid-model'
import { DESCRIPTION_TRACKS, TransactionRow } from './transaction-row'
import { nameIndex } from './types'

import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { CurrencyCode, Minor } from '#/lib/money'
import type { CellPosition } from './grid-model'
import type { TransactionRowActions } from './transaction-row'
import type { LedgerRow, LedgerSort, TransactionReference } from './types'

/**
 * The ledger: a virtualised `role="grid"` over keyset pages, grouped by day, with one tab stop.
 *
 * ## Virtualisation without lying about the size
 *
 * `@tanstack/react-virtual` keeps roughly thirty rows in the DOM, which is what makes ten thousand
 * of them scroll at frame rate — and what would otherwise tell a screen reader that the table has
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
  /** How many rows match the filters in total — the figure `aria-rowcount` reports. */
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
}

/**
 * The column headings, pinned directly beneath the app header.
 *
 * The offset composes the shell's chrome rather than restating a number: `top-0` alone pinned this
 * row at the *viewport* top, which is inside the 64px app header — same `z-nav`, later in the
 * document, so the ledger painted over the product header and the headings sat on top of the
 * workspace switcher.
 *
 * There used to be a second sticky bar above this one, naming the day of whichever row happened to
 * be at the top of the window and printing that day's net beside it. It read as a group header
 * presiding over everything below it — eight rows spanning eight different days — while its figure
 * summed only one of them. A total that does not add up the rows under it is the one mistake a
 * ledger may not make, so the running bar is gone and each day now has a real heading of its own,
 * immediately above the rows it is the total of.
 */
const HEADER_CELL =
  'sticky top-[calc(var(--nav-h)+var(--impersonation-h))] z-nav bg-surface-sunken px-2 py-2 text-micro font-semibold tracking-label uppercase text-ink-2 outline-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2'

function positionKey(position: CellPosition): string {
  return `${position.row}:${position.column}`
}

interface DayHeadingProps {
  readonly label: string
  /** The day's signed net, or `null` while some of its rows are still to be paged in. */
  readonly netMinor: Minor | null
  readonly currencyCode: CurrencyCode
  readonly netLabel: string
}

/**
 * The heading that opens one calendar day, immediately above that day's rows.
 *
 * Two properties it does not get to break:
 *
 * - **It presides over exactly the rows beneath it.** Every row under this heading and above the
 *   next one shares its date, because the rows are ordered by date and the heading is emitted at
 *   each boundary.
 * - **The figure is the sum of those rows.** `groupByDay` nets the day, and it withholds the total
 *   for a day that is still half loaded rather than printing a number that would grow as somebody
 *   read it. A finance product that prints a total which does not add up the rows under it has
 *   failed at the only thing it is for.
 *
 * It is a `<tr aria-hidden>` rather than a row of the grid — like the two virtualiser spacers — so
 * `aria-rowcount` and `aria-rowindex` keep describing transactions and only transactions. Nothing
 * is lost to a listener: every row speaks its own full date, and the totals under the list are the
 * authority on any sum.
 *
 * ## The total shares a right edge with the amounts it sums
 *
 * The heading spans all five columns, so `justify-between` alone parked its figure at the table's
 * own padding edge while every row amount stopped 44px short of it — the width of the actions
 * column, which the heading does not have. A subtotal that does not line up with its addends breaks
 * the one vertical scan a ledger exists for, so the heading carries the actions column back as a
 * trailing spacer: `pe-13` is 8px of cell padding plus the 44px (`w-11`) actions track. Change one
 * of the two and this must change with it.
 *
 * ## It is the recessed band, not another page-coloured one
 *
 * `bg-canvas` put the band 1.10:1 from the row beneath it in dark and 1.02:1 in light — a grouping
 * that is invisible on the theme half the product is read in. The band is now `surface-sunken`, the
 * darkest ground in both themes, so the ledger reads band → page → row as three distinct planes.
 * Two near-black fills cannot be pushed past ~1.24:1 without dropping the band's own label below
 * the 7:1 text floor, so the separation is not asked to come from tone alone: the top rule is a
 * full-strength `border-strong` hairline (3.6:1 in dark, 3.9:1 in light) rather than a 45%-opacity
 * one, and that rule is what survives a dim laptop screen.
 */
function DayHeading({
  label,
  netMinor,
  currencyCode,
  netLabel,
}: DayHeadingProps) {
  return (
    <tr aria-hidden="true">
      <td colSpan={COLUMN_COUNT} className="p-0">
        <div
          style={{ height: DAY_HEADER_HEIGHT_PX }}
          className="flex items-center justify-between gap-3 border-t border-t-border-strong bg-surface-sunken ps-2 pe-13"
        >
          <span className="truncate text-caption font-semibold text-ink">
            {label}
          </span>
          {netMinor === null ? null : (
            <span className="flex shrink-0 items-center gap-1.5 text-caption text-ink-2">
              <span>{netLabel}</span>
              <NetAmount
                amountMinor={netMinor}
                currencyCode={currencyCode}
                className="text-caption"
              />
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
}: TransactionListProps) {
  const t = useTranslate()
  const locale = useLocale()

  const containerRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef(new Map<string, HTMLElement>())
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds

  const [active, setActive] = useState<CellPosition>({
    row: HEADER_ROW,
    column: COLUMN_INDEX.description,
  })
  const [pendingFocus, setPendingFocus] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  useLayoutEffect(() => {
    setScrollMargin(containerRef.current?.offsetTop ?? 0)
  }, [rows.length])

  const grouping = useMemo(
    () => groupByDay({ rows, sort, hasMore }),
    [rows, sort, hasMore],
  )

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    // Still arithmetic rather than measurement — see `ROW_HEIGHT_PX` — but no longer one constant:
    // the row that opens a day carries that day's heading, so its virtual item is taller by exactly
    // the heading. Nothing is measured, so the scrollbar stays honest at ten thousand rows.
    estimateSize: (index) =>
      virtualItemHeight(grouping.startsDay[index] === true),
    overscan: 10,
    scrollMargin,
    // Without a rect the server renders an empty tbody and the first paint has no ledger in it.
    // This is a plausible desktop viewport; the real one replaces it in the first effect.
    initialRect: { width: 1280, height: 960 },
    getItemKey: (index) => rows[index]?.id ?? index,
  })

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
    (row: number, column: number, element: HTMLElement | null) => {
      const key = `${row}:${column}`
      if (element === null) {
        cellRefs.current.delete(key)
        return
      }
      cellRefs.current.set(key, element)
    },
    [],
  )

  const onCellFocus = useCallback((row: number, column: number) => {
    setActive((current) =>
      current.row === row && current.column === column
        ? current
        : { row, column },
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
    if (active.column === COLUMN_INDEX.select) {
      toggleSelectAll()
      return
    }
    if (active.column === COLUMN_INDEX.date) {
      toggleDateSort()
    }
  }, [active.column, toggleDateSort, toggleSelectAll])

  const activateRow = useCallback(
    (row: LedgerRow) => {
      switch (active.column) {
        case COLUMN_INDEX.select:
          toggleSelect(row.id)
          return
        case COLUMN_INDEX.actions:
          setOpenMenuId(row.id)
          return
        default:
          onOpen(row.id)
      }
    },
    [active.column, onOpen, toggleSelect],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTableElement>) => {
      const target = event.target as HTMLElement
      // Anything raised from inside a cell's own widget belongs to that widget.
      if (target.dataset.gridCell !== 'true') {
        return
      }

      const moved = nextPosition(active, event, rows.length)
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

  const headerCellProps = (column: number) => ({
    role: 'columnheader' as const,
    scope: 'col' as const,
    'aria-colindex': column + 1,
    'data-grid-cell': 'true',
    tabIndex: tabStopOnHeader && active.column === column ? 0 : -1,
    ref: (element: HTMLTableCellElement | null) =>
      registerCell(HEADER_ROW, column, element),
    onFocus: () => onCellFocus(HEADER_ROW, column),
  })

  const dateSortState = () => {
    if (sort.field !== 'bookedOn') {
      return 'none' as const
    }
    return sort.direction === 'asc'
      ? ('ascending' as const)
      : ('descending' as const)
  }

  return (
    <div ref={containerRef} className="relative">
      <table
        role="grid"
        aria-label={t('transactions.list.label')}
        aria-rowcount={totalRows + 1}
        aria-colcount={COLUMN_COUNT}
        aria-multiselectable="true"
        aria-busy={isLoadingMore}
        onKeyDown={handleKeyDown}
        className="w-full table-fixed border-collapse border-separate border-spacing-0"
      >
        <caption className="sr-only">{caption}</caption>
        {/*
          The date track is sized for the string it actually holds. `w-16` was 64px against a
          ten-character `31.12.2025` set in 12px tabular figures — about 68px of glyphs — so every
          date in the ledger printed straight over the payee beside it. Below `sm` the row prints
          the day of the month alone, which fits 44px with room to spare; from `sm` up it prints the
          whole date and gets 96px to do it in.
        */}
        <colgroup>
          <col className="w-10 sm:w-12" />
          <col className="w-9 sm:w-24" />
          <col />
          <col className="w-28 sm:w-40" />
          <col className="w-11" />
        </colgroup>

        <thead>
          <tr role="row" aria-rowindex={1}>
            <th
              {...headerCellProps(COLUMN_INDEX.select)}
              className={cn(HEADER_CELL, 'text-center')}
            >
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
            </th>
            <th
              {...headerCellProps(COLUMN_INDEX.date)}
              aria-sort={dateSortState()}
              className={cn(HEADER_CELL, 'text-start')}
            >
              <Button
                variant="ghost"
                size="sm"
                excludeFromTabOrder
                onPress={toggleDateSort}
                className="-mx-1 h-7 px-1 text-micro tracking-label uppercase"
                iconAfter={
                  sort.field === 'bookedOn' && sort.direction === 'asc' ? (
                    <ArrowUp />
                  ) : (
                    <ArrowDown />
                  )
                }
              >
                {/* Below `sm` the date column is 36px wide — room for `29`, and none for the word
                    beside an arrow. The heading keeps its accessible name and drops to the sort
                    arrow alone; the 44px hit area is the button's own and does not shrink with it. */}
                <span className="sr-only sm:not-sr-only">
                  {t('transactions.field.date')}
                </span>
              </Button>
            </th>
            {/*
              One heading cell, three labels — the mirror of the row's own description cell. The
              column still holds the description, the category and the account; from `lg` up they
              are drawn on tracks instead of stacked, and this is what they line up under.
            */}
            <th
              {...headerCellProps(COLUMN_INDEX.description)}
              className={cn(HEADER_CELL, 'text-start')}
            >
              <div className={DESCRIPTION_TRACKS}>
                <span>{t('transactions.column.description')}</span>
                <span className="hidden lg:block">
                  {t('transactions.field.category')}
                </span>
                <span className="hidden lg:block">
                  {t('transactions.field.account')}
                </span>
              </div>
            </th>
            <th
              {...headerCellProps(COLUMN_INDEX.amount)}
              className={cn(HEADER_CELL, 'text-end')}
            >
              {t('transactions.field.amount')}
            </th>
            <th
              {...headerCellProps(COLUMN_INDEX.actions)}
              className={cn(HEADER_CELL, 'text-center')}
            >
              <span className="sr-only">
                {t('transactions.column.actions')}
              </span>
            </th>
          </tr>
        </thead>

        <tbody>
          {paddingTop > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={COLUMN_COUNT} style={{ height: paddingTop }} />
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
            const opensDay = grouping.startsDay[item.index] === true
            return (
              <Fragment key={row.id}>
                {opensDay ? (
                  <DayHeading
                    label={formatCalendarDate(locale, row.bookedOn, 'long')}
                    netMinor={grouping.netByDay.get(row.bookedOn) ?? null}
                    currencyCode={reference.baseCurrencyCode}
                    netLabel={t('transactions.day.net')}
                  />
                ) : null}
                <TransactionRow
                  row={row}
                  rowIndex={gridRow}
                  ariaRowIndex={item.index + 2}
                  isSelected={selectedIds.has(row.id)}
                  activeColumn={active.row === gridRow ? active.column : null}
                  isMenuOpen={openMenuId === row.id}
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
              </Fragment>
            )
          })}

          {paddingBottom > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={COLUMN_COUNT} style={{ height: paddingBottom }} />
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
