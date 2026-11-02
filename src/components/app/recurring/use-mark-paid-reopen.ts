import { useCallback, useRef, useState } from 'react'

/**
 * The `?markPaid=` reopen / close-and-clear address for the mark-paid dialog.
 *
 * Three screens share this: the list and planned require both halves (`periodStart` and series),
 * because a date alone is ambiguous on a mixed list; the series detail matches the period start
 * on an unsettled period of an active series. Closing the picker drops the query so a reload does
 * not reopen it.
 *
 * The helpers are the policy; the hook is the pending row plus that close. None of this imports a
 * route or a server function — the same test approach as {@link useRecurringAction}.
 */

export type MarkPaidSearch = {
  readonly markPaid?: string
  readonly series?: string
}

export type MarkPaidPeriodKey = {
  readonly periodStart: string
  readonly seriesId: string
}

export type FindReopenedPeriodOptions<T> = {
  /** When true, both halves of the address must be present and must match. */
  readonly matchSeries: boolean
  readonly canOpen?: (row: T) => boolean
}

export type MarkPaidReopen<T> = {
  readonly pending: T | null
  readonly open: (row: T) => void
  readonly close: () => void
  readonly reopenId: string | null
}

/** The address of one period on a mixed list: series, then the period start. */
export function markPaidReopenId(search: MarkPaidSearch): string | null {
  if (search.markPaid === undefined || search.series === undefined) {
    return null
  }
  return `${search.series}:${search.markPaid}`
}

export function hasMarkPaidSearch(search: MarkPaidSearch): boolean {
  return search.markPaid !== undefined || search.series !== undefined
}

export function isUnsettledPeriodStatus(status: string): boolean {
  return status !== 'paid' && status !== 'skipped'
}

/**
 * The period `?markPaid=` names, or none.
 *
 * `matchSeries` is how a mixed list refuses to guess when the series half is missing. A screen
 * that already is one series (`/recurring/$seriesId`) passes `false` and uses `canOpen` to refuse
 * a settled period.
 */
export function findReopenedPeriod<T>(
  periods: ReadonlyArray<T>,
  search: MarkPaidSearch,
  of: (row: T) => MarkPaidPeriodKey,
  options: FindReopenedPeriodOptions<T>,
): T | undefined {
  if (search.markPaid === undefined) return undefined
  if (options.matchSeries && search.series === undefined) return undefined
  const canOpen = options.canOpen ?? (() => true)
  return periods.find((row) => {
    const key = of(row)
    if (key.periodStart !== search.markPaid) return false
    if (options.matchSeries && key.seriesId !== search.series) return false
    return canOpen(row)
  })
}

export function useMarkPaidReopen<T>({
  search,
  initial,
  onClearSearch,
}: {
  readonly search: MarkPaidSearch
  readonly initial: T | null
  readonly onClearSearch: () => void
}): MarkPaidReopen<T> {
  const [pending, setPending] = useState<T | null>(initial)
  const searchRef = useRef(search)
  const clearRef = useRef(onClearSearch)
  searchRef.current = search
  clearRef.current = onClearSearch

  const open = useCallback((row: T) => {
    setPending(row)
  }, [])

  const close = useCallback(() => {
    setPending(null)
    if (hasMarkPaidSearch(searchRef.current)) {
      clearRef.current()
    }
  }, [])

  return {
    pending,
    open,
    close,
    reopenId: markPaidReopenId(search),
  }
}
