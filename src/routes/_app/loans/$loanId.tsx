import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { z } from 'zod'

import { LoanDetailSkeleton, LoanMeter } from '#/components/app/loans'
import { ErrorPanel } from '#/components/app/shell'
import { Badge, Card } from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { loadLoanDetail } from '#/server/fns/loans'
import { pageHead } from '#/routes/-lib/page-title'

import { useDataRefresh } from '../-lib/refresh'
import { ScheduleTable } from './-ui/schedule-table'
import { SettleDialog } from './-ui/settle-dialog'

import type { MessageKey } from '#/lib/i18n'
import type { LoanKind } from '#/lib/enums'
import type { InstalmentView } from '#/server/repos/loans'

/**
 * `/loans/$loanId` — one liability and its imported schedule.
 *
 * Mark paid links an existing transaction. Overdue is derived. A buyout is a flagged row.
 */

const KIND_KEYS: Record<LoanKind, MessageKey> = {
  credit: 'loans.kind.credit',
  leasing: 'loans.kind.leasing',
  loan: 'loans.kind.loan',
  other: 'loans.kind.other',
}

const searchSchema = z.object({
  markPaid: z.coerce.number().int().min(1).optional().catch(undefined),
})

export const Route = createFileRoute('/_app/loans/$loanId')({
  validateSearch: searchSchema,
  loader: async ({ params }) =>
    loadLoanDetail({ data: { loanId: params.loanId } }),
  pendingComponent: LoanDetailSkeleton,
  errorComponent: LoanDetailError,
  head: ({ matches, loaderData }) =>
    pageHead(matches, (t) => loaderData?.summary.loan.name ?? t('loans.title')),
  component: LoanDetailRoute,
})

function LoanDetailError({
  error,
  reset,
}: {
  readonly error: Error
  readonly reset: () => void
}) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('loans.detail.error.title')}
      body={t('loans.detail.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

function LoanDetailRoute() {
  const t = useTranslate()
  const locale = useLocale()
  const detail = Route.useLoaderData()
  const { markPaid } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refreshCaches = useDataRefresh()
  const { loan } = detail.summary

  const reopened = detail.instalments.find(
    (row) => row.sequence === markPaid && row.derivedStatus !== 'paid',
  )
  const [pending, setPending] = useState<InstalmentView | null>(
    reopened ?? null,
  )

  const close = () => {
    setPending(null)
    if (markPaid !== undefined) {
      void navigate({ search: {}, replace: true })
    }
  }
  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  return (
    <div className="flex flex-col gap-6">
      <p>
        <Link
          to="/loans"
          className="inline-flex items-center gap-2 text-label font-semibold text-brand"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('loans.detail.back')}
        </Link>
      </p>

      <header className="flex flex-col gap-2">
        <h1 className="text-title font-bold text-ink">{loan.name}</h1>
        <p className="flex flex-wrap items-center gap-x-2 text-caption text-ink-2">
          <span>{t(KIND_KEYS[loan.kind as LoanKind] ?? KIND_KEYS.other)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {t(
              loan.book === 'business'
                ? 'loans.book.business'
                : 'loans.book.personal',
            )}
          </span>
          {loan.lender === null ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span>{loan.lender}</span>
            </>
          )}
          {loan.paymentDay ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{t('loans.paymentDay', { day: loan.paymentDay })}</span>
            </>
          ) : null}
          {loan.endsOn === null ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {t('loans.endsOn', {
                  date: formatCalendarDate(locale, loan.endsOn, 'medium'),
                })}
              </span>
            </>
          )}
        </p>
        {detail.summary.isOverdue ? (
          <Badge tone="warning">{t('loans.status.overdue')}</Badge>
        ) : null}
      </header>

      <Card padding="lg" className="flex flex-col gap-4">
        <LoanMeter summary={detail.summary} size="lg" />
      </Card>

      <ScheduleTable
        instalments={detail.instalments}
        currencyCode={loan.currencyCode}
        onMarkPaid={setPending}
      />

      {pending === null ? null : (
        <SettleDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          loanId={loan.id}
          accountId={loan.accountId}
          instalment={pending}
          onSaved={() => {
            close()
            refresh()
          }}
        />
      )}
    </div>
  )
}
