import { Repeat } from 'lucide-react'

import { amountReading } from '#/components/app/money'
import { rowWashSecondary } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, money } from '#/lib/money'

import type { CurrencyCode, Minor } from '#/lib/money'
import type { LedgerRow } from './types'

/**
 * How an amount is written down, everywhere on this surface.
 *
 * ## The reading is not the drawing
 *
 * The visible figure is `−20,00 zł`: a sign, tabular figures, a narrow symbol and one of the
 * reserved amount hues. That is three channels for a sighted reader and none at all for somebody
 * listening, because a narrow symbol is announced inconsistently and a minus sign in front of a
 * number is not the same sentence as "an expense".
 *
 * There used to be a fourth: an up or down arrow in front of every figure. It was removed because
 * the sign already says the same thing at the same glance, and because a glyph in front of a
 * right-aligned number gives the column two left edges — one for the arrow, one for the digits —
 * so nothing in it lines up. The transfer mark stays, and only that one: a transfer is drawn in the
 * muted hue and carries a minus like an expense, so with no glyph the *only* thing separating the
 * two would be colour, which `docs/ACCESS` does not allow.
 *
 * So the cell carries two strings: the drawing, marked `aria-hidden`, and a full sentence in an
 * `sr-only` span — _"Expense of 20.00 Polish zlotys"_ — built with `currencyDisplay: 'name'`, which
 * is the one display mode that reads correctly in both locales this product ships. `docs/ACCESS`'s
 * colour rule is satisfied twice over: the sign is a non-colour channel, and the screen-reader
 * sentence names the direction in words.
 *
 * ## No arithmetic happens here
 *
 * The component is handed `Minor` and a currency and formats them. It never negates, never adds and
 * never converts — the sign it draws comes from `direction`, which is where the sign lives.
 */

/** Which of the reserved hues an amount is painted in, and how heavily. */
type AmountTone = 'income' | 'expense' | 'transfer' | 'planned'

const TONE_CLASS: Record<AmountTone, string> = {
  // Inflow is the heavier weight as well as the other hue: `tokens.css` records the measured
  // dichromat separation between `positive` and `negative` as low as 1.14:1, so weight and sign are
  // doing the work and colour is the third channel rather than the first.
  income: 'text-positive font-semibold',
  expense: 'text-negative',
  transfer: rowWashSecondary,
  // A planned line is written in pencil: the secondary ink, never the stamp violet the product
  // spends on what is settled. The word beside the row is the channel; the grey only agrees.
  planned: rowWashSecondary,
}

function toneOf(
  row: Pick<LedgerRow, 'direction' | 'isPlanned' | 'transferKind'>,
): AmountTone {
  if (row.transferKind !== 'none') {
    return 'transfer'
  }
  if (row.isPlanned) {
    return 'planned'
  }
  return row.direction === 'income' ? 'income' : 'expense'
}

/**
 * The transfer mark, and nothing else.
 *
 * Income and expense are told apart by their sign, so an arrow beside them is a third statement of
 * the same fact and a ragged left edge on a right-aligned column. A transfer has no sign of its own
 * — it is drawn muted and minus-prefixed — so this glyph is the non-colour channel that keeps it
 * from being "an expense in a different grey".
 */
function GlyphFor({ tone }: { tone: AmountTone }) {
  if (tone === 'transfer') {
    return <Repeat aria-hidden="true" className="size-3.5 shrink-0" />
  }
  return null
}

export interface AmountTextProps {
  readonly amountMinor: Minor
  readonly currencyCode: CurrencyCode
  readonly direction: LedgerRow['direction']
  readonly isPlanned?: boolean
  readonly transferKind?: LedgerRow['transferKind']
  /** Drop the transfer mark too — for a footer figure that already sits under a worded label. */
  readonly hideGlyph?: boolean
  readonly className?: string
}

/**
 * A transaction amount: sign, hue, and a spoken sentence that names the currency in full.
 */
export function AmountText({
  amountMinor,
  currencyCode,
  direction,
  isPlanned = false,
  transferKind = 'none',
  hideGlyph = false,
  className,
}: AmountTextProps) {
  const locale = useLocale()
  const t = useTranslate()
  const tone = toneOf({ direction, isPlanned, transferKind })
  const value = money(amountMinor, currencyCode)

  // U+2212, not a hyphen: at the sizes a ledger column is set in, a hyphen is a third of the width
  // of the plus beside it and the column stops reading as a column.
  const sign = direction === 'income' ? '+' : '−'
  const drawn = `${sign}${formatMoney(locale, value, { display: 'narrowSymbol' })}`
  const spokenAmount = amountReading(t, locale, value)
  const spoken =
    direction === 'income'
      ? t('transactions.amount.income', { amount: spokenAmount })
      : t('transactions.amount.expense', { amount: spokenAmount })

  return (
    <span
      className={cn(
        'inline-flex items-center justify-end gap-1.5 tabular whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      {hideGlyph ? null : <GlyphFor tone={tone} />}
      <span aria-hidden="true">{drawn}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  )
}

export interface ConvertedAmountProps {
  readonly refAmountMinor: Minor
  readonly refCurrencyCode: CurrencyCode
  readonly className?: string
}

/**
 * The base-currency equivalent, set under the native figure.
 *
 * Rendered only when the two currencies differ — repeating `20,00 zł` under `20,00 zł` is noise —
 * and never recomputed: `refAmountMinor` was fixed at the booking date's rate when the row was
 * written, and a second opinion about it here would be a second opinion about history.
 */
export function ConvertedAmount({
  refAmountMinor,
  refCurrencyCode,
  className,
}: ConvertedAmountProps) {
  const locale = useLocale()
  const t = useTranslate()
  const value = money(refAmountMinor, refCurrencyCode)
  const formatted = formatMoney(locale, value, { display: 'narrowSymbol' })

  return (
    <span
      className={cn('block tabular text-caption', rowWashSecondary, className)}
    >
      <span aria-hidden="true">{formatted}</span>
      <span className="sr-only">
        {t('money.amountIn', { currency: amountReading(t, locale, value) })}
      </span>
    </span>
  )
}

export interface NetAmountProps {
  readonly amountMinor: Minor
  readonly currencyCode: CurrencyCode
  readonly className?: string
}

/**
 * A signed net figure — the difference under the list, a day's balance.
 *
 * Zero is written unsigned, because a settled difference is a fact rather than a direction and
 * `+0,00 zł` reads as a rounding artefact.
 */
export function NetAmount({
  amountMinor,
  currencyCode,
  className,
}: NetAmountProps) {
  const locale = useLocale()
  const t = useTranslate()
  const value = money(amountMinor, currencyCode)
  const magnitude = Math.abs(amountMinor) as Minor
  const formatted = formatMoney(locale, money(magnitude, currencyCode), {
    display: 'narrowSymbol',
  })
  // The sign is a word rather than the glyph beside it: U+2212 is announced as
  // nothing at all by several screen readers, and `+` fares little better.
  const spoken = amountReading(t, locale, value, { signed: true })

  if (amountMinor === 0) {
    return (
      <span className={cn('tabular whitespace-nowrap text-ink', className)}>
        <span aria-hidden="true">{formatted}</span>
        <span className="sr-only">{spoken}</span>
      </span>
    )
  }

  const positive = amountMinor > 0
  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        positive ? 'text-positive font-semibold' : 'text-negative',
        className,
      )}
    >
      <span aria-hidden="true">{`${positive ? '+' : '−'}${formatted}`}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  )
}

export interface BalanceAmountProps {
  readonly amountMinor: Minor
  readonly currencyCode: CurrencyCode
  /** After a planned line the balance is pencil like the line: what will be, not what is. */
  readonly isPlanned?: boolean
  readonly className?: string
}

/**
 * The balance after a line: the passbook's spine.
 *
 * Bold because the spine is the form's own emphasis, `tabular` for the decimal, unsigned because a
 * balance is a state and not a movement, and negative only through the formatter's own U+2212. The
 * figure is handed in: it was summed by the repository from stored minor units, and nothing here
 * adds a grosz to it.
 */
export function BalanceAmount({
  amountMinor,
  currencyCode,
  isPlanned = false,
  className,
}: BalanceAmountProps) {
  const locale = useLocale()
  const t = useTranslate()
  const value = money(amountMinor, currencyCode)

  return (
    <span
      className={cn(
        'font-bold whitespace-nowrap tabular',
        isPlanned ? rowWashSecondary : 'text-ink',
        className,
      )}
    >
      <span aria-hidden="true">
        {formatMoney(locale, value, { display: 'narrowSymbol' })}
      </span>
      <span className="sr-only">{amountReading(t, locale, value)}</span>
    </span>
  )
}
