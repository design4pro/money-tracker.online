/**
 * Which ledger filters narrow the expected group of the planned screen, and which hide it.
 *
 * ## An expectation is not a transaction, so most of the filters have a counterpart and five do not
 *
 * The group is read once (`getUpcoming`, at most the fifty nearest) and narrowed **here, in
 * memory**, over those rows: no SQL, no change to the repository's signature. A filter with a
 * counterpart on {@link ExpectationRow} narrows the group. A filter without one - an account
 * group, a tag, a payment method, an attachment, a transfer kind - has nothing to narrow by, and
 * ignoring it would show rows that do not match what the person asked for, so it **suppresses the
 * whole group** and the screen says why.
 *
 * ## The classification is exhaustive, so a new filter cannot be forgotten
 *
 * {@link FILTER_EFFECT} is checked against `keyof TransactionFilters` in both directions: a key the
 * repository's filter type gains and this table lacks is a typecheck error, and so is a key this
 * table invents.
 *
 * ## Absence is not a match
 *
 * A series whose account, category or payee was deleted carries `null` for it (`onDelete: 'set
 * null'`). A filter naming ids never matches a `null`: "no payee" is not the payee that was asked
 * for.
 *
 * ## The amount window never converts
 *
 * The bounds are minor units in the currency the filter names, so they are compared only against a
 * row in that same currency. A row in another currency does not match, rather than being converted
 * to be compared (`docs/MONEY.md` §2).
 */

import type { ExpectationRow } from '#/components/app/transactions/types'
import type { TransactionFilters } from '#/server/repos/transaction-queries'

type FilterEffect = 'narrows' | 'suppresses'

export const FILTER_EFFECT = {
  text: 'narrows',
  from: 'narrows',
  to: 'narrows',
  accountIds: 'narrows',
  categoryIds: 'narrows',
  payeeIds: 'narrows',
  direction: 'narrows',
  amount: 'narrows',
  accountGroupIds: 'suppresses',
  tagIds: 'suppresses',
  paymentMethods: 'suppresses',
  hasAttachment: 'suppresses',
  transferKinds: 'suppresses',
} as const satisfies Record<keyof TransactionFilters, FilterEffect>

/** Whether any filter in force is one an expectation cannot be narrowed by. */
export function suppressesExpectations(filters: TransactionFilters): boolean {
  return (Object.keys(filters) as Array<keyof TransactionFilters>).some(
    (key) => FILTER_EFFECT[key] === 'suppresses' && filters[key] !== undefined,
  )
}

/**
 * The named categories and their children, as a set of ids.
 *
 * The tree is two levels deep by construction, so "and its descendants" is one hop. The categories
 * come from the scoped repository read the caller already made, never from a query of this
 * module's own.
 */
export function categoryScopeOf(
  named: ReadonlyArray<string>,
  categories: ReadonlyArray<{
    readonly id: string
    readonly parentId: string | null
  }>,
): ReadonlySet<string> {
  const scope = new Set(named)
  for (const category of categories) {
    if (category.parentId !== null && scope.has(category.parentId)) {
      scope.add(category.id)
    }
  }
  // A child never names its own children, so the loop above cannot miss a grandchild.
  return scope
}

function matches(
  row: ExpectationRow,
  filters: TransactionFilters,
  categoryScope: ReadonlySet<string> | undefined,
): boolean {
  if (
    filters.text !== undefined &&
    !row.seriesName.toLowerCase().includes(filters.text.toLowerCase())
  ) {
    return false
  }
  // ISO calendar dates compare correctly as strings.
  if (filters.from !== undefined && row.dueOn < filters.from) {
    return false
  }
  if (filters.to !== undefined && row.dueOn > filters.to) {
    return false
  }
  if (
    filters.accountIds !== undefined &&
    (row.accountId === null || !filters.accountIds.includes(row.accountId))
  ) {
    return false
  }
  if (
    filters.categoryIds !== undefined &&
    (row.categoryId === null ||
      !(categoryScope ?? new Set(filters.categoryIds)).has(row.categoryId))
  ) {
    return false
  }
  if (
    filters.payeeIds !== undefined &&
    (row.payeeId === null || !filters.payeeIds.includes(row.payeeId))
  ) {
    return false
  }
  if (filters.direction !== undefined && row.direction !== filters.direction) {
    return false
  }
  if (filters.amount !== undefined) {
    const { currencyCode, minMinor, maxMinor } = filters.amount
    if (row.currencyCode !== currencyCode) {
      return false
    }
    if (minMinor !== undefined && row.expectedAmountMinor < minMinor) {
      return false
    }
    if (maxMinor !== undefined && row.expectedAmountMinor > maxMinor) {
      return false
    }
  }
  return true
}

/**
 * The rows the filters in force leave in the group.
 *
 * Only call this when {@link suppressesExpectations} is `false`: a suppressing filter withholds the
 * group, it does not narrow it, and this function does not look at those keys at all.
 */
export function narrowExpectations(
  rows: ReadonlyArray<ExpectationRow>,
  filters: TransactionFilters,
  categoryScope?: ReadonlySet<string>,
): ReadonlyArray<ExpectationRow> {
  return rows.filter((row) => matches(row, filters, categoryScope))
}
