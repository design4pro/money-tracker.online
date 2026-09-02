import { Badge } from '#/components/ui'

import type { RecurringPeriodStatus } from '#/server/db/schema'
import { useTranslate } from '#/lib/i18n'

/**
 * A period's state, as a word.
 *
 * `docs/ACCESSIBILITY.md` §1: overdue may not be *red* and nothing else. The badge prints the
 * status in words, in the reader's language, and the tone is the second channel rather than the
 * only one - the text survives greyscale, a monochrome print and a reader who cannot see the tint
 * at all.
 *
 * The status handed in is always the **derived** one. `recurring_periods.status` can hold a stale
 * `upcoming` for a date that has since passed; deriving it against today is what makes the word on
 * the screen true rather than as-of-last-write. See `derivedStatusOf` in `repos/recurring`.
 */

export interface PeriodStatusBadgeProps {
  readonly status: RecurringPeriodStatus
}

const TONES = {
  upcoming: 'neutral',
  paid: 'positive',
  overdue: 'negative',
  skipped: 'neutral',
} as const

export function PeriodStatusBadge({ status }: PeriodStatusBadgeProps) {
  const t = useTranslate()
  return <Badge tone={TONES[status]}>{t(`recurring.status.${status}`)}</Badge>
}
