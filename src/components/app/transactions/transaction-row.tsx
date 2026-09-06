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
  Popover,
} from '#/components/ui'
import { paintFor } from '#/components/app/categories'
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
 * date, the payee or note, the category and the account, and the amount end-aligned in one of the
 * reserved hues with the base-currency equivalent beneath it when the two currencies differ.
 *
 * Below `lg` the category and the account are a second line under the title. From `lg` up they are
 * two proportional tracks of a CSS grid inside the same cell, so they line up down the page under
 * their own headings — see {@link DESCRIPTION_TRACKS}.
 *
 * ## Nothing may leave its column
 *
 * The table is `table-fixed`, which fixes the *track* widths but does nothing about content that is
 * wider than its track: an unbreakable ten-character date in a 44px cell simply paints over the
 * title beside it, with no gutter and no clipping. Every text node in this row is therefore either
 * `truncate`d or short by construction, and the date column is sized for the string it actually
 * holds at each breakpoint rather than for the shortest one.
 *
 * ## One centreline
 *
 * Every cell — the date, the title, the amount, the checkbox and the overflow trigger — is
 * `vertical-align: middle` in a 56px band. Type and targets therefore share one centreline, which
 * is the thing a ledger is scanned along: an amount and the button that acts on it are no longer
 * ten pixels apart vertically. From `lg` up all the type in the row is a single 20px line, so a
 * common centre is also a common baseline. See {@link CELL_TEXT} for what this replaced and why.
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

/**
 * The description cell's internal tracks, shared with its column heading so the two agree.
 *
 * Above `lg` a 1440px ledger has some 850px between the description and the amount, and spending it
 * on nothing while the category is squeezed into a 12px subtitle is the widest column in the table
 * doing the least work. These three tracks are a *drawing*, not a change to the grid: the DOM is
 * still one `gridcell`, so `aria-colcount`, the roving tab stop and the server-rendered markup are
 * untouched by it.
 *
 * It goes on a wrapper **inside** the cell, never on the `<td>` or `<th>` itself. `display: grid`
 * on a table cell stops it being a table cell: the browser wraps it in an anonymous one, the real
 * box no longer stretches to the row's height, and its background stops short — which paints a bare
 * strip of canvas straight across the middle of the column headings.
 *
 * ## Why three fractions and not one fraction plus two fixed tracks
 *
 * They were `minmax(0,1fr)` then two 180px tracks. Fixed tracks do not share: at 1440px every pixel
 * of surplus went to the description — some 600px to hold the word "Uber" — while the category, the
 * column actually carrying meaning, truncated at 180px. At 1024px the arithmetic went the other way
 * and the two fixed tracks left the description barely any width at all. Fractions with a `minmax(0,…)`
 * floor make the split proportional at every width instead: the description keeps half again what
 * either of the others gets, and surplus is divided rather than dumped. At 1440px that is roughly
 * 325 / 215 / 215 where it was 600 / 180 / 180.
 */
export const DESCRIPTION_TRACKS =
  'block lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-baseline lg:gap-x-4'

/**
 * `scroll-mt-9` is WCAG 2.2 §2.4.11 for this grid specifically.
 *
 * `<html>` reserves `scroll-pt-16` for the app header, which is all the header needs — but the
 * ledger stacks its own 36px column headings beneath it. Arrowing down the grid calls `focus()` on
 * a cell, and the browser scrolls it only clear of the scrollport's own padding, so without these
 * extra 36px the focused cell — ring and all — comes to rest underneath the headings.
 */
const CELL_BASE =
  'scroll-mt-9 px-2 outline-focus data-[active]:relative focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2'

/**
 * A text cell, centred in the row's band.
 *
 * It used to be `align-baseline pt-3` against a 72px row, which put the type in the top 40% of the
 * band with 30px of nothing under it — and left an amount and its own overflow button, which is a
 * centred target, on two different centrelines about 10px apart. Every cell in the row is now
 * centred on the one line, so the amount, its kebab, its checkbox and its date agree.
 *
 * The shared-baseline promise the row was built on is kept where it is visible: from `lg` up the
 * description's three tracks are single lines of the same 20px leading as the date and the amount,
 * so centring them in a common band puts them on a common baseline. Below `lg` the description is
 * two lines and the date centres against the pair rather than hanging off the title's baseline,
 * which is the better of the two readings once the band is only 56px tall.
 */
const CELL_TEXT = 'align-middle'

/** A cell holding a target rather than type. */
const CELL_TARGET = 'align-middle'

/** U+2014. Stands in for a date or a category a row does not have, so no cell is ever blank. */
const EM_DASH = '—'

/** `YYYY-MM-DD`, which is the only shape `bookedOn` is ever written in. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

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

/** The category's own colour, as a dot beside its name — never instead of it. */
function CategoryMark({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full border border-border-subtle"
      style={{
        backgroundColor: color === null ? 'transparent' : paintFor(color),
      }}
    />
  )
}

/** What is unusual about a row, in words. */
function RowFlags({
  isPlanned,
  isBalanceAdjustment,
  excludeFromStats,
}: Pick<LedgerRow, 'isPlanned' | 'isBalanceAdjustment' | 'excludeFromStats'>) {
  const t = useTranslate()
  return (
    <>
      {isPlanned ? (
        <Badge tone="info" size="sm">
          {t('transactions.planned')}
        </Badge>
      ) : null}
      {isBalanceAdjustment ? (
        <Badge tone="warning" size="sm">
          {t('transactions.balanceAdjustment')}
        </Badge>
      ) : null}
      {excludeFromStats ? (
        <Badge tone="neutral" size="sm">
          {t('transactions.excludedFromTotals')}
        </Badge>
      ) : null}
    </>
  )
}

function TransactionRowImpl({
  row,
  rowIndex,
  ariaRowIndex,
  isSelected,
  activeColumn,
  isMenuOpen,
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

  // A row with no usable booking date is not a state the schema allows, and the cell still gets a
  // mark rather than a hole: a column that goes blank on one row out of twelve reads as a rendering
  // fault, and a reader cannot tell it from "this one has no date".
  const hasDate = CALENDAR_DATE.test(row.bookedOn)
  const dateLong = hasDate
    ? formatCalendarDate(locale, row.bookedOn, 'long')
    : t('common.unknown')
  const dateShort = hasDate
    ? formatCalendarDate(locale, row.bookedOn, 'short')
    : EM_DASH
  const dateDay = hasDate
    ? formatCalendarDate(locale, row.bookedOn, 'day')
    : EM_DASH

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
        'border-t border-t-border-subtle bg-surface text-ink transition-[background-color] duration-fast',
        'hover:bg-hover',
        isSelected &&
          'bg-brand-soft shadow-[inset_0_0_0_1px_var(--color-brand)] hover:bg-brand-soft',
      )}
    >
      {/* ---- Selection ---------------------------------------------------- */}
      <td
        {...cellProps(COLUMN_INDEX.select)}
        className={cn(CELL_BASE, CELL_TARGET, 'text-center')}
      >
        <Checkbox
          excludeFromTabOrder
          // `target-min` rather than the primitive's `target-min-h`: a checkbox with no visible
          // label is only as wide as its 18px box, and the select column's content box is 24px.
          // The height was already 44; this is the axis that was not.
          className="target-min"
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
        className={cn(CELL_BASE, CELL_TEXT, 'text-start text-ink-2')}
      >
        {/*
          One date, drawn two ways. Below `sm` there is no column wide enough for `31.12.2025`
          without it spilling over the title, and none is needed: the day heading above the group
          has just named the month and the year, so the day of the month alone is unambiguous.
        */}
        <span
          aria-hidden="true"
          className="block truncate text-caption leading-5 tabular"
        >
          <span className="sm:hidden">{dateDay}</span>
          <span className="hidden sm:inline">{dateShort}</span>
        </span>
        {/* The date is spoken in full on every row: a listener has no day heading above them to
            carry the context forward. */}
        <span className="sr-only">{dateLong}</span>
      </td>

      {/* ---- Description, category and account ----------------------------- */}
      <td
        {...cellProps(COLUMN_INDEX.description)}
        className={cn(CELL_BASE, CELL_TEXT, 'min-w-0')}
      >
        <div className={cn('min-w-0', DESCRIPTION_TRACKS)}>
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
            className="block truncate text-label leading-5 font-medium text-ink no-underline hover:underline"
          >
            {title}
          </a>

          {/* Below `lg`: one meta line under the title. Exactly one of these two subtrees is ever
            displayed, so neither the reader nor a screen reader sees the pair. */}
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-caption text-ink-2 lg:hidden">
            {categoryName === null ? null : (
              <>
                <CategoryMark color={categoryColor} />
                <span className="truncate">{categoryName}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span className="truncate">{accountName}</span>
            <RowFlags
              isPlanned={row.isPlanned}
              isBalanceAdjustment={row.isBalanceAdjustment}
              excludeFromStats={row.excludeFromStats}
            />
          </span>

          {/* From `lg` up: two tracks of their own, under their own headings. */}
          <span className="hidden min-w-0 items-center gap-1.5 text-caption leading-5 text-ink-2 lg:flex">
            {categoryName === null ? (
              <span aria-hidden="true">{EM_DASH}</span>
            ) : (
              <>
                <CategoryMark color={categoryColor} />
                <span className="truncate">{categoryName}</span>
              </>
            )}
          </span>
          <span className="hidden min-w-0 items-center gap-1.5 text-caption leading-5 text-ink-2 lg:flex">
            <span className="truncate">{accountName}</span>
            <RowFlags
              isPlanned={row.isPlanned}
              isBalanceAdjustment={row.isBalanceAdjustment}
              excludeFromStats={row.excludeFromStats}
            />
          </span>
        </div>
      </td>

      {/* ---- Amount -------------------------------------------------------- */}
      <td
        {...cellProps(COLUMN_INDEX.amount)}
        className={cn(CELL_BASE, CELL_TEXT, 'text-end')}
      >
        <AmountText
          amountMinor={row.amountMinor}
          currencyCode={row.currencyCode}
          direction={row.direction}
          isPlanned={row.isPlanned}
          transferKind={row.transferKind}
          className="text-label leading-5"
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
        className={cn(CELL_BASE, CELL_TARGET, 'text-center')}
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
          {/*
            React Aria renders a `MenuTrigger`'s overlay only through a `Popover`; `Menu`'s own
            docblock says so. Without one the menu is not "closed", it is simply always in the
            document — nineteen open menus and seventy-six menu items on a full ledger, each a
            tab stop the grid promises it does not have.
          */}
          <Popover placement="bottom end">
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
          </Popover>
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
