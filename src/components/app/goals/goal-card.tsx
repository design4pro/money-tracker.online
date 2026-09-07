import { Link } from '@tanstack/react-router'
import { CalendarClock, Lightbulb } from 'lucide-react'

import { Badge } from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import { GoalMeter, goalStateOf } from './goal-meter'

import type { ReactNode } from 'react'
import type { Locale } from '#/lib/i18n'
import type { GoalSummary } from '#/server/goals/summary'

/**
 * One goal, as the list renders it.
 *
 * ## The remainder is the headline and it is the first thing in the row
 *
 * Everything else here — the date, the accounts, the base-currency line — is context for one
 * number, and {@link GoalMeter} sets that number at the subtitle step directly above the track.
 *
 * ## The deadline is a count of days before it is a colour
 *
 * "12 days to the target date" and "40 days past the target date" are different sentences with
 * different icons, and the overdue one changes the meter's word and hatch as well. Nothing about
 * being late is carried by hue alone — `docs/ACCESSIBILITY.md` §1.
 *
 * ## The base-currency line is secondary and looks it
 *
 * A goal in euro shows euro. The złoty equivalent sits underneath at caption size, because it is
 * an answer to a question the reader did not ask, at a rate that moves under them. It is absent
 * entirely — not zero — when no rate exists, which is the honest rendering of *unknown*.
 *
 * ## Archived is a surface and a badge, never an opacity
 *
 * Dropping the row to 60% opacity drops the contrast of its text by the same 60%, and this product
 * claims 7:1. The archived card moves to the sunken surface and wears a badge instead.
 */

export interface GoalCardProps {
  readonly goal: GoalSummary
  /** The row's menu. Supplied by the route, because it performs writes. */
  readonly actions?: ReactNode
}

export function GoalCard({ goal, actions }: GoalCardProps) {
  const t = useTranslate()
  const locale = useLocale()

  const state = goalStateOf(goal)
  const isArchived = goal.status === 'archived'

  return (
    <li
      className={cn(
        'relative flex flex-col gap-3 border-t border-border-subtle px-4 py-4 first:rounded-t-xl first:border-t-0 last:rounded-b-xl',
        'transition-colors duration-fast hover:bg-hover',
        isArchived && 'bg-surface-sunken',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-subtitle font-semibold text-ink">
            {/*
              The whole card is the target: the name is a real link with a real accessible name,
              stretched over the row by a pseudo-element. The actions trigger sits above that
              pseudo-element in the stacking order, so it stays pressable and stays its own tab
              stop — the failure mode of every "clickable card" that wraps its own buttons.
            */}
            <Link
              to="/goals/$goalId"
              params={{ goalId: goal.id }}
              className={cn(
                'rounded-sm outline-focus after:absolute after:inset-0 after:content-[""]',
                'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2',
              )}
            >
              {goal.name}
            </Link>
          </h2>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock aria-hidden="true" className="size-3.5 shrink-0" />
              {goal.targetDate === null
                ? t('goals.target.none')
                : t('goals.target.by', {
                    date: formatCalendarDate(locale, goal.targetDate, 'medium'),
                  })}
            </span>

            {goal.daysToTarget === null || goal.status !== 'active' ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span className={goal.isOverdue ? 'text-warning' : undefined}>
                  {goal.isOverdue
                    ? t('goals.target.overdue', {
                        count: -goal.daysToTarget,
                      })
                    : t('goals.target.daysLeft', { count: goal.daysToTarget })}
                </span>
              </>
            )}

            {goal.contributionCount === 0 ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('goals.contributions.count', {
                    count: goal.contributionCount,
                  })}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="relative z-10 flex shrink-0 items-center gap-2">
          {isArchived ? (
            <Badge tone="neutral">{t('goals.status.archived')}</Badge>
          ) : null}
          {actions}
        </div>
      </div>

      <GoalMeter
        name={goal.name}
        targetMinor={goal.targetMinor}
        contributedMinor={goal.contributedMinor}
        remainingMinor={goal.remainingMinor}
        ratio={goal.ratio}
        state={state}
        currencyCode={goal.currencyCode}
      />

      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-2">
        {goal.base === null ? null : (
          <BaseLine base={goal.base} locale={locale} />
        )}
        {goal.suggestions.length === 0 ? null : (
          <>
            {goal.base === null ? null : <span aria-hidden="true">·</span>}
            <span className="inline-flex items-center gap-1.5 text-brand">
              <Lightbulb aria-hidden="true" className="size-3.5 shrink-0" />
              {t('goals.suggestions.count', {
                count: goal.suggestions.length,
              })}
            </span>
          </>
        )}
      </p>
    </li>
  )
}

/**
 * The same goal in the workspace's own money.
 *
 * Its own component so the card's own read stays about the goal's currency, and so the `null` case
 * — no rate for the day — is a branch the caller makes rather than a `0` rendered here.
 */
function BaseLine({
  base,
  locale,
}: {
  readonly base: NonNullable<GoalSummary['base']>
  readonly locale: Locale
}) {
  const t = useTranslate()
  const money = (amountMinor: number) =>
    formatMoney(locale, makeMoney(amountMinor, base.baseCurrencyCode))

  return (
    <span className="tabular">
      {t('goals.progress.base', {
        contributed: money(base.contributedMinor),
        target: money(base.targetMinor),
        currency: base.baseCurrencyCode,
      })}
    </span>
  )
}
