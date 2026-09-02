import { useCallback, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { getLocalTimeZone, today } from '@internationalized/date'
import { WalletMinimal } from 'lucide-react'
import { z } from 'zod'

import {
  TransactionForm,
  TransactionListError,
  emptyFormValues,
} from '#/components/app/transactions'
import { Button, EmptyState, toast } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { createTransaction } from '#/server/fns/transactions'

import { useDataRefresh } from '../-lib/refresh'
import { TransactionFormSkeleton } from './-ui/form-skeleton'
import { loadTransactionDetail } from './-server/detail'
import { loadTransactionReference } from './-server/list'

import type {
  TransactionFormValues,
  TransactionReference,
} from '#/components/app/transactions'
import type { Minor } from '#/lib/money'
import type { Transaction } from '#/server/db/types'
import type { TransactionPolicies } from '#/server/repos/transactions'

/**
 * `/transactions/new` — the entry form.
 *
 * ## The screen is built around one measurement: keystrokes per entry
 *
 * Somebody working through a week of receipts does this twenty times in a row. The amount is
 * focused on arrival, the currency follows the account so there is no second field to keep
 * consistent, and **Save and add another** returns to a form that has kept the date, the account,
 * the category and the payment method — so the next entry is a number and a key. `⌘`/`Ctrl + Enter`
 * does the same from anywhere in the form.
 *
 * ## Duplicate is this route with a source
 *
 * `?from=<id>` loads that transaction and opens the form on a copy of it. A duplicate is a new
 * entry that starts somewhere other than blank, so it is the same screen rather than a second one —
 * and because the source is in the URL, the row action is a plain navigation and the result is
 * reloadable.
 *
 * ## The gates are outside the form
 *
 * Loading, failure and "this workspace has no accounts yet" are decided by the route; the form
 * itself is only ever handed a reference set that exists. That is what keeps every value inside it
 * non-nullable and every prop honest, instead of scattering `!` through a component that renders on
 * every keystroke.
 */

const WRITE_POLICIES: TransactionPolicies = {
  planned: 'include',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

const newSearchSchema = z.object({
  /** The transaction this entry is a copy of, when the reader arrived by "Duplicate". */
  from: z.string().trim().min(1).max(64).optional().catch(undefined),
})

export const Route = createFileRoute('/_app/transactions/new')({
  validateSearch: newSearchSchema,
  component: NewTransactionRoute,
})

function NewTransactionRoute() {
  const t = useTranslate()
  const navigate = Route.useNavigate()
  const { from } = Route.useSearch()

  const referenceQuery = useQuery({
    queryKey: ['transactions', 'reference'],
    queryFn: () => loadTransactionReference(),
    staleTime: 5 * 60_000,
  })

  const sourceQuery = useQuery({
    queryKey: ['transactions', 'detail', from ?? null],
    queryFn: () =>
      loadTransactionDetail({ data: { transactionId: from ?? '' } }),
    enabled: from !== undefined,
  })

  const reference = referenceQuery.data
  const waitingForSource = from !== undefined && sourceQuery.isPending

  if (referenceQuery.isPending || waitingForSource) {
    return <TransactionFormSkeleton />
  }

  if (referenceQuery.isError || reference === undefined) {
    return (
      <TransactionListError onRetry={() => void referenceQuery.refetch()} />
    )
  }

  if (reference.accounts.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <h1 className="text-title font-semibold text-ink">
          {t('transactions.form.newTitle')}
        </h1>
        <EmptyState
          icon={<WalletMinimal />}
          headingLevel={2}
          title={t('transactions.form.noAccounts.title')}
          description={t('transactions.form.noAccounts.body')}
          action={
            <Button
              variant="primary"
              onPress={() => void navigate({ to: '/accounts' })}
            >
              {t('transactions.form.noAccounts.action')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <NewTransactionEditor
      reference={reference}
      source={sourceQuery.data?.transaction}
      isDuplicate={from !== undefined}
    />
  )
}

/** The starting values: today, the first account, and — for a duplicate — the source's shape. */
function initialValues(
  reference: TransactionReference,
  source: Transaction | undefined,
): TransactionFormValues {
  const blank = emptyFormValues(
    reference.accounts[0].id,
    today(getLocalTimeZone()).toString(),
  )
  if (source === undefined) {
    return blank
  }
  return {
    ...blank,
    direction: source.direction === 'income' ? 'income' : 'expense',
    amountMinor: source.amountMinor,
    accountId: source.accountId,
    // The date is deliberately **not** copied. A duplicate is nearly always "the same thing, today"
    // — a weekly shop, a recurring cash withdrawal — and copying the old date is the one mistake
    // that is invisible until a month-end total comes out wrong.
    categoryId: source.categoryId,
    payeeId: source.payeeId,
    note: source.note ?? '',
    isPlanned: source.isPlanned,
  }
}

interface EditorProps {
  readonly reference: TransactionReference
  readonly source: Transaction | undefined
  readonly isDuplicate: boolean
}

function NewTransactionEditor({ reference, source, isDuplicate }: EditorProps) {
  const t = useTranslate()
  const navigate = Route.useNavigate()
  const refresh = useDataRefresh()

  const [values, setValues] = useState<TransactionFormValues>(() =>
    initialValues(reference, source),
  )
  const [resetToken, setResetToken] = useState(0)
  const [serverError, setServerError] = useState<string | undefined>(undefined)

  const goToList = useCallback(
    () => void navigate({ to: '/transactions', search: {} }),
    [navigate],
  )

  const creation = useMutation({
    mutationFn: (input: {
      readonly entry: TransactionFormValues
      readonly amountMinor: Minor
      readonly addAnother: boolean
    }) => {
      const { entry } = input
      const account = reference.accounts.find(
        (option) => option.id === entry.accountId,
      )
      return createTransaction({
        data: {
          policies: WRITE_POLICIES,
          input: {
            accountId: entry.accountId,
            direction: entry.direction,
            // Already `Minor` — an integer count of the currency's own minor units. Nothing on this
            // path parses a string or divides by a hundred.
            amountMinor: input.amountMinor,
            currencyCode: account?.currencyCode ?? reference.baseCurrencyCode,
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
    onSuccess: async (_created, input) => {
      setServerError(undefined)
      toast.success(t('transactions.saved'))
      // Before the navigation, not after: the ledger this lands on reads a React Query cache that
      // was populated before the row existed, and a list that answers "Nothing recorded yet" a
      // second after a successful save is the worst thing this screen can say.
      await refresh()
      if (!input.addAnother) {
        goToList()
        return
      }
      // Everything that describes *this* entry is cleared; everything that describes the sitting —
      // the day, the account, the category, how it was paid — stays, because the next receipt in
      // the pile is almost always the same in those four ways.
      setValues({
        ...input.entry,
        amountMinor: null,
        payeeId: null,
        note: '',
      })
      setResetToken((token) => token + 1)
    },
    onError: (error: unknown) => {
      setServerError(
        error instanceof Error ? error.message : t('empty.error.body'),
      )
    },
  })

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-semibold text-ink">
          {t('transactions.form.newTitle')}
        </h1>
        <p className="max-w-prose text-caption text-ink-2">
          {isDuplicate
            ? t('transactions.duplicated')
            : t('transactions.form.newSubtitle')}
        </p>
      </header>

      <TransactionForm
        values={values}
        onChange={setValues}
        reference={reference}
        onSubmit={({ addAnother }) => {
          // The form only calls this once its own validation has passed, so the amount is present.
          // Checking again rather than asserting keeps the branded type honest all the way down.
          const amountMinor = values.amountMinor
          if (amountMinor === null) {
            return
          }
          creation.mutate({ entry: values, amountMinor, addAnother })
        }}
        onCancel={goToList}
        isSubmitting={creation.isPending}
        serverError={serverError}
        allowRepeat
        submitLabel={t('action.save')}
        autoFocusAmount
        resetToken={resetToken}
      />
    </div>
  )
}
