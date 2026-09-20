/**
 * One payload, two surfaces, one number.
 *
 * `src/server/notify/copy.ts` deliberately formats nothing: a notification row stores an integer
 * number of minor units with its currency code, an ISO date, a whole percentage, a name somebody
 * typed — because only the *reader* knows whose locale to render them in, and this product has
 * households whose members do not share one. A string formatted when the cron swept would read
 * correctly for nobody in particular, permanently, because it would be what the row said.
 *
 * This module is the other half of that decision: the single place those stored values become
 * display strings. `21-S2`'s email templates call it, and `21-S3`'s in-app notification item will
 * call it, which is what makes "the email states the same number the app states" true by
 * construction rather than by two implementations agreeing.
 *
 * **It is pure, and it imports nothing from `server/`.** That is not tidiness — it is the whole
 * reason a component in the browser and a queue handler in workerd can share it.
 *
 * ## The scale comes from the currency, never from a 2
 *
 * `formatMoney` resolves `digits` through `minorUnitDigits` (`docs/MONEY.md` §1.2, §7.2), so JPY
 * renders with no separator and KWD with three places without this module knowing either fact. The
 * spec sketched a `digitsOf` injector for that; there is nothing to inject, and the amendment on
 * the spec records why.
 *
 * ## Telling an ISO date from a name
 *
 * `CopyParam`'s string arm is both "a name somebody typed" and "an ISO date", and the stored shape
 * does not distinguish them — `params` is JSON in a D1 column, and giving dates their own object
 * arm would change what is already written there. So a string is treated as a date only when it is
 * *exactly* `YYYY-MM-DD` and names a real calendar day.
 *
 * The residual cost is a budget, series or goal named exactly `2026-03-18`, which renders as
 * `18 Mar 2026`. That is cosmetic, it is bounded to names that are nothing but a date, and it is
 * the cheaper side of the trade: the alternative reformats the stored row shape for every
 * notification ever written.
 */

import { formatCalendarDate } from '#/lib/i18n'
import { formatMoney } from '#/lib/money/format'
import { makeMoney } from '#/lib/money/types'

import type { Locale, MessageParams } from '#/lib/i18n'
import type { CopyParam, MoneyParam } from './params'

/** `2026-03-18`, and nothing else — not a prefix, not a timestamp, not a name that starts with one. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isMoney(value: CopyParam): value is MoneyParam {
  return typeof value === 'object' && 'minor' in value
}

/**
 * A real calendar day, not merely ten characters in the right places.
 *
 * `2026-02-31` matches the pattern and is not a date; `Date.UTC` rolls it forward to March, and
 * comparing the round trip is what catches that. A stored value that fails here is left alone and
 * shown verbatim, because a row saying something impossible is a data problem and hiding it behind
 * a plausible-looking March date is worse than printing what is there.
 */
function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/**
 * One stored parameter as the reader sees it.
 *
 * Numbers pass through **as numbers**, deliberately: `count` drives the plural machinery, and a
 * `count` that arrived as `'3'` would pick the wrong branch in Polish, where the rules are counted
 * rather than compared.
 */
export function renderCopyParam(
  locale: Locale,
  value: CopyParam,
): string | number {
  if (isMoney(value)) {
    // `makeMoney` is the only door into the money path: it brands the integer and the code, and
    // throws on anything a row should never hold. A render error is caught by the send path and
    // reported as a failed delivery, which is the right shape for a corrupted row — better than a
    // plausible-looking amount nobody can trace.
    return formatMoney(locale, makeMoney(value.minor, value.currencyCode))
  }
  if (typeof value === 'string' && isCalendarDate(value)) {
    return formatCalendarDate(locale, value)
  }
  return value
}

/** The whole bag, ready to hand to `t()` or to a stored translator. */
export function renderCopyParams(
  locale: Locale,
  params: Readonly<Record<string, CopyParam>>,
): MessageParams {
  const rendered: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(params)) {
    rendered[name] = renderCopyParam(locale, value)
  }
  return rendered
}
