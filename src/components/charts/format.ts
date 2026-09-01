import { formatMoney, money } from '#/lib/money'

import type { Locale } from '#/lib/i18n'
import type { CurrencyCode, Minor } from '#/lib/money'

/**
 * The one door every number in every chart leaves through.
 *
 * A chart shows the same figure on four surfaces — the axis, the point's accessible name, the
 * tooltip and the visually-hidden table — and the failure this module exists to prevent is those
 * four disagreeing. They cannot, because they all call these two functions, which both call
 * `formatMoney` with the chart's own `currencyCode`, and `formatMoney` reads the scale from
 * `currencies.digits`. A zero-decimal currency therefore renders no decimal separator on the axis
 * for the same reason it renders none in the table.
 *
 * No arithmetic happens here. `amountMinor` arrives an integer and leaves a string.
 */

/** The full figure with its currency: `1 234,00 zł`, `¥5,000`. */
export function chartAmount(
  locale: Locale,
  currencyCode: CurrencyCode,
  amountMinor: Minor,
): string {
  return formatMoney(locale, money(amountMinor, currencyCode))
}

/**
 * The bare figure, for an axis whose currency is named once in the chart's caption.
 *
 * Same function, same digits, no symbol — repeating `zł` down eight gridlines is noise, and the
 * one place the reader looks for the currency is the caption above them.
 */
export function chartAxisAmount(
  locale: Locale,
  currencyCode: CurrencyCode,
  amountMinor: Minor,
): string {
  return formatMoney(locale, money(amountMinor, currencyCode), {
    display: 'none',
  })
}

/**
 * The accessible name of one data point: _"Groceries, March, 1 234,00 zł"_.
 *
 * A comma-joined list rather than a sentence, because the fragments are already translated and a
 * sentence built by concatenation cannot be translated into Polish (or any other language)
 * without the grammar breaking. Screen readers pause on the commas, which is the behaviour a
 * three-part label wants.
 */
export function pointName(...parts: ReadonlyArray<string>): string {
  return parts.filter((part) => part.length > 0).join(', ')
}
