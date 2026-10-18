import { Link } from '@tanstack/react-router'

import { Badge, rowWash, rowWashSecondary } from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { ReactNode } from 'react'
import type { RecurringDutyCode } from '#/lib/enums'
import type {
  Book,
  RecurringFrequency,
  RecurringKind,
  TransactionDirection,
} from '#/lib/enums'
import type { SeriesListRow } from '#/server/fns/recurring'

/**
 * One series, as the list renders it.
 *
 * ## What is due is the headline, and it is a sentence
 *
 * The list exists to answer *what do I owe and what have I missed*. So the row leads with the
 * amount and then says, in words, where the next period stands: *Due 1 March*, *Due today*,
 * *3 days overdue*. Not a coloured dot, not a bare date the reader has to compare against today
 * in their head. `docs/ACCESSIBILITY.md` §1 - never colour alone - and the plain-language rule
 * from `DESIGN.md` both land on the same answer here.
 *
 * ## Overdue is counted, not implied
 *
 * A series that missed four months shows *4 overdue periods*, not four red rows the reader has to
 * count. That number is derived per render against today rather than stored, so it cannot go
 * stale between the last cron tick and the page load.
 *
 * ## Paused is a surface and a badge, never an opacity
 *
 * Dropping the row to 60% opacity would drop the contrast of its text by the same 60%. The paused
 * card moves to the sunken surface and wears a badge instead - both survive greyscale, neither
 * makes the name harder to read.
 */

export interface SeriesCardProps {
  readonly row: SeriesListRow
  /** The day the list derived its statuses against. The card labels lateness against the same one. */
  readonly today: string
  /** The row's menu. Supplied by the route, because it performs writes. */
  readonly actions?: ReactNode
}

/** Whole days from `a` to `b`. Both are UTC calendar days; a day count is exact on a UTC epoch. */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  )
}

export function SeriesCard({ row, today, actions }: SeriesCardProps) {
  const t = useTranslate()
  const locale = useLocale()

  const { series, next, overdueCount } = row
  const isPaused = !series.isActive

  return (
    <li
      className={cn(
        'relative flex flex-col gap-3 border-t border-border-subtle px-4 py-4 first:rounded-t-xl first:border-t-0 last:rounded-b-xl',
        rowWash,
        isPaused && 'bg-surface-sunken',
      )}
    >
      {/*
        The badges and the menu take a line of their own before they take the name's. They are
        `shrink-0` and the name is not, so on a phone the card hands the whole deficit to the one
        word the card is about and a `Records automatically` pill lands on top of it. `ms-auto`
        keeps them at the end of whichever line they end up on.
      */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/*
            `h2`, not `h3`. A series is a top-level entry of `/recurring`, the same rank as the
            `Due soon` panel beside it - it was never a subsection of that panel, and only read
            like one while the panel happened to come first in the DOM. Now that the list leads,
            an `h3` here would announce the outline as `h1` then a series name with the level
            between them missing, which is the skip `docs/ACCESSIBILITY.md` rules out.
          */}
          <h2 className="text-subtitle font-semibold text-ink">
            {/*
              The whole card is the target: the name is a real link with a real accessible name,
              stretched over the row by a pseudo-element. The actions trigger sits above that
              pseudo-element in the stacking order, so it stays pressable and stays its own tab
              stop - the failure mode of every "clickable card" that wraps its own buttons.
            */}
            <Link
              to="/recurring/$seriesId"
              params={{ seriesId: series.id }}
              className={cn(
                'rounded-sm outline-focus after:absolute after:inset-0 after:content-[""]',
                'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2',
              )}
            >
              {series.name}
            </Link>
          </h2>
          <p
            className={cn(
              'mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption',
              rowWashSecondary,
            )}
          >
            <span>
              {series.dutyCode === null
                ? t(`recurring.kind.${series.kind as RecurringKind}`)
                : t(`recurring.duty.${series.dutyCode as RecurringDutyCode}`)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t(
                `recurring.frequency.${series.frequency as RecurringFrequency}`,
              )}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t(
                `recurring.direction.${series.direction as TransactionDirection}`,
              )}
            </span>
            <span aria-hidden="true">·</span>
            <span>{t(`book.${series.book as Book}`)}</span>
          </p>
        </div>

        <div className="relative z-10 ms-auto flex shrink-0 items-center gap-2">
          {isPaused ? (
            <Badge tone="neutral">{t('recurring.series.paused')}</Badge>
          ) : null}
          {series.dutyCode === null ? null : (
            <Badge tone="neutral">{t('recurring.duty.badge')}</Badge>
          )}
          {series.autoRecord ? (
            <Badge tone="info">{t('recurring.automation.badge.auto')}</Badge>
          ) : null}
          {actions}
        </div>
      </div>

      <p className="text-subtitle font-semibold tabular text-ink">
        {formatMoney(
          locale,
          makeMoney(series.expectedAmountMinor, series.expectedCurrencyCode),
        )}
      </p>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption">
        <DueNote next={next} today={today} />
        {overdueCount > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-negative">
              {t('recurring.due.overdueCount', { count: overdueCount })}
            </span>
          </>
        ) : null}
      </p>
    </li>
  )
}

/**
 * Where the next unsettled period stands, in a sentence.
 *
 * Four cases, four different sentences, because *Due 1 March* on the 4th is not a statement a
 * reader should have to turn into *three days late* themselves.
 */
function DueNote({
  next,
  today,
}: {
  readonly next: SeriesListRow['next']
  readonly today: string
}) {
  const t = useTranslate()
  const locale = useLocale()

  if (next === null) {
    return <span className={rowWashSecondary}>{t('recurring.due.none')}</span>
  }

  const days = daysBetween(today, next.dueOn)
  if (days < 0) {
    return (
      <span className="font-medium text-negative">
        {t('recurring.due.late', { count: -days })}
      </span>
    )
  }
  if (days === 0) {
    return (
      <span className="font-medium text-ink">{t('recurring.due.today')}</span>
    )
  }
  if (days <= 7) {
    return (
      <span className={rowWashSecondary}>
        {t('recurring.due.in', { count: days })}
      </span>
    )
  }
  return (
    <span className={rowWashSecondary}>
      {t('recurring.due.on', {
        date: formatCalendarDate(locale, next.dueOn, 'medium'),
      })}
    </span>
  )
}
