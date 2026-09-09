/**
 * The dashboard's composition, against a real SQLite database built from `drizzle/*.sql`.
 *
 * The defect this file exists for: the "Latest transactions" widget was fed a query filtered to
 * the selected period, so a workspace whose newest transaction was booked outside the open month
 * showed the widget's **empty state** — "Nothing recorded yet · Record your first transaction" —
 * over a ledger that was not empty at all. `e2e/core-flow.spec.ts` records a transaction and then
 * reads the dashboard, and that is the assertion it failed on.
 *
 * The distinction the cases below pin is the one `dashboard-data.ts` already states in prose and
 * did not state in code: **a list and a statistic are different questions**. The figures answer
 * "how much, in this period" and stay bounded by it; the recent list answers "what happened last"
 * and is bounded by nothing but its own row count. Plan 18 (`docs/plans/18-dashboard.md`, `18-S2`)
 * specifies the widget as "`07-S2`'s transaction query with `limit: 5`" and puts `period` in the
 * *cashflow* widget's params, never in this one's.
 *
 * `dashboardFor` rather than `loadDashboard`: a `createServerFn` value is only callable inside the
 * Start request context, so a test of the wrapper would be a test of TanStack.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { organization, user } from '#/server/db/auth-schema'
// A Node-run test seeding real tables, never bundled for the browser - the one case the rule
// against value imports of the schema from a route directory does not mean.
// eslint-disable-next-line no-restricted-imports
import {
  accounts,
  categories,
  currencies,
  organizationCurrencies,
  transactions,
} from '#/server/db/schema'
import { openTestDb } from '#/server/repos/__tests__/db-harness'
import { createScope } from '#/server/repos/scope'

import { dashboardFor } from '../dashboard-data'

import type { DashboardPeriod } from '#/components/app/dashboard'
import type { TenantScope } from '#/server/repos/scope'

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The day the server is serving on, and the only reason it is pinned.
 *
 * `thisMonth` resolves against it, so every fixture date below is either inside August 2026 or
 * deliberately outside it. Left to the wall clock the whole file would assert something different
 * every month.
 */
const TODAY = '2026-08-20'

let scope: TenantScope

// The one thing this composition reaches for that a unit test cannot supply. Everything below it
// is the real code path, against the real schema.
vi.mock('#/server/clock', () => ({ serverToday: () => TODAY }))

/**
 * One expense on `bookedOn`, in the base currency so no rate row is needed.
 *
 * Every row carries a category, because an uncategorised amount sends the loader through the
 * catalogue to name the donut's leftover slice — a second thing to arrange for, and not the thing
 * any case here is about.
 */
function expense(id: string, bookedOn: string, amountMinor: number) {
  return {
    id,
    organizationId: 'org-a',
    accountId: 'acc-1',
    direction: 'expense',
    amountMinor,
    currencyCode: 'PLN',
    refAmountMinor: amountMinor,
    refCurrencyCode: 'PLN',
    rateE10: 10_000_000_000,
    bookedOn,
    bookedAt: new Date(`${bookedOn}T09:00:00.000Z`),
    categoryId: 'cat-1',
    note: id,
    createdAt: new Date(`${bookedOn}T09:00:00.000Z`),
    updatedAt: new Date(`${bookedOn}T09:00:00.000Z`),
  }
}

beforeEach(async () => {
  const db = openTestDb()
  const now = new Date('2026-01-01T00:00:00.000Z')

  await db
    .insert(currencies)
    .values({ code: 'PLN', name: 'Polish Zloty', digits: 2, numericCode: 985 })
    .onConflictDoNothing()
  await db.insert(user).values({
    id: 'user-a',
    name: 'A',
    email: 'a@example.com',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db
    .insert(organization)
    .values({ id: 'org-a', name: 'A', slug: 'a', createdAt: now })
  await db.insert(organizationCurrencies).values({
    organizationId: 'org-a',
    currencyCode: 'PLN',
    isBase: true,
    liveRateUpdate: false,
    addedAt: now,
  })
  await db.insert(accounts).values({
    id: 'acc-1',
    organizationId: 'org-a',
    name: 'Everyday',
    currencyCode: 'PLN',
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(categories).values({
    id: 'cat-1',
    organizationId: 'org-a',
    name: 'Groceries',
    slug: 'groceries',
    color: '#112233',
    createdAt: now,
    updatedAt: now,
  })

  // One row two months before the open month, one inside it, one after it — so `lastMonth` is a
  // period with nothing in it at all. The last row is the `core-flow` case:
  // a transaction recorded moments ago whose booked date is not in the month the dashboard opens
  // on — which is every reader east of UTC on the first of a month, and every backdated receipt.
  await db
    .insert(transactions)
    .values([
      expense('txn-june', '2026-06-15', 1_000),
      expense('txn-august', '2026-08-10', 2_000),
      expense('txn-september', '2026-09-02', 4_250),
    ])

  scope = createScope(db, {
    userId: 'user-a',
    organizationId: 'org-a',
    role: 'owner',
  })
})

/**
 * The import is static, and that is load-bearing rather than stylistic.
 *
 * `dashboard-data` pulls the i18n catalogue, the dashboard view models, four repositories and
 * `@tanstack/react-start/server` behind it. Vite transforms that graph on first import, and
 * imported from inside a case the whole cost — measured at over seven seconds on this machine —
 * is charged to that case's 5000 ms `testTimeout`, while the composition it is actually
 * measuring runs in about ten. Hoisting the import to module scope moves the transform into
 * collection, which no timeout bounds, and leaves each case timing only its own work.
 */
async function load(period: DashboardPeriod = 'thisMonth') {
  return dashboardFor(scope, period)
}

/* -------------------------------------------------------------------------- */
/* Cases                                                                       */
/* -------------------------------------------------------------------------- */

describe('the recent list', () => {
  it('shows the latest transactions in the workspace, not the latest in the period', async () => {
    const data = await load()

    expect(data.recent.map((row) => row.id)).toEqual([
      'txn-september',
      'txn-august',
      'txn-june',
    ])
  })

  it('does not empty itself when the period the reader opened on holds nothing', async () => {
    // "Nothing recorded yet" is a claim about the workspace, and the widget's own empty state says
    // so in as many words. A period with no rows in it is not that claim.
    const data = await load('lastMonth')

    expect(data.recent.map((row) => row.id)).toEqual([
      'txn-september',
      'txn-august',
      'txn-june',
    ])
    expect(data.cashFlow.expenseMinor).toBe(0)
  })
})

describe('the figures', () => {
  it('counts the selected period alone, and none of the months around it', async () => {
    // The other half of the same distinction: unscoping the list must not unscope the header. A
    // dashboard whose August total counted July and September would be a worse bug than the one
    // this file was written for.
    const data = await load()

    expect(data.cashFlow.expenseMinor).toBe(2_000)
    expect(data.cashFlow.incomeMinor).toBe(0)
    expect(data.cashFlow.netMinor).toBe(-2_000)
    expect(data.range).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })
})
