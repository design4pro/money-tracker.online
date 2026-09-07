import { Link } from '@tanstack/react-router'

import { Badge } from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatCalendarDateRange, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import { BudgetMeter } from './budget-meter'
import { NoPeriodNote } from './no-period-note'

import type { ReactNode } from 'react'
import type { MessageKey } from '#/lib/i18n'
import type { BudgetSummary } from '#/server/budgets/summary'

/**
 * One envelope, as the list renders it.
 *
 * ## The remainder is the headline, and it is the first thing in the row
 *
 * Everything else on this card — the period, the categories, the alert ladder — is context for
 * one number. {@link BudgetMeter} sets it at the subtitle step directly above the track, so the
 * reader's eye lands on *how much is left* and then, if they want it, on what that is a share of.
 *
 * ## A card with no utilisation shows a sentence, never 0%
 *
 * A budget can be unmeasurable for three different reasons — it has not started, it has ended, or
 * its limit has no rate for the day — and `0%` would read as *nothing spent* in all three, which
 * is a lie with money in it. {@link NoPeriodNote} says which of the three it is.
 *
 * ## Archived is a surface and a badge, never an opacity
 *
 * Dropping the row to 60% opacity would drop the contrast of its text by the same 60%, and this
 * product claims 7:1. The archived card moves to the sunken surface and wears a badge instead —
 * both survive greyscale, neither makes the name harder to read.
 */

export interface BudgetCardProps {
  readonly budget: BudgetSummary
  /** The row's menu. Supplied by the route, because it performs writes. */
  readonly actions?: ReactNode
}

const PERIOD_LABELS: Record<string, MessageKey> = {
  one_off: 'budgets.period.one_off',
  weekly: 'budgets.period.weekly',
  monthly: 'budgets.period.monthly',
  quarterly: 'budgets.period.quarterly',
  yearly: 'budgets.period.yearly',
}

export function BudgetCard({ budget, actions }: BudgetCardProps) {
  const t = useTranslate()
  const locale = useLocale()

  const isArchived = budget.status === 'archived'
  const period = budget.current
  const utilisation = budget.utilisation

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
              to="/budgets/$budgetId"
              params={{ budgetId: budget.id }}
              className={cn(
                'rounded-sm outline-focus after:absolute after:inset-0 after:content-[""]',
                'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2',
              )}
            >
              {budget.name}
            </Link>
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-2">
            <span>
              {t(PERIOD_LABELS[budget.period] ?? 'budgets.period.monthly')}
            </span>
            {period === null ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {formatCalendarDateRange(
                    locale,
                    period.periodStart,
                    period.periodEnd,
                    'medium',
                  )}
                </span>
              </>
            )}
            {budget.kind === 'manual' ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t('budgets.kind.manual')}</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="relative flex shrink-0 items-center gap-2">
          {isArchived ? (
            <Badge tone="neutral">{t('budgets.status.archived')}</Badge>
          ) : null}
          {actions}
        </div>
      </div>

      {utilisation === null || period === null ? (
        <NoPeriodNote budget={budget} />
      ) : (
        <>
          <BudgetMeter
            name={budget.name}
            availableMinor={utilisation.availableMinor}
            spentMinor={utilisation.spentMinor}
            remainingMinor={utilisation.remainingMinor}
            ratio={utilisation.ratio}
            state={utilisation.state}
            thresholds={budget.thresholds}
            currencyCode={budget.currencyCode}
          />

          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-2">
            {budget.daysLeft === null ? null : (
              <span>{t('budgets.daysLeft', { count: budget.daysLeft })}</span>
            )}
            {period.carriedInMinor === 0 ? null : (
              <>
                <span aria-hidden="true">·</span>
                <CarryNote
                  carriedInMinor={period.carriedInMinor}
                  currencyCode={budget.currencyCode}
                />
              </>
            )}
            {budget.categories.length === 0 ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('budgets.categories.count', {
                    count: budget.categories.length,
                  })}
                </span>
              </>
            )}
          </p>
        </>
      )}
    </li>
  )
}

/**
 * The opening balance, in words as well as in sign.
 *
 * A negative carry is what `carry_all` does to an envelope that overran, and printing it as a
 * bare `−400,00 zł` beside "carried in" leaves the reader to work out whether that is good news.
 * The two cases have different sentences.
 */
function CarryNote({
  carriedInMinor,
  currencyCode,
}: {
  readonly carriedInMinor: number
  readonly currencyCode: string
}) {
  const t = useTranslate()
  const locale = useLocale()
  const amount = formatMoney(
    locale,
    makeMoney(Math.abs(carriedInMinor), currencyCode),
  )
  return (
    <span className={carriedInMinor < 0 ? 'text-negative' : undefined}>
      {carriedInMinor < 0
        ? t('budgets.carriedInNegative', { amount })
        : t('budgets.carriedIn', { amount })}
    </span>
  )
}
