import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'

import { amountReading } from '#/components/app/money'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'
import {
  asMinor,
  formatMoneySegments,
  formatSignedMoneySegments,
  makeMoney,
  negateMinor,
} from '#/lib/money'

import type { ReactNode } from 'react'
import type { Locale } from '#/lib/i18n'
import type { CurrencyDisplay, MoneySegment } from '#/lib/money'

/**
 * Every figure on the accounts surface, and the one place it is turned into text.
 *
 * ## Three rules this file exists to keep
 *
 * **The amount arrives as integer minor units and leaves as a string.** `makeMoney` is the
 * gate: it refuses a non-integer, so a major-unit float that has leaked out of a form or a
 * hand-rolled division fails here rather than being rendered a hundred times too small. There is
 * no arithmetic in this module at all — the sign is read, never computed by subtraction.
 *
 * **The currency decides the number of decimals, never a hard-coded two.** That is
 * `formatMoney`'s job (`currencies.digits`), which is why nothing here composes a string itself:
 * `¥5,000` and `5,000.00 KWD` are both correct and neither is two digits.
 *
 * **Colour is never the only channel.** A negative figure carries a U+2212 minus at the front of
 * the number — from `formatMoney` and from `formatSignedMoney` alike, which is why the accounts
 * list and the ledger no longer disagree about the glyph — and {@link DirectionalAmount} adds an
 * arrow and a word on top of that. Greyscale, a forced-colours theme and a reader with
 * deuteranopia all get the same answer as everyone else — `docs/ACCESSIBILITY.md` §1, and the
 * reason `text-negative` is reinforcement rather than meaning.
 *
 * **The reading is not the drawing.** The figure a reader sees is marked `aria-hidden` and an
 * `sr-only` sentence sits beside it: the currency named in full and the sign as a word, because
 * a narrow symbol is announced inconsistently and U+2212 is frequently announced as nothing at
 * all. `amountReading` composes it, so this component and the ledger's cannot drift.
 */

/**
 * The type ramp a figure may take. Larger than `lg` is a page's headline number.
 *
 * `2xl` is the display step — the one figure a surface is *about*. It exists because a hero that
 * is only 1.4x its own sub-figures is not a hero: the eye lands on whichever number has the most
 * digits, and on an accounts page that is reliably the wrong one. Two steps of separation is the
 * difference between a headline and a sibling.
 */
export type AmountSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

const SIZES: Record<AmountSize, string> = {
  sm: 'text-caption font-medium',
  md: 'text-body font-semibold',
  lg: 'text-subtitle font-semibold',
  xl: 'text-title font-bold',
  '2xl': 'text-display',
}

/**
 * The sizes at which the currency mark is set down out of the digits' way.
 *
 * At the display step a two-glyph `zł` drawn at the numeral's own size and weight reads as part of
 * the number and takes the first fixation. Set to 0.6em at the regular weight in the secondary ink
 * it becomes what it is — a unit — and the digits get the fixation instead. It stops at `xl`:
 * below that the mark is already too small to compete, and shrinking it further would only make a
 * 15px row harder to read.
 *
 * The **sign is never set down by this**. It is one of the three channels that carry direction, so
 * it stays at the digits' own size and weight wherever the figure appears
 * (`docs/ACCESSIBILITY.md` §1).
 */
const MARKED_SIZES: ReadonlySet<AmountSize> = new Set<AmountSize>(['xl', '2xl'])

export interface AmountProps {
  /** The reader's negotiated locale — grouping, decimal mark and minus sign come from it. */
  locale: Locale
  /** Integer minor units in `currencyCode`'s own scale. */
  amountMinor: number
  currencyCode: string
  size?: AmountSize
  /** How the currency is named beside the figure. */
  display?: CurrencyDisplay
  /**
   * `true` shows a `+` on positives as well as the `−` on negatives.
   *
   * On for a delta — a correction, a change — and off for a balance, where `+1 200,00 zł` reads
   * as an increase that did not happen.
   */
  signed?: boolean
  /**
   * `'value'` tints a negative figure with the negative token.
   *
   * The tint is on top of the minus sign, never instead of it. `'plain'` is for a figure whose
   * sign carries no judgement — an opening balance, a credit limit.
   */
  tone?: 'plain' | 'value'
  /**
   * `'decimal'` splits the figure at its decimal separator so a **column** of them lines up on
   * that separator whatever currency each row is in.
   *
   * Flush-right alignment is not decimal alignment: `zł 72 328,33` and `$7 785,32` put their
   * digits at different offsets because the two marks are different widths, and the minus on an
   * overdrawn row shifts its digits again. Splitting after the integer digits pins the separator
   * to one x for every row, and hangs the sign to the left of the column where it stays visible
   * instead of pushing the number sideways.
   *
   * Only for a right-aligned column. `'inline'` (the default) is a figure inside a sentence.
   */
  align?: 'inline' | 'decimal'
  className?: string
}

/** One money figure, formatted for this locale and this currency. */
export function Amount({
  locale,
  amountMinor,
  currencyCode,
  size = 'md',
  display,
  signed = false,
  tone = 'plain',
  align = 'inline',
  className,
}: AmountProps) {
  const t = useTranslate()
  const value = makeMoney(amountMinor, currencyCode)
  const options = display === undefined ? {} : { display }
  const segments = signed
    ? formatSignedMoneySegments(locale, value, options)
    : formatMoneySegments(locale, value, options)

  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        SIZES[size],
        tone === 'value' && amountMinor < 0 ? 'text-negative' : 'text-ink',
        align === 'decimal' && 'flex justify-end',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(align === 'decimal' && 'contents')}
      >
        {align === 'decimal' ? (
          <DecimalColumn segments={segments} size={size} />
        ) : (
          <Drawn segments={segments} size={size} />
        )}
      </span>
      <span className="sr-only">
        {amountReading(t, locale, value, { signed })}
      </span>
    </span>
  )
}

/**
 * The figure as its reader sees it: one span per segment, so the currency mark can be set down
 * without the digits or the sign following it.
 *
 * `MARKED_SIZES` is where the mark is set down and where it is not — see the note on the constant.
 */
function Drawn({
  segments,
  size,
}: {
  segments: ReadonlyArray<MoneySegment>
  size: AmountSize
}) {
  const marked = MARKED_SIZES.has(size)
  return (
    <>
      {segments.map((segment, index) =>
        marked && segment.kind === 'currency' ? (
          <span
            // The segments of one figure have no identity of their own; their position is it.
            key={index}
            className="text-[0.6em] font-normal text-ink-2"
          >
            {segment.value}
          </span>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </>
  )
}

/**
 * The same figure cut into a head and a tail, for a column that aligns on the decimal separator.
 *
 * The head is everything up to and including the integer digits and is set flush right; the tail
 * is the fraction and whatever follows it, and reserves a fixed measure so the head's right edge —
 * and therefore the separator — lands at the same x on every row. `min-width` rather than `width`:
 * a longer tail (`,00 KWD`) pushes its own row out of alignment rather than being clipped, which
 * is the failure mode a reader can see and act on.
 */
function DecimalColumn({
  segments,
  size,
}: {
  segments: ReadonlyArray<MoneySegment>
  size: AmountSize
}) {
  const cut = segments.findIndex((segment) => segment.kind === 'fraction')
  const at = cut === -1 ? segments.length : cut

  return (
    <>
      <span className="text-end">
        <Drawn segments={segments.slice(0, at)} size={size} />
      </span>
      <span className="min-w-[5.5ch] text-start">
        <Drawn segments={segments.slice(at)} size={size} />
      </span>
    </>
  )
}

/**
 * A figure that is money moving, with the direction stated three ways.
 *
 * An arrow, a word and a sign — then colour, last and least. This is the component the balance
 * correction uses to say what it is about to write and what it wrote, and the whole point of
 * that flow is that a person can tell an income from an expense without trusting a hue.
 *
 * ## `layout`, and why `'cells'` renders no wrapper
 *
 * `'inline'` is the figure inside a sentence: icon, word and amount flowing together, which is
 * right for a confirmation line and wrong for a list. In a list the type word and the amount are
 * **columns**: `Expense` and `Income` are different widths, so flowed against the amount their
 * left edges are ragged and the arrow starts at a different x on every row — which is exactly the
 * scan the eye is trying to make down a column of money.
 *
 * Columns only align if every row shares one grid, and a row cannot share the list's tracks
 * through a wrapper `<span>`. So `'cells'` returns the two cells as siblings with no element
 * around them, for a parent whose `grid-template-columns` reserves a track for each. `className`
 * then styles the type cell, since that is the only cell a caller has anything to say about.
 */
export type DirectionalAmountLayout = 'inline' | 'cells'

export interface DirectionalAmountProps {
  locale: Locale
  direction: 'income' | 'expense'
  /** The magnitude, always positive. The sign lives in `direction`. */
  amountMinor: number
  currencyCode: string
  /** The localised word for the direction — `transactions.direction.income` / `.expense`. */
  label: ReactNode
  size?: AmountSize
  /** See the note above. `'cells'` needs a parent grid with two tracks free. */
  layout?: DirectionalAmountLayout
  className?: string
}

export function DirectionalAmount({
  locale,
  direction,
  amountMinor,
  currencyCode,
  label,
  size = 'md',
  layout = 'inline',
  className,
}: DirectionalAmountProps) {
  const income = direction === 'income'
  const Icon = income ? ArrowDownLeft : ArrowUpRight
  const signedMinor = income ? amountMinor : negateMinor(asMinor(amountMinor))

  const type = (
    <>
      <Icon
        aria-hidden="true"
        className={cn(
          'size-4 shrink-0',
          income ? 'text-positive' : 'text-negative',
        )}
      />
      <span className="text-caption font-semibold text-ink-2">{label}</span>
    </>
  )

  if (layout === 'cells') {
    return (
      <>
        <span
          className={cn('inline-flex min-w-0 items-center gap-2', className)}
        >
          {type}
        </span>
        {/*
          `align="decimal"` rather than a plain flush-right cell: the rows of a workspace with two
          currencies carry two different marks and a minus on half of them, and flush right puts
          those digits at four different offsets. Splitting after the integer digits pins the
          separator to one x for the whole column.
        */}
        <Amount
          locale={locale}
          amountMinor={signedMinor}
          currencyCode={currencyCode}
          size={size}
          signed
          tone="value"
          align="decimal"
        />
      </>
    )
  }

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {type}
      <Amount
        locale={locale}
        amountMinor={signedMinor}
        currencyCode={currencyCode}
        size={size}
        signed
        tone="value"
      />
    </span>
  )
}
