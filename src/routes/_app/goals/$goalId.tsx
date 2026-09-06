import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, CalendarClock, CheckCircle2, Plus } from 'lucide-react'

import { Amount, ErrorPanel } from '#/components/app/accounts'
import {
  ContributionChart,
  ContributionList,
  GoalDetailSkeleton,
  GoalMeter,
  GoalProjection,
  SuggestionList,
  goalStateOf,
} from '#/components/app/goals'
import { Badge, Button, Card, Separator, toast } from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import { listAccounts } from '#/server/fns/accounts'
import {
  addGoalContribution,
  archiveGoal,
  deleteGoal,
  loadGoalDetail,
  recomputeGoalProgress,
  removeGoalContribution,
  restoreGoal,
} from '#/server/fns/goals'

import { useDataRefresh } from '../-lib/refresh'
import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'
import { ContributionDialog } from './-ui/contribution-dialog'
import { GoalActionsMenu } from './-ui/goal-actions-menu'
import { GoalFormDialog } from './-ui/goal-form-dialog'

import type { ReactNode } from 'react'
import type { GoalContribution } from '#/server/repos/goals'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/goals/$goalId` — one goal, its history, and an honest guess about when it lands.
 *
 * ## The order of the page is the order of the questions
 *
 * *How far along am I* (the hero meter), *when will I get there* (the projection, with its
 * confidence attached), *what has that looked like* (the chart), *which transactions were those*
 * (the history), and *is there anything I have forgotten to count* (the suggestions). Each block
 * is evidence for the one above it, which is why the projection sits directly under the meter
 * rather than at the bottom where a "stats" section would normally go.
 *
 * ## The projection is never presented as a fact
 *
 * `GoalProjection` is the component that enforces it. This route's only job is to hand it the
 * projection the server computed and the goal's target date; there is no arithmetic on this page
 * at all, and no branch here decides how confident to sound.
 *
 * ## Delete is offered here and nowhere else
 *
 * It removes the record of which transactions counted, which is a thing worth being able to see
 * before agreeing to it. Archiving is the reversible answer and is available in both screens.
 *
 * ## The recompute is a repair, offered rather than run
 *
 * `contributed_minor` is a cache over the links. It is rebuilt on every write, so it should never
 * drift — but "should never" is not "cannot", and the action that rebuilds it from scratch is
 * idempotent and safe to press twice. Offering it beats a support conversation.
 */

export const Route = createFileRoute('/_app/goals/$goalId')({
  loader: async ({ params }) => {
    const [detail, accounts] = await Promise.all([
      loadGoalDetail({ data: { goalId: params.goalId } }),
      listAccounts({ data: {} }),
    ])
    return { detail, accounts: accounts.accounts }
  },
  pendingComponent: GoalDetailSkeleton,
  errorComponent: GoalDetailError,
  head: ({ matches, loaderData }) =>
    pageHead(
      matches,
      (t) => loaderData?.detail.summary.name ?? t('goals.title'),
    ),
  component: GoalDetailRoute,
})

function GoalDetailError({
  error,
  reset,
}: {
  readonly error: Error
  readonly reset: () => void
}) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('goals.detail.error.title')}
      body={t('goals.detail.error.body')}
      detail={error.message}
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
  | { kind: 'contribute' }
  | { kind: 'removeContribution'; contribution: GoalContribution }

function GoalDetailRoute() {
  const t = useTranslate()
  const locale = useLocale()
  const { detail, accounts } = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const refreshCaches = useDataRefresh()

  const [pending, setPending] = useState<Pending>({ kind: 'none' })
  const close = () => setPending({ kind: 'none' })
  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  const { summary, contributions, projection, series } = detail
  const state = goalStateOf(summary)
  const accountNames = new Map(
    accounts.map((account) => [account.id, account.name]),
  )
  const currencyOptions = [
    ...new Set([
      summary.currencyCode,
      ...accounts.map((account) => account.currencyCode),
    ]),
  ]

  /** Announces the write, and the crossing separately when there was one. */
  const announceContribution = (reached: boolean) => {
    toast.success(t('goals.toast.contributed'))
    if (reached) toast.success(t('goals.toast.reached', { name: summary.name }))
    close()
    refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/goals"
          className="inline-flex items-center gap-1.5 rounded-sm text-caption text-ink-2 outline-focus hover:text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {t('goals.detail.back')}
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title font-bold text-ink">{summary.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock aria-hidden="true" className="size-3.5 shrink-0" />
              {summary.targetDate === null
                ? t('goals.target.none')
                : t('goals.target.by', {
                    date: formatCalendarDate(
                      locale,
                      summary.targetDate,
                      'long',
                    ),
                  })}
            </span>
            {summary.accountId === null ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('goals.accounts.from', {
                    name:
                      accountNames.get(summary.accountId) ?? summary.accountId,
                  })}
                </span>
              </>
            )}
            {summary.linkedAccountId === null ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('goals.accounts.held', {
                    name:
                      accountNames.get(summary.linkedAccountId) ??
                      summary.linkedAccountId,
                  })}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {summary.status === 'archived' ? (
            <Badge tone="neutral">{t('goals.status.archived')}</Badge>
          ) : null}
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" />}
            onPress={() => setPending({ kind: 'contribute' })}
          >
            {t('goals.contributions.add')}
          </Button>
          <GoalActionsMenu
            goal={summary}
            onEdit={() => setPending({ kind: 'form' })}
            onArchive={() => setPending({ kind: 'archive' })}
            onRestore={() => setPending({ kind: 'restore' })}
            onDelete={() => setPending({ kind: 'delete' })}
            onRecompute={() => {
              void recomputeGoalProgress({ data: { goalId: summary.id } }).then(
                () => {
                  toast.success(t('goals.toast.recomputed'))
                  refresh()
                },
              )
            }}
          />
        </div>
      </header>

      {/* The hero. One meter, three figures under it, and the arithmetic they are the terms of. */}
      <Card className="flex flex-col gap-5">
        <GoalMeter
          name={summary.name}
          targetMinor={summary.targetMinor}
          contributedMinor={summary.contributedMinor}
          remainingMinor={summary.remainingMinor}
          ratio={summary.ratio}
          state={state}
          currencyCode={summary.currencyCode}
          size="lg"
        />

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Figure label={t('goals.detail.saved')}>
            <Amount
              locale={locale}
              amountMinor={summary.contributedMinor}
              currencyCode={summary.currencyCode}
              size="lg"
            />
          </Figure>
          <Figure label={t('goals.detail.target')}>
            <Amount
              locale={locale}
              amountMinor={summary.targetMinor}
              currencyCode={summary.currencyCode}
              size="lg"
            />
          </Figure>
          <Figure label={t('goals.detail.remaining')}>
            <Amount
              locale={locale}
              amountMinor={summary.remainingMinor}
              currencyCode={summary.currencyCode}
              size="lg"
            />
          </Figure>
        </dl>

        {summary.base === null ? null : (
          <>
            <Separator />
            <div>
              <p className="text-caption text-ink-2 tabular">
                {t('goals.progress.base', {
                  contributed: formatMoney(
                    locale,
                    makeMoney(
                      summary.base.contributedMinor,
                      summary.base.baseCurrencyCode,
                    ),
                  ),
                  target: formatMoney(
                    locale,
                    makeMoney(
                      summary.base.targetMinor,
                      summary.base.baseCurrencyCode,
                    ),
                  ),
                  currency: summary.base.baseCurrencyCode,
                })}
              </p>
              <p className="prose-measure mt-1 text-caption text-ink-2">
                {t('goals.progress.baseHelp')}
              </p>
            </div>
          </>
        )}

        {summary.status === 'reached' ? (
          <div className="flex items-start gap-2 rounded-lg bg-positive-soft px-3 py-2.5">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-positive"
            />
            <div>
              <p className="text-label font-semibold text-ink">
                {t('goals.reached.title')}
              </p>
              <p className="prose-measure mt-0.5 text-caption text-ink-2">
                {t('goals.reached.body')}
              </p>
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <GoalProjection
          projection={projection}
          targetDate={summary.targetDate}
          currencyCode={summary.currencyCode}
        />
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-subtitle font-semibold text-ink">
          {t('goals.chart.title')}
        </h2>
        <ContributionChart
          series={series}
          currencyCode={summary.currencyCode}
        />
      </Card>

      <SuggestionList
        suggestions={summary.suggestions}
        currencyCode={summary.currencyCode}
        accountNames={accountNames}
        onAccept={(suggestion) => {
          void addGoalContribution({
            data: {
              goalId: summary.id,
              transactionId: suggestion.transaction.id,
            },
          }).then((result) => {
            announceContribution(result.becameReached)
          })
        }}
      />

      <Card padding="none" className="flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h2 className="text-subtitle font-semibold text-ink">
            {t('goals.contributions.heading')}
          </h2>
          <p className="text-caption text-ink-2">
            {t('goals.contributions.count', {
              count: summary.contributionCount,
            })}
          </p>
        </div>
        <ContributionList
          contributions={contributions}
          currencyCode={summary.currencyCode}
          onRemove={(contribution) =>
            setPending({ kind: 'removeContribution', contribution })
          }
        />
      </Card>

      {pending.kind === 'form' ? (
        <GoalFormDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          goal={summary}
          accounts={accounts}
          currencyOptions={currencyOptions}
          baseCurrencyCode={summary.currencyCode}
          onSaved={() => {
            toast.success(t('goals.toast.saved'))
            close()
            refresh()
          }}
        />
      ) : null}

      {pending.kind === 'contribute' ? (
        <ContributionDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          goal={summary}
          onAdded={announceContribution}
        />
      ) : null}

      {pending.kind === 'removeContribution' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={t('goals.confirm.remove.title')}
          body={t('goals.confirm.remove.body')}
          confirmLabel={t('goals.confirm.remove.action')}
          isDestructive
          errorTitle={t('goals.toast.failed')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            await removeGoalContribution({
              data: {
                goalId: summary.id,
                transactionId: pending.contribution.transaction.id,
              },
            })
            toast.success(t('goals.toast.uncontributed'))
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
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            await archiveGoal({ data: { goalId: summary.id } })
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
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            await restoreGoal({ data: { goalId: summary.id } })
            toast.success(t('goals.toast.restored'))
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
          title={t('goals.confirm.delete.title')}
          body={t('goals.confirm.delete.body')}
          confirmLabel={t('goals.confirm.delete.action')}
          isDestructive
          errorTitle={t('goals.toast.failed')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            await deleteGoal({ data: { goalId: summary.id } })
            toast.success(t('goals.toast.deleted'))
            close()
            await navigate({ to: '/goals' })
          }}
        />
      ) : null}
    </div>
  )
}

/** One figure in the hero's terms row. A `<dt>`/`<dd>` pair, because that is what it is. */
function Figure({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-ink-2">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
