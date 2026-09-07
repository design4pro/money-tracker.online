// Module paths rather than the directory barrels: the landing page must load without the
// application's graph. See the note at the top of `src/routes/index.tsx`.
import { amountReading } from '#/components/app/money/amount-reading'
import {
  AmountText,
  ConvertedAmount,
} from '#/components/app/transactions/amount-text'
import { Badge } from '#/components/ui/badge'
import { TYPED_LINE } from '#/components/app/transactions/typed-line'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { asCurrencyCode, asMinor, formatMoney, makeMoney } from '#/lib/money'

import type {
  LedgerDirection,
  LedgerTransferKind,
} from '#/components/app/transactions'
import type { MessageKey } from '#/lib/i18n'

/**
 * A page of the passbook, on the landing page a visitor sees before they have one.
 *
 * The landing page's whole argument is that the arithmetic is right, and the only honest way to
 * make that argument is to run it. So this is not a picture of the product: it is
 * {@link AmountText} and {@link ConvertedAmount}, the same components the signed-in ledger uses,
 * handed static props. Every rule they carry comes with them - the U+2212 minus, the four tones
 * with weight and glyph doing the work colour cannot, and the `sr-only` sentence that names the
 * currency in full.
 *
 * ## Why every line ends in a balance
 *
 * A passbook is read line by line, and after every line it says what is left. That column is the
 * spine of this table - the heavier rule before it and the bold figures in it are the form's own
 * emphasis - and the rows run oldest first, because a balance that is carried forward only makes
 * sense read downwards. The balances are literals, not sums: the component's contract everywhere
 * in the product is that the caller has already done the arithmetic in minor units and the
 * component only draws it, and a marketing page gets no exemption from that.
 *
 * ## The two ends of the page
 *
 * A page of a passbook opens on what came over from the last page and closes on what goes to the
 * next, so the table does both. The opening line carries February's balance in. The closing line
 * carries the last balance out, under the heavier rule that is the foot of the form - the same
 * rule the column headings sit on - and it reads that balance from the last row rather than typing
 * it a second time, so the two cannot disagree. Here the last line is planned, so what goes to
 * April is written in pencil like the line that produced it: the figure that will be carried, not
 * yet the one that was.
 *
 * ## Typed on the form, not on a card
 *
 * There is no box around this table. The page beneath it is ruled at 2.5rem, every line of type in
 * it is a 2.5rem box ({@link TYPED_LINE}), and each cell draws the rule under itself on the same
 * pixel row the printed ruling already occupies - so the two are one ruling where the paper's
 * rule is visible, and the table keeps its rules where the paper's is faint. A row is therefore
 * always a whole number of rules tall: one for an entry, its category typed after the payee on the
 * same line and a converted figure typed beside the amount on it.
 *
 * ## The narrow page
 *
 * Below `sm` there is no room for four columns, and a column a hundred pixels wide turns every
 * entry into a stack of single words. So the same rows are set the way a pocket passbook sets
 * them: two full-width lines per entry, the payee and the amount on the first, the date, the
 * category and the balance on the second, each line one rule, with no column rules of its own.
 * That is the `<tr>` as a two-column grid with its cells placed in it. A table part whose display
 * is not a table's loses its semantics in WebKit, so every part carries its ARIA role explicitly
 * and a screen reader keeps the table at every width.
 *
 * ## Pencil before ink, and one stamp
 *
 * The last entry is planned rather than booked. It is the same row in the secondary ink - pencil -
 * with the word beside its category: the two channels the ledger inside the product gives a
 * planned line. The stamp violet is spent on what is settled and never on what is not, and on
 * this page it is spent once, on the word beside the opening line: February is closed, and the
 * balance it handed over is the one figure here that nothing can move. The mark is a typed word
 * inside a one-pixel rule in the stamp ink ({@link Badge} in its `settled` tone), not a drawing of
 * a rubber stamp - the metaphor lives in rules and type - and a page that closes in pencil is not
 * stamped.
 *
 * **The rows are invented and the page says so.** `PRODUCT.md` forbids fabricating evidence, and a
 * ledger fragment with no label is exactly the kind of thing a visitor could read as somebody's
 * real account. The caption under the table names it as an example, in both locales.
 *
 * The euro row is the point of the section beneath. `refAmountMinor` is 118.42 zł because 27.40 €
 * was booked at 4.3218 on 14 March 2026 and frozen there; it is a literal here for the same
 * reason it is a stored column in the database - a figure recomputed today would be a different
 * claim - and the balance after it is the one that figure produced.
 */

interface PreviewRow {
  readonly id: string
  /** ISO calendar date. Formatted by the active locale, never concatenated. */
  readonly bookedOn: string
  readonly payee: MessageKey
  readonly category: MessageKey
  readonly amountMinor: number
  readonly currencyCode: string
  readonly direction: LedgerDirection
  readonly transferKind?: LedgerTransferKind
  /** Written in pencil: not booked yet. */
  readonly isPlanned?: boolean
  /** Set only where the row's currency is not the workspace's base. */
  readonly refAmountMinor?: number
  /** The workspace balance once this line is written, in minor units of the base currency. */
  readonly balanceAfterMinor: number
}

/** The line carried over from the previous page: a date and a balance, nothing else. */
const OPENING = { bookedOn: '2026-03-01', balanceMinor: 481260 } as const

/** The day the page closes. What it carries forward is whatever its last line left. */
const CLOSING_ON = '2026-03-31'

/**
 * The euro line, shared with the section that explains it: the amount as typed and the złoty
 * figure it was frozen at are the same literals in both places, so they cannot drift apart.
 */
export const EURO_ENTRY = {
  bookedOn: '2026-03-14',
  payee: 'marketing.ledger.row.groceries',
  amountMinor: 2740,
  currencyCode: 'EUR',
  refAmountMinor: 11842,
} as const

/** The last line on the page, named because the closing line reads its balance. */
const LAST_ROW: PreviewRow = {
  id: 'electricity',
  bookedOn: '2026-03-20',
  payee: 'marketing.ledger.row.electricity',
  category: 'marketing.ledger.category.utilities',
  amountMinor: 18500,
  currencyCode: 'PLN',
  direction: 'expense',
  isPlanned: true,
  balanceAfterMinor: 941618,
}

const ROWS: ReadonlyArray<PreviewRow> = [
  {
    id: 'rent',
    bookedOn: '2026-03-05',
    payee: 'marketing.ledger.row.rent',
    category: 'marketing.ledger.category.housing',
    amountMinor: 325000,
    currencyCode: 'PLN',
    direction: 'expense',
    balanceAfterMinor: 156260,
  },
  {
    id: 'savings',
    bookedOn: '2026-03-09',
    payee: 'marketing.ledger.row.savings',
    category: 'marketing.ledger.category.transfer',
    amountMinor: 120000,
    currencyCode: 'PLN',
    direction: 'expense',
    transferKind: 'internal',
    balanceAfterMinor: 36260,
  },
  {
    id: 'streaming',
    bookedOn: '2026-03-11',
    payee: 'marketing.ledger.row.streaming',
    category: 'marketing.ledger.category.subscriptions',
    amountMinor: 4300,
    currencyCode: 'PLN',
    direction: 'expense',
    balanceAfterMinor: 31960,
  },
  {
    id: 'salary',
    bookedOn: '2026-03-12',
    payee: 'marketing.ledger.row.salary',
    category: 'marketing.ledger.category.income',
    amountMinor: 940000,
    currencyCode: 'PLN',
    direction: 'income',
    balanceAfterMinor: 971960,
  },
  {
    id: 'groceries',
    ...EURO_ENTRY,
    category: 'marketing.ledger.category.groceries',
    direction: 'expense',
    balanceAfterMinor: 960118,
  },
  LAST_ROW,
]

/**
 * The typed line is shared with the ledger inside the app, so the two are one book; the landing
 * page re-exports it for the section that explains the euro row.
 */
export { TYPED_LINE }

/** The form's vertical ruling on the wide page: a hairline after every cell but the last. */
const RULED = 'sm:border-e sm:border-border-subtle sm:last:border-e-0'

/** The spine. A heavier rule in front of the balance column, and it wins the collapse. */
const SPINE = 'sm:border-s-2 sm:border-border-panel'

/**
 * The heavier rule under a cell on the wide page. The column headings sit on it and the page
 * closes on it; merged after `CELL`, it replaces the hairline that cell would draw.
 */
const HEAVY_RULE = 'sm:shadow-[inset_0_-1px_0_0_var(--color-border-panel)]'

/**
 * A cell: no vertical padding, so the row is exactly as tall as its lines, and the rule under it
 * drawn as an inset shadow, which paints on the cell's last pixel row - the printed rule's - and
 * adds no height of its own where a border would add one and walk the table off the pitch. On
 * the narrow page it draws nothing: the paper's ruling is the form there.
 */
const CELL = cn(
  'py-0 align-top sm:px-4 sm:shadow-[inset_0_-1px_0_0_var(--color-border-subtle)]',
  RULED,
)

/** A column heading: the same cell with the heavier rule under it. */
const HEAD = cn(CELL, 'text-start', HEAVY_RULE)

/** The row on the narrow page: a grid of two columns, the second sized to its figures. */
const ROW = 'max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-4'

/**
 * The heading row and the closing row keep their heavier rule on the narrow page too, drawn by
 * the row since its cells draw none there.
 */
const HEAVY_ROW = cn(
  ROW,
  'max-sm:shadow-[inset_0_-1px_0_0_var(--color-border-panel)]',
)

/**
 * Where each cell lands in that grid. The description spans both lines; `min-w-0` lets it shrink
 * to the column so its lines truncate instead of widening the row.
 */
const AT_DESCRIPTION =
  'max-sm:col-start-1 max-sm:row-start-1 max-sm:row-span-2 max-sm:min-w-0'
const AT_AMOUNT = 'max-sm:col-start-2 max-sm:row-start-1'
const AT_BALANCE = 'max-sm:col-start-2 max-sm:row-start-2'

const HEAD_TEXT = cn(
  'text-micro tracking-label uppercase text-ink-2',
  TYPED_LINE,
)

const DATE_CELL = cn(CELL, 'hidden sm:table-cell')

const DATE_TEXT = cn(
  'text-caption whitespace-nowrap text-ink-2 tabular',
  TYPED_LINE,
)

/**
 * U+00B7 between two facts typed on one line. The dot binds to the word after it, so a
 * line may break before the separator and never after: no line is ever a lone dot.
 */
const SEPARATOR = ' ·\u00a0'

/**
 * The balance after a line, as a typed figure with its spoken sentence.
 *
 * Bold because it is the spine, `tabular` for the decimal, and the sentence beside it so a reader
 * hears the złoty and grosze named rather than a string of digits. After a planned line it is
 * pencil like the line.
 */
function BalanceCell({
  amountMinor,
  isPlanned = false,
  className,
}: {
  amountMinor: number
  isPlanned?: boolean
  className?: string
}) {
  const t = useTranslate()
  const locale = useLocale()
  const balance = makeMoney(amountMinor, 'PLN')

  return (
    <td
      role="cell"
      className={cn(
        CELL,
        'text-end font-bold whitespace-nowrap tabular',
        isPlanned ? 'text-ink-2' : 'text-ink',
        SPINE,
        AT_BALANCE,
        className,
      )}
    >
      <span className={cn('text-label', TYPED_LINE)}>
        <span aria-hidden="true">{formatMoney(locale, balance)}</span>
        <span className="sr-only">{amountReading(t, locale, balance)}</span>
      </span>
    </td>
  )
}

export function LedgerPreview() {
  const t = useTranslate()
  const locale = useLocale()

  return (
    <table role="table" className="w-full border-collapse max-sm:block">
      <caption className="sr-only">{t('marketing.ledger.caption')}</caption>
      <thead role="rowgroup" className="max-sm:block">
        <tr role="row" className={HEAVY_ROW}>
          <th
            role="columnheader"
            scope="col"
            className={cn(HEAD, 'hidden sm:table-cell')}
          >
            <span className={HEAD_TEXT}>{t('common.date')}</span>
          </th>
          <th
            role="columnheader"
            scope="col"
            className={cn(HEAD, AT_DESCRIPTION)}
          >
            <span className={HEAD_TEXT}>{t('common.description')}</span>
          </th>
          <th
            role="columnheader"
            scope="col"
            className={cn(HEAD, 'text-end', AT_AMOUNT)}
          >
            <span className={HEAD_TEXT}>{t('common.amount')}</span>
          </th>
          <th
            role="columnheader"
            scope="col"
            className={cn(HEAD, 'text-end', SPINE, AT_BALANCE)}
          >
            <span className={HEAD_TEXT}>
              {t('marketing.ledger.col.balance')}
            </span>
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup" className="max-sm:block">
        {/* The line every page of a passbook opens on: what came over from the last one. It has
            no amount, so on the narrow page its balance sits on its first line. */}
        <tr role="row" className={ROW}>
          <td role="cell" className={DATE_CELL}>
            <span className={DATE_TEXT}>
              {formatCalendarDate(locale, OPENING.bookedOn, 'medium')}
            </span>
          </td>
          <td role="cell" className={cn(CELL, AT_DESCRIPTION)}>
            <span className={cn('text-label text-ink-2', TYPED_LINE)}>
              {t('marketing.ledger.opening')}{' '}
              {/* The one stamp on the page. Beside the line where there is room for it; on the
                  narrow page it takes the entry's second line, where a category would go, so
                  the row keeps the two-line shape of every other entry rather than wrapping
                  at whatever width the word happens to run out. */}
              <span className="sm:ms-1 max-sm:block">
                {/* Raised four pixels so the frame stands on the printed rule instead of
                    crossing it: a stamp lands on the line, it is not typed on the baseline. */}
                <Badge tone="settled" size="sm" className="relative -top-1">
                  {t('marketing.ledger.settled')}
                </Badge>
              </span>
            </span>
          </td>
          <td role="cell" className={cn(CELL, AT_AMOUNT)} />
          <BalanceCell
            amountMinor={OPENING.balanceMinor}
            className="max-sm:row-start-1"
          />
        </tr>

        {ROWS.map((row) => (
          <tr key={row.id} role="row" className={ROW}>
            <td role="cell" className={DATE_CELL}>
              <span className={DATE_TEXT}>
                {formatCalendarDate(locale, row.bookedOn, 'medium')}
              </span>
            </td>
            <td role="cell" className={cn(CELL, AT_DESCRIPTION)}>
              <span
                className={cn(
                  'text-label max-sm:truncate',
                  row.isPlanned ? 'text-ink-2' : 'text-ink',
                  TYPED_LINE,
                )}
              >
                {t(row.payee)}
                {/* The category, typed after the payee in the secondary ink. On the narrow page
                    it is the entry's second line, and the date - whose column is gone there -
                    is typed in front of it. `hidden` is `display: none`, so only one of the
                    two dates ever reaches the accessibility tree. */}
                <span className="text-ink-2 max-sm:block max-sm:truncate">
                  <span className="sm:hidden">
                    {formatCalendarDate(locale, row.bookedOn, 'medium')}
                  </span>
                  {SEPARATOR}
                  {/* The word before the category, so a narrow line that has to lose its end
                      loses the category's tail and never the status. */}
                  {row.isPlanned ? (
                    <>
                      {t('transactions.planned')}
                      {SEPARATOR}
                    </>
                  ) : null}
                  {t(row.category)}
                </span>
              </span>
            </td>
            <td role="cell" className={cn(CELL, 'text-end', AT_AMOUNT)}>
              <span className={cn('text-label', TYPED_LINE)}>
                {/*
                  The amount is an inline-flex box. On a transfer its first item is
                  the glyph, centred, whose bottom edge would become the box's
                  baseline and push the line four pixels off the rule. Top-aligned,
                  the box shares the line's own baseline instead.
                */}
                <AmountText
                  amountMinor={asMinor(row.amountMinor)}
                  currencyCode={asCurrencyCode(row.currencyCode)}
                  direction={row.direction}
                  isPlanned={row.isPlanned ?? false}
                  transferKind={row.transferKind ?? 'none'}
                  className="align-top"
                />
                {/* The złoty figure beside the euro one, on the same rule: a line of its own
                    would leave the balance cell beside it empty, and a ruled line with no
                    balance is not a line of a passbook. Top-aligned so its smaller box shares
                    the line rather than stretching it by a pixel. */}
                {row.refAmountMinor === undefined ? null : (
                  <ConvertedAmount
                    refAmountMinor={asMinor(row.refAmountMinor)}
                    refCurrencyCode={asCurrencyCode('PLN')}
                    className="inline ps-2"
                  />
                )}
              </span>
            </td>
            <BalanceCell
              amountMinor={row.balanceAfterMinor}
              isPlanned={row.isPlanned}
            />
          </tr>
        ))}

        {/* The line every page closes on: what goes over to the next one. Its balance is the
            last line's, read rather than retyped, and the heavier rule under it is the foot of
            the form. Like the opening line it has no amount, so on the narrow page its balance
            sits on its first line. */}
        <tr role="row" className={HEAVY_ROW}>
          <td role="cell" className={cn(DATE_CELL, HEAVY_RULE)}>
            <span className={DATE_TEXT}>
              {formatCalendarDate(locale, CLOSING_ON, 'medium')}
            </span>
          </td>
          <td role="cell" className={cn(CELL, HEAVY_RULE, AT_DESCRIPTION)}>
            <span className={cn('text-label text-ink-2', TYPED_LINE)}>
              {t('marketing.ledger.closing')}
            </span>
          </td>
          <td role="cell" className={cn(CELL, HEAVY_RULE, AT_AMOUNT)} />
          <BalanceCell
            amountMinor={LAST_ROW.balanceAfterMinor}
            isPlanned={LAST_ROW.isPlanned}
            className={cn(HEAVY_RULE, 'max-sm:row-start-1')}
          />
        </tr>
      </tbody>
    </table>
  )
}
