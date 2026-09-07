import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { z } from 'zod'

import { ErrorPanel } from '#/components/app/accounts'
import {
  GoalCard,
  GoalEmptyState,
  GoalListSkeleton,
} from '#/components/app/goals'
import { Button, Card, Select, SelectItem, toast } from '#/components/ui'
import { listAccounts } from '#/server/fns/accounts'
import { archiveGoal, loadGoals, restoreGoal } from '#/server/fns/goals'

import { useDataRefresh } from '../-lib/refresh'
import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'
import { GoalActionsMenu } from './-ui/goal-actions-menu'
import { GoalFormDialog } from './-ui/goal-form-dialog'

import type { Key } from 'react-aria-components'
import type { GoalSummary } from '#/server/goals/summary'
import { useTranslate } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/goals` — every savings goal, and how far along each one is.
 *
 * ## The filter lives in the URL
 *
 * `?status=reached` is a bookmark, a back button and a link somebody can send; holding it in
 * component state would make all three lie. `loaderDeps` ties the loader to it, so changing the
 * filter refetches without a manual invalidate. Only the *archived* case changes what the server
 * is asked for — the other three are one list, filtered in the browser, because a goal list is a
 * handful of rows and a round trip to hide two of them is a round trip wasted.
 *
 * ## One request for the meters and the rows
 *
 * `loadGoals` returns each goal's progress, its base-currency line and its pending suggestions
 * with the goal, for the same reason `loadBudgets` returns its meters with its rows: this is a
 * screen whose whole point is *how far along am I*, and a second round trip for the meters is a
 * second chance to paint a page with the numbers missing.
 *
 * ## The accounts are loaded here, not in the dialog
 *
 * The form needs them for its two account pickers and the form is mounted only while it is open —
 * fetching there would open the dialog on empty pickers and fill them a moment later.
 */

const searchSchema = z.object({
  status: z.enum(['active', 'reached', 'archived', 'all']).default('active'),
})

type StatusFilter = z.infer<typeof searchSchema>['status']

export const Route = createFileRoute('/_app/goals/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => {
    const [goals, accounts] = await Promise.all([
      loadGoals({ data: { includeArchived: deps.status !== 'active' } }),
      listAccounts({ data: {} }),
    ])
    return { goals, accounts: accounts.accounts }
  },
  pendingComponent: GoalListSkeleton,
  errorComponent: GoalsListError,
  head: ({ matches }) => pageHead(matches, (t) => t('goals.title')),
  component: GoalsListRoute,
})

function GoalsListError({
  error,
  reset,
}: {
  readonly error: Error
  readonly reset: () => void
}) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('goals.error.title')}
      body={t('goals.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

/** What the route is currently asking the reader to confirm, if anything. */
type Pending =
  | { kind: 'none' }
  | { kind: 'form'; goal: GoalSummary | null }
  | { kind: 'archive'; goal: GoalSummary }
  | { kind: 'restore'; goal: GoalSummary }

/** Which statuses each filter shows. `all` is the absence of a filter, not a fourth set. */
const FILTERS: Record<StatusFilter, ReadonlySet<string> | null> = {
  active: new Set(['active']),
  reached: new Set(['reached']),
  archived: new Set(['archived']),
  all: null,
}

function GoalsListRoute() {
  const t = useTranslate()
  const { goals, accounts } = Route.useLoaderData()
  const { status } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [pending, setPending] = useState<Pending>({ kind: 'none' })
  const close = () => setPending({ kind: 'none' })
  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  const allowed = FILTERS[status]
  const shown =
    allowed === null ? goals : goals.filter((goal) => allowed.has(goal.status))

  const baseCurrencyCode = accounts.at(0)?.currencyCode ?? 'PLN'
  const currencyOptions = [
    ...new Set([
      baseCurrencyCode,
      ...accounts.map((account) => account.currencyCode),
    ]),
  ]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title font-bold text-ink">{t('goals.title')}</h1>
          <p className="mt-1 text-body text-ink-2">{t('goals.subtitle')}</p>
        </div>
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" />}
          onPress={() => setPending({ kind: 'form', goal: null })}
        >
          {t('goals.new')}
        </Button>
      </header>

      {goals.length === 0 && status === 'active' ? (
        <GoalEmptyState
          onCreate={() => setPending({ kind: 'form', goal: null })}
        />
      ) : (
        <>
          <div className="w-full sm:max-w-xs">
            <Select
              label={t('goals.filter.label')}
              selectedKey={status}
              onSelectionChange={(key: Key | null) => {
                if (key !== null) {
                  void navigate({ search: { status: key as StatusFilter } })
                }
              }}
            >
              <SelectItem id="active">{t('goals.filter.active')}</SelectItem>
              <SelectItem id="reached">{t('goals.filter.reached')}</SelectItem>
              <SelectItem id="archived">
                {t('goals.filter.archived')}
              </SelectItem>
              <SelectItem id="all">{t('goals.filter.all')}</SelectItem>
            </Select>
          </div>

          {shown.length === 0 ? (
            <Card padding="lg" className="text-center">
              <h2 className="text-subtitle font-semibold text-ink">
                {t('goals.empty.filtered.title')}
              </h2>
              <p className="mt-1 text-body text-ink-2">
                {t('goals.empty.filtered.body')}
              </p>
            </Card>
          ) : (
            /* One card, hairlines between the rows. No `overflow-hidden`: a focus ring in this
               product is an `outline` and nothing may clip one — the rows round their own first
               and last corners instead. */
            <ul className="rounded-xl border border-border-subtle bg-surface shadow-card">
              {shown.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  actions={
                    <GoalActionsMenu
                      goal={goal}
                      onEdit={() => setPending({ kind: 'form', goal })}
                      onArchive={() => setPending({ kind: 'archive', goal })}
                      onRestore={() => setPending({ kind: 'restore', goal })}
                    />
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}

      {pending.kind === 'form' ? (
        <GoalFormDialog
          key={pending.goal?.id ?? 'new'}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          goal={pending.goal}
          accounts={accounts}
          currencyOptions={currencyOptions}
          baseCurrencyCode={baseCurrencyCode}
          onSaved={(mode) => {
            toast.success(
              t(
                mode === 'created'
                  ? 'goals.toast.created'
                  : 'goals.toast.saved',
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
          title={t('goals.confirm.archive.title')}
          body={t('goals.confirm.archive.body')}
          confirmLabel={t('goals.confirm.archive.action')}
          errorTitle={t('goals.toast.failed')}
          errorBody={t('goals.error.body')}
          onConfirm={async () => {
            await archiveGoal({ data: { goalId: pending.goal.id } })
            toast.success(t('goals.toast.archived'))
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
          title={t('goals.actions.restore')}
          body={t('goals.confirm.archive.body')}
          confirmLabel={t('goals.actions.restore')}
          errorTitle={t('goals.toast.failed')}
          errorBody={t('goals.error.body')}
          onConfirm={async () => {
            await restoreGoal({ data: { goalId: pending.goal.id } })
            toast.success(t('goals.toast.restored'))
            close()
            refresh()
          }}
        />
      ) : null}
    </div>
  )
}
