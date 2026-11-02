import { Link } from '@tanstack/react-router'
import { CalendarClock } from 'lucide-react'

import { Badge, rowWash, rowWashSecondary } from '#/components/ui'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import { LoanMeter } from './loan-meter'

import type { MessageKey } from '#/lib/i18n'
import type { LoanKind } from '#/lib/enums'
import type { LoanSummary } from '#/server/loans/summary'

/**
 * One liability, as the list renders it.
 *
 * The whole card is the target: the name is a real link stretched over the row. Overdue is a
 * word beside the next due date, never a colour on its own.
 */

export interface LoanCardProps {
  readonly summary: LoanSummary
}

const KIND_KEYS: Record<LoanKind, MessageKey> = {
  credit: 'loans.kind.credit',
  leasing: 'loans.kind.leasing',
  loan: 'loans.kind.loan',
  other: 'loans.kind.other',
}

const BOOK_KEYS = {
  business: 'loans.book.business',
  personal: 'loans.book.personal',
} as const

export function LoanCard({ summary }: LoanCardProps) {
  const t = useTranslate()
  const locale = useLocale()
  const { loan, next } = summary

  return (
    <li
      className={cn(
        'relative flex flex-col gap-3 border-t border-border-subtle px-4 py-4 first:rounded-t-xl first:border-t-0 last:rounded-b-xl',
        rowWash,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-subtitle font-semibold text-ink">
            <Link
              to="/loans/$loanId"
              params={{ loanId: loan.id }}
              className={cn(
                'rounded-sm outline-focus after:absolute after:inset-0 after:content-[""]',
                'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2',
              )}
            >
              {loan.name}
            </Link>
          </h2>
          <p
            className={cn(
              'mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption',
              rowWashSecondary,
            )}
          >
            <span>
              {t(KIND_KEYS[loan.kind as LoanKind] ?? KIND_KEYS.other)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t(
                loan.book === 'business'
                  ? BOOK_KEYS.business
                  : BOOK_KEYS.personal,
              )}
            </span>
            {loan.lender === null ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>{loan.lender}</span>
              </>
            )}
          </p>
        </div>
        {summary.isOverdue ? (
          <Badge tone="warning">{t('loans.status.overdue')}</Badge>
        ) : null}
      </div>

      <LoanMeter summary={summary} size="md" />

      {next === null ? (
        <p className={cn('text-caption', rowWashSecondary)}>
          {t('loans.next.none')}
        </p>
      ) : (
        <p
          className={cn(
            'flex flex-wrap items-center gap-x-2 text-caption',
            next.derivedStatus === 'overdue'
              ? 'text-warning'
              : rowWashSecondary,
          )}
        >
          <CalendarClock aria-hidden="true" className="size-3.5 shrink-0" />
          <span>
            {next.derivedStatus === 'overdue'
              ? t('loans.next.overdue', {
                  date: formatCalendarDate(locale, next.dueOn, 'medium'),
                  amount: formatMoney(
                    locale,
                    makeMoney(next.amountMinor, next.currencyCode),
                  ),
                })
              : t('loans.next.due', {
                  date: formatCalendarDate(locale, next.dueOn, 'medium'),
                  amount: formatMoney(
                    locale,
                    makeMoney(next.amountMinor, next.currencyCode),
                  ),
                })}
          </span>
        </p>
      )}
    </li>
  )
}
