import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { z } from 'zod'

import { ErrorPanel } from '#/components/app/accounts'
import {
  BudgetCard,
  BudgetEmptyState,
  BudgetListSkeleton,
  budgetListClass,
} from '#/components/app/budgets'
import { SegmentedFilter } from '#/components/app/nav'
import { Button, Card, toast } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { listCategories } from '#/server/fns/categories'
import { archiveBudget, loadBudgets, restoreBudget } from '#/server/fns/budgets'

import { useDataRefresh } from '../-lib/refresh'
import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'
import { BudgetActionsMenu } from './-ui/budget-actions-menu'
import { BudgetFormDialog } from './-ui/budget-form-dialog'

import type { BudgetKind } from '#/server/db/schema'
import type { BudgetSummary } from '#/server/budgets/summary'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/budgets` — the list, and the one question it answers.
 *
 * ## The filter lives in the URL
 *
 * `?status=archived` is a bookmark, a back button and a link somebody can send. Holding it in
 * component state would make all three lie. `loaderDeps` ties the loader to it, so changing the
 * filter refetches without a manual invalidate.
 *
 * ## One request for the meters and the rows
 *
 * `loadBudgets` returns each budget's current-period utilisation with the budget, for the same
 * reason `listAccounts` returns its overview with its rows: this is a screen whose whole point is
 * *how much is left*, and a second round trip for the meters is a second chance to paint a page
 * with the numbers missing.
 *
 * ## The categories are loaded here, not in the dialog
 *
 * The form needs them and the form is mounted only while it is open — fetching there would open
 * the dialog on an empty picker and fill it a moment later. They come with the list instead,
 * where they are one small query beside a much larger one.
 */

const searchSchema = z.object({
  status: z.enum(['active', 'archived', 'all']).default('active'),
})

type StatusFilter = z.infer<typeof searchSchema>['status']

export const Route = createFileRoute('/_app/budgets/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => {
    const [budgets, categories] = await Promise.all([
      loadBudgets({ data: { includeArchived: deps.status !== 'active' } }),
      listCategories({ data: {} }),
    ])
    return { budgets, categories }
  },
  pendingComponent: BudgetListSkeleton,
  errorComponent: BudgetsListError,
  head: ({ matches }) => pageHead(matches, (t) => t('budgets.title')),
  component: BudgetsListRoute,
})

function BudgetsListError({
  error,
  reset,
}: {
  readonly error: Error
  readonly reset: () => void
}) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('budgets.error.title')}
      body={t('budgets.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

/** What the route is currently asking the reader to confirm, if anything. */
type Pending =
  | { kind: 'none' }
  | { kind: 'form'; budget: BudgetSummary | null; budgetKind?: BudgetKind }
  | { kind: 'archive'; budget: BudgetSummary }
  | { kind: 'restore'; budget: BudgetSummary }

function BudgetsListRoute() {
  const t = useTranslate()
  const { budgets, categories } = Route.useLoaderData()
  const { status } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [pending, setPending] = useState<Pending>({ kind: 'none' })
  const close = () => setPending({ kind: 'none' })
  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  const shown =
    status === 'archived'
      ? budgets.filter((budget) => budget.status === 'archived')
      : budgets

  const baseCurrencyCode = budgets.at(0)?.currencyCode ?? 'PLN'
  const currencyOptions = [
    ...new Set([
      baseCurrencyCode,
      ...budgets.map((budget) => budget.budgetCurrencyCode),
    ]),
  ]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        {/* The heading states its own measure, so the actions decide the wrap rather than
            the subtitle's ideal line - see `recurring/index.tsx`. */}
        <div className="min-w-0 grow basis-72">
          <h1 className="text-title font-bold text-ink">
            {t('budgets.title')}
          </h1>
          <p className="mt-1 max-w-prose text-body text-ink-2">
            {t('budgets.subtitle')}
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" />}
          onPress={() => setPending({ kind: 'form', budget: null })}
        >
          {t('budgets.new')}
        </Button>
      </header>

      {budgets.length === 0 && status === 'active' ? (
        <BudgetEmptyState
          onCreate={(budgetKind) =>
            setPending({
              kind: 'form',
              budget: null,
              ...(budgetKind ? { budgetKind } : {}),
            })
          }
        />
      ) : (
        <>
          <SegmentedFilter
            label={t('budgets.filter.label')}
            value={status}
            options={[
              { id: 'active', label: t('budgets.filter.active') },
              { id: 'archived', label: t('budgets.filter.archived') },
              { id: 'all', label: t('budgets.filter.all') },
            ]}
            onChange={(next: StatusFilter) => {
              void navigate({ search: { status: next } })
            }}
          />

          {shown.length === 0 ? (
            <Card padding="lg" className="text-center">
              <h2 className="text-subtitle font-semibold text-ink">
                {t('budgets.empty.archived.title')}
              </h2>
              <p className="mt-1 text-body text-ink-2">
                {t('budgets.empty.archived.body')}
              </p>
            </Card>
          ) : (
            /* Two columns from `lg` when there are two budgets to put on a row, the list band when
               there is only one. Both cases and why they differ: {@link budgetListClass}. */
            <ul className={budgetListClass(shown.length)}>
              {shown.map((budget) => (
                <BudgetCard
                  key={budget.id}
                  budget={budget}
                  actions={
                    <BudgetActionsMenu
                      budget={budget}
                      onEdit={() => setPending({ kind: 'form', budget })}
                      onArchive={() => setPending({ kind: 'archive', budget })}
                      onRestore={() => setPending({ kind: 'restore', budget })}
                    />
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}

      {pending.kind === 'form' ? (
        <BudgetFormDialog
          key={pending.budget?.id ?? 'new'}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          budget={pending.budget}
          selectedCategoryIds={
            pending.budget?.categories.map((category) => category.id) ?? []
          }
          {...(pending.budgetKind ? { initialKind: pending.budgetKind } : {})}
          categories={categories}
          currencyOptions={currencyOptions}
          baseCurrencyCode={baseCurrencyCode}
          onSaved={(mode) => {
            toast.success(
              t(
                mode === 'created'
                  ? 'budgets.toast.created'
                  : 'budgets.toast.saved',
              ),
            )
            close()
            refresh()
          }}
        />
      ) : null}

      {pending.kind === 'archive' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={t('budgets.confirm.archive.title')}
          body={t('budgets.confirm.archive.body')}
          confirmLabel={t('budgets.confirm.archive.action')}
          errorTitle={t('budgets.toast.failed')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            await archiveBudget({ data: { budgetId: pending.budget.id } })
            toast.success(t('budgets.toast.archived'))
            close()
            refresh()
          }}
        />
      ) : null}

      {pending.kind === 'restore' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={t('budgets.actions.restore')}
          body={t('budgets.confirm.restore.body')}
          confirmLabel={t('budgets.actions.restore')}
          errorTitle={t('budgets.toast.failed')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            await restoreBudget({ data: { budgetId: pending.budget.id } })
            toast.success(t('budgets.toast.restored'))
            close()
            refresh()
          }}
        />
      ) : null}
    </div>
  )
}
