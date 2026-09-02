/**
 * The budget server functions: the only door between a route and the budget repositories.
 *
 * Three things happen here and nothing else does — the same three as `fns/accounts`.
 *
 * **The input is validated with Zod**, using the very schemas the repositories re-parse with. The
 * second parse is not redundancy for its own sake: the cron branch, the importer and the seed
 * reach those repositories without passing this file.
 *
 * **The caller is authorised with `requireOrg()`**, inside every handler and never in a
 * `beforeLoad`. A route guard is UX; an id in a URL is not an authorised id until a tenant-scoped
 * query has failed to find it somewhere else. The two period writes need `owner | admin` in a
 * shared workspace, and that gate lives in the repository where every caller meets it.
 *
 * **No write here is batched, and that is a statement rather than an omission.** Budgets read
 * `transactions` and write none, so nothing they do can move a day of an account's balance
 * history. `runWithLedgerBatch` is deliberately absent from this file; if it ever appears, either
 * a budget started writing money or somebody added it defensively, and both are worth catching in
 * review.
 *
 * **`today` enters here, once per call, from `#/server/clock`.** The repositories take it as a
 * parameter and never read a clock, which is what makes a period boundary testable at a pinned
 * date. `serverToday()` owns what the day *is* - the UTC calendar day, matching `booked_on`'s own
 * definition in `docs/MONEY.md` §6.1, and pinnable by header under `pnpm dev` so the browser suite
 * photographs the same product twice. The reader's timezone is applied at render and only there.
 *
 * Reads are `GET` so the router can cache and prefetch them; every write is `POST`.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireOrg } from '#/server/auth/guards'
import { serverToday } from '#/server/clock'
import { calendarOf, periodContaining } from '#/server/budgets/period'
import {
  rolloverLedger,
  summariseBudget,
  summariseBudgets,
} from '#/server/budgets/summary'
import {
  closePeriod as closePeriodRow,
  listPeriods as listPeriodsRow,
  materializePeriods as materializePeriodsRow,
  periodCorrections,
  periodKeySchema,
  recomputeOpenPeriod as recomputeOpenPeriodRow,
  reopenPeriod as reopenPeriodRow,
} from '#/server/repos/budget-periods'
import {
  addBudgetTransactions as addBudgetTransactionsRow,
  archiveBudget as archiveBudgetRow,
  budgetTransactionsSchema,
  createBudget as createBudgetRow,
  createBudgetSchema,
  deleteBudget as deleteBudgetRow,
  getBudget as getBudgetRow,
  listBudgetCategoryRefs,
  listBudgetPeriodTransactions,
  removeBudgetTransactions as removeBudgetTransactionsRow,
  restoreBudget as restoreBudgetRow,
  setBudgetCategories as setBudgetCategoriesRow,
  setBudgetCategoriesSchema,
  updateBudget as updateBudgetRow,
  updateBudgetSchema,
} from '#/server/repos/budgets'
import { conversionContextFor } from '#/server/repos/workspace-currencies'

import type { Transaction } from '#/server/db/types'
import type { BudgetSummary, LedgerRow } from '#/server/budgets/summary'
import type { PeriodCorrection } from '#/server/repos/budget-periods'

const budgetIdSchema = z.strictObject({
  budgetId: z.string().trim().min(1).max(64),
})

const listInputSchema = z.strictObject({
  includeArchived: z.boolean().default(false),
})

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every budget with its current period's utilisation, in one response.
 *
 * One call rather than two, for the same reason `listAccounts` returns its overview with its rows:
 * `/budgets` is a screen whose whole point is *how much is left*, and a second round trip for the
 * meters is a second chance to paint a page with the numbers missing.
 */
export const loadBudgets = createServerFn({ method: 'GET' })
  .inputValidator(listInputSchema)
  .handler(async ({ data }): Promise<ReadonlyArray<BudgetSummary>> => {
    const scope = await requireOrg()
    return summariseBudgets({
      scope,
      today: serverToday(),
      conversion: await conversionContextFor(scope),
      includeArchived: data.includeArchived,
    })
  })

/** What the detail screen draws: the budget, its ledger, its corrections and its transactions. */
export interface BudgetDetail {
  readonly summary: BudgetSummary
  readonly categoryIds: ReadonlyArray<string>
  readonly ledger: ReadonlyArray<LedgerRow>
  readonly corrections: ReadonlyArray<PeriodCorrection>
  readonly transactions: ReadonlyArray<Transaction>
}

/**
 * One budget, everything it needs, one round trip.
 *
 * The corrections are computed here and not on the list: they cost one `SUM` per closed period,
 * which is right for a screen somebody opened on purpose and wrong for a grid of cards.
 */
export const loadBudgetDetail = createServerFn({ method: 'GET' })
  .inputValidator(budgetIdSchema)
  .handler(async ({ data }): Promise<BudgetDetail> => {
    const scope = await requireOrg()
    const today = serverToday()
    const budget = await getBudgetRow(scope, data.budgetId)
    const [periods, allCategoryRefs, conversion] = await Promise.all([
      listPeriodsRow(scope, budget.id),
      listBudgetCategoryRefs(scope),
      conversionContextFor(scope),
    ])
    const categories = allCategoryRefs.filter(
      (ref) => ref.budgetId === budget.id,
    )

    const bounds = periodContaining(calendarOf(budget), today)
    const [summary, corrections, transactions] = await Promise.all([
      summariseBudget({
        scope,
        today,
        conversion,
        budget,
        periods,
        categories,
      }),
      periodCorrections(scope, budget, periods),
      bounds === null
        ? Promise.resolve<ReadonlyArray<Transaction>>([])
        : listBudgetPeriodTransactions(scope, budget, {
            from: bounds.periodStart,
            to: bounds.periodEnd,
          }),
    ])

    return {
      summary,
      categoryIds: categories.map((ref) => ref.categoryId),
      ledger: rolloverLedger(summary.rolloverPolicy, periods),
      corrections,
      transactions,
    }
  })

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Creates a budget and materialises the periods it should already have.
 *
 * The materialisation is here rather than in the repository because it is a *product* decision:
 * a budget backdated to January should show January through today the moment it is saved, and
 * waiting for the top of the next hour's cron to make that true would make the first thing a
 * person sees after creating a budget an empty screen.
 */
export const createBudget = createServerFn({ method: 'POST' })
  .inputValidator(createBudgetSchema)
  .handler(async ({ data }): Promise<{ readonly budgetId: string }> => {
    const scope = await requireOrg()
    const budget = await createBudgetRow(scope, data)
    await materializePeriodsRow(scope, {
      budgetId: budget.id,
      today: serverToday(),
    })
    return { budgetId: budget.id }
  })

const updateInputSchema = z.strictObject({
  budgetId: z.string().trim().min(1).max(64),
  patch: updateBudgetSchema,
})

/**
 * Edits a budget, then brings its **open** period into line with the change.
 *
 * A new limit reaches the open period and every period after it; not one closed period moves. That
 * asymmetry is the auditability property, and it is why the recompute is a separate call rather
 * than something `updateBudget` does to every row it can reach.
 */
export const updateBudget = createServerFn({ method: 'POST' })
  .inputValidator(updateInputSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await updateBudgetRow(scope, data.budgetId, data.patch)
    const today = serverToday()
    await materializePeriodsRow(scope, { budgetId: data.budgetId, today })
    await recomputeOpenPeriodRow(scope, data.budgetId, today)
  })

/** Takes a budget out of the list. Every period it closed stays exactly as it was. */
export const archiveBudget = createServerFn({ method: 'POST' })
  .inputValidator(budgetIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await archiveBudgetRow(scope, data.budgetId)
  })

/** Puts an archived budget back. */
export const restoreBudget = createServerFn({ method: 'POST' })
  .inputValidator(budgetIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await restoreBudgetRow(scope, data.budgetId)
  })

/** Deletes a budget that never closed a period. The repository refuses — with the count — if it did. */
export const deleteBudget = createServerFn({ method: 'POST' })
  .inputValidator(budgetIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await deleteBudgetRow(scope, data.budgetId)
  })

/** Replaces a `category` budget's category set, then recomputes what the open period counted. */
export const setBudgetCategories = createServerFn({ method: 'POST' })
  .inputValidator(setBudgetCategoriesSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await setBudgetCategoriesRow(scope, data)
    await recomputeOpenPeriodRow(scope, data.budgetId, serverToday())
  })

/** Puts transactions into a `manual` budget. A `category` budget is refused. */
export const addBudgetTransactions = createServerFn({ method: 'POST' })
  .inputValidator(budgetTransactionsSchema)
  .handler(async ({ data }): Promise<{ readonly added: number }> => {
    const scope = await requireOrg()
    const added = await addBudgetTransactionsRow(scope, data)
    await recomputeOpenPeriodRow(scope, data.budgetId, serverToday())
    return { added }
  })

/** Takes transactions back out of a `manual` budget. */
export const removeBudgetTransactions = createServerFn({ method: 'POST' })
  .inputValidator(budgetTransactionsSchema)
  .handler(async ({ data }): Promise<{ readonly removed: number }> => {
    const scope = await requireOrg()
    const removed = await removeBudgetTransactionsRow(scope, data)
    await recomputeOpenPeriodRow(scope, data.budgetId, serverToday())
    return { removed }
  })

/** Freezes a period's figures. `owner | admin` in a shared workspace — the repository decides. */
export const closeBudgetPeriod = createServerFn({ method: 'POST' })
  .inputValidator(periodKeySchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await closePeriodRow(scope, data)
  })

/** Unfreezes one, so a mistake can be corrected at source. Same gate, same reasoning. */
export const reopenBudgetPeriod = createServerFn({ method: 'POST' })
  .inputValidator(periodKeySchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    await reopenPeriodRow(scope, data)
  })

/** Brings the open period's stored spend up to date. Idempotent; touches no closed row. */
export const refreshBudgetPeriods = createServerFn({ method: 'POST' })
  .inputValidator(budgetIdSchema)
  .handler(async ({ data }): Promise<void> => {
    const scope = await requireOrg()
    const today = serverToday()
    await materializePeriodsRow(scope, { budgetId: data.budgetId, today })
    await recomputeOpenPeriodRow(scope, data.budgetId, today)
  })
