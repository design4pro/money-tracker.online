import { DateFormatter, parseDate } from '@internationalized/date'

import type { Locale } from '#/lib/i18n'

/**
 * "Jan 2026" — the label a month bucket wears on the cash-flow axis and in its text equivalent.
 *
 * `src/lib/i18n/format.ts` is the product's formatting door and its `DateStyle` ramp has no
 * month-only entry; `formatCalendarDate(locale, key, 'medium')` would render a bucket covering
 * the whole of January as "1 Jan 2026", which is a different claim. So the style lives here for
 * now, built from the same `@internationalized/date` `DateFormatter` that `format.ts` uses, in
 * UTC, from a `YYYY-MM-DD` string — never `toLocaleDateString` on a bare string, which is what
 * `docs/I18N.md` §6 actually forbids.
 *
 * **Move it.** When `format.ts` next changes hands, this belongs there as a `'month'` `DateStyle`
 * and this file should go with it. It is here because that file is owned elsewhere, not because
 * the dashboard deserves its own date formatter.
 *
 * Formatters are memoised per locale: a twelve-month chart would otherwise construct twelve.
 */
const formatters = new Map<Locale, DateFormatter>()

function formatterFor(locale: Locale): DateFormatter {
  const cached = formatters.get(locale)
  if (cached !== undefined) return cached

  const created = new DateFormatter(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  formatters.set(locale, created)
  return created
}

/** `firstDay` is the bucket's first calendar day, `YYYY-MM-DD`. */
export function monthLabel(locale: Locale, firstDay: string): string {
  return formatterFor(locale).format(parseDate(firstDay).toDate('UTC'))
}
