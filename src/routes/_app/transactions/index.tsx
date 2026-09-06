import { createFileRoute } from '@tanstack/react-router'

import {
  KeyboardShortcuts,
  TransactionsEmpty,
} from '#/components/app/transactions'
import { useTranslate } from '#/lib/i18n'

import { transactionSearchSchema } from './-lib/filters'
import { TransactionsScreen } from './-ui/transactions-screen'

import type { TransactionPolicies } from '#/server/repos/transactions'
import { pageHead } from '#/routes/-lib/page-title'
import type { TransactionSearch } from './-lib/filters'

/**
 * `/transactions` — the ledger.
 *
 * ## The policies are written out here
 *
 * Every read of `transactions` states what it is doing about planned rows, corrections, transfer
 * legs and uncategorised rows, and there is no default anywhere in the stack to fall back on. This
 * view is "what has actually happened to my money": planned entries are excluded because they have
 * not happened, corrections are included because they are real movements, transfer legs are
 * included because a ledger that hid them would not reconcile against a statement, and completeness
 * is `any` because an uncategorised row is still a row that happened.
 *
 * Spelling it out at the call site is the point — a constant named `DEFAULT_POLICIES` would put
 * this decision somewhere a reviewer does not look.
 *
 * ## `validateSearch` is the filter state
 *
 * The whole filter set is in the query string, so this page is shareable and the back button walks
 * the narrowing history. Unknown parameters are stripped rather than rejected: a link decorated
 * with `?utm_source=…` has to render the ledger, not an error.
 */

const LEDGER_POLICIES: TransactionPolicies = {
  planned: 'exclude',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

export const Route = createFileRoute('/_app/transactions/')({
  validateSearch: transactionSearchSchema,
  head: ({ matches }) => pageHead(matches, (t) => t('transactions.title')),
  component: TransactionsIndexRoute,
})

function TransactionsIndexRoute() {
  const t = useTranslate()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <div className="flex flex-col gap-5">
      {/*
        The keyboard contract used to be printed here as a subtitle, which spent the best line on
        the page on reference material. It now lives behind the `?` beside the heading — a button,
        and the `?` key — so it is still one gesture away and no longer in front of the ledger.
      */}
      <header className="flex items-center gap-1">
        <h1 className="text-title font-semibold text-ink">
          {t('transactions.title')}
        </h1>
        <KeyboardShortcuts />
      </header>

      <TransactionsScreen
        policies={LEDGER_POLICIES}
        search={search}
        onSearchChange={(next: TransactionSearch, options) =>
          void navigate({ search: next, replace: options.replace })
        }
        emptyState={
          <TransactionsEmpty
            onCreate={() =>
              void navigate({ to: '/transactions/new', search: {} })
            }
          />
        }
      />
    </div>
  )
}
