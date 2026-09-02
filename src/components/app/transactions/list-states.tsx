import { FilterX, Plus, ReceiptText, TriangleAlert } from 'lucide-react'

import { Button, EmptyState, Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import { ROW_HEIGHT_PX } from './grid-model'

/**
 * The three things the list shows when it is not showing transactions.
 *
 * They are three states rather than one because they need three different answers. Somebody whose
 * workspace is empty needs an invitation; somebody whose *filters* match nothing needs those
 * filters taken off, and offering them "Add a transaction" is answering a question they did not
 * ask. A failed load needs the filters preserved and a way to try again.
 */

const SKELETON_ROWS = 12

/**
 * Twelve rows at the real row height.
 *
 * The height is the point: a skeleton shorter than its content lets the page grow under the
 * reader's pointer the moment data arrives, which on a list they were already scrolling is how a
 * click lands on the wrong row.
 */
export function TransactionListSkeleton() {
  const t = useTranslate()

  return (
    <div className="rounded-lg border border-border-subtle bg-surface">
      <p role="status" className="sr-only">
        {t('transactions.loading')}
      </p>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div
          key={index}
          style={{ height: ROW_HEIGHT_PX }}
          className="flex items-center gap-3 border-b border-border-subtle px-3 last:border-b-0"
        >
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <Skeleton className="h-3 w-8 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-20 shrink-0" />
        </div>
      ))}
    </div>
  )
}

export interface TransactionsEmptyProps {
  readonly onCreate: () => void
}

/** No transactions at all: the first screen of a new workspace. */
export function TransactionsEmpty({ onCreate }: TransactionsEmptyProps) {
  const t = useTranslate()

  return (
    <EmptyState
      icon={<ReceiptText />}
      headingLevel={2}
      title={t('transactions.empty.title')}
      description={t('transactions.empty.body')}
      action={
        <Button variant="primary" icon={<Plus />} onPress={onCreate}>
          {t('transactions.empty.action')}
        </Button>
      }
    />
  )
}

export interface NoMatchProps {
  readonly onClearFilters: () => void
}

/** Transactions exist; these filters exclude all of them. */
export function TransactionsNoMatch({ onClearFilters }: NoMatchProps) {
  const t = useTranslate()

  return (
    <EmptyState
      icon={<FilterX />}
      headingLevel={2}
      title={t('transactions.noResults.title')}
      description={t('transactions.noResults.body')}
      action={
        <Button variant="secondary" onPress={onClearFilters}>
          {t('transactions.filter.reset')}
        </Button>
      }
    />
  )
}

export interface TransactionListErrorProps {
  readonly onRetry: () => void
  /** The correlation id from the failed request, when there is one. */
  readonly reference?: string
}

/**
 * A failed load, with the filters left exactly as they were.
 *
 * Retrying into a cleared filter set would show a different list and call it a recovery.
 */
export function TransactionListError({
  onRetry,
  reference,
}: TransactionListErrorProps) {
  const t = useTranslate()

  return (
    <div
      role="alert"
      className="rounded-lg border border-negative/40 bg-negative-soft px-5 py-6"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-negative"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-subtitle font-semibold text-ink">
            {t('empty.error.title')}
          </h2>
          <p className="mt-1 text-body text-ink-2">{t('empty.error.body')}</p>
          {reference === undefined ? null : (
            <p className="mt-1 text-caption text-ink-2 tabular">
              {t('empty.error.reference', { reference })}
            </p>
          )}
          <Button className="mt-3" variant="secondary" onPress={onRetry}>
            {t('action.retry')}
          </Button>
        </div>
      </div>
    </div>
  )
}
