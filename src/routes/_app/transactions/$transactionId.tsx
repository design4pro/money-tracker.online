import { useCallback, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Copy, Pencil, Trash2 } from 'lucide-react'
import { z } from 'zod'

import {
  ConfirmDeleteDialog,
  DetailSummary,
  TransactionForm,
  TransactionListError,
} from '#/components/app/transactions'
import { Button, EmptyState, toast } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'
import { deleteTransaction, updateTransaction } from '#/server/fns/transactions'

import { useDataRefresh } from '../-lib/refresh'
import { toLedgerRow } from './-lib/rows'
import { AttachmentDropzone } from './-ui/attachment-dropzone'
import { AttachmentList } from './-ui/attachment-list'
import { TransactionFormSkeleton } from './-ui/form-skeleton'
import { GroupPanel } from './-ui/group-panel'
import { RefundPanel } from './-ui/refund-panel'
import { SplitEditor } from './-ui/split-editor'
import { loadTransactionDetail } from './-server/detail'
import { loadTransactionReference } from './-server/list'

import type {
  TransactionFormValues,
  TransactionReference,
} from '#/components/app/transactions'
import type { Minor } from '#/lib/money'
import type { AttachmentRow } from '#/server/db/schema'
import type { Transaction, TransactionSplit } from '#/server/db/types'
import type { RefundSummary } from '#/server/repos/refunds'
import type { TransactionGroupSummary } from '#/server/repos/transaction-groups'
import type { TransactionPolicies } from '#/server/repos/transactions'

/**
 * `/transactions/$transactionId` — one transaction, read and edited at the same address.
 *
 * ## Why edit is a search param and not a route
 *
 * `?mode=edit` is a *state of this screen*, not a different thing to look at. Making it a param
 * keeps two properties that matter: the row action `e` in the ledger is a plain navigation, and
 * pressing Cancel or Back returns to the summary rather than to the list — the reader ends up where
 * they were, not two steps out.
 *
 * ## What the summary quotes and what it never recomputes
 *
 * `refAmountMinor` and `rateE10` were fixed at the booking date's rate when the row was written.
 * The summary prints both. Recomputing either here would be a second opinion about a historical
 * fact, and on any day the rate has moved it would be a detail screen that disagrees with the list
 * it was opened from.
 *
 * ## Two columns, because five equal cards are a pile
 *
 * Read mode carries five concerns: the summary, splits, refunds, groups and receipts. Only the
 * summary is true of every transaction; the other four are *sometimes*, and stacking five cards of
 * equal weight makes a reader scan all five to find out which ones apply today.
 *
 * So the money goes in the primary column — the summary, and the splits that divide it — and the
 * context goes in a narrower secondary one. Each of the four panels is already a self-contained
 * `<Card as="section">` with its own heading, so this file arranges them and adds no chrome of its
 * own; wrapping them in accordions would have put a second heading at an inverted level inside each
 * one. Below `lg` the grid collapses and the order becomes the reading order.
 *
 * A panel with nothing in it is not hidden. It renders its own empty state carrying the action that
 * fills it, which is why a transaction with no receipts still shows where receipts would go.
 *
 * ## A no-op save writes nothing new
 *
 * The patch carries only the fields the form actually holds, and the repository re-anchors
 * `ref_amount_minor` **only** when the amount, the currency or the booking date changed. Saving an
 * unedited March transaction does not re-value it at today's rate.
 */

const DETAIL_POLICIES: TransactionPolicies = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

const detailSearchSchema = z.object({
  mode: z.enum(['edit']).optional().catch(undefined),
})

export const Route = createFileRoute('/_app/transactions/$transactionId')({
  validateSearch: detailSearchSchema,
  component: TransactionDetailRoute,
})

function TransactionDetailRoute() {
  const t = useTranslate()
  const { transactionId } = Route.useParams()
  const { mode } = Route.useSearch()
  const navigate = Route.useNavigate()

  const detailQuery = useQuery({
    queryKey: ['transactions', 'detail', transactionId],
    queryFn: () => loadTransactionDetail({ data: { transactionId } }),
  })

  const referenceQuery = useQuery({
    queryKey: ['transactions', 'reference'],
    queryFn: () => loadTransactionReference(),
    staleTime: 5 * 60_000,
  })

  const goToList = useCallback(
    () => void navigate({ to: '/transactions', search: {} }),
    [navigate],
  )

  if (detailQuery.isPending || referenceQuery.isPending) {
    return <TransactionFormSkeleton />
  }

  if (detailQuery.isError) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <h1 className="text-title font-semibold text-ink">
          {t('transactions.detail.title')}
        </h1>
        <EmptyState
          headingLevel={2}
          title={t('transactions.detail.notFound.title')}
          description={t('transactions.detail.notFound.body')}
          action={
            <Button variant="secondary" icon={<ArrowLeft />} onPress={goToList}>
              {t('transactions.detail.back')}
            </Button>
          }
        />
      </div>
    )
  }

  if (referenceQuery.isError) {
    return (
      <TransactionListError onRetry={() => void referenceQuery.refetch()} />
    )
  }

  return (
    <TransactionDetailScreen
      transaction={detailQuery.data.transaction}
      accountName={detailQuery.data.accountName}
      splits={detailQuery.data.splits}
      refunds={detailQuery.data.refunds}
      groups={detailQuery.data.groups}
      allGroups={detailQuery.data.allGroups}
      attachments={detailQuery.data.attachments}
      reference={referenceQuery.data}
      isEditing={mode === 'edit'}
      onRefresh={() => void detailQuery.refetch()}
    />
  )
}

/** The stored row as the form holds it. Money stays `Minor`; nothing is parsed on the way in. */
function toFormValues(row: Transaction): TransactionFormValues {
  return {
    direction: row.direction === 'income' ? 'income' : 'expense',
    amountMinor: row.amountMinor,
    accountId: row.accountId,
    bookedOn: row.bookedOn,
    categoryId: row.categoryId,
    payeeId: row.payeeId,
    paymentMethod:
      row.paymentMethod === null
        ? null
        : (toLedgerRow(row).paymentMethod ?? null),
    note: row.note ?? '',
    isPlanned: row.isPlanned,
  }
}

interface ScreenProps {
  readonly transaction: Transaction
  readonly accountName: string
  readonly splits: ReadonlyArray<TransactionSplit>
  readonly refunds: RefundSummary
  readonly groups: ReadonlyArray<TransactionGroupSummary>
  readonly allGroups: ReadonlyArray<TransactionGroupSummary>
  readonly attachments: ReadonlyArray<AttachmentRow>
  readonly reference: TransactionReference
  readonly isEditing: boolean
  readonly onRefresh: () => void
}

function TransactionDetailScreen({
  transaction,
  accountName,
  splits,
  refunds,
  groups,
  allGroups,
  attachments,
  reference,
  isEditing,
  onRefresh,
}: ScreenProps) {
  const t = useTranslate()
  const navigate = Route.useNavigate()
  const refresh = useDataRefresh()

  const [values, setValues] = useState<TransactionFormValues>(() =>
    toFormValues(transaction),
  )
  const [serverError, setServerError] = useState<string | undefined>(undefined)
  const [isConfirmingDelete, setConfirmingDelete] = useState(false)

  const row = toLedgerRow(transaction)
  const category = reference.categories.find(
    (entry) => entry.id === transaction.categoryId,
  )
  const payee = reference.payees.find(
    (entry) => entry.id === transaction.payeeId,
  )

  const goToList = useCallback(
    () => void navigate({ to: '/transactions', search: {} }),
    [navigate],
  )
  const setMode = useCallback(
    (mode: 'edit' | undefined) => void navigate({ search: { mode } }),
    [navigate],
  )

  const saving = useMutation({
    mutationFn: (input: {
      readonly entry: TransactionFormValues
      readonly amountMinor: Minor
    }) => {
      const { entry } = input
      const account = reference.accounts.find(
        (option) => option.id === entry.accountId,
      )
      return updateTransaction({
        data: {
          transactionId: transaction.id,
          policies: DETAIL_POLICIES,
          patch: {
            accountId: entry.accountId,
            direction: entry.direction,
            amountMinor: input.amountMinor,
            currencyCode: account?.currencyCode ?? transaction.currencyCode,
            bookedOn: entry.bookedOn,
            categoryId: entry.categoryId,
            payeeId: entry.payeeId,
            note: entry.note.trim() === '' ? null : entry.note,
            paymentMethod: entry.paymentMethod,
            isPlanned: entry.isPlanned,
          },
        },
      })
    },
    onSuccess: async () => {
      setServerError(undefined)
      toast.success(t('transactions.saved'))
      onRefresh()
      // An edit moves the ledger row, the day total, the account balance and the dashboard, none of
      // which this screen owns. `onRefresh` only refetches the detail query behind this page.
      await refresh()
      setMode(undefined)
    },
    onError: (error: unknown) => {
      setServerError(
        error instanceof Error ? error.message : t('empty.error.body'),
      )
    },
  })

  const deletion = useMutation({
    mutationFn: () =>
      deleteTransaction({
        data: { transactionId: transaction.id, policies: DETAIL_POLICIES },
      }),
    onSuccess: async () => {
      toast.success(t('transactions.deleted'))
      await refresh()
      goToList()
    },
    onError: () => {
      setConfirmingDelete(false)
      toast.error(t('empty.error.title'))
    },
  })

  return (
    // The edit form stays at reading width; the read view needs room for its second column.
    <div
      className={cn(
        'mx-auto flex w-full flex-col gap-6',
        isEditing ? 'max-w-3xl' : 'max-w-5xl',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" icon={<ArrowLeft />} onPress={goToList}>
          {t('transactions.detail.back')}
        </Button>

        {isEditing ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon={<Pencil />}
              onPress={() => setMode('edit')}
            >
              {t('action.edit')}
            </Button>
            <Button
              variant="secondary"
              icon={<Copy />}
              onPress={() =>
                void navigate({
                  to: '/transactions/new',
                  search: { from: transaction.id },
                })
              }
            >
              {t('action.duplicate')}
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 />}
              onPress={() => setConfirmingDelete(true)}
            >
              {t('action.delete')}
            </Button>
          </div>
        )}
      </div>

      <h1 className="sr-only">{t('transactions.detail.title')}</h1>

      {isEditing ? (
        <TransactionForm
          values={values}
          onChange={setValues}
          reference={reference}
          onSubmit={() => {
            const amountMinor = values.amountMinor
            if (amountMinor === null) {
              return
            }
            saving.mutate({ entry: values, amountMinor })
          }}
          onCancel={() => {
            setValues(toFormValues(transaction))
            setMode(undefined)
          }}
          isSubmitting={saving.isPending}
          serverError={serverError}
          submitLabel={t('action.saveChanges')}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          {/* The money: what this row is, and how it divides. */}
          <div className="flex min-w-0 flex-col gap-6">
            <DetailSummary
              row={row}
              accountName={accountName}
              categoryName={category?.name ?? null}
              payeeName={payee?.name ?? null}
              createdAtMs={transaction.createdAt.getTime()}
              timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
            />
            {/*
              Keyed on the stored set's ids, not on the transaction's. The panel seeds its rows once
              and deliberately has no synchronising effect, so a save that replaces the set has to
              arrive as a remount or the editor goes on showing the figures it was opened with. Every
              saved line gets a fresh id, so the key changes exactly when the stored set does.
            */}
            <SplitEditor
              key={splits.map((split) => split.id).join(',')}
              transactionId={transaction.id}
              amountMinor={transaction.amountMinor}
              currencyCode={transaction.currencyCode}
              splits={splits}
              categories={reference.categories}
              isTransferLeg={transaction.transferKind !== 'none'}
              onSaved={onRefresh}
            />
          </div>

          {/* The context: what else is attached to this row. Each panel states its own emptiness. */}
          <div className="flex min-w-0 flex-col gap-6">
            {/*
              `initialSummary` is the loader's read, spent on the first paint only — the panel's own
              reads are the authority from then on. Passing it saves a round trip and stops the
              column reflowing under a reader a moment after the rest of the screen has settled.
            */}
            <RefundPanel
              transactionId={transaction.id}
              initialSummary={refunds}
              onChanged={onRefresh}
            />
            <GroupPanel
              transactionId={transaction.id}
              memberOf={groups}
              allGroups={allGroups}
              onChanged={onRefresh}
            />
            {/*
              The dropzone is the list's action rather than a panel beside it: it renders inside the
              empty state and below a filled one, so "no receipts yet" is the place you add the
              first, not a card that says nothing and sits above the card that does.
            */}
            <AttachmentList
              attachments={attachments}
              onDeleted={onRefresh}
              action={
                <AttachmentDropzone
                  transactionId={transaction.id}
                  onUploaded={onRefresh}
                />
              }
            />
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        isOpen={isConfirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('action.delete')}
        body={t('transactions.delete.confirm')}
        confirmLabel={t('action.delete')}
        isPending={deletion.isPending}
        onConfirm={() => deletion.mutate()}
      />
    </div>
  )
}
