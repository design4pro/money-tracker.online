import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus, Search } from 'lucide-react'
import { z } from 'zod'

import { ErrorPanel } from '#/components/app/accounts'
import {
  PeriodStatusBadge,
  RecurringEmptyState,
  RecurringListSkeleton,
  SeriesCard,
} from '#/components/app/recurring'
import { Button, Card, Select, SelectItem, toast } from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import { listAccounts } from '#/server/fns/accounts'
import { listCategories } from '#/server/fns/categories'
import { listPayees } from '#/server/fns/payees'
import {
  completeSeries,
  loadRecurring,
  pauseSeries,
  resumeSeries,
} from '#/server/fns/recurring'

import { useDataRefresh } from '../-lib/refresh'
import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'
import { SeriesActionsMenu } from './-ui/series-actions-menu'
import { SeriesFormDialog } from './-ui/series-form-dialog'

import type { Key } from 'react-aria-components'
import type { RecurringSeries } from '#/server/db/types'
import type { UpcomingPeriod } from '#/server/repos/recurring'

/**
 * `/recurring` - the list, and the one question it answers.
 *
 * ## What is due and what is late, above everything else
 *
 * The screen opens with *Due soon*: every unsettled period in the next month plus everything
 * already overdue, however old. A bill missed in March is more urgent in September, not less, and
 * a window that quietly drops it hides the one row this screen exists for. The per-series cards
 * come after it, because *which of my subscriptions is which* is a question somebody asks second.
 *
 * ## The filter lives in the URL
 *
 * `?status=all` is a bookmark, a back button and a link somebody can send. Holding it in component
 * state would make all three lie. `loaderDeps` ties the loader to it, so changing the filter
 * refetches without a manual invalidate.
 *
 * ## The reference lists are loaded here, not in the dialog
 *
 * The form needs accounts, categories and payees, and the form is mounted only while it is open -
 * fetching there would open the dialog on three empty pickers and fill them a moment later. They
 * come with the list instead, where they are three small queries beside a much larger one.
 */

const searchSchema = z.object({
  status: z.enum(['active', 'all']).default('active'),
})

type StatusFilter = z.infer<typeof searchSchema>['status']

export const Route = createFileRoute('/_app/recurring/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => {
    const [overview, accounts, categories, payees] = await Promise.all([
      loadRecurring({ data: { includeInactive: deps.status === 'all' } }),
      listAccounts({ data: {} }),
      listCategories({ data: {} }),
      listPayees({ data: {} }),
    ])
    return { overview, accounts, categories, payees }
  },
  pendingComponent: RecurringListSkeleton,
  errorComponent: RecurringListError,
  component: RecurringListRoute,
})

function RecurringListError({
  error,
  reset,
}: {
  readonly error: Error
  readonly reset: () => void
}) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('recurring.error.title')}
      body={t('recurring.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

/** What the route is currently asking the reader to confirm, if anything. */
type Pending =
  | { kind: 'none' }
  | { kind: 'form'; series: RecurringSeries | null }
  | { kind: 'pause'; series: RecurringSeries }
  | { kind: 'complete'; series: RecurringSeries }

function RecurringListRoute() {
  const t = useTranslate()
  const { overview, accounts, categories, payees } = Route.useLoaderData()
  const { status } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [pending, setPending] = useState<Pending>({ kind: 'none' })
  const close = () => setPending({ kind: 'none' })
  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  const baseCurrencyCode =
    overview.rows.at(0)?.series.expectedCurrencyCode ?? 'PLN'
  const currencyOptions = [
    ...new Set([
      baseCurrencyCode,
      ...overview.rows.map((row) => row.series.expectedCurrencyCode),
    ]),
  ]
  const accountRefs = accounts.accounts.map((account) => ({
    id: account.id,
    name: account.name,
  }))
  const payeeRefs = payees.map((entry) => ({
    id: entry.payee.id,
    name: entry.payee.name,
  }))

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title font-bold text-ink">
            {t('recurring.title')}
          </h1>
          <p className="mt-1 text-body text-ink-2">{t('recurring.subtitle')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            icon={<Search aria-hidden="true" />}
            onPress={() => void navigate({ to: '/recurring/candidates' })}
          >
            {t('recurring.candidates.link')}
          </Button>
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" />}
            onPress={() => setPending({ kind: 'form', series: null })}
          >
            {t('recurring.new')}
          </Button>
        </div>
      </header>

      {overview.rows.length === 0 && status === 'active' ? (
        <RecurringEmptyState
          onCreate={() => setPending({ kind: 'form', series: null })}
          onDetect={() => void navigate({ to: '/recurring/candidates' })}
        />
      ) : (
        <>
          <UpcomingPanel upcoming={overview.upcoming} />

          <div className="w-full sm:max-w-xs">
            <Select
              label={t('recurring.filter.label')}
              selectedKey={status}
              onSelectionChange={(key: Key | null) => {
                if (key !== null) {
                  void navigate({ search: { status: key as StatusFilter } })
                }
              }}
            >
              <SelectItem id="active">
                {t('recurring.filter.active')}
              </SelectItem>
              <SelectItem id="all">{t('recurring.filter.all')}</SelectItem>
            </Select>
          </div>

          {overview.rows.length === 0 ? (
            <Card padding="lg" className="text-center">
              <h2 className="text-subtitle font-semibold text-ink">
                {t('recurring.empty.filtered.title')}
              </h2>
              <p className="mt-1 text-body text-ink-2">
                {t('recurring.empty.filtered.body')}
              </p>
            </Card>
          ) : (
            /* One card, hairlines between the rows. No `overflow-hidden`: a focus ring in this
               product is an `outline` and nothing may clip one - the rows round their own first
               and last corners instead. */
            <ul className="rounded-xl border border-border-subtle bg-surface shadow-card">
              {overview.rows.map((row) => (
                <SeriesCard
                  key={row.series.id}
                  row={row}
                  today={overview.today}
                  actions={
                    <SeriesActionsMenu
                      series={row.series}
                      onEdit={() =>
                        setPending({ kind: 'form', series: row.series })
                      }
                      onPause={() =>
                        setPending({ kind: 'pause', series: row.series })
                      }
                      onResume={() => {
                        void resumeSeries({
                          data: { seriesId: row.series.id },
                        }).then(() => {
                          toast.success(t('recurring.toast.resumed'))
                          refresh()
                        })
                      }}
                      onComplete={() =>
                        setPending({ kind: 'complete', series: row.series })
                      }
                    />
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}

      {pending.kind === 'form' ? (
        <SeriesFormDialog
          key={pending.series?.id ?? 'new'}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          series={pending.series}
          accounts={accountRefs}
          categories={categories}
          payees={payeeRefs}
          currencyOptions={currencyOptions}
          baseCurrencyCode={baseCurrencyCode}
          onSaved={(mode) => {
            toast.success(
              t(
                mode === 'created'
                  ? 'recurring.toast.created'
                  : 'recurring.toast.saved',
              ),
            )
            close()
            refresh()
          }}
        />
      ) : null}

      {pending.kind === 'pause' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={t('recurring.confirm.pause.title')}
          body={t('recurring.confirm.pause.body')}
          confirmLabel={t('recurring.actions.pause')}
          errorTitle={t('recurring.toast.failed')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            await pauseSeries({ data: { seriesId: pending.series.id } })
            toast.success(t('recurring.toast.paused'))
            close()
            refresh()
          }}
        />
      ) : null}

      {pending.kind === 'complete' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={t('recurring.confirm.complete.title')}
          body={t('recurring.confirm.complete.body')}
          confirmLabel={t('recurring.actions.complete')}
          errorTitle={t('recurring.toast.failed')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            await completeSeries({ data: { seriesId: pending.series.id } })
            toast.success(t('recurring.toast.completed'))
            close()
            refresh()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * What is due soon, and what is already late.
 *
 * A real `<table>`: this is tabular data somebody reads down a column, and it has no sorting, no
 * selection and no cell navigation, so the semantics that matter are the plain ones. The status is
 * a word in its own cell rather than a tint on the row - `docs/ACCESSIBILITY.md` §1 - and the
 * series name is a link, so the row is a route to the thing rather than a dead end.
 */
function UpcomingPanel({
  upcoming,
}: {
  readonly upcoming: ReadonlyArray<UpcomingPeriod>
}) {
  const t = useTranslate()
  const locale = useLocale()

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-subtitle font-semibold text-ink">
        {t('recurring.upcoming.title')}
      </h2>

      {upcoming.length === 0 ? (
        <p className="text-body text-ink-2">{t('recurring.upcoming.empty')}</p>
      ) : (
        <div
          role="region"
          aria-label={t('recurring.upcoming.title')}
          tabIndex={0}
          className="overflow-x-auto rounded-md outline-focus focus-safe focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
        >
          <table className="w-full border-collapse text-label">
            <caption className="pb-3 text-start text-caption text-ink-2">
              {t('recurring.upcoming.caption')}
            </caption>
            <thead>
              <tr className="border-b border-border-subtle">
                <th
                  scope="col"
                  className="px-3 py-2 text-start font-medium text-ink-2"
                >
                  {t('recurring.periods.col.due')}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-start font-medium text-ink-2"
                >
                  {t('recurring.form.name')}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-end font-medium text-ink-2"
                >
                  {t('recurring.periods.col.expected')}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-start font-medium text-ink-2"
                >
                  {t('recurring.periods.col.status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((period) => (
                <tr
                  key={`${period.seriesId}:${period.periodStart}`}
                  className="border-b border-border-subtle last:border-b-0"
                >
                  <th
                    scope="row"
                    className="whitespace-nowrap px-3 py-2 text-start font-medium text-ink"
                  >
                    {formatCalendarDate(locale, period.dueOn, 'medium')}
                  </th>
                  <td className="px-3 py-2">
                    <Link
                      to="/recurring/$seriesId"
                      params={{ seriesId: period.seriesId }}
                      className="rounded-sm text-ink underline-offset-2 outline-focus hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
                    >
                      {period.seriesName}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-end tabular text-ink">
                    {formatMoney(
                      locale,
                      makeMoney(
                        period.expectedAmountMinor,
                        period.expectedCurrencyCode,
                      ),
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <PeriodStatusBadge status={period.derivedStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
