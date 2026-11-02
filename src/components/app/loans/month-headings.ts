import { DateFormatter, parseDate } from '@internationalized/date'

import type { Locale } from '#/lib/i18n'

/**
 * Short month names for the calendar's twelve columns.
 *
 * Same door as the dashboard's cash-flow labels: `@internationalized/date` in UTC from a
 * `YYYY-MM-DD` string, never `toLocaleDateString` on a bare string. The year in the dummy date
 * is not shown; only `month: 'short'` is requested.
 */

const formatters = new Map<Locale, DateFormatter>()

function formatterFor(locale: Locale): DateFormatter {
  const cached = formatters.get(locale)
  if (cached !== undefined) return cached
  const created = new DateFormatter(locale, {
    month: 'short',
    timeZone: 'UTC',
  })
  formatters.set(locale, created)
  return created
}

export function monthHeadings(locale: Locale): ReadonlyArray<string> {
  const formatter = formatterFor(locale)
  return Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, '0')
    return formatter.format(parseDate(`2026-${month}-01`).toDate('UTC'))
  })
}
