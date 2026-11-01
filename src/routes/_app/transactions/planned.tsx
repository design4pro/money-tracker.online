import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { CalendarClock } from 'lucide-react'
import { z } from 'zod'

import { useRecurringAction } from '#/components/app/recurring'
import {
  KeyboardShortcuts,
  TransactionsModeSwitch,
} from '#/components/app/transactions'
import { EmptyState, toast } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { skipPeriod } from '#/server/fns/recurring'

import { useDataRefresh } from '../-lib/refresh'
import { MarkPaidDialog } from '../recurring/-ui/mark-paid-dialog'
import { transactionSearchSchema } from './-lib/filters'
import { TransactionsScreen } from './-ui/transactions-screen'

import type { ExpectationRow } from '#/components/app/transactions'
import type { TransactionPolicies } from '#/server/repos/transactions'
import { pageHead } from '#/routes/-lib/page-title'
import type { TransactionSearch } from './-lib/filters'

/**
 * `/transactions/planned` — what is coming, rather than what happened.
 *
 * ## Why a route and not a filter
 *
 * `{ planned: 'only' }` is a *policy*, not a narrowing, and the difference is the whole reason this
 * has its own address. A filter answers "which of these rows do I want to see"; a policy answers
 * "which rows is this screen about at all". Planned entries are excluded from balances until they
 * are confirmed, so a list of them totals to something that has not happened — a figure that would
 * be actively misleading sitting under the same heading as the real ledger.
 *
 * It also makes the mode linkable and bookmarkable, which "the ledger with a checkbox ticked" is
 * not.
 *
 * The {@link TransactionsModeSwitch} is how a person gets here and back, carrying the active
 * filters with them. It is a control on the screen and not a navigation entry: a mode is not an
 * area, and the navigation table was deliberately narrowed.
 *
 * The filter bar, the keyboard map and the totals are the same composition the main ledger uses, so
 * the two screens cannot drift apart in the ways a reader would notice.
 *
 * ## Recurring payments are listed here, and settled from here
 *
 * The screen also reads the recurring periods that have not settled and draws them as a group above
 * the planned entries (`TransactionsScreen`'s `expectations`). They are expectations, not planned
 * transactions: no row exists until one settles, and they are never added to the totals. This
 * route owns what settling them takes, because both ways are writes: **Skip** calls the same
 * server function `/recurring` does, and **Mark paid** opens the same dialog, with the entry form's
 * way back (`returnTo=planned`) reopening it through `?markPaid=<period start>&series=<id>`. The
 * address is cleaned when the dialog closes, so a reload does not reopen it.
 */

const plannedSearchSchema = transactionSearchSchema.extend({
  markPaid: z.iso.date().optional().catch(undefined),
  series: z.string().trim().min(1).max(64).optional().catch(undefined),
})

const PLANNED_POLICIES: TransactionPolicies = {
  planned: 'only',
  adjustments: 'exclude',
  transfers: 'include',
  completeness: 'any',
}

export const Route = createFileRoute('/_app/transactions/planned')({
  validateSearch: plannedSearchSchema,
  head: ({ matches }) =>
    pageHead(matches, (t) => t('transactions.planned.title')),
  component: PlannedTransactionsRoute,
})

function PlannedTransactionsRoute() {
  const t = useTranslate()
  const { markPaid, series, ...search } = Route.useSearch()
  const navigate = Route.useNavigate()
  const refresh = useDataRefresh()
  const runAction = useRecurringAction(refresh)

  const [pending, setPending] = useState<ExpectationRow | null>(null)
  const close = () => {
    setPending(null)
    if (markPaid !== undefined || series !== undefined) {
      void navigate({ search, replace: true })
    }
  }

  const skip = (row: ExpectationRow) => {
    void runAction(
      () =>
        skipPeriod({
          data: { seriesId: row.seriesId, periodStart: row.periodStart },
        }),
      t('recurring.toast.periodSkipped'),
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <h1 className="text-title font-semibold text-ink">
            {t('transactions.planned.title')}
          </h1>
          <KeyboardShortcuts />
        </div>
        <p className="max-w-prose text-caption text-ink-2">
          {t('transactions.planned.subtitle')}
        </p>
      </header>

      <TransactionsModeSwitch
        mode="planned"
        onChange={(next) => {
          if (next === 'recorded') {
            void navigate({ to: '/transactions', search })
          }
        }}
      />

      <TransactionsScreen
        policies={PLANNED_POLICIES}
        search={search}
        onSearchChange={(next: TransactionSearch, options) =>
          void navigate({ search: next, replace: options.replace })
        }
        emptyState={
          <EmptyState
            icon={<CalendarClock />}
            headingLevel={2}
            title={t('transactions.planned.empty.title')}
            description={t('transactions.planned.empty.body')}
            action={
              <Link
                to="/recurring"
                search={{ status: 'active' }}
                className="inline-flex target-min-h items-center rounded-sm text-body text-ink underline underline-offset-2 outline-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
              >
                {t('transactions.planned.empty.recurring')}
              </Link>
            }
          />
        }
        expectations={{
          onMarkPaid: setPending,
          onSkip: skip,
          openRowId: pending?.id ?? null,
          reopenId:
            markPaid !== undefined && series !== undefined
              ? `${series}:${markPaid}`
              : null,
        }}
      />

      {pending === null ? null : (
        <MarkPaidDialog
          key={pending.id}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          series={{
            id: pending.seriesId,
            direction: pending.direction,
            accountId: pending.accountId,
            categoryId: pending.categoryId,
            payeeId: pending.payeeId,
          }}
          period={{
            periodStart: pending.periodStart,
            dueOn: pending.dueOn,
            expectedAmountMinor: pending.expectedAmountMinor,
            expectedCurrencyCode: pending.currencyCode,
          }}
          origin="planned"
          onSaved={() => {
            toast.success(t('recurring.toast.periodPaid'))
            close()
            void refresh()
          }}
        />
      )}
    </div>
  )
}
