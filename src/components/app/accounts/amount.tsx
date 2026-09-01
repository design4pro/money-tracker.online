import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'

import { cn } from '#/lib/cn'
import {
  asMinor,
  formatMoney,
  formatSignedMoney,
  makeMoney,
  negateMinor,
} from '#/lib/money'

import type { ReactNode } from 'react'
import type { Locale } from '#/lib/i18n'
import type { CurrencyDisplay } from '#/lib/money'

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
 * **Colour is never the only channel.** A negative figure carries the locale's minus sign
 * (U+2212 from `formatSignedMoney`, the locale's own from `formatMoney`) at the front of the
 * number, and {@link DirectionalAmount} adds an arrow and a word on top of that. Greyscale, a
 * forced-colours theme and a reader with deuteranopia all get the same answer as everyone else —
 * `docs/ACCESSIBILITY.md` §1, and the reason `text-negative` is reinforcement rather than
 * meaning.
 */

/** The type ramp a figure may take. Larger than `lg` is a page's headline number. */
export type AmountSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<AmountSize, string> = {
  sm: 'text-caption font-medium',
  md: 'text-body font-semibold',
  lg: 'text-subtitle font-semibold',
  xl: 'text-title font-bold',
}

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
  className,
}: AmountProps) {
  const value = makeMoney(amountMinor, currencyCode)
  const options = display === undefined ? {} : { display }
  const text = signed
    ? formatSignedMoney(locale, value, options)
    : formatMoney(locale, value, options)

  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        SIZES[size],
        tone === 'value' && amountMinor < 0 ? 'text-negative' : 'text-ink',
        className,
      )}
    >
      {text}
    </span>
  )
}

/**
 * A figure that is money moving, with the direction stated three ways.
 *
 * An arrow, a word and a sign — then colour, last and least. This is the component the balance
 * correction uses to say what it is about to write and what it wrote, and the whole point of
 * that flow is that a person can tell an income from an expense without trusting a hue.
 */
export interface DirectionalAmountProps {
  locale: Locale
  direction: 'income' | 'expense'
  /** The magnitude, always positive. The sign lives in `direction`. */
  amountMinor: number
  currencyCode: string
  /** The localised word for the direction — `transactions.direction.income` / `.expense`. */
  label: ReactNode
  size?: AmountSize
  className?: string
}

export function DirectionalAmount({
  locale,
  direction,
  amountMinor,
  currencyCode,
  label,
  size = 'md',
  className,
}: DirectionalAmountProps) {
  const income = direction === 'income'
  const Icon = income ? ArrowDownLeft : ArrowUpRight

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Icon
        aria-hidden="true"
        className={cn(
          'size-4 shrink-0',
          income ? 'text-positive' : 'text-negative',
        )}
      />
      <span className="text-caption font-semibold text-ink-2">{label}</span>
      <Amount
        locale={locale}
        amountMinor={income ? amountMinor : negateMinor(asMinor(amountMinor))}
        currencyCode={currencyCode}
        size={size}
        signed
        tone="value"
      />
    </span>
  )
}
