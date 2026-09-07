import { useCallback, useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import {
  BulkActions,
  ConfirmDeleteDialog,
  FilterBar,
  ListSummary,
  TransactionList,
  TransactionListError,
  TransactionListSkeleton,
  TransactionsNoMatch,
  countActiveFilters,
  describeFilters,
  emptyReference,
} from '#/components/app/transactions'
import { toast } from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { asCurrencyCode } from '#/lib/money'
import { deleteTransaction, loadTransactions } from '#/server/fns/transactions'

import { useDataRefresh } from '../../-lib/refresh'
import { toFilters, toQueryFilters, toSearch, toSort } from '../-lib/filters'
import { toLedgerRow } from '../-lib/rows'
import { loadTransactionReference } from '../-server/list'

import type { ReactNode } from 'react'
import type {
  LedgerFilters,
  LedgerSort,
  LedgerSortField,
} from '#/components/app/transactions'
import type { MessageKey } from '#/lib/i18n'
import type { TransactionFilters } from '#/server/repos/transaction-queries'
import type { TransactionPolicies } from '#/server/repos/transactions'
import type { TransactionSearch } from '../-lib/filters'

/**
 * The transactions surface: filter bar, virtualised ledger, totals and bulk actions, wired to the
 * URL and to the query layer.
 *
 * ## One screen, two routes
 *
 * `/transactions` and `/transactions/planned` are the same screen under two policy sets. They are
 * separate routes rather than one route with a toggle because "what have I spent" and "what is
 * coming" are different mental modes and each deserves its own address — but the composition below
 * is shared, so the two cannot drift apart in the ways that matter (the keyboard map, the totals,
 * the empty states).
 *
 * ## The URL is the state
 *
 * Every filter and the sort live in the search params. A view is therefore a link, the back button
 * walks the filter history, and a reload lands on the same list. The query key is derived from the
 * same object, so navigating back to a view that is still cached is instant rather than a refetch.
 *
 * ## Pages accumulate; the totals do not
 *
 * The list is keyset-paginated and pages are concatenated as they arrive, which is what the
 * virtualiser scrolls over. The totals and the match count come from the same response but describe
 * the **whole filtered set** — a footer that only sums the rows scrolled past would change while
 * somebody watched it, which is worse than no footer.
 *
 * ## Selection is cleared by a change of view
 *
 * Filtering or re-sorting resets the selection. Keeping it would leave a bulk delete armed against
 * rows that are no longer on screen — the reader would be confirming a count they cannot see.
 */

/**
 * Whether two views differ in nothing but their free-text narrowing.
 *
 * The comparison is over the query string rather than over the filter objects, because that is what
 * the history stack actually holds, and because it makes the rule one loop rather than one branch
 * per filter.
 */
function onlyTextMoved(
  current: TransactionSearch,
  next: TransactionSearch,
): boolean {
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]) as Set<
    keyof TransactionSearch
  >
  if (current.q === next.q) {
    return false
  }
  for (const key of keys) {
    if (key !== 'q' && current[key] !== next[key]) {
      return false
    }
  }
  return true
}

/** How many rows a page carries. The repository's own default; stated here so the caller sees it. */
const PAGE_SIZE = 50

const SORT_LABEL: Record<LedgerSortField, MessageKey> = {
  bookedOn: 'transactions.field.date',
  payee: 'transactions.field.payee',
  category: 'transactions.field.category',
  account: 'transactions.field.account',
}

export interface TransactionsScreenProps {
  /** Which planned, adjustment, transfer and completeness rows this view is about. Never defaulted. */
  readonly policies: TransactionPolicies
  readonly search: TransactionSearch
  /**
   * Writes the next view into the URL. The caller owns the route, so it owns the navigation.
   *
   * `replace` is set when the only thing that moved is the search text. Typing pushes one history
   * entry per keystroke otherwise, which turns the back button into a way to delete a word rather
   * than a way to leave a view — and the brief for this screen is that back and forward walk
   * *views*.
   */
  readonly onSearchChange: (
    next: TransactionSearch,
    options: { readonly replace: boolean },
  ) => void
  /** Shown when the workspace has no rows for this view **and** no filters are narrowing it. */
  readonly emptyState: ReactNode
  /**
   * Narrowing the view is *about* rather than one the reader chose: the passbook of one account
   * fixes `accountIds`. Merged into the query only, so no chip offers to remove it.
   */
  readonly fixedFilters?: TransactionFilters
  /** The passbook of one account: rows carry a balance after each line and the spine is drawn. */
  readonly hasBalance?: boolean
  readonly showFilterBar?: boolean
  readonly showSummary?: boolean
}

export function TransactionsScreen({
  policies,
  search,
  onSearchChange,
  emptyState,
  fixedFilters,
  hasBalance = false,
  showFilterBar = true,
  showSummary = true,
}: TransactionsScreenProps) {
  const t = useTranslate()
  const locale = useLocale()
  const navigate = useNavigate()
  const refresh = useDataRefresh()

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<ReadonlyArray<string>>([])

  const filters = useMemo(() => toFilters(search), [search])
  const sort = useMemo(() => toSort(search), [search])

  /* ---- Data ------------------------------------------------------------- */

  const referenceQuery = useQuery({
    queryKey: ['transactions', 'reference'],
    queryFn: () => loadTransactionReference(),
    // The account list changes when somebody opens an account, not when they type in a filter box.
    staleTime: 5 * 60_000,
  })

  const reference = referenceQuery.data ?? emptyReference(asCurrencyCode('EUR'))

  const queryFilters = useMemo(
    () => ({
      ...toQueryFilters(filters, reference.baseCurrencyCode),
      ...fixedFilters,
    }),
    [filters, fixedFilters, reference.baseCurrencyCode],
  )

  const pageQuery = useInfiniteQuery({
    queryKey: ['transactions', 'page', policies, queryFilters, sort],
    queryFn: ({ pageParam }) =>
      loadTransactions({
        data: {
          policies,
          filters: queryFilters,
          sort,
          cursor: pageParam,
          limit: PAGE_SIZE,
          includeBalanceAfter: hasBalance,
        },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })

  const rows = useMemo(
    () =>
      (pageQuery.data?.pages ?? []).flatMap((page) =>
        page.rows.map((row) => ({
          ...toLedgerRow(row),
          balanceAfterMinor: page.balances?.[row.id],
        })),
      ),
    [pageQuery.data],
  )
  // Naming the account on every line says nothing when every line is the same account.
  const showAccount =
    queryFilters.accountIds === undefined || queryFilters.accountIds.length > 1

  const head = pageQuery.data?.pages.at(0)
  const total = head?.total ?? 0
  const totals = head?.totals

  /* ---- Writing back to the URL ------------------------------------------ */

  const applyView = useCallback(
    (nextFilters: LedgerFilters, nextSort: LedgerSort) => {
      setSelectedIds(new Set())
      const next = toSearch(nextFilters, nextSort)
      onSearchChange(next, { replace: onlyTextMoved(search, next) })
    },
    [onSearchChange, search],
  )

  const onSortChange = useCallback(
    (next: LedgerSort) => applyView(filters, next),
    [applyView, filters],
  )

  /* ---- Deleting ---------------------------------------------------------- */

  const deletion = useMutation({
    mutationFn: async (ids: ReadonlyArray<string>) => {
      // Sequential rather than concurrent: each write enqueues a balance rebuild for its account,
      // and a burst of them against one Durable Object buys nothing a person can perceive.
      for (const transactionId of ids) {
        await deleteTransaction({ data: { transactionId, policies } })
      }
      return ids.length
    },
    onSuccess: async (count) => {
      setPendingDelete([])
      setSelectedIds(new Set())
      toast.success(
        count === 1
          ? t('transactions.deleted')
          : t('transactions.deletedMany', { count }),
      )
      // The page query refetches itself; `refresh` is what moves the account balances and the
      // dashboard the deleted rows were also counted in.
      await Promise.all([pageQuery.refetch(), refresh()])
    },
    onError: () => {
      setPendingDelete([])
      toast.error(t('empty.error.title'))
    },
  })

  /* ---- The caption ------------------------------------------------------- */

  const chips = useMemo(
    () => describeFilters({ filters, reference, t, locale }),
    [filters, locale, reference, t],
  )

  const caption = useMemo(() => {
    const order =
      sort.direction === 'asc'
        ? t('transactions.sort.ascending')
        : t('transactions.sort.descending')
    const sortPhrase = t('transactions.list.caption.sort', {
      field: t(SORT_LABEL[sort.field]),
      order,
    })
    if (chips.length === 0) {
      return t('transactions.list.caption.all', {
        count: total,
        sort: sortPhrase,
      })
    }
    return t('transactions.list.caption.filtered', {
      count: total,
      filters: chips.map((chip) => chip.label).join('; '),
      sort: sortPhrase,
    })
  }, [chips, sort, t, total])

  /* ---- Rendering --------------------------------------------------------- */

  const goToNew = useCallback(
    () => navigate({ to: '/transactions/new', search: {} }),
    [navigate],
  )

  const bar = (
    <FilterBar
      filters={filters}
      sort={sort}
      onViewChange={applyView}
      reference={reference}
      onCreate={goToNew}
    />
  )

  const body = () => {
    if (pageQuery.isPending) {
      return <TransactionListSkeleton />
    }
    if (pageQuery.isError) {
      return <TransactionListError onRetry={() => void pageQuery.refetch()} />
    }
    if (rows.length === 0) {
      return countActiveFilters(filters) === 0 ? (
        emptyState
      ) : (
        <TransactionsNoMatch onClearFilters={() => applyView({}, sort)} />
      )
    }
    return (
      <>
        {totals === undefined || !showSummary ? null : (
          <ListSummary totals={totals} matchCount={total} />
        )}
        <TransactionList
          rows={rows}
          totalRows={total}
          reference={reference}
          sort={sort}
          onSortChange={onSortChange}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          hasMore={pageQuery.hasNextPage}
          isLoadingMore={pageQuery.isFetchingNextPage}
          onLoadMore={() => void pageQuery.fetchNextPage()}
          onOpen={(id) =>
            navigate({
              to: '/transactions/$transactionId',
              params: { transactionId: id },
              search: {},
            })
          }
          onEdit={(id) =>
            navigate({
              to: '/transactions/$transactionId',
              params: { transactionId: id },
              search: { mode: 'edit' },
            })
          }
          onDuplicate={(id) =>
            navigate({ to: '/transactions/new', search: { from: id } })
          }
          onDelete={(id) => setPendingDelete([id])}
          hrefFor={(id) => `/transactions/${id}`}
          caption={caption}
          hasBalance={hasBalance}
          showAccount={showAccount}
        />
      </>
    )
  }

  const confirmCount = pendingDelete.length

  return (
    <div className="flex flex-col gap-4">
      {showFilterBar ? bar : null}
      <BulkActions
        selectedCount={selectedIds.size}
        onClearSelection={() => setSelectedIds(new Set())}
        onDeleteSelected={() => setPendingDelete([...selectedIds])}
        isDeleting={deletion.isPending && selectedIds.size > 0}
      />
      {body()}

      <ConfirmDeleteDialog
        isOpen={confirmCount > 0}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete([])
          }
        }}
        title={t('action.delete')}
        body={
          confirmCount === 1
            ? t('transactions.delete.confirm')
            : t('transactions.bulk.confirm', { count: confirmCount })
        }
        confirmLabel={t('action.delete')}
        isPending={deletion.isPending}
        onConfirm={() => deletion.mutate(pendingDelete)}
      />
    </div>
  )
}
