import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { z } from 'zod'

import {
  ForecastPanel,
  PeriodGrid,
  SeriesDetailSkeleton,
  useRecurringAction,
} from '#/components/app/recurring'
import { ErrorPanel } from '#/components/app/shell'
import { Badge, Button, Card, toast } from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import { listAccounts } from '#/server/fns/accounts'
import { listCategories } from '#/server/fns/categories'
import { listPayees } from '#/server/fns/payees'
import {
  completeSeries,
  deleteSeries,
  loadSeriesDetail,
  pauseSeries,
  resumeSeries,
  revertPeriod,
  skipPeriod,
  unlinkTransaction,
} from '#/server/fns/recurring'

import { useDataRefresh } from '../-lib/refresh'
import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'
import { MarkPaidDialog } from './-ui/mark-paid-dialog'
import { SeriesActionsMenu } from './-ui/series-actions-menu'
import { SeriesFormDialog } from './-ui/series-form-dialog'

import type {
  RecurringFrequency,
  RecurringKind,
  TransactionDirection,
} from '#/server/db/schema'
import type { PeriodView } from '#/server/repos/recurring'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/recurring/$seriesId` - one series, and the record of every period it has produced.
 *
 * ## The period grid is the screen
 *
 * Everything above it is the series' settings; the table is what it has actually done. It is a
 * real `<table>` with a status word per row and real buttons per row, because *mark this one paid*
 * is the action somebody came here to perform and burying it behind a per-row menu adds a click to
 * the only thing the screen is for.
 *
 * ## Nothing here creates a transaction
 *
 * *Mark paid* links an existing row. The dialog says so, and this screen says so again in the
 * table's own caption area. A screen that could mint money from a button labelled *mark paid* is a
 * screen where a mis-click adds a payment nobody made.
 *
 * ## The picker can be reopened from the address
 *
 * `?markPaid=<period start>` opens the mark-paid dialog on that period. It is how the entry form
 * brings a person back after they recorded the payment the picker had nothing to offer for. It opens
 * only on a period this series still holds unsettled; any other value is ignored, and the address is
 * cleaned when the dialog closes so a reload does not reopen it.
 *
 * ## Delete is offered here and nowhere else
 *
 * `deleteSeries` refuses once a period has settled, and this is the only screen that knows how
 * many have. Offering the action on the list would mean offering one that may simply refuse.
 */

const searchSchema = z.object({
  markPaid: z.iso.date().optional().catch(undefined),
})

export const Route = createFileRoute('/_app/recurring/$seriesId')({
  validateSearch: searchSchema,
  loader: async ({ params }) => {
    const [detail, accounts, categories, payees] = await Promise.all([
      loadSeriesDetail({ data: { seriesId: params.seriesId } }),
      listAccounts({ data: {} }),
      listCategories({ data: {} }),
      listPayees({ data: {} }),
    ])
    return { detail, accounts, categories, payees }
  },
  pendingComponent: SeriesDetailSkeleton,
  errorComponent: SeriesDetailError,
  head: ({ matches, loaderData }) =>
    pageHead(
      matches,
      (t) => loaderData?.detail.series.name ?? t('recurring.title'),
    ),
  component: SeriesDetailRoute,
})

function SeriesDetailError({
  error,
  reset,
}: {
  readonly error: Error
  readonly reset: () => void
}) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('recurring.detail.error.title')}
      body={t('recurring.detail.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

type Pending =
  | { kind: 'none' }
  | { kind: 'form' }
  | { kind: 'pause' }
  | { kind: 'complete' }
  | { kind: 'delete' }
  | { kind: 'markPaid'; period: PeriodView }

function SeriesDetailRoute() {
  const t = useTranslate()
  const locale = useLocale()
  const { detail, accounts, categories, payees } = Route.useLoaderData()
  const { markPaid } = Route.useSearch()
  const navigate = Route.useNavigate()
  const refreshCaches = useDataRefresh()
  const runAction = useRecurringAction(refreshCaches)

  const [pending, setPending] = useState<Pending>(() => {
    const reopened = detail.periods.find(
      (candidate) =>
        candidate.periodStart === markPaid &&
        candidate.derivedStatus !== 'paid' &&
        candidate.derivedStatus !== 'skipped',
    )
    return reopened === undefined || !detail.series.isActive
      ? { kind: 'none' }
      : { kind: 'markPaid', period: reopened }
  })
  const close = () => {
    setPending({ kind: 'none' })
    if (markPaid !== undefined) {
      void navigate({ search: {}, replace: true })
    }
  }

  const { series, periods, links, forecast } = detail
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
      <Link
        to="/recurring"
        className="inline-flex items-center gap-1.5 self-start rounded-sm text-label text-ink-2 outline-focus hover:text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('recurring.detail.back')}
      </Link>

      <Card className="flex flex-col gap-4">
        {/* The status badge and the menu wrap under the name rather than across it - see
            `series-card.tsx` for why a `shrink-0` pill beside a shrinking heading loses. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-title font-bold text-ink">{series.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-2">
              <span>{t(`recurring.kind.${series.kind as RecurringKind}`)}</span>
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
              <span>
                {t('recurring.form.startDate')}
                {': '}
                {formatCalendarDate(locale, series.startDate, 'medium')}
              </span>
            </p>
          </div>
          <div className="ms-auto flex shrink-0 items-center gap-2">
            <Badge tone={series.isActive ? 'brand' : 'neutral'}>
              {t(
                series.isActive
                  ? 'recurring.series.active'
                  : 'recurring.series.paused',
              )}
            </Badge>
            <SeriesActionsMenu
              series={series}
              onEdit={() => setPending({ kind: 'form' })}
              onPause={() => setPending({ kind: 'pause' })}
              onResume={() => {
                void runAction(
                  () => resumeSeries({ data: { seriesId: series.id } }),
                  t('recurring.toast.resumed'),
                )
              }}
              onComplete={() => setPending({ kind: 'complete' })}
              onDelete={() => setPending({ kind: 'delete' })}
            />
          </div>
        </div>

        <p className="text-display font-bold tabular text-ink">
          {formatMoney(
            locale,
            makeMoney(series.expectedAmountMinor, series.expectedCurrencyCode),
          )}
        </p>

        {series.dutyCode === null ? null : (
          <p className="text-caption text-ink-2">
            {t('recurring.duty.disclaimer')}
          </p>
        )}

        <p className="flex flex-wrap items-center gap-2">
          {series.dutyCode === null ? null : (
            <Badge tone="neutral">{t('recurring.duty.badge')}</Badge>
          )}
          {series.autoRecord ? (
            <Badge tone="info">{t('recurring.automation.badge.auto')}</Badge>
          ) : series.matchingRules === null ? null : (
            <Badge tone="info">{t('recurring.automation.badge.match')}</Badge>
          )}
        </p>
      </Card>

      {series.direction === 'expense' ? (
        <ForecastPanel forecasts={[forecast]} />
      ) : null}

      <Card className="flex flex-col gap-3">
        <h2 className="text-subtitle font-semibold text-ink">
          {t('recurring.periods.title')}
        </h2>
        <p className="text-caption text-ink-2">
          {t('recurring.markPaid.never')}
        </p>
        <PeriodGrid
          periods={periods}
          copy={series.dutyCode === null ? 'series' : 'duty'}
          isReadOnly={!series.isActive}
          openPeriodStart={
            pending.kind === 'markPaid' ? pending.period.periodStart : null
          }
          onMarkPaid={(period) => setPending({ kind: 'markPaid', period })}
          onSkip={(period) => {
            void runAction(
              () =>
                skipPeriod({
                  data: {
                    seriesId: series.id,
                    periodStart: period.periodStart,
                  },
                }),
              t('recurring.toast.periodSkipped'),
            )
          }}
          onRevert={(period) => {
            void runAction(
              () =>
                revertPeriod({
                  data: {
                    seriesId: series.id,
                    periodStart: period.periodStart,
                  },
                }),
              t('recurring.toast.periodReverted'),
            )
          }}
        />
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-subtitle font-semibold text-ink">
          {t('recurring.links.title')}
        </h2>
        <p className="text-caption text-ink-2">
          {t('recurring.links.caption')}
        </p>
        {links.length === 0 ? (
          <p className="text-body text-ink-2">{t('recurring.links.empty')}</p>
        ) : (
          <ul className="flex flex-col">
            {links.map((link) => (
              <li
                key={link.transactionId}
                className="flex items-center justify-between gap-3 border-t border-border-subtle py-2 first:border-t-0"
              >
                <span className="min-w-0 text-label text-ink">
                  <Link
                    to="/transactions/$transactionId"
                    params={{ transactionId: link.transactionId }}
                    className="rounded-sm underline-offset-2 outline-focus hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
                  >
                    {`${formatCalendarDate(locale, link.bookedOn, 'medium')} · ${formatMoney(
                      locale,
                      makeMoney(link.amountMinor, link.currencyCode),
                    )}`}
                  </Link>
                  {link.note === null ? null : (
                    <span className="block text-caption text-ink-2">
                      {link.note}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-caption text-ink-2">
                    {t(
                      link.matchSource === 'auto'
                        ? 'recurring.links.source.auto'
                        : link.matchSource === 'rule'
                          ? 'recurring.links.source.rule'
                          : 'recurring.links.source.manual',
                    )}
                  </span>
                  {link.status === 'unlinked' ? (
                    <Badge tone="neutral">
                      {t('recurring.links.unlinked')}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        void runAction(
                          () =>
                            unlinkTransaction({
                              data: {
                                seriesId: series.id,
                                transactionId: link.transactionId,
                              },
                            }),
                          t('recurring.toast.unlinked'),
                        )
                      }}
                    >
                      {t('recurring.links.unlink')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pending.kind === 'form' ? (
        <SeriesFormDialog
          key={series.id}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          series={series}
          accounts={accountRefs}
          categories={categories}
          payees={payeeRefs}
          currencyOptions={[series.expectedCurrencyCode]}
          baseCurrencyCode={series.expectedCurrencyCode}
          onSaved={() => {
            toast.success(t('recurring.toast.saved'))
            close()
            void refreshCaches()
          }}
        />
      ) : null}

      {pending.kind === 'markPaid' ? (
        <MarkPaidDialog
          key={pending.period.periodStart}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          series={series}
          period={pending.period}
          origin="series"
          onSaved={() => {
            toast.success(t('recurring.toast.periodPaid'))
            close()
            void refreshCaches()
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
            await pauseSeries({ data: { seriesId: series.id } })
            toast.success(t('recurring.toast.paused'))
            close()
            void refreshCaches()
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
            await completeSeries({ data: { seriesId: series.id } })
            toast.success(t('recurring.toast.completed'))
            close()
            void refreshCaches()
          }}
        />
      ) : null}

      {pending.kind === 'delete' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          isDestructive
          title={t('recurring.confirm.delete.title')}
          body={t('recurring.confirm.delete.body')}
          confirmLabel={t('recurring.actions.delete')}
          errorTitle={t('recurring.toast.failed')}
          errorBody={t('recurring.confirm.delete.body')}
          onConfirm={async () => {
            await deleteSeries({ data: { seriesId: series.id } })
            toast.success(t('recurring.toast.deleted'))
            close()
            refreshCaches()
            void navigate({ to: '/recurring' })
          }}
        />
      ) : null}
    </div>
  )
}
