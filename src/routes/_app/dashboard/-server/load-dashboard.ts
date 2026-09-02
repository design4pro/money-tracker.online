import { today } from '@internationalized/date'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { z } from 'zod'

import {
  DASHBOARD_PERIODS,
  monthRange,
  monthsIn,
  periodRange,
  trailingMonths,
} from '#/components/app/dashboard'
import { createTranslator, loadCatalogue } from '#/lib/i18n'
import { asCurrencyCode, asMinor, subtractMinor, sumMinor } from '#/lib/money'
import { requireOrg } from '#/server/auth/guards'
import { isLiabilityCategory } from '#/server/catalog/account-types'
import { negotiateLocaleFrom } from '#/server/fns/locale'
import { listAccounts } from '#/server/repos/accounts'
import { spendingByCategory } from '#/server/repos/categories'
import { listPayees } from '#/server/repos/payees'
import {
  DEFAULT_TRANSACTION_SORT,
  pageTransactions,
  sumTransactions,
} from '#/server/repos/transaction-queries'

import type {
  CashFlowBucket,
  CategorySpend,
  DashboardData,
} from '#/components/app/dashboard'
import type { TenantScope } from '#/server/repos/base'
import type { SpendingByCategory } from '#/server/repos/categories'
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
 * The period totals are not queried. They are `sumMinor` over the month buckets the chart draws —
 * the ones marked `inPeriod`, since a one-month period is drawn against trailing context months —
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
 * ## The one figure that is named rather than queried
 *
 * The spending donut needs a label for the transactions nobody filed. The repository refuses to
 * invent one — it has no locale — so it reports the unfiled sum as its own field and this loader
 * names it, in the language the request negotiated. Dropping the bucket instead would make the
 * donut's total disagree with the expense figure in the header directly above it.
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

/**
 * How many months the cash-flow chart draws when the period is a single month.
 *
 * Six: enough for a reader to see a normal month and an unusual one apart, short enough that every
 * bar still has a width worth reading at a panel's size, and cheap enough that the extra aggregates
 * stay inside one round of concurrency.
 */
const CONTEXT_MONTHS = 6

/**
 * How many named slices the donut draws before the rest is folded into "Other".
 *
 * Eight, because the categorical series palette is eight hues wide (`DESIGN.md`) and a ninth slice
 * would either repeat a colour or introduce one nobody measured against the four grounds.
 */
const SPENDING_SLICES = 8

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

    const [buckets, recentPage, spending, payees] = await Promise.all([
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
      spendingByCategory(scope, {
        from: range.from,
        to: range.to,
        limit: SPENDING_SLICES,
      }),
      listPayees(scope),
    ])

    const accountNames = new Map(
      list.accounts.map((account) => [account.id, account.name]),
    )
    const payeeNames = new Map(
      payees.map(({ payee }) => [payee.id, payee.name]),
    )

    // The selected period alone. The chart may also carry trailing context months, and counting
    // those in the header would report six months of spending under a heading that says March.
    const selected = buckets.filter((bucket) => bucket.inPeriod)
    const incomeMinor = sumMinor(selected.map((bucket) => bucket.incomeMinor))
    const expenseMinor = sumMinor(selected.map((bucket) => bucket.expenseMinor))

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
        // Who it was with, then what the person wrote, then what it was on. Three real values in
        // the order a reader recognises them, and no fabricated title anywhere in the chain: the
        // account name is reached only when the row genuinely has no payee and no note.
        title:
          (row.payeeId === null ? undefined : payeeNames.get(row.payeeId)) ??
          (row.note?.trim() || undefined) ??
          accountNames.get(row.accountId) ??
          '',
        direction: row.direction === 'income' ? 'income' : 'expense',
        amountMinor: asMinor(row.amountMinor),
        currencyCode: asCurrencyCode(row.currencyCode),
        refAmountMinor: asMinor(row.refAmountMinor),
      })),
      spending: await spendingSlices(spending),
    }
  })

/**
 * The donut's slices, with the unfiled bucket named in the request's language.
 *
 * The catalogue is loaded here rather than passed in because this is the only figure on the
 * dashboard that needs a word rather than a number — every other label belongs to a component that
 * already has `t()`. `createTranslator` renders the key itself if the catalogue is missing it,
 * which is visible damage a reviewer catches rather than an English word on a Polish screen.
 */
async function spendingSlices(
  spending: SpendingByCategory,
): Promise<ReadonlyArray<CategorySpend>> {
  const named: Array<CategorySpend> = spending.categories.map((slice) => ({
    id: slice.categoryId,
    label: slice.name,
    amountMinor: slice.amountMinor,
  }))

  if (spending.uncategorisedMinor === 0) {
    return named
  }

  const { locale } = negotiateLocaleFrom({
    acceptLanguage: () => getRequestHeader('accept-language') ?? null,
  })
  const t = createTranslator(locale, await loadCatalogue(locale))

  return [
    ...named,
    {
      id: 'uncategorised',
      label: t('dashboard.spending.uncategorised'),
      amountMinor: spending.uncategorisedMinor,
    },
  ]
}

/**
 * One `sumTransactions` per month drawn, concurrently. See the note on the known cost.
 *
 * **A one-month period is drawn against its trailing months.** `thisMonth` and `lastMonth` resolve
 * to a single bucket, and a single bucket is not a chart: two bars alone in a plot answer "how much"
 * and cannot answer "is that a lot", which is the only question anyone brings to a cash-flow panel.
 * The extra months are marked `inPeriod: false` and every total on the screen ignores them, so the
 * context costs five more concurrent aggregates and changes no figure the header states.
 */
async function cashFlowBuckets(
  scope: TenantScope,
  range: { readonly from: string; readonly to: string },
  baseCurrencyCode: DashboardData['baseCurrencyCode'],
): Promise<ReadonlyArray<CashFlowBucket>> {
  const months = monthsIn(range)
  const selected = new Set(months)
  const drawn =
    months.length === 1 ? trailingMonths(months[0], CONTEXT_MONTHS) : months

  return Promise.all(
    drawn.map(async (firstDay): Promise<CashFlowBucket> => {
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
        inPeriod: selected.has(firstDay),
      }
    }),
  )
}
