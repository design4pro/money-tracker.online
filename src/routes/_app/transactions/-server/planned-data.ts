import { getUpcoming } from '#/server/repos/recurring'
import { listCategories } from '#/server/repos/categories'

import {
  categoryScopeOf,
  narrowExpectations,
  suppressesExpectations,
} from '../-lib/expectation-filters'
import { toExpectationRow } from '../-lib/rows'

import type {
  ExpectationGroup,
  ExpectationRow,
} from '#/components/app/transactions'
import type { TransactionListPage } from '#/server/fns/transactions'
import type { Logger } from '#/server/observability/logger'
import type { TenantScope } from '#/server/repos/base'
import type {
  TransactionFilters,
  TransactionSort,
} from '#/server/repos/transaction-queries'
import type { TransactionPolicies } from '#/server/repos/transactions'

/**
 * The planned screen's read: the planned transactions page, and the recurring periods that have
 * not settled yet, composed.
 *
 * ## An expectation is rendered beside the ledger, never converted into it
 *
 * A recurring period that is due is not money yet and is not a row of `transactions`, so the
 * ledger page below is **exactly** what the ledger reader returned: the same rows, the same count,
 * the same totals. Nothing here is passed to the totals and nothing here is added to them, which
 * is the property a case in `money-invariants.test.ts` pins by running this very function with and
 * without expectations and comparing the totals byte for byte.
 *
 * ## Why it is a read-time merge and not materialised rows
 *
 * Writing planned `transactions` rows ahead of the due date would make a second writer into the
 * ledger, to be deduplicated against the auto-record and the matcher, with a migration and a stored
 * money row behind it. This composes two scoped reads and persists nothing, so reverting the
 * commit undoes it (`.ai/specs/2026-09-20-recurring-periods-settle-and-surface.md`).
 *
 * ## The group is read once and is not paged
 *
 * The upcoming read has no lower date bound and the ledger's sort can be by a name, so there is no
 * horizon a page could derive. The group is therefore the same on every call whatever the cursor
 * or the sort: due within {@link WITHIN_DAYS} days or already overdue, the {@link LIMIT} nearest,
 * ordered by due date. The screen draws it from the first page only.
 *
 * ## It owns no SQL and no scope
 *
 * It receives the scope and the day from the server function that established them (the day is
 * read from the server clock there, never accepted from a caller) and passes the scope first to
 * every repository call. The ledger half arrives as a function, because the thing it stands for is
 * a server function that authorises on its own and only runs inside a request - which is also what
 * makes this one callable from a unit test.
 */

/** How far ahead the group looks, in days. The same window `/recurring` uses for what is due. */
const WITHIN_DAYS = 30

/** The most periods the group holds. */
const LIMIT = 50

export interface PlannedScreenInput {
  readonly policies: TransactionPolicies
  readonly filters: TransactionFilters
  readonly sort: TransactionSort
  readonly cursor: string | null
  readonly limit?: number
  readonly includeBalanceAfter?: boolean
}

/** One page of the transactions ledger, under the policies and filters the input states. */
export type LedgerReader = (
  input: PlannedScreenInput,
) => Promise<TransactionListPage>

export interface PlannedScreenPage extends TransactionListPage {
  /** The day the read was taken on, so "overdue" is judged against the same date everywhere. */
  readonly today: string
  readonly expectations: ExpectationGroup
}

export interface PlannedScreenDeps {
  readonly readLedger: LedgerReader
  readonly logger: Logger
}

/** Soonest first; the id breaks a tie so the order is the same on every call. */
function byDueDate(a: ExpectationRow, b: ExpectationRow): number {
  if (a.dueOn !== b.dueOn) {
    return a.dueOn < b.dueOn ? -1 : 1
  }
  if (a.id === b.id) {
    return 0
  }
  return a.id < b.id ? -1 : 1
}

async function readExpectations(
  scope: TenantScope,
  filters: TransactionFilters,
  today: string,
  logger: Logger,
): Promise<ExpectationGroup> {
  if (suppressesExpectations(filters)) {
    return { state: 'suppressed' }
  }
  try {
    // One more than the cap, to learn whether there is more without a second read.
    const periods = await getUpcoming(scope, {
      today,
      within: WITHIN_DAYS,
      limit: LIMIT + 1,
    })
    const categoryScope =
      filters.categoryIds === undefined
        ? undefined
        : categoryScopeOf(
            filters.categoryIds,
            await listCategories(scope, { includeArchived: true }),
          )
    // The cap comes first and the narrowing after it: the group is the fifty nearest, filtered.
    const rows = narrowExpectations(
      periods.slice(0, LIMIT).map(toExpectationRow),
      filters,
      categoryScope,
    )
    return {
      state: 'shown',
      rows: [...rows].sort(byDueDate),
      withinDays: WITHIN_DAYS,
      limit: LIMIT,
      isCapped: periods.length > LIMIT,
    }
  } catch (error) {
    // The person came for their planned transactions and still gets them; the screen says the
    // expected half could not be loaded. Logged, so a failing read is not a silent one.
    logger.error('planned screen: expected payments could not be read', error, {
      orgId: scope.ctx.organizationId,
    })
    return { state: 'failed' }
  }
}

/**
 * The planned screen's page for a scope that has already been established.
 *
 * A failing ledger read rejects, so the screen's ordinary error path applies. A failing expected
 * read does not: it becomes the `failed` state of the group beside a ledger that loaded.
 */
export async function plannedScreenFor(
  scope: TenantScope,
  input: PlannedScreenInput,
  today: string,
  { readLedger, logger }: PlannedScreenDeps,
): Promise<PlannedScreenPage> {
  const [page, expectations] = await Promise.all([
    readLedger(input),
    readExpectations(scope, input.filters, today, logger),
  ])
  return { ...page, today, expectations }
}
