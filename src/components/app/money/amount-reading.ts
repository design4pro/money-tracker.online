import {
  absMoney,
  formatMoney,
  isNegativeMinor,
  isPositiveMinor,
} from '#/lib/money'

import type { Locale, Translate } from '#/lib/i18n'
import type { Money } from '#/lib/money'

/**
 * What a screen reader is given in place of a figure, on every surface.
 *
 * ## The reading is not the drawing
 *
 * A drawn amount is `−43,81 zł`: a U+2212 minus, tabular figures and a narrow
 * currency symbol. None of those three survive being spoken. U+2212 is
 * announced as nothing at all by several screen readers, `zł` is announced
 * inconsistently, and neither says *which* currency in a workspace that holds
 * three of them. So the drawing is marked `aria-hidden` at each call site and
 * this sentence is put beside it in an `sr-only` span.
 *
 * The sign becomes a **word** and the currency becomes its **name** —
 * `currencyDisplay: 'name'` is the one display mode that reads correctly in
 * both locales this product ships.
 *
 * ## The magnitude is formatted from `absMoney`, never from a subtraction
 *
 * The sign is carried by the message, so formatting the signed value here would
 * put a second minus inside a sentence that already says "minus".
 *
 * This function exists so the accounts surface, the ledger and the dashboard
 * cannot answer differently: it is the only place the sign is turned into a
 * word.
 */
export interface AmountReadingOptions {
  /**
   * Say the sign on a positive figure as well as on a negative one.
   *
   * On for a delta — a correction, a period's difference — and off for a
   * balance, where "positive 1 200,00 zł" reads as an increase that did not
   * happen.
   */
  readonly signed?: boolean
}

export function amountReading(
  t: Translate,
  locale: Locale,
  amount: Money,
  options: AmountReadingOptions = {},
): string {
  const magnitude = formatMoney(locale, absMoney(amount), { display: 'name' })

  if (isNegativeMinor(amount.amountMinor)) {
    return t('money.spoken.negative', { amount: magnitude })
  }
  if (options.signed === true && isPositiveMinor(amount.amountMinor)) {
    return t('money.spoken.positive', { amount: magnitude })
  }
  return magnitude
}
