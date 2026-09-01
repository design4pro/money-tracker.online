import {
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
  HEADER_ROW,
  ROW_HEIGHT_PX,
  groupByDay,
  nextPosition,
  samePosition,
} from './grid-model'
import { TransactionRow } from './transaction-row'
import { nameIndex } from './types'

import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
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

const HEADER_CELL =
  'sticky top-9 z-nav bg-surface-sunken px-2 py-2 text-micro font-semibold tracking-label uppercase text-ink-2 outline-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2'

function positionKey(position: CellPosition): string {
  return `${position.row}:${position.column}`
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

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT_PX,
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
  const grouping = useMemo(
    () => groupByDay({ rows, sort, hasMore }),
    [rows, sort, hasMore],
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

  const topRow = rows.at(virtualItems.at(0)?.index ?? 0)
  const contextDay = topRow === undefined ? null : topRow.bookedOn
  const contextNet =
    contextDay === null ? undefined : grouping.netByDay.get(contextDay)

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
      {/*
        The running context: which day the reader is inside, and that day's net once every row of
        it has arrived. Decorative — the date is spoken on every row and the totals under the list
        are the authority — so it is hidden from assistive technology rather than repeated to it.
      */}
      <div
        aria-hidden="true"
        className="sticky top-0 z-nav flex h-9 items-center justify-between gap-3 border-b border-border-subtle bg-canvas/95 px-2 text-caption text-ink-2 backdrop-blur-sm"
      >
        <span className="truncate font-medium text-ink">
          {contextDay === null
            ? ''
            : formatCalendarDate(locale, contextDay, 'long')}
        </span>
        {contextNet === undefined ? null : (
          <span className="flex shrink-0 items-center gap-1.5">
            <span>{t('transactions.day.net')}</span>
            <NetAmount
              amountMinor={contextNet}
              currencyCode={reference.baseCurrencyCode}
              className="text-caption"
            />
          </span>
        )}
      </div>

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
        <colgroup>
          <col className="w-10 sm:w-12" />
          <col className="w-11 sm:w-16" />
          <col />
          <col className="w-26 sm:w-36" />
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
                {t('transactions.field.date')}
              </Button>
            </th>
            <th
              {...headerCellProps(COLUMN_INDEX.description)}
              className={cn(HEADER_CELL, 'text-start')}
            >
              {t('transactions.column.description')}
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
            return (
              <TransactionRow
                key={row.id}
                row={row}
                rowIndex={gridRow}
                ariaRowIndex={item.index + 2}
                isSelected={selectedIds.has(row.id)}
                activeColumn={active.row === gridRow ? active.column : null}
                isMenuOpen={openMenuId === row.id}
                startsDay={grouping.startsDay[item.index] === true}
                showDate={
                  sort.field !== 'bookedOn' ||
                  grouping.startsDay[item.index] === true
                }
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
