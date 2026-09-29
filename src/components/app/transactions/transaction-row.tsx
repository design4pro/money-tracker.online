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
  rowWash,
  rowWashSecondary,
} from '#/components/ui'
import { paintFor } from '#/components/app/categories'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, money } from '#/lib/money'

import { AmountText, BalanceAmount, ConvertedAmount } from './amount-text'
import { columnIndexFor, rowHeightFor } from './grid-model'
import { TYPED_LINE } from './typed-line'

import type { KeyboardEvent, MouseEvent } from 'react'
import type { LedgerColumn } from './grid-model'
import type { LedgerRow } from './types'

/**
 * One line of the passbook.
 *
 * ## Shape
 *
 * `DESIGN.md`'s typed line, rendered as a real `<tr>` inside a `role="grid"` table. From `lg` up
 * an entry is one rule of the form: the date, the payee or note with the category (and the
 * account, where the book has more than one) on tracks beside it, the amount end-aligned in one
 * of the reserved hues, and in the passbook of one account the balance after the line behind the
 * spine. A foreign-currency entry takes a second rule for the converted figure under the amount.
 *
 * Below `lg` the category and the account drop under the title, so every entry is two rules.
 * Below `sm` the `<tr>` becomes a grid (see {@link ROW}): the title over the date and the category
 * on the left, the amount over the balance on the right, the checkbox and the overflow trigger as
 * side tracks spanning both rules. Every cell keeps its ARIA role, so the table is a table at every
 * width, and every cell keeps a box of its own, so the roving tab stop always has somewhere visible
 * to land.
 *
 * ## On the pitch
 *
 * The page is ruled at 2.5rem. A cell has no vertical padding, its rule is an inset shadow on its
 * last pixel row, and every line of type in it is a {@link TYPED_LINE}: a 2.5rem box painted so the
 * baseline sits three pixels above the rule. The translate is on a span *inside* the link, never on
 * the link itself, because a transform moves hit-testing too and a link painted 13px lower would
 * catch taps meant for the line under it.
 *
 * ## Nothing may leave its column
 *
 * The table is `table-fixed`, which fixes the track widths but does nothing about content wider
 * than its track. Every text node in this row is therefore either `truncate`d or short by
 * construction.
 *
 * ## Why every prop is a scalar
 *
 * The list virtualises ten thousand rows and re-renders on every scroll frame, so this component is
 * `memo`ised - and a memo is defeated by exactly one thing: an object prop rebuilt on each render
 * of the parent. Names arrive as strings rather than as a `labels` object and callbacks arrive as
 * one stable `actions` bundle the parent holds in a ref-stable `useMemo`.
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
  /** The book's columns; a reference-stable constant from `columnsFor`. */
  readonly columns: ReadonlyArray<LedgerColumn>
  /** Whether the list is grouped by day, so the row prints only the day of the month. */
  readonly isGrouped: boolean
  /** Whether the account is worth naming: false when every row in the book is the same one. */
  readonly showAccount: boolean
  /** Whether the row is set on a wide page - from `lg` - and so one rule tall. */
  readonly isWide: boolean
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
 * The description cell's internal tracks from `lg` up, shared with its column heading so the two
 * agree. Three where the account is named, two where it is not. They are a *drawing*, not a change
 * to the grid: the DOM is still one `gridcell`, so `aria-colcount` and the roving tab stop are
 * untouched. They go on a wrapper **inside** the cell, never on the `<td>` itself: `display: grid`
 * on a table cell stops it being one.
 */
export function descriptionTracks(showAccount: boolean): string {
  return showAccount
    ? 'block lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-4'
    : 'block lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-x-4'
}

/**
 * The row below `sm`: a grid of two rules, a 2.5rem track for the checkbox, the entry, its
 * figures sized to themselves, and a 2.75rem track for the overflow trigger. The row draws the
 * rule under both lines there, since its cells draw none.
 */
const ROW =
  'max-sm:grid max-sm:grid-cols-[2.5rem_minmax(0,1fr)_auto_2.75rem] max-sm:grid-rows-[2.5rem_2.5rem] max-sm:shadow-[inset_0_-1px_0_0_var(--color-border-subtle)]'

/** Where each cell lands in that grid. */
const AT_SELECT = 'max-sm:col-start-1 max-sm:row-start-1 max-sm:row-span-2'
const AT_TITLE = 'max-sm:col-start-2 max-sm:row-start-1'
const AT_META = 'max-sm:col-start-2 max-sm:row-start-2'
const AT_AMOUNT = 'max-sm:col-start-3 max-sm:row-start-1'
const AT_BALANCE = 'max-sm:col-start-3 max-sm:row-start-2'
const AT_ACTIONS = 'max-sm:col-start-4 max-sm:row-start-1 max-sm:row-span-2'

/**
 * `scroll-mt-10` is WCAG 2.2 §2.4.11 for this grid specifically: `<html>` reserves scroll padding
 * for the app header, and the ledger pins its own 2.5rem column headings beneath it. Arrowing down
 * the grid calls `focus()` on a cell, and without these extra 40px the focused cell comes to rest
 * underneath the headings.
 *
 * A cell has no vertical padding - the row is exactly as tall as its rules - and from `sm` up
 * draws its own rule as an inset shadow on its last pixel row, which adds no height of its own.
 */
export const CELL_BASE =
  'scroll-mt-10 px-2 py-0 align-top outline-focus data-[active]:relative focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 sm:px-3 sm:shadow-[inset_0_-1px_0_0_var(--color-border-subtle)]'

/** The vertical rule in front of a cell. Every cell but the first has one. */
export const CELL_RULE = 'sm:border-s sm:border-border-subtle'

/** The spine: the one heavier vertical rule, in front of the balance column. It is neutral. */
export const CELL_SPINE = 'sm:border-s-2 sm:border-border-panel'

/** A cell holding a target rather than type: the target centred on the first rule. */
const TARGET_LINE = 'flex h-10 items-center justify-center max-sm:h-full'

/** The meta line: the secondary facts of an entry, typed in pencil on one truncating line. */
const META_LINE = cn(
  'text-caption',
  rowWashSecondary,
  TYPED_LINE,
  // After the typed line, whose `block` this replaces; the line-height it set stays.
  'flex min-w-0 items-center gap-1.5 overflow-hidden',
)

/** U+2014. Stands in for a category a row does not have, so no track is ever blank. */
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

/** The category's own colour, as a dot beside its name - never instead of it. */
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

function Dot() {
  return <span aria-hidden="true">·</span>
}

interface MetaProps {
  readonly row: LedgerRow
  readonly categoryName: string | null
  readonly categoryColor: string | null
  readonly accountName: string
  readonly showAccount: boolean
}

/**
 * The category, typed in pencil with the word `Planned` before it where the line is not booked
 * yet: a line that has to lose its end loses the category's tail and never the status.
 */
function CategoryFacts({
  row,
  categoryName,
  categoryColor,
}: Pick<MetaProps, 'row' | 'categoryName' | 'categoryColor'>) {
  const t = useTranslate()
  return (
    <>
      {row.isPlanned ? (
        <>
          <span className="shrink-0">{t('transactions.planned')}</span>
          <Dot />
        </>
      ) : null}
      {categoryName === null ? (
        <span aria-hidden="true">{EM_DASH}</span>
      ) : (
        <>
          <CategoryMark color={categoryColor} />
          <span className="truncate">{categoryName}</span>
        </>
      )}
    </>
  )
}

/**
 * The account, where the book names it, and what is unusual about the row, in words.
 *
 * `afterDot` is the shared-line case, where the account follows the category: it takes what is
 * left of the line and gives way first, dot included, since it is the same on most lines and the
 * category is not.
 */
function AccountFacts({
  row,
  accountName,
  showAccount,
  afterDot = false,
}: Pick<MetaProps, 'row' | 'accountName' | 'showAccount'> & {
  readonly afterDot?: boolean
}) {
  const t = useTranslate()
  return (
    <>
      {showAccount ? (
        <span className={cn('truncate', afterDot && 'min-w-0 flex-1')}>
          {afterDot ? (
            <>
              <Dot />{' '}
            </>
          ) : null}
          {accountName}
        </span>
      ) : null}
      {/* A mark sits on the line it covers: `-top-px` puts the `sm` word within 0.25px of the
          caption's baseline on the typed line (measured; `-top-0.5` was derived for the box). */}
      {row.isBalanceAdjustment ? (
        <Badge tone="warning" size="sm" className="relative -top-px">
          {t('transactions.balanceAdjustment')}
        </Badge>
      ) : null}
      {row.excludeFromStats ? (
        <Badge tone="neutral" size="sm" className="relative -top-px">
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
  columns,
  isGrouped,
  showAccount,
  isWide,
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
  const column = columnIndexFor(columns)
  const hasBalance = column.balance !== -1

  // A row with no usable booking date is not a state the schema allows, and the cell still gets a
  // mark rather than a hole: a column that goes blank on one row out of twelve reads as a rendering
  // fault, and a reader cannot tell it from "this one has no date".
  const hasDate = CALENDAR_DATE.test(row.bookedOn)
  const dateLong = hasDate
    ? formatCalendarDate(locale, row.bookedOn, 'long')
    : t('common.unknown')
  const dateMedium = hasDate
    ? formatCalendarDate(locale, row.bookedOn, 'medium')
    : EM_DASH
  // Under a day heading the month and the year are already named, so the row prints the day of
  // the month alone; under any other sort there is no heading to carry them and it prints the date.
  const dateInColumn =
    hasDate && isGrouped
      ? formatCalendarDate(locale, row.bookedOn, 'day')
      : dateMedium

  const title = payeeName ?? row.note ?? t('common.unknown')
  const spokenAmount = formatMoney(
    locale,
    money(row.amountMinor, row.currencyCode),
    {
      display: 'name',
    },
  )
  const facts = { row, categoryName, categoryColor, accountName, showAccount }

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
      style={{ height: rowHeightFor(row, isWide) }}
      className={cn(
        ROW,
        'bg-surface text-ink',
        rowWash,
        isSelected &&
          'bg-brand-soft shadow-[inset_0_0_0_1px_var(--color-brand)] hover:bg-brand-soft',
      )}
    >
      {/* ---- Selection ---------------------------------------------------- */}
      <td
        {...cellProps(column.select)}
        className={cn(CELL_BASE, AT_SELECT, 'text-center')}
      >
        <span className={TARGET_LINE}>
          <Checkbox
            excludeFromTabOrder
            // `target-min` rather than the primitive's `target-min-h`: a checkbox with no visible
            // label is only as wide as its 18px box, and the select column's content box is 24px.
            className="target-min"
            isSelected={isSelected}
            onChange={() => actions.onToggleSelect(row.id)}
            aria-label={t('transactions.row.select', {
              amount: spokenAmount,
              date: dateLong,
            })}
          />
        </span>
      </td>

      {/* ---- Date --------------------------------------------------------- */}
      <td
        {...cellProps(column.date)}
        className={cn(
          CELL_BASE,
          CELL_RULE,
          AT_META,
          'text-start',
          rowWashSecondary,
        )}
      >
        {/* From `sm` up the column holds the date. The date is spoken in full on every row: a
            listener has no day heading above them to carry the context forward. */}
        <span
          aria-hidden="true"
          className={cn(
            'truncate text-caption tabular max-sm:hidden',
            TYPED_LINE,
          )}
        >
          {dateInColumn}
        </span>
        <span className="sr-only">{dateLong}</span>
        {/* Below `sm` the column is gone and this cell is the entry's second line: the category
            and the account, with the date typed in front of them only where no day heading names
            it. `hidden` is `display: none`, so only one of the two readings of this cell ever
            reaches the accessibility tree. */}
        <span className={cn(META_LINE, 'sm:hidden')}>
          {isGrouped ? null : (
            <>
              <span aria-hidden="true" className="shrink-0 tabular">
                {dateMedium}
              </span>
              <Dot />
            </>
          )}
          <CategoryFacts {...facts} />
          <AccountFacts {...facts} afterDot />
        </span>
      </td>

      {/* ---- Description, category and account ----------------------------- */}
      <td
        {...cellProps(column.description)}
        className={cn(CELL_BASE, CELL_RULE, AT_TITLE, 'min-w-0')}
      >
        <div className={cn('min-w-0', descriptionTracks(showAccount))}>
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
            // The row's one tap path: a 44px box around the 40px line, the extra 4px given back by
            // the negative margins so nothing moves. `relative` keeps it above the static text of
            // the line under it. The typed line is the span inside, so the box stays on its rule.
            className="relative -my-0.5 block min-w-0 overflow-hidden py-0.5 no-underline hover:underline"
          >
            <span
              className={cn(
                'truncate text-label font-medium',
                row.isPlanned ? rowWashSecondary : 'text-ink',
                TYPED_LINE,
              )}
            >
              {title}
            </span>
          </a>

          {/* Between `sm` and `lg`: one meta line under the title. Exactly one of the three
              readings of the meta facts is ever displayed, so no reader sees them twice. */}
          <span className={cn(META_LINE, 'max-sm:hidden lg:hidden')}>
            <CategoryFacts {...facts} />
            <AccountFacts {...facts} afterDot />
          </span>

          {/* From `lg` up: tracks of their own, under their own headings. */}
          <span className={cn(META_LINE, 'hidden lg:flex')}>
            <CategoryFacts {...facts} />
            {showAccount ? null : <AccountFacts {...facts} />}
          </span>
          {showAccount ? (
            <span className={cn(META_LINE, 'hidden lg:flex')}>
              <AccountFacts {...facts} />
            </span>
          ) : null}
        </div>
      </td>

      {/* ---- Amount -------------------------------------------------------- */}
      <td
        {...cellProps(column.amount)}
        className={cn(
          CELL_BASE,
          CELL_RULE,
          AT_AMOUNT,
          'text-end',
          // With no balance under it the cell keeps both phone lines, so a converted figure
          // takes the second rather than widening the column at the title's expense.
          hasBalance ? null : 'max-sm:row-span-2',
        )}
      >
        <span className={cn('text-label', TYPED_LINE)}>
          {/* The amount is an inline-flex box; top-aligned it shares the line's own baseline
              rather than lending the transfer glyph's bottom edge as one. */}
          <AmountText
            amountMinor={row.amountMinor}
            currencyCode={row.currencyCode}
            direction={row.direction}
            isPlanned={row.isPlanned}
            transferKind={row.transferKind}
            className="align-top"
          />
          {/* The base-currency figure on the rule under the amount where the row has one to
              spare. On a phone passbook that rule belongs to the balance and the figure is left to
              the entry's own page: beside the amount it took the title's room instead. */}
          {row.currencyCode === row.refCurrencyCode ? null : (
            <ConvertedAmount
              refAmountMinor={row.refAmountMinor}
              refCurrencyCode={row.refCurrencyCode}
              className={cn('leading-10', hasBalance && 'max-sm:hidden')}
            />
          )}
        </span>
      </td>

      {/* ---- Balance after, behind the spine ------------------------------ */}
      {hasBalance ? (
        <td
          {...cellProps(column.balance)}
          className={cn(CELL_BASE, CELL_SPINE, AT_BALANCE, 'text-end')}
        >
          {row.balanceAfterMinor === undefined ? null : (
            <span className={cn('text-label', TYPED_LINE)}>
              <BalanceAmount
                amountMinor={row.balanceAfterMinor}
                currencyCode={row.currencyCode}
                isPlanned={row.isPlanned}
              />
            </span>
          )}
        </td>
      ) : null}

      {/* ---- Actions ------------------------------------------------------- */}
      <td
        {...cellProps(column.actions)}
        className={cn(CELL_BASE, CELL_RULE, AT_ACTIONS, 'text-center')}
      >
        <span className={TARGET_LINE}>
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
              document - nineteen open menus and seventy-six menu items on a full ledger, each a
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
        </span>
      </td>
    </tr>
  )
}

export const TransactionRow = memo(TransactionRowImpl)

/** Exported for the grid's key handler, which needs the same notion of "a plain press". */
export function isUnmodified(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey
}
