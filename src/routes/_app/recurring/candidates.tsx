import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, RefreshCw } from 'lucide-react'

import {
  CandidateCard,
  CandidateListSkeleton,
} from '#/components/app/recurring'
import { ErrorPanel } from '#/components/app/shell'
import { Button, Card, EmptyState, toast } from '#/components/ui'
import { listAccounts } from '#/server/fns/accounts'
import { listCategories } from '#/server/fns/categories'
import { listPayees } from '#/server/fns/payees'
import {
  acceptCandidate,
  detectRecurring,
  dismissCandidate,
  loadCandidates,
} from '#/server/fns/recurring'

import { useDataRefresh } from '../-lib/refresh'
import { SeriesFormDialog } from './-ui/series-form-dialog'

import type {
  RecurringFrequency,
  TransactionDirection,
} from '#/server/db/schema'
import type { CandidateRow } from '#/server/fns/recurring'
import type { WeakestSignal } from '#/server/recurring/detect'
import { failureOf } from '#/lib/failure'
import { useTranslate } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/recurring/candidates` - what the detector noticed, offered rather than acted on.
 *
 * ## Nothing on this screen has happened
 *
 * Every card is a proposal. Accepting one opens the ordinary series form, prefilled, and creates a
 * plan; it writes no transaction and changes none of the rows the proposal was found from. That is
 * stated on each card rather than in a footnote, because a suggestion screen that reads as a
 * report of something already done is one people dismiss unread.
 *
 * ## Dismissal is remembered, and that is what makes *Look again* safe
 *
 * Re-running detection replaces the **pending** proposals only. A dismissal is kept so the same
 * suggestion is not made again next month, and an acceptance is history. So the button can be
 * pressed as often as somebody likes without undoing a single decision.
 *
 * ## The reason is shown for this run, and only for this run
 *
 * `recurring_candidates` has no column for the weakest signal, so a proposal read back from an
 * earlier run carries its confidence but not its reason. The detector reports it for the run it
 * just performed; that report is held here in component state and shown on the matching cards.
 * A card with no reason shows the band alone rather than inventing one. See the handover note.
 */

export const Route = createFileRoute('/_app/recurring/candidates')({
  loader: async () => {
    const [candidates, accounts, categories, payees] = await Promise.all([
      loadCandidates({ data: {} }),
      listAccounts({ data: {} }),
      listCategories({ data: {} }),
      listPayees({ data: {} }),
    ])
    return { candidates, accounts, categories, payees }
  },
  pendingComponent: CandidateListSkeleton,
  errorComponent: CandidateListError,
  head: ({ matches }) =>
    pageHead(matches, (t) => t('recurring.candidates.title')),
  component: CandidateListRoute,
})

function CandidateListError({ reset }: { readonly reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('recurring.candidates.error.title')}
      body={t('recurring.candidates.error.body')}
      onRetry={reset}
    />
  )
}

function CandidateListRoute() {
  const t = useTranslate()
  const { candidates, accounts, categories, payees } = Route.useLoaderData()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [isDetecting, setIsDetecting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [accepting, setAccepting] = useState<CandidateRow | null>(null)
  // Only the run this session performed knows which signal held each proposal back.
  const [reasons, setReasons] = useState<
    ReadonlyMap<string, WeakestSignal> | undefined
  >(undefined)

  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  const accountRefs = accounts.accounts.map((account) => ({
    id: account.id,
    name: account.name,
  }))
  const payeeRefs = payees.map((entry) => ({
    id: entry.payee.id,
    name: entry.payee.name,
  }))
  const baseCurrencyCode =
    candidates.at(0)?.candidate.expectedCurrencyCode ?? 'PLN'

  async function detect() {
    setIsDetecting(true)
    try {
      const report = await detectRecurring({ data: {} })
      setReasons(
        new Map(
          report.weakest.map((entry) => [
            entry.suggestedName,
            entry.weakestSignal,
          ]),
        ),
      )
      toast.success(t('recurring.candidates.found', { count: report.found }))
      refresh()
    } catch (error) {
      toast.error(t('recurring.toast.failed'), {
        description: t(failureOf(error).message.key),
      })
    } finally {
      setIsDetecting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/recurring"
        className="inline-flex items-center gap-1.5 self-start rounded-sm text-label text-ink-2 outline-focus hover:text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('recurring.detail.back')}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        {/* The heading states its own measure, so the actions decide the wrap rather than
            the subtitle's ideal line - see `recurring/index.tsx`. */}
        <div className="min-w-0 grow basis-72">
          <h1 className="text-title font-bold text-ink">
            {t('recurring.candidates.title')}
          </h1>
          <p className="mt-1 text-body text-ink-2">
            {t('recurring.candidates.subtitle')}
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw aria-hidden="true" />}
          isPending={isDetecting}
          onPress={() => void detect()}
        >
          {t(
            isDetecting
              ? 'recurring.candidates.detecting'
              : 'recurring.candidates.detect',
          )}
        </Button>
      </header>

      {candidates.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            headingLevel={2}
            title={t('recurring.candidates.empty.title')}
            description={t('recurring.candidates.empty.body')}
            action={
              <Button
                variant="primary"
                icon={<RefreshCw aria-hidden="true" />}
                isPending={isDetecting}
                onPress={() => void detect()}
              >
                {t('recurring.candidates.detect')}
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="rounded-xl border border-border-subtle bg-surface shadow-card">
          {candidates.map((row) => {
            const reason = reasons?.get(row.candidate.suggestedName ?? '')
            return (
              <CandidateCard
                key={row.candidate.id}
                row={row}
                {...(reason === undefined ? {} : { weakestSignal: reason })}
                isBusy={busyId === row.candidate.id}
                onAccept={() => setAccepting(row)}
                onDismiss={() => {
                  setBusyId(row.candidate.id)
                  void dismissCandidate({
                    data: { candidateId: row.candidate.id },
                  })
                    .then(() => {
                      toast.success(t('recurring.candidate.toast.dismissed'))
                      refresh()
                    })
                    .finally(() => setBusyId(null))
                }}
              />
            )
          })}
        </ul>
      )}

      {accepting === null ? null : (
        <AcceptDialog
          row={accepting}
          accounts={accountRefs}
          categories={categories}
          payees={payeeRefs}
          baseCurrencyCode={baseCurrencyCode}
          onClose={() => setAccepting(null)}
          onAccepted={() => {
            toast.success(t('recurring.candidate.toast.accepted'))
            setAccepting(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

/**
 * Accepting a proposal: the ordinary series form, prefilled from the candidate.
 *
 * The full form rather than a one-button *create it* for one reason - a suggestion is a starting
 * point, and the fields most worth checking (the account it comes out of, whether it should record
 * automatically) are exactly the ones the detector cannot know. `acceptCandidate` on the server
 * takes a complete series payload for the same reason.
 *
 * The dialog writes through {@link acceptCandidate} rather than through the form's own
 * `createSeries`, because accepting has a second effect: the candidate is marked `accepted`, so it
 * is not proposed again. Doing that as two calls from the browser would leave a window in which
 * the series exists and the proposal is still pending.
 */
function AcceptDialog({
  row,
  accounts,
  categories,
  payees,
  baseCurrencyCode,
  onClose,
  onAccepted,
}: {
  readonly row: CandidateRow
  readonly accounts: ReadonlyArray<{
    readonly id: string
    readonly name: string
  }>
  readonly categories: ReturnType<typeof Route.useLoaderData>['categories']
  readonly payees: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly baseCurrencyCode: string
  readonly onClose: () => void
  readonly onAccepted: () => void
}) {
  const { candidate } = row
  const currency = candidate.expectedCurrencyCode ?? baseCurrencyCode

  return (
    <SeriesFormDialog
      key={candidate.id}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      series={null}
      accounts={accounts}
      categories={categories}
      payees={payees}
      currencyOptions={[currency]}
      baseCurrencyCode={currency}
      initial={{
        name: candidate.suggestedName ?? '',
        expectedAmountMinor: candidate.expectedAmountMinor,
        currencyCode: currency,
        frequency: (candidate.frequency ?? 'monthly') as RecurringFrequency,
        payeeId: candidate.payeeId,
        // A detected series is money going out unless somebody says otherwise: the detector groups
        // by direction, and an income proposal is rare enough that guessing wrong here is cheaper
        // than a field the form cannot prefill at all.
        direction: 'expense' as TransactionDirection,
      }}
      onCreate={async (input) => {
        await acceptCandidate({
          data: { candidateId: candidate.id, series: input },
        })
      }}
      onSaved={onAccepted}
    />
  )
}
