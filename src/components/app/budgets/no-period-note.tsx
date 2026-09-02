import { today } from '@internationalized/date'

import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'

import type { BudgetSummary } from '#/server/budgets/summary'

/**
 * What a budget with no measurable current period says instead of a meter.
 *
 * Three different things can leave {@link BudgetSummary.current} `null`, and they are not
 * interchangeable:
 *
 * - the budget **has not started** — it was created ahead of a salary date, and the honest thing
 *   to say is when it begins;
 * - the budget **has ended** — its `end_date` is behind us, and there is no further period to draw;
 * - the limit **could not be converted** — no rate on the period's first day, which is the one case
 *   where the product genuinely does not know.
 *
 * Collapsing all three into "no rate" would tell somebody their currency is broken when in fact
 * their budget starts on Monday. `0%` would be worse still: it reads as *nothing spent*.
 *
 * The date comparison is a plain string comparison because `YYYY-MM-DD` sorts lexicographically,
 * and `today('UTC')` is the same day the server used to build the summary (`fns/budgets` decides
 * `today` once, in UTC). They can disagree only in the instant either side of UTC midnight, and
 * the disagreement costs a sentence rather than a number.
 */

export interface NoPeriodNoteProps {
  readonly budget: BudgetSummary
  readonly className?: string
}

export function NoPeriodNote({ budget, className }: NoPeriodNoteProps) {
  const t = useTranslate()
  const locale = useLocale()
  const now = today('UTC').toString()

  const text =
    budget.startDate > now
      ? t('budgets.notStarted', {
          date: formatCalendarDate(locale, budget.startDate, 'medium'),
        })
      : budget.endDate !== null && budget.endDate < now
        ? t('budgets.ended', {
            date: formatCalendarDate(locale, budget.endDate, 'medium'),
          })
        : t('budgets.meter.noRate', { currency: budget.budgetCurrencyCode })

  return <p className={cn('text-caption text-ink-2', className)}>{text}</p>
}
