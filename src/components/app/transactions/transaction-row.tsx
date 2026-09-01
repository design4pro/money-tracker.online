import { memo } from 'react'
import {
  Copy,
  MoreHorizontal,
  Pencil,
  SquareArrowOutUpRight,
  Trash2,
} from 'lucide-react'

import {
  Badge,
  Button,
  Checkbox,
  Menu,
  MenuItem,
  MenuTrigger,
} from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, money } from '#/lib/money'

import { AmountText, ConvertedAmount } from './amount-text'
import { COLUMN_INDEX, ROW_HEIGHT_PX } from './grid-model'

import type { KeyboardEvent, MouseEvent } from 'react'
import type { LedgerRow } from './types'

/**
 * One line of the ledger.
 *
 * ## Shape
 *
 * `DESIGN.md`'s signature component, rendered as a real `<tr>` inside a `role="grid"` table: the
 * payee or note on line one, the category chip and the account on line two, the amount end-aligned
 * in one of the reserved hues with the base-currency equivalent beneath it when the two currencies
 * differ.
 *
 * ## Why every prop is a scalar
 *
 * The list virtualises ten thousand rows and re-renders on every scroll frame, so this component is
 * `memo`ised — and a memo is defeated by exactly one thing: an object prop rebuilt on each render
 * of the parent. Names arrive as strings rather than as a `labels` object and callbacks arrive as
 * one stable `actions` bundle the parent holds in a ref-stable `useMemo`. The prop list is long on
 * purpose; the alternative is a list that repaints every row when one row's selection changes.
 *
 * ## Row actions are never hover-only
 *
 * The overflow trigger is always painted, at a 44px hit area, and the surrounding grid binds `e`,
 * `d` and `Delete` on any cell of the row. A menu that appears on `:hover` does not exist for a
 * keyboard, for a screen reader, or on a touch screen.
 */

/** What a row can ask the surface to do. One object, held stable by the list. */
export interface TransactionRowActions {
  readonly onToggleSelect: (id: string) => void
  readonly onOpen: (id: string) => void
  readonly onEdit: (id: string) => void
  readonly onDuplicate: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly onMenuOpenChange: (id: string, isOpen: boolean) => void
  /** The address of the detail screen, so the row is a real link a reader can open in a tab. */
  readonly hrefFor: (id: string) => string
}

export interface TransactionRowProps {
  readonly row: LedgerRow
  /** Position among the rows loaded so far. */
  readonly rowIndex: number
  /** Position in the **whole** filtered set, one-based, header row included. */
  readonly ariaRowIndex: number
  readonly isSelected: boolean
  /** The column holding the grid's single tab stop, or `null` when it is elsewhere. */
  readonly activeColumn: number | null
  readonly isMenuOpen: boolean
  /** Draw the day rule above this row and print its date. */
  readonly startsDay: boolean
  /** Print the date in the date cell — off for the rows under a day heading. */
  readonly showDate: boolean
  readonly accountName: string
  readonly categoryName: string | null
  readonly categoryColor: string | null
  readonly payeeName: string | null
  readonly registerCell: (
    rowIndex: number,
    columnIndex: number,
    element: HTMLElement | null,
  ) => void
  readonly onCellFocus: (rowIndex: number, columnIndex: number) => void
  readonly actions: TransactionRowActions
}

const CELL_BASE =
  'px-2 align-middle outline-focus data-[active]:relative focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2'

/** A left click with no modifier is ours to intercept; anything else belongs to the browser. */
function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

function TransactionRowImpl({
  row,
  rowIndex,
  ariaRowIndex,
  isSelected,
  activeColumn,
  isMenuOpen,
  startsDay,
  showDate,
  accountName,
  categoryName,
  categoryColor,
  payeeName,
  registerCell,
  onCellFocus,
  actions,
}: TransactionRowProps) {
  const t = useTranslate()
  const locale = useLocale()

  const dateLong = formatCalendarDate(locale, row.bookedOn, 'long')
  const day = formatCalendarDate(locale, row.bookedOn, 'short')
  const title = payeeName ?? row.note ?? t('common.unknown')
  const spokenAmount = formatMoney(
    locale,
    money(row.amountMinor, row.currencyCode),
    {
      display: 'name',
    },
  )

  const cellProps = (columnIndex: number) => ({
    role: 'gridcell' as const,
    'aria-colindex': columnIndex + 1,
    'data-grid-cell': 'true',
    tabIndex: activeColumn === columnIndex ? 0 : -1,
    ref: (element: HTMLTableCellElement | null) =>
      registerCell(rowIndex, columnIndex, element),
    onFocus: () => onCellFocus(rowIndex, columnIndex),
  })

  return (
    <tr
      role="row"
      aria-rowindex={ariaRowIndex}
      aria-selected={isSelected}
      style={{ height: ROW_HEIGHT_PX }}
      className={cn(
        'bg-surface text-ink transition-[background-color] duration-fast',
        'hover:bg-hover',
        startsDay
          ? 'border-t-2 border-t-border-strong/45'
          : 'border-t border-t-border-subtle',
        isSelected &&
          'bg-brand-soft shadow-[inset_3px_0_0_0_var(--color-brand)] hover:bg-brand-soft',
      )}
    >
      {/* ---- Selection ---------------------------------------------------- */}
      <td
        {...cellProps(COLUMN_INDEX.select)}
        className={cn(CELL_BASE, 'text-center')}
      >
        <Checkbox
          excludeFromTabOrder
          isSelected={isSelected}
          onChange={() => actions.onToggleSelect(row.id)}
          aria-label={t('transactions.row.select', {
            amount: spokenAmount,
            date: dateLong,
          })}
        />
      </td>

      {/* ---- Date --------------------------------------------------------- */}
      <td
        {...cellProps(COLUMN_INDEX.date)}
        className={cn(CELL_BASE, 'text-start text-ink-2')}
      >
        {showDate ? (
          <span
            aria-hidden="true"
            className="block text-caption tabular leading-tight"
          >
            {day}
          </span>
        ) : null}
        {/* The date is spoken on every row even when it is printed once per day: a listener has no
            day heading above them to carry the context forward. */}
        <span className="sr-only">{dateLong}</span>
      </td>

      {/* ---- Description --------------------------------------------------- */}
      <td
        {...cellProps(COLUMN_INDEX.description)}
        className={cn(CELL_BASE, 'min-w-0')}
      >
        <a
          href={actions.hrefFor(row.id)}
          tabIndex={-1}
          onClick={(event) => {
            if (!isPlainLeftClick(event)) {
              return
            }
            event.preventDefault()
            actions.onOpen(row.id)
          }}
          className="block truncate text-label font-medium text-ink no-underline hover:underline"
        >
          {title}
        </a>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption text-ink-2">
          {categoryName === null ? null : (
            <span className="inline-flex min-w-0 items-center gap-1">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full border border-border-subtle"
                style={{ backgroundColor: categoryColor ?? 'transparent' }}
              />
              <span className="truncate">{categoryName}</span>
            </span>
          )}
          {categoryName === null ? null : (
            <span aria-hidden="true" className="text-ink-2/70">
              ·
            </span>
          )}
          <span className="truncate">{accountName}</span>
          {row.isPlanned ? (
            <Badge tone="info" size="sm">
              {t('transactions.planned')}
            </Badge>
          ) : null}
          {row.isBalanceAdjustment ? (
            <Badge tone="warning" size="sm">
              {t('transactions.balanceAdjustment')}
            </Badge>
          ) : null}
          {row.excludeFromStats ? (
            <Badge tone="neutral" size="sm">
              {t('transactions.excludedFromTotals')}
            </Badge>
          ) : null}
        </span>
      </td>

      {/* ---- Amount -------------------------------------------------------- */}
      <td
        {...cellProps(COLUMN_INDEX.amount)}
        className={cn(CELL_BASE, 'text-end')}
      >
        <AmountText
          amountMinor={row.amountMinor}
          currencyCode={row.currencyCode}
          direction={row.direction}
          isPlanned={row.isPlanned}
          transferKind={row.transferKind}
          className="text-label"
        />
        {row.currencyCode === row.refCurrencyCode ? null : (
          <ConvertedAmount
            refAmountMinor={row.refAmountMinor}
            refCurrencyCode={row.refCurrencyCode}
          />
        )}
      </td>

      {/* ---- Actions ------------------------------------------------------- */}
      <td
        {...cellProps(COLUMN_INDEX.actions)}
        className={cn(CELL_BASE, 'text-center')}
      >
        <MenuTrigger
          isOpen={isMenuOpen}
          onOpenChange={(open) => actions.onMenuOpenChange(row.id, open)}
        >
          <Button
            variant="ghost"
            size="sm"
            shape="icon"
            excludeFromTabOrder
            label={t('transactions.row.actions', { name: title })}
            icon={<MoreHorizontal />}
          />
          <Menu
            onAction={(key) => {
              switch (key) {
                case 'open':
                  actions.onOpen(row.id)
                  return
                case 'edit':
                  actions.onEdit(row.id)
                  return
                case 'duplicate':
                  actions.onDuplicate(row.id)
                  return
                case 'delete':
                  actions.onDelete(row.id)
                  return
                default:
                  return
              }
            }}
          >
            <MenuItem id="open" icon={<SquareArrowOutUpRight />}>
              {t('transactions.row.open')}
            </MenuItem>
            <MenuItem id="edit" icon={<Pencil />}>
              {t('action.edit')}
            </MenuItem>
            <MenuItem id="duplicate" icon={<Copy />}>
              {t('action.duplicate')}
            </MenuItem>
            <MenuItem id="delete" isDestructive icon={<Trash2 />}>
              {t('action.delete')}
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </td>
    </tr>
  )
}

export const TransactionRow = memo(TransactionRowImpl)

/** Exported for the grid's key handler, which needs the same notion of "a plain press". */
export function isUnmodified(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey
}
