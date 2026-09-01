import { today } from '@internationalized/date'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  DASHBOARD_PERIODS,
  monthRange,
  monthsIn,
  periodRange,
} from '#/components/app/dashboard'
import { asCurrencyCode, asMinor, subtractMinor, sumMinor } from '#/lib/money'
import { requireOrg } from '#/server/auth/guards'
import { isLiabilityCategory } from '#/server/catalog/account-types'
import { listAccounts } from '#/server/repos/accounts'
import {
  DEFAULT_TRANSACTION_SORT,
  pageTransactions,
  sumTransactions,
} from '#/server/repos/transaction-queries'

import type { CashFlowBucket, DashboardData } from '#/components/app/dashboard'
import type { TenantScope } from '#/server/repos/base'
import type { TransactionPolicies } from '#/server/repos/transactions'

/**
 * Everything the dashboard renders, in one call.
 *
 * ## Why a route-local server function rather than a repository
 *
 * It owns **no SQL**. It composes `listAccounts`, `sumTransactions` and `pageTransactions` — all of
 * them tenant-scoped — and reduces what they return to the view models the widgets take. That is
 * exactly what `-server/` is for: routes call server functions, server functions call repositories,
 * and no SQL lives outside `src/server/repos`.
 *
 * ## Two policy sets, because a list and a statistic are different questions
 *
 * {@link FLOW_POLICIES} drives every figure: planned rows are excluded (a forecast is not what
 * happened) and **transfers are excluded**, because moving your own money between your own accounts
 * is neither income nor expense — counting it would inflate both halves of the cash-flow chart by
 * the same amount and make the difference look smaller than it is. Balance corrections are
 * included, because a correction is real money that moved.
 *
 * {@link LEDGER_POLICIES} drives the recent list, which is a **record of what happened** and so
 * shows the transfer the person recorded ten minutes ago. The repository draws the same
 * distinction in `sumTransactions`, and this is the same distinction one layer up.
 *
 * ## The header cannot disagree with the chart
 *
 * The period totals are not queried. They are `sumMinor` over the month buckets the chart draws,
 * so the two are the same integers by construction rather than by two queries agreeing. The
 * periods are all month-aligned, which is what makes that sound.
 *
 * ## The known cost, and what replaces it
 *
 * One `sumTransactions` per month — thirteen queries at most, issued concurrently. Plan 17's
 * `cashflow` repository does this in a single `GROUP BY` and this loader should call it the day it
 * lands. Grouping by month here would mean writing SQL outside `src/server/repos`, which is not a
 * trade this codebase makes for a round trip.
 *
 * ## What is deliberately empty
 *
 * `spending` comes back empty for every workspace: the classification repository does not exist
 * yet, and the dashboard **invents no data**. The widget renders its designed empty state, which
 * says what would fill it.
 */

/** What the figures count. See the note above on why transfers are out. */
const FLOW_POLICIES: TransactionPolicies = {
  planned: 'exclude',
  adjustments: 'include',
  transfers: 'exclude',
  completeness: 'any',
}

/** What the recent list shows. A record, not a statistic. */
const LEDGER_POLICIES: TransactionPolicies = {
  planned: 'exclude',
  adjustments: 'include',
  transfers: 'include',
  completeness: 'any',
}

/** How many rows the recent panel holds. Small on purpose: it is a glance, not the ledger. */
const RECENT_LIMIT = 6

const inputSchema = z.strictObject({
  period: z.enum(DASHBOARD_PERIODS).default('thisMonth'),
})

export const loadDashboard = createServerFn({ method: 'GET' })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<DashboardData> => {
    const scope = await requireOrg()
    // The clock is read once, here, in UTC — the frame `booked_on` is stored in. A date supplied
    // by the caller would let a bookmark decide what "this month" means.
    const range = periodRange(data.period, today('UTC').toString())

    // Archived and excluded accounts come back too: the recent list may name one, and a row whose
    // account has been archived must still say which account it was on.
    const list = await listAccounts(scope, { includeExcluded: true })
    const baseCurrencyCode = list.overview.baseCurrencyCode

    const [buckets, recentPage] = await Promise.all([
      cashFlowBuckets(scope, range, baseCurrencyCode),
      pageTransactions({
        scope,
        policies: LEDGER_POLICIES,
        filters: { from: range.from, to: range.to },
        historyFloor: null,
        sort: DEFAULT_TRANSACTION_SORT,
        cursor: null,
        limit: RECENT_LIMIT,
      }),
    ])

    const accountNames = new Map(
      list.accounts.map((account) => [account.id, account.name]),
    )

    const incomeMinor = sumMinor(buckets.map((bucket) => bucket.incomeMinor))
    const expenseMinor = sumMinor(buckets.map((bucket) => bucket.expenseMinor))

    return {
      baseCurrencyCode,
      period: data.period,
      range,
      hasData: list.overview.totalAccounts > 0,
      netWorth: {
        totalBalanceMinor: list.overview.totalBalanceMinor,
        liabilitiesMinor: list.overview.liabilitiesMinor,
        netWorthMinor: list.overview.netWorthMinor,
      },
      cashFlow: {
        buckets,
        incomeMinor,
        expenseMinor,
        netMinor: subtractMinor(incomeMinor, expenseMinor),
      },
      accounts: list.accounts
        .filter((account) => account.status === 'active')
        .map((account) => ({
          id: account.id,
          name: account.name,
          balanceMinor: asMinor(account.currentBalanceMinor),
          currencyCode: asCurrencyCode(account.currencyCode),
          refBalanceMinor: asMinor(account.refCurrentBalanceMinor),
          isLiability: isLiabilityCategory(account.category),
        })),
      recent: recentPage.rows.map((row) => ({
        id: row.id,
        bookedOn: row.bookedOn,
        // The note is what the person wrote; the account is what the row is on. Neither is a
        // fabricated title, and there is no third fallback because there is nothing honest to
        // put there. Payee names arrive with plan 09.
        title: row.note?.trim() || (accountNames.get(row.accountId) ?? ''),
        direction: row.direction === 'income' ? 'income' : 'expense',
        amountMinor: asMinor(row.amountMinor),
        currencyCode: asCurrencyCode(row.currencyCode),
        refAmountMinor: asMinor(row.refAmountMinor),
      })),
      spending: [],
    }
  })

/** One `sumTransactions` per month in the range, concurrently. See the note on the known cost. */
async function cashFlowBuckets(
  scope: TenantScope,
  range: { readonly from: string; readonly to: string },
  baseCurrencyCode: DashboardData['baseCurrencyCode'],
): Promise<ReadonlyArray<CashFlowBucket>> {
  const months = monthsIn(range)

  return Promise.all(
    months.map(async (firstDay): Promise<CashFlowBucket> => {
      const month = monthRange(firstDay)
      const totals = await sumTransactions({
        scope,
        policies: FLOW_POLICIES,
        filters: { from: month.from, to: month.to },
        historyFloor: null,
        baseCurrencyCode,
      })

      return {
        key: firstDay,
        incomeMinor: totals.incomeMinor,
        expenseMinor: totals.expenseMinor,
        netMinor: totals.netMinor,
      }
    }),
  )
}
