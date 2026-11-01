import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus, Search } from 'lucide-react'
import { z } from 'zod'

import {
  RECURRING_PANES,
  RecurringEmptyState,
  RecurringListSkeleton,
  SeriesCard,
  UpcomingPanel,
} from '#/components/app/recurring'
import { SegmentedFilter } from '#/components/app/nav'
import { ErrorPanel } from '#/components/app/shell'
import { Button, Card, toast } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { listAccounts } from '#/server/fns/accounts'
import { listCategories } from '#/server/fns/categories'
import { listPayees } from '#/server/fns/payees'
import {
  completeSeries,
  loadRecurring,
  pauseSeries,
  resumeSeries,
  skipPeriod,
} from '#/server/fns/recurring'

import { useDataRefresh } from '../-lib/refresh'
import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'
import { MarkPaidDialog } from './-ui/mark-paid-dialog'
import { SeriesActionsMenu } from './-ui/series-actions-menu'
import { SeriesFormDialog } from './-ui/series-form-dialog'

import type { RecurringSeries } from '#/server/db/types'
import type { SeriesListRow } from '#/server/fns/recurring'
import type { UpcomingPeriod } from '#/server/repos/recurring'
import { pageHead } from '#/routes/-lib/page-title'

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
 * ## Due periods are settled from here
 *
 * Each row of *Due soon* carries Mark paid and Skip, which call the same server functions and open
 * the same dialog as the series detail screen. `?markPaid=<period start>&series=<id>` reopens that
 * dialog on a period - how the entry form brings somebody back once they have recorded the payment
 * the picker had nothing to offer for. It opens only on a period *Due soon* still lists, and the
 * address is cleaned when the dialog closes so a reload does not reopen it.
 *
 * ## The reference lists are loaded here, not in the dialog
 *
 * The form needs accounts, categories and payees, and the form is mounted only while it is open -
 * fetching there would open the dialog on three empty pickers and fill them a moment later. They
 * come with the list instead, where they are three small queries beside a much larger one.
 */

const searchSchema = z.object({
  status: z.enum(['active', 'all']).default('active'),
  markPaid: z.iso.date().optional().catch(undefined),
  series: z.string().trim().min(1).max(64).optional().catch(undefined),
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
  head: ({ matches }) => pageHead(matches, (t) => t('recurring.title')),
  component: RecurringListRoute,
})

function RecurringListError({ reset }: { readonly reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('recurring.error.title')}
      body={t('recurring.error.body')}
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
  | { kind: 'markPaid'; period: UpcomingPeriod; series: RecurringSeries }

/**
 * The dialog state for marking one listed period paid.
 *
 * A period is listed only for an active series and `rows` holds every active series, so the lookup
 * finds one; the `none` branch is what keeps the type honest rather than a case that is expected.
 */
function markPaidPending(
  rows: ReadonlyArray<SeriesListRow>,
  period: UpcomingPeriod,
): Pending {
  const series = rows.find((row) => row.series.id === period.seriesId)?.series
  return series === undefined
    ? { kind: 'none' }
    : { kind: 'markPaid', period, series }
}

function RecurringListRoute() {
  const t = useTranslate()
  const { overview, accounts, categories, payees } = Route.useLoaderData()
  const { status, markPaid, series: markPaidSeries } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [pending, setPending] = useState<Pending>(() => {
    const reopened = overview.upcoming.find(
      (candidate) =>
        candidate.periodStart === markPaid &&
        candidate.seriesId === markPaidSeries,
    )
    return reopened === undefined
      ? { kind: 'none' }
      : markPaidPending(overview.rows, reopened)
  })
  const close = () => {
    setPending({ kind: 'none' })
    if (markPaid !== undefined || markPaidSeries !== undefined) {
      void navigate({ search: { status }, replace: true })
    }
  }
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
      {/*
        The actions take a line of their own before they take the title's. Two buttons that will
        not shrink beside a heading that will is how `Recurring` comes to render as `R` with a pill
        painted over it, and how a 328px subtitle ends up in a 110px column one word per line.
        `flex-wrap` puts the break where the reader expects it; the action row wraps inside itself
        after that, so it never has to be narrower than a button.
      */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        {/*
          `basis-72` is what makes the break happen where it should. A wrap is decided on flex
          bases, and this block's natural one is its subtitle set on a single line - about 700px,
          wide enough to push the actions onto their own row on a 1280px desktop that has room for
          both. Stating the measure the heading actually needs puts the decision back on the
          actions: they sit beside the title wherever they fit and drop below it where they do not.
        */}
        <div className="min-w-0 grow basis-72">
          <h1 className="text-title font-bold text-ink">
            {t('recurring.title')}
          </h1>
          <p className="mt-1 max-w-prose text-body text-ink-2">
            {t('recurring.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        /*
          Two panes from `xl` up - the tracks and why they are what they are live on
          {@link RECURRING_PANES}, which the loading picture uses too.

          The DOM order moved with them, deliberately: `Due soon` now comes *after* the series
          list, so below `xl` it reads below the list rather than above it. The reason somebody
          opens `/recurring` is the series they keep; the rail is the aside. Doing it in the DOM
          rather than with `order` keeps the reading order and the visual order the same thing at
          every width, which is WCAG 1.3.2.
        */
        <div className={RECURRING_PANES}>
          <div className="flex min-w-0 flex-col gap-6">
            <SegmentedFilter
              label={t('recurring.filter.label')}
              value={status}
              options={[
                { id: 'active', label: t('recurring.filter.active') },
                { id: 'all', label: t('recurring.filter.all') },
              ]}
              onChange={(next: StatusFilter) => {
                void navigate({ search: { status: next } })
              }}
            />

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
          </div>

          <UpcomingPanel
            upcoming={overview.upcoming}
            openPeriod={pending.kind === 'markPaid' ? pending.period : null}
            onMarkPaid={(period) =>
              setPending(markPaidPending(overview.rows, period))
            }
            onSkip={(period) => {
              void skipPeriod({
                data: {
                  seriesId: period.seriesId,
                  periodStart: period.periodStart,
                },
              })
                .then(() => {
                  toast.success(t('recurring.toast.periodSkipped'))
                  refresh()
                })
                .catch(() => {
                  toast.error(t('recurring.toast.failed'))
                })
            }}
          />
        </div>
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

      {pending.kind === 'markPaid' ? (
        <MarkPaidDialog
          key={`${pending.period.seriesId}:${pending.period.periodStart}`}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          series={pending.series}
          period={pending.period}
          origin="list"
          onSaved={() => {
            toast.success(t('recurring.toast.periodPaid'))
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
