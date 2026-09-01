import { createFileRoute } from '@tanstack/react-router'
import { CalendarClock } from 'lucide-react'

import { EmptyState } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import { transactionSearchSchema } from './-lib/filters'
import { TransactionsScreen } from './-ui/transactions-screen'

import type { TransactionPolicies } from '#/server/repos/transactions'
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
 * The filter bar, the keyboard map and the totals are the same composition the main ledger uses, so
 * the two screens cannot drift apart in the ways a reader would notice.
 */

const PLANNED_POLICIES: TransactionPolicies = {
  planned: 'only',
  adjustments: 'exclude',
  transfers: 'include',
  completeness: 'any',
}

export const Route = createFileRoute('/_app/transactions/planned')({
  validateSearch: transactionSearchSchema,
  component: PlannedTransactionsRoute,
})

function PlannedTransactionsRoute() {
  const t = useTranslate()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-semibold text-ink">
          {t('transactions.planned.title')}
        </h1>
        <p className="max-w-prose text-caption text-ink-2">
          {t('transactions.planned.subtitle')}
        </p>
      </header>

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
          />
        }
      />
    </div>
  )
}
