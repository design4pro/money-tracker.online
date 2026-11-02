import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { AlertTriangle, ArrowLeft, Lock, Unlock } from 'lucide-react'

import { Amount } from '#/components/app/accounts'
import {
  BudgetDetailSkeleton,
  BudgetMeter,
  CategoryAllocation,
  NoPeriodNote,
  PeriodTimeline,
  RolloverLedger,
} from '#/components/app/budgets'
import { ErrorPanel } from '#/components/app/shell'
import { Badge, Button, Card, Separator, toast } from '#/components/ui'
import { formatCalendarDateRange, useLocale, useTranslate } from '#/lib/i18n'
import { asCurrencyCode, formatMoney, makeMoney } from '#/lib/money'
import { listCategories } from '#/server/fns/categories'
import {
  archiveBudget,
  closeBudgetPeriod,
  deleteBudget,
  loadBudgetDetail,
  refreshBudgetPeriods,
  reopenBudgetPeriod,
  restoreBudget,
} from '#/server/fns/budgets'

import { useDataRefresh } from '../-lib/refresh'
import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'
import { BudgetActionsMenu } from './-ui/budget-actions-menu'
import { BudgetFormDialog } from './-ui/budget-form-dialog'

import type { MessageKey } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/budgets/$budgetId` — one envelope, and the record of every period it has had.
 *
 * ## The hero is the remainder, and everything under it is evidence for it
 *
 * The meter sits alone in the first card at the `lg` size, and the four figures beneath it are
 * the *terms* of the number it draws: gross spend, what came back in the same categories, what
 * was refunded elsewhere, and the net. `docs/MONEY.md` §4.4 requires an aggregation to say
 * whether it is gross or net; this says both, and shows the arithmetic.
 *
 * ## Corrections are surfaced, not swallowed
 *
 * A closed period whose dates no longer add up to what it stored is the case the materialised
 * table exists to make visible. It is reported here, against the open period, in a panel with a
 * warning icon and a sentence — never written back, because writing it back is the retroactive
 * rewrite the whole design refuses.
 *
 * ## Delete is offered here and nowhere else
 *
 * `deleteBudget` refuses once a period has closed, and this is the only screen that knows how
 * many have. Offering the action on the list would mean offering one that may simply refuse.
 */

export const Route = createFileRoute('/_app/budgets/$budgetId')({
  loader: async ({ params }) => {
    const [detail, categories] = await Promise.all([
      loadBudgetDetail({ data: { budgetId: params.budgetId } }),
      listCategories({ data: {} }),
    ])
    return { detail, categories }
  },
  pendingComponent: BudgetDetailSkeleton,
  errorComponent: BudgetDetailError,
  head: ({ matches, loaderData }) =>
    pageHead(
      matches,
      (t) => loaderData?.detail.summary.name ?? t('budgets.title'),
    ),
  component: BudgetDetailRoute,
})

function BudgetDetailError({ reset }: { readonly reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('budgets.detail.error.title')}
      body={t('budgets.detail.error.body')}
      onRetry={reset}
    />
  )
}

type Pending =
  | { kind: 'none' }
  | { kind: 'form' }
  | { kind: 'archive' }
  | { kind: 'restore' }
  | { kind: 'delete' }
  | { kind: 'closePeriod'; periodStart: string }
  | { kind: 'reopenPeriod'; periodStart: string }

const PERIOD_LABELS: Record<string, MessageKey> = {
  one_off: 'budgets.period.one_off',
  weekly: 'budgets.period.weekly',
  monthly: 'budgets.period.monthly',
  quarterly: 'budgets.period.quarterly',
  yearly: 'budgets.period.yearly',
}

function BudgetDetailRoute() {
  const t = useTranslate()
  const locale = useLocale()
  const { detail, categories } = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const refreshCaches = useDataRefresh()

  const [pending, setPending] = useState<Pending>({ kind: 'none' })
  const close = () => setPending({ kind: 'none' })
  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  const { summary, ledger, corrections, transactions, categoryIds } = detail
  const period = summary.current
  const utilisation = summary.utilisation
  const isArchived = summary.status === 'archived'
  const money = (amountMinor: number) =>
    formatMoney(locale, makeMoney(amountMinor, summary.currencyCode))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/budgets"
          className="inline-flex items-center gap-1.5 rounded-sm text-caption text-ink-2 outline-focus hover:text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {t('budgets.detail.back')}
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        {/* The heading states its own measure, so the actions decide the wrap rather than
            the subtitle's ideal line - see `recurring/index.tsx`. */}
        <div className="min-w-0 grow basis-72">
          <h1 className="text-title font-bold text-ink">{summary.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-ink-2">
            <span>
              {t(PERIOD_LABELS[summary.period] ?? 'budgets.period.monthly')}
            </span>
            <span aria-hidden="true">·</span>
            <span>{t(`budgets.rollover.${summary.rolloverPolicy}`)}</span>
            {summary.budgetCurrencyCode === summary.currencyCode ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('budgets.limitIn', {
                    currency: summary.budgetCurrencyCode,
                  })}
                </span>
              </>
            )}
            {isArchived ? (
              <Badge tone="neutral">{t('budgets.status.archived')}</Badge>
            ) : null}
          </p>
        </div>

        <BudgetActionsMenu
          budget={summary}
          onEdit={() => setPending({ kind: 'form' })}
          onArchive={() => setPending({ kind: 'archive' })}
          onRestore={() => setPending({ kind: 'restore' })}
          onRefresh={async () => {
            await refreshBudgetPeriods({ data: { budgetId: summary.id } })
            toast.success(t('budgets.toast.refreshed'))
            refresh()
          }}
          onDelete={() => setPending({ kind: 'delete' })}
        />
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* This period                                                       */}
      {/* ---------------------------------------------------------------- */}
      <Card
        as="section"
        aria-labelledby="budget-period"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="budget-period"
            className="text-subtitle font-semibold text-ink"
          >
            {t('budgets.detail.thisPeriod')}
          </h2>
          {period === null ? null : (
            <p className="text-caption text-ink-2">
              {formatCalendarDateRange(
                locale,
                period.periodStart,
                period.periodEnd,
                'medium',
              )}
            </p>
          )}
        </div>

        {utilisation === null || period === null ? (
          <NoPeriodNote budget={summary} className="text-body" />
        ) : (
          <>
            <BudgetMeter
              size="lg"
              name={summary.name}
              availableMinor={utilisation.availableMinor}
              spentMinor={utilisation.spentMinor}
              remainingMinor={utilisation.remainingMinor}
              ratio={utilisation.ratio}
              state={utilisation.state}
              thresholds={summary.thresholds}
              currencyCode={summary.currencyCode}
            />

            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-2">
              {summary.daysLeft === null ? null : (
                <span>
                  {t('budgets.daysLeft', { count: summary.daysLeft })}
                </span>
              )}
              {period.carriedInMinor === 0 ? null : (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      period.carriedInMinor < 0 ? 'text-negative' : undefined
                    }
                  >
                    {t(
                      period.carriedInMinor < 0
                        ? 'budgets.carriedInNegative'
                        : 'budgets.carriedIn',
                      {
                        amount: '',
                      },
                    )}
                    <Amount
                      locale={locale}
                      amountMinor={Math.abs(period.carriedInMinor)}
                      currencyCode={summary.currencyCode}
                      size="sm"
                    />
                  </span>
                </>
              )}
            </p>

            <Separator />

            {/*
              The terms of the net figure, each under its own label. `docs/MONEY.md` §4.4: an
              aggregation has to say whether it is gross or net, and a screen that prints only the
              net cannot explain where 80,00 zł of it went.
            */}
            {summary.spend === null ? null : (
              <dl className="grid gap-4 sm:grid-cols-4">
                {(
                  [
                    ['budgets.detail.spentGross', summary.spend.grossMinor],
                    ['budgets.detail.credited', summary.spend.creditedMinor],
                    ['budgets.detail.refunded', summary.spend.refundedMinor],
                    ['budgets.detail.net', summary.spend.spentMinor],
                  ] as const
                ).map(([key, amountMinor]) => (
                  <div key={key}>
                    <dt className="text-micro tracking-label uppercase text-ink-2">
                      {t(key)}
                    </dt>
                    <dd className="mt-1">
                      <Amount
                        locale={locale}
                        amountMinor={amountMinor}
                        currencyCode={summary.currencyCode}
                        size="md"
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {isArchived || period.closed ? null : (
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Lock aria-hidden="true" className="size-4" />}
                  onPress={() =>
                    setPending({
                      kind: 'closePeriod',
                      periodStart: period.periodStart,
                    })
                  }
                >
                  {t('budgets.actions.closePeriod')}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Corrections                                                       */}
      {/* ---------------------------------------------------------------- */}
      {corrections.length === 0 ? null : (
        <Card
          as="section"
          aria-labelledby="budget-corrections"
          className="flex flex-col gap-3 border-warning"
        >
          <h2
            id="budget-corrections"
            className="flex items-center gap-2 text-subtitle font-semibold text-ink"
          >
            <AlertTriangle
              aria-hidden="true"
              className="size-4 shrink-0 text-warning"
            />
            {t('budgets.corrections.title')}
          </h2>
          <p className="text-body text-ink-2">
            {t('budgets.corrections.body')}
          </p>
          <ul className="flex flex-col gap-2">
            {corrections.map((correction) => (
              <li
                key={correction.periodStart}
                className="text-caption text-ink tabular"
              >
                {t('budgets.corrections.row', {
                  period: formatCalendarDateRange(
                    locale,
                    correction.periodStart,
                    correction.periodEnd,
                    'medium',
                  ),
                  stored: money(correction.storedSpentMinor),
                  actual: money(correction.actualSpentMinor),
                })}{' '}
                {/*
                  The delta carries its own sign, which is what tells a reader whether the period
                  grew or shrank without their having to subtract two formatted amounts in their
                  head — and the sign, not the tint, is what survives greyscale.
                */}
                <span
                  className={
                    correction.deltaMinor > 0
                      ? 'text-negative'
                      : 'text-positive'
                  }
                >
                  {t('budgets.corrections.delta', {
                    amount: money(correction.deltaMinor),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* The timeline                                                      */}
      {/* ---------------------------------------------------------------- */}
      <Card
        as="section"
        aria-labelledby="budget-timeline"
        className="flex flex-col gap-3"
      >
        <h2
          id="budget-timeline"
          className="text-subtitle font-semibold text-ink"
        >
          {t('budgets.timeline.title')}
        </h2>
        <PeriodTimeline
          rows={ledger}
          currencyCode={asCurrencyCode(summary.currencyCode)}
        />
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* The rollover ledger                                               */}
      {/* ---------------------------------------------------------------- */}
      <Card
        as="section"
        aria-labelledby="budget-ledger"
        className="flex flex-col gap-3"
      >
        <h2 id="budget-ledger" className="text-subtitle font-semibold text-ink">
          {t('budgets.ledger.title')}
        </h2>
        <RolloverLedger
          rows={ledger}
          policy={summary.rolloverPolicy}
          currencyCode={summary.currencyCode}
        />
        {ledger.some((row) => row.closed) && !isArchived ? (
          <div>
            <Button
              variant="ghost"
              size="sm"
              icon={<Unlock aria-hidden="true" className="size-4" />}
              onPress={() => {
                const last = [...ledger].reverse().find((row) => row.closed)
                if (last !== undefined) {
                  setPending({
                    kind: 'reopenPeriod',
                    periodStart: last.periodStart,
                  })
                }
              }}
            >
              {t('budgets.actions.reopenPeriod')}
            </Button>
          </div>
        ) : null}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Allocation                                                        */}
      {/* ---------------------------------------------------------------- */}
      <Card
        as="section"
        aria-labelledby="budget-allocation"
        className="flex flex-col gap-3"
      >
        <h2
          id="budget-allocation"
          className="text-subtitle font-semibold text-ink"
        >
          {t('budgets.allocation.title')}
        </h2>
        <CategoryAllocation
          kind={summary.kind}
          categories={summary.categories}
          {...(isArchived
            ? {}
            : { onEdit: () => setPending({ kind: 'form' }) })}
        />
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* What counted                                                      */}
      {/* ---------------------------------------------------------------- */}
      <Card
        as="section"
        aria-labelledby="budget-transactions"
        className="flex flex-col gap-3"
      >
        <h2
          id="budget-transactions"
          className="text-subtitle font-semibold text-ink"
        >
          {t('budgets.transactions.title')}
        </h2>
        {transactions.length === 0 ? (
          <p className="text-body text-ink-2">
            {t('budgets.transactions.empty')}
          </p>
        ) : (
          <ul className="flex flex-col">
            {transactions.map((transaction) => (
              <li
                key={transaction.id}
                className="flex items-center justify-between gap-3 border-t border-border-subtle py-2 first:border-t-0"
              >
                <span className="min-w-0 truncate text-label text-ink">
                  {transaction.note ?? transaction.bookedOn}
                </span>
                <Amount
                  locale={locale}
                  amountMinor={transaction.refAmountMinor}
                  currencyCode={transaction.refCurrencyCode}
                  size="sm"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pending.kind === 'form' ? (
        <BudgetFormDialog
          key={summary.id}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          budget={summary}
          selectedCategoryIds={categoryIds}
          categories={categories}
          currencyOptions={[summary.currencyCode, summary.budgetCurrencyCode]}
          baseCurrencyCode={summary.currencyCode}
          onSaved={() => {
            toast.success(t('budgets.toast.saved'))
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
            await archiveBudget({ data: { budgetId: summary.id } })
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
          body={t('budgets.confirm.archive.body')}
          confirmLabel={t('budgets.actions.restore')}
          errorTitle={t('budgets.toast.failed')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            await restoreBudget({ data: { budgetId: summary.id } })
            toast.success(t('budgets.toast.restored'))
            close()
            refresh()
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
          title={t('budgets.confirm.delete.title')}
          body={t('budgets.confirm.delete.body')}
          confirmLabel={t('budgets.confirm.delete.action')}
          errorTitle={t('budgets.toast.failed')}
          errorBody={t('budgets.confirm.delete.body')}
          onConfirm={async () => {
            await deleteBudget({ data: { budgetId: summary.id } })
            toast.success(t('budgets.toast.deleted'))
            close()
            await navigate({ to: '/budgets' })
          }}
        />
      ) : null}

      {pending.kind === 'closePeriod' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={t('budgets.confirm.closePeriod.title')}
          body={t('budgets.confirm.closePeriod.body')}
          confirmLabel={t('budgets.confirm.closePeriod.action')}
          errorTitle={t('budgets.toast.failed')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            await closeBudgetPeriod({
              data: {
                budgetId: summary.id,
                periodStart: pending.periodStart,
              },
            })
            toast.success(t('budgets.toast.periodClosed'))
            close()
            refresh()
          }}
        />
      ) : null}

      {pending.kind === 'reopenPeriod' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={t('budgets.confirm.reopenPeriod.title')}
          body={t('budgets.confirm.reopenPeriod.body')}
          confirmLabel={t('budgets.confirm.reopenPeriod.action')}
          errorTitle={t('budgets.toast.failed')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            await reopenBudgetPeriod({
              data: {
                budgetId: summary.id,
                periodStart: pending.periodStart,
              },
            })
            toast.success(t('budgets.toast.periodReopened'))
            close()
            refresh()
          }}
        />
      ) : null}
    </div>
  )
}
