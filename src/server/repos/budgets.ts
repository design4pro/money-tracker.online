/**
 * Budgets — the envelopes, their membership, and the one integer every screen reads.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE RULES THIS MODULE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 *
 * 1. **Two kinds, and exactly one membership mechanism each.** A `category` budget follows a set
 *    of categories and resolves its members **at read time** from that set; a `manual` budget
 *    follows the rows somebody put in `budget_transactions` by hand. {@link addBudgetTransactions}
 *    refuses a `category` budget and {@link setBudgetCategories} refuses a `manual` one. Two
 *    mechanisms answering the same membership question is how a transaction ends up counted twice,
 *    and the refusal is where that is cheap to see.
 *
 * 2. **`auto_include` is resolved, never materialised.** A transaction in a covered category joins
 *    the current period the moment it is written, because the membership query reads
 *    `budget_categories` rather than a copy of it. Materialising the set would need a backfill on
 *    every category change, on every re-categorisation and on every import, and the first one
 *    anybody forgot would drift silently.
 *
 * 3. **Spend is an integer SQL `SUM` of `ref_amount_minor`.** Never a JavaScript reduction over a
 *    page — a page is 25 rows and a budget is not. The column is already in the workspace base
 *    currency at each row's own `booked_on` rate, so nothing here converts a transaction, ever.
 *    The **limit** is the only thing that is converted, once, when the budget is denominated in
 *    something other than the base (see {@link limitInBaseMinor}).
 *
 * 4. **Spend is net, and the document says which.** `docs/MONEY.md` §4.4 requires every spend
 *    aggregation to state whether it is gross or net of refunds. This one is **net**:
 *    `gross expenses − credits in the same membership − linked refunds booked elsewhere`. The
 *    third term is guarded so that a refund which is *itself* inside the budget is subtracted once
 *    by the second term and not again by the third.
 *
 * 5. **A budget write never touches a transaction.** Nothing below writes to `transactions`,
 *    `transaction_splits` or `account_balances`, and no path here enqueues a ledger rebuild —
 *    stated out loud, per `12-S1`, so nobody wraps these calls in `runWithLedgerBatch` later on
 *    the theory that money moved. Budgets read money; they do not move it.
 *
 * The rollover arithmetic is deliberately *not* here: it is `#/server/budgets/rollover`, which has
 * no database handle, so every policy question is answerable without a fixture. This module writes
 * what that module computes.
 */

import {
  and,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lte,
  not,
  or,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'

import { ZERO_MINOR, asCurrencyCode, asMinor } from '#/lib/money'
import { member } from '#/server/db/auth-schema'
import {
  BUDGET_KINDS,
  BUDGET_PERIODS,
  BUDGET_ROLLOVER_POLICIES,
  BUDGET_STATUSES,
  accounts,
  budgetCategories,
  budgetPeriods as budgetPeriodsTable,
  budgetTransactions,
  budgets,
  categories,
  refunds,
  transactionSplits,
  transactions,
} from '#/server/db/schema'
import { newId } from '#/server/db/ids'

import {
  assertWithinLimit,
  createTenantRepository,
  createTenantTableAccess,
  tenantFilter,
} from './base'
import { ConflictError, ForbiddenError, NotFoundError } from './errors'
import {
  computeRefAmount,
  scopedTransactionFilter,
  toTransaction,
} from './transactions'

import type { SQL } from 'drizzle-orm'
import type { Minor } from '#/lib/money'
import type { BudgetRow } from '#/server/db/schema'
import type { Budget, Transaction } from '#/server/db/types'
import type { TenantScope } from './base'
import type { ConversionContext, TransactionPolicies } from './transactions'

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Thrown when a caller uses the wrong membership mechanism for a budget's kind.
 *
 * Names the kind as well as the budget, because "cannot add a transaction to this budget" without
 * the reason sends somebody looking for a permissions problem that is not there.
 */
export class BudgetMembershipError extends ConflictError {
  readonly budgetId: string
  readonly kind: string

  constructor(budgetId: string, kind: string, attempted: string) {
    super(
      `Budget ${budgetId} is a ${kind} budget; ${attempted} is not how its membership is decided.`,
    )
    this.budgetId = budgetId
    this.kind = kind
  }
}

/** Thrown when a budget with closed periods is asked to be deleted rather than archived. */
export class BudgetHasHistoryError extends ConflictError {
  readonly budgetId: string
  readonly closedPeriods: number

  constructor(budgetId: string, closedPeriods: number) {
    super(
      `Budget ${budgetId} has ${closedPeriods} closed period(s) of history; archive it instead of deleting it.`,
    )
    this.budgetId = budgetId
    this.closedPeriods = closedPeriods
  }
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const idSchema = z.string().trim().min(1).max(64)
const nameSchema = z.string().trim().min(1).max(200)
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/u, { error: 'An ISO 4217 alphabetic code.' })

/**
 * The alert ladder: percentages, sorted, unique.
 *
 * The ceiling is 200 rather than 100 because *"tell me when I hit 150%"* is a real request from
 * somebody whose envelope routinely overruns and who wants one notification rather than a daily
 * one. The floor is 1: a threshold of 0 would fire on an empty budget every period.
 */
const thresholdsSchema = z
  .array(z.number().int().min(1).max(200))
  .min(1)
  .max(8)
  .transform((values) => [...new Set(values)].sort((a, b) => a - b))

export const listBudgetsSchema = z.strictObject({
  /** Archived budgets still hold history, so a screen asks for them explicitly. */
  status: z.enum(BUDGET_STATUSES).optional(),
  includeArchived: z.boolean().default(false),
})
export type ListBudgetsInput = z.input<typeof listBudgetsSchema>

/**
 * The create payload.
 *
 * `limitMinor` is `int().positive()`: an envelope of nothing is not a budget, and the schema's
 * `budgets_limit_minor_check` says the same thing from the other side.
 *
 * **`rolloverPolicy` defaults to `carry_surplus`, not to the column's `none`.** The column default
 * is what an older row gets; this is what a *person* gets, and the product decision is that money
 * left in an envelope belongs to the envelope. `carry_all` is offered and never assumed — a
 * negative opening balance is a thing to opt into.
 */
export const createBudgetSchema = z.strictObject({
  name: nameSchema,
  kind: z.enum(BUDGET_KINDS).default('category'),
  period: z.enum(BUDGET_PERIODS).default('monthly'),
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable().default(null),
  limitMinor: z.number().int().positive(),
  currencyCode: currencySchema,
  autoInclude: z.boolean().default(true),
  rolloverPolicy: z.enum(BUDGET_ROLLOVER_POLICIES).default('carry_surplus'),
  alertThresholds: thresholdsSchema.default([50, 80, 100]),
  /** Only meaningful for a `category` budget; a `manual` one is refused if it sends any. */
  categoryIds: z.array(idSchema).max(100).default([]),
})
export type CreateBudgetInput = z.input<typeof createBudgetSchema>

/**
 * The edit payload.
 *
 * `kind` is absent on purpose: changing a budget from `category` to `manual` would leave its
 * history counted by a mechanism that no longer applies, and the honest operation is a new budget.
 */
export const updateBudgetSchema = z
  .strictObject({
    name: nameSchema,
    status: z.enum(BUDGET_STATUSES),
    period: z.enum(BUDGET_PERIODS),
    endDate: z.iso.date().nullable(),
    limitMinor: z.number().int().positive(),
    autoInclude: z.boolean(),
    rolloverPolicy: z.enum(BUDGET_ROLLOVER_POLICIES),
    alertThresholds: thresholdsSchema,
  })
  .partial()
export type UpdateBudgetInput = z.input<typeof updateBudgetSchema>

export const setBudgetCategoriesSchema = z.strictObject({
  budgetId: idSchema,
  categoryIds: z.array(idSchema).max(100),
})
export type SetBudgetCategoriesInput = z.input<typeof setBudgetCategoriesSchema>

export const budgetTransactionsSchema = z.strictObject({
  budgetId: idSchema,
  transactionIds: z.array(idSchema).min(1).max(200),
})
export type BudgetTransactionsInput = z.input<typeof budgetTransactionsSchema>

/** The closed calendar range a spend figure is summed over. */
export const dateRangeSchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
})
export type DateRange = z.infer<typeof dateRangeSchema>

/* -------------------------------------------------------------------------- */
/* Returned shapes                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Brands a budget row's money column on the way out.
 *
 * The same check `toTransaction` makes, for the same reason: `#/server/db/types` claims a
 * repository hands out `Minor` rather than `number`, and a claim made by a cast is not a claim.
 */
export function toBudget(row: BudgetRow): Budget {
  return { ...row, limitMinor: asMinor(row.limitMinor) }
}

export type { Budget }

/** One category a budget follows, as the card's chip needs it. */
export interface BudgetCategoryRef {
  readonly budgetId: string
  readonly categoryId: string
  readonly name: string
  readonly color: string
}

/** A budget with its category set resolved — what the detail screen and the form both need. */
export interface BudgetWithCategories {
  readonly budget: Budget
  /** The categories the budget follows, as chosen. Children are covered but are not listed. */
  readonly categoryIds: ReadonlyArray<string>
}

/**
 * Spend over one range, with its terms kept apart.
 *
 * Returned as four figures rather than one because `docs/MONEY.md` §4.4 requires an aggregation to
 * say whether it is gross or net, and a screen that wants to explain *"1 240 zł spent, 80 zł came
 * back"* cannot recover the second number from the first.
 */
export interface BudgetSpend {
  /** Expenses inside the membership. The gross figure. */
  readonly grossMinor: Minor
  /** Income inside the membership — a refund filed under the same category lands here. */
  readonly creditedMinor: Minor
  /** Linked refunds booked **outside** the membership. Never double-counts `creditedMinor`. */
  readonly refundedMinor: Minor
  /** `gross − credited − refunded`. The number the meter reads and the period stores. */
  readonly spentMinor: Minor
}

/* -------------------------------------------------------------------------- */
/* Repository                                                                 */
/* -------------------------------------------------------------------------- */

const budgetRepo = createTenantRepository(budgets, 'budget')
const budgetCategoryAccess = createTenantTableAccess(
  budgetCategories,
  'budget category',
)
const budgetTransactionAccess = createTenantTableAccess(
  budgetTransactions,
  'budget transaction',
)

/**
 * What a budget counts.
 *
 * The same four decisions the dashboard donut makes, for the same reason: two surfaces that answer
 * *"what did I spend on groceries in March"* with different policy sets are two surfaces that print
 * different numbers beside each other.
 *
 * - **Planned rows are excluded.** A budget is about money that has moved.
 * - **Balance adjustments are excluded.** A correction is not spending; counting one would let a
 *   reconciliation eat somebody's grocery envelope.
 * - **Transfers are excluded**, both legs. Moving 500 zł from current to savings is not 500 zł of
 *   spending, and a budget that says it is, is the classic budgeting bug.
 */
const BUDGET_POLICIES: TransactionPolicies = {
  planned: 'exclude',
  adjustments: 'exclude',
  transfers: 'exclude',
  completeness: 'any',
}

/** The metered metric name. Archived budgets count, for the same reason archived accounts do. */
export const BUDGET_QUOTA_METRIC = 'budgets'

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The destructive writes need `owner | admin` — but only in a shared workspace.
 *
 * The same rule, and the same reasoning, as `repos/categories`: a solo workspace has one member
 * who is its owner, so a role gate there can only ever produce a bug report. The member count is
 * read live rather than taken from the session, because a claim minted before somebody was invited
 * is a claim about a workspace that no longer exists.
 */
export async function assertMayAdministerBudgets(
  scope: TenantScope,
  action: string,
): Promise<void> {
  if (scope.ctx.role === 'owner' || scope.ctx.role === 'admin') return
  const rows = await scope.db
    .select({ value: count() })
    .from(member)
    .where(tenantFilter(scope, member))
  if ((rows.at(0)?.value ?? 0) > 1) {
    throw new ForbiddenError(action, ['owner', 'admin'])
  }
}

/** Every id belongs to this workspace, or the call is a {@link NotFoundError}. */
async function requireOwnedCategories(
  scope: TenantScope,
  ids: ReadonlyArray<string>,
): Promise<void> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return
  const rows = await scope.db
    .select({ id: categories.id })
    .from(categories)
    .where(tenantFilter(scope, categories, inArray(categories.id, unique)))
  const found = new Set(rows.map((row) => row.id))
  const missing = unique.find((id) => !found.has(id))
  if (missing !== undefined) throw new NotFoundError('category', missing)
}

/** Same, for the transactions a `manual` budget is being handed. */
async function requireOwnedTransactions(
  scope: TenantScope,
  ids: ReadonlyArray<string>,
): Promise<void> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return
  const rows = await scope.db
    .select({ id: transactions.id })
    .from(transactions)
    .where(tenantFilter(scope, transactions, inArray(transactions.id, unique)))
  const found = new Set(rows.map((row) => row.id))
  const missing = unique.find((id) => !found.has(id))
  if (missing !== undefined) throw new NotFoundError('transaction', missing)
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Every budget in the workspace, newest first. Archived rows only when asked for. */
export async function listBudgets(
  scope: TenantScope,
  input: ListBudgetsInput = {},
): Promise<ReadonlyArray<Budget>> {
  const parsed = listBudgetsSchema.parse(input)
  const where =
    parsed.status !== undefined
      ? eq(budgets.status, parsed.status)
      : parsed.includeArchived
        ? undefined
        : not(eq(budgets.status, 'archived'))

  const rows = await budgetRepo.findMany(scope, {
    where,
    orderBy: [sql`${budgets.name} collate nocase asc`],
  })
  return rows.map(toBudget)
}

/** One budget, or {@link NotFoundError}. An id from another workspace is simply not found. */
export async function getBudget(
  scope: TenantScope,
  budgetId: string,
): Promise<Budget> {
  return toBudget(await budgetRepo.requireById(scope, idSchema.parse(budgetId)))
}

/** One budget with the category set it follows, in the order the picker shows them. */
export async function getBudgetWithCategories(
  scope: TenantScope,
  budgetId: string,
): Promise<BudgetWithCategories> {
  const budget = await getBudget(scope, budgetId)
  return { budget, categoryIds: await listBudgetCategoryIds(scope, budget.id) }
}

/**
 * Every `category` budget's chosen categories, with their name and colour, in **one** query.
 *
 * The list screen draws a chip per category on every card, and a per-budget read would be N+1
 * queries for a screen whose whole job is to render in one paint. Scoped on both tables: only
 * `(organization_id, id)` is unique by construction, and a category name is exactly the kind of
 * value that leaks legibly if the join's inner half is left open.
 */
export async function listBudgetCategoryRefs(
  scope: TenantScope,
): Promise<ReadonlyArray<BudgetCategoryRef>> {
  return scope.db
    .select({
      budgetId: budgetCategories.budgetId,
      categoryId: categories.id,
      name: categories.name,
      color: categories.color,
    })
    .from(budgetCategories)
    .innerJoin(
      categories,
      // Both halves of the join are scoped, and the inner half goes through `tenantFilter` like
      // every other predicate in this directory. Hand-rolling `eq(categories.organizationId, …)`
      // here would be correct today and one edit away from being a cross-tenant join tomorrow —
      // which is why `tenant-isolation.test.ts` reads the source for it rather than the behaviour.
      tenantFilter(
        scope,
        categories,
        eq(categories.id, budgetCategories.categoryId),
      ),
    )
    .where(tenantFilter(scope, budgetCategories))
    .orderBy(sql`${categories.name} collate nocase asc`)
}

/** The category ids a budget follows, as chosen. Empty for a `manual` budget. */
export async function listBudgetCategoryIds(
  scope: TenantScope,
  budgetId: string,
): Promise<ReadonlyArray<string>> {
  const rows = await budgetCategoryAccess.findMany(scope, {
    where: eq(budgetCategories.budgetId, budgetId),
  })
  return rows.map((row) => row.categoryId)
}

/** The transaction ids a `manual` budget holds. Empty for a `category` budget, by construction. */
export async function listBudgetTransactionIds(
  scope: TenantScope,
  budgetId: string,
): Promise<ReadonlyArray<string>> {
  const rows = await budgetTransactionAccess.findMany(scope, {
    where: eq(budgetTransactions.budgetId, budgetId),
  })
  return rows.map((row) => row.transactionId)
}

/**
 * Every category a `category` budget covers: the ones it names, **and their children**.
 *
 * The tree is two deep by construction, so this is one extra query and never a walk. Covering the
 * children is what makes a budget on *Food* behave the way a reader expects when they later file a
 * receipt under *Food → Groceries*; the alternative — an envelope that silently stops counting the
 * moment somebody adds a subcategory — is a bug report waiting to be written.
 */
export async function coveredCategoryIds(
  scope: TenantScope,
  budgetId: string,
): Promise<ReadonlyArray<string>> {
  const chosen = await listBudgetCategoryIds(scope, budgetId)
  if (chosen.length === 0) return []

  const children = await scope.db
    .select({ id: categories.id })
    .from(categories)
    .where(
      tenantFilter(
        scope,
        categories,
        inArray(categories.parentId, [...chosen]),
      ),
    )
  return [...new Set([...chosen, ...children.map((row) => row.id)])]
}

/* -------------------------------------------------------------------------- */
/* Spend                                                                       */
/* -------------------------------------------------------------------------- */

/** `1` when the transaction sits on an account the workspace keeps out of its statistics. */
function onAnExcludedAccount(scope: TenantScope): SQL {
  return exists(
    scope.db
      .select({ present: sql`1` })
      .from(accounts)
      .where(
        tenantFilter(
          scope,
          accounts,
          eq(accounts.id, transactions.accountId),
          eq(accounts.excludeFromStats, true),
        ),
      ),
  )
}

/** `1` when the transaction has split lines, which is what moves it off the parent's category. */
function hasSplits(scope: TenantScope): SQL {
  return exists(
    scope.db
      .select({ present: sql`1` })
      .from(transactionSplits)
      .where(
        tenantFilter(
          scope,
          transactionSplits,
          eq(transactionSplits.transactionId, transactions.id),
        ),
      ),
  )
}

/**
 * The membership predicate on `transactions`, one kind at a time.
 *
 * A `category` budget matches the parent's own `category_id`; the split half of the membership is
 * summed separately, in {@link sumSplitLines}, because it lives on another table. A `manual`
 * budget matches the join row and nothing else.
 */
function membershipPredicate(
  scope: TenantScope,
  budget: Budget,
  covered: ReadonlyArray<string>,
): SQL {
  if (budget.kind === 'manual') {
    return exists(
      scope.db
        .select({ present: sql`1` })
        .from(budgetTransactions)
        .where(
          tenantFilter(
            scope,
            budgetTransactions,
            eq(budgetTransactions.budgetId, budget.id),
            eq(budgetTransactions.transactionId, transactions.id),
          ),
        ),
    )
  }
  return inArray(transactions.categoryId, [...covered])
}

/** The shared exclusions: a row the workspace keeps out of statistics is out of its budgets too. */
function statisticalExclusions(scope: TenantScope): Array<SQL> {
  return [
    eq(transactions.excludeFromStats, false),
    not(onAnExcludedAccount(scope)),
  ]
}

/** `SUM(ref_amount_minor)` over parent rows in one direction, splits excluded. */
async function sumParentRows(
  scope: TenantScope,
  budget: Budget,
  covered: ReadonlyArray<string>,
  range: DateRange,
  direction: 'income' | 'expense',
): Promise<Minor> {
  const rows = await scope.db
    .select({
      total: sql<number>`coalesce(sum(${transactions.refAmountMinor}), 0)`,
    })
    .from(transactions)
    .where(
      scopedTransactionFilter(
        scope,
        BUDGET_POLICIES,
        eq(transactions.direction, direction),
        membershipPredicate(scope, budget, covered),
        ...statisticalExclusions(scope),
        gte(transactions.bookedOn, range.from),
        lte(transactions.bookedOn, range.to),
        // A split receipt is counted line by line, so its parent must not also be counted whole.
        budget.kind === 'category' ? not(hasSplits(scope)) : undefined,
      ),
    )
  return asMinor(Number(rows.at(0)?.total ?? 0))
}

/**
 * `SUM(ref_amount_minor)` over the **split lines** filed in a covered category.
 *
 * This is the half of `11-S1` a budget has to understand: a 300 zł supermarket receipt split
 * 200 zł *Groceries* / 100 zł *Household* contributes 200 zł to the groceries envelope and 100 zł
 * to the household one, and the two contributions sum to the parent's `ref_amount_minor` exactly
 * because the split rows were written to. Nothing here divides, so nothing here can round.
 *
 * `manual` budgets skip it: a person who put a transaction in an envelope by hand put the whole
 * transaction in, and reading its split lines would count part of it a second time.
 */
async function sumSplitLines(
  scope: TenantScope,
  budget: Budget,
  covered: ReadonlyArray<string>,
  range: DateRange,
  direction: 'income' | 'expense',
): Promise<Minor> {
  if (budget.kind !== 'category' || covered.length === 0) return ZERO_MINOR

  const parentQualifies = exists(
    scope.db
      .select({ present: sql`1` })
      .from(transactions)
      .where(
        scopedTransactionFilter(
          scope,
          BUDGET_POLICIES,
          eq(transactions.id, transactionSplits.transactionId),
          eq(transactions.direction, direction),
          ...statisticalExclusions(scope),
          gte(transactions.bookedOn, range.from),
          lte(transactions.bookedOn, range.to),
        ),
      ),
  )

  const rows = await scope.db
    .select({
      total: sql<number>`coalesce(sum(${transactionSplits.refAmountMinor}), 0)`,
    })
    .from(transactionSplits)
    .where(
      tenantFilter(
        scope,
        transactionSplits,
        inArray(transactionSplits.categoryId, [...covered]),
        parentQualifies,
      ),
    )
  return asMinor(Number(rows.at(0)?.total ?? 0))
}

/**
 * Linked refunds of this budget's transactions that were **booked outside** the budget.
 *
 * The guard is the whole point. A refund filed under the same category as the purchase is already
 * subtracted as a credit by {@link sumParentRows}; subtracting it again here would give somebody
 * back twice what the shop gave them back once. So this term counts only refund rows whose own
 * transaction is *not* a member, and `__tests__/money-invariants.test.ts` pins both halves.
 *
 * The amount taken is the refund **transaction's** `ref_amount_minor` — already in the base
 * currency, already fixed at its own `booked_on` rate. `refunds.amount_minor` is denominated in
 * the refund's own currency and carries no stored conversion, so re-converting it at read time
 * would recompute a historical amount, which `docs/MONEY.md` §3.1 forbids outright.
 */
async function sumExternalRefunds(
  scope: TenantScope,
  budget: Budget,
  covered: ReadonlyArray<string>,
  range: DateRange,
): Promise<Minor> {
  const memberIds = scope.db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      tenantFilter(
        scope,
        transactions,
        membershipPredicate(scope, budget, covered),
      ),
    )

  const linkedToAMember = exists(
    scope.db
      .select({ present: sql`1` })
      .from(refunds)
      .where(
        tenantFilter(
          scope,
          refunds,
          eq(refunds.refundTransactionId, transactions.id),
          inArray(refunds.originalTransactionId, memberIds),
        ),
      ),
  )

  const rows = await scope.db
    .select({
      total: sql<number>`coalesce(sum(${transactions.refAmountMinor}), 0)`,
    })
    .from(transactions)
    .where(
      scopedTransactionFilter(
        scope,
        BUDGET_POLICIES,
        eq(transactions.direction, 'income'),
        ...statisticalExclusions(scope),
        gte(transactions.bookedOn, range.from),
        lte(transactions.bookedOn, range.to),
        not(membershipPredicate(scope, budget, covered)),
        linkedToAMember,
      ),
    )
  return asMinor(Number(rows.at(0)?.total ?? 0))
}

/**
 * What one budget spent over one closed calendar range, net of refunds.
 *
 * Four integer `SUM`s and two subtractions. No JavaScript reduction over rows, no division, no
 * conversion — the figure this returns is the one `budget_periods.spent_minor` stores when a
 * period closes, produced by this function and no other, which is what stops the stored number and
 * the displayed number from being computed two different ways.
 */
export async function budgetSpend(
  scope: TenantScope,
  budget: Budget,
  range: DateRange,
): Promise<BudgetSpend> {
  const parsedRange = dateRangeSchema.parse(range)
  const covered =
    budget.kind === 'category' ? await coveredCategoryIds(scope, budget.id) : []

  if (budget.kind === 'category' && covered.length === 0) {
    // A category budget that follows nothing spends nothing. Said explicitly rather than left to
    // `inArray([])`, whose SQL is `false` and would work by accident.
    return {
      grossMinor: ZERO_MINOR,
      creditedMinor: ZERO_MINOR,
      refundedMinor: ZERO_MINOR,
      spentMinor: ZERO_MINOR,
    }
  }

  const [
    grossParents,
    grossSplits,
    creditParents,
    creditSplits,
    refundedMinor,
  ] = await Promise.all([
    sumParentRows(scope, budget, covered, parsedRange, 'expense'),
    sumSplitLines(scope, budget, covered, parsedRange, 'expense'),
    sumParentRows(scope, budget, covered, parsedRange, 'income'),
    sumSplitLines(scope, budget, covered, parsedRange, 'income'),
    sumExternalRefunds(scope, budget, covered, parsedRange),
  ])

  const grossMinor = asMinor(grossParents + grossSplits)
  const creditedMinor = asMinor(creditParents + creditSplits)

  return {
    grossMinor,
    creditedMinor,
    refundedMinor,
    spentMinor: asMinor(grossMinor - creditedMinor - refundedMinor),
  }
}

/**
 * The transactions this budget counted over one range, newest first.
 *
 * The **same** membership predicate the sums use, so the list a person scrolls and the figure
 * above it cannot disagree about what is in the envelope. Split receipts appear as their parent
 * row: a reader looking for "what did I buy" wants the shop, not the two lines it was cut into,
 * and the amount beside each row is the parent's, with the split breakdown a click away on the
 * transaction itself.
 */
export async function listBudgetPeriodTransactions(
  scope: TenantScope,
  budget: Budget,
  range: DateRange,
  limit = 50,
): Promise<ReadonlyArray<Transaction>> {
  const parsedRange = dateRangeSchema.parse(range)
  const covered =
    budget.kind === 'category' ? await coveredCategoryIds(scope, budget.id) : []
  if (budget.kind === 'category' && covered.length === 0) return []

  const inASplit = exists(
    scope.db
      .select({ present: sql`1` })
      .from(transactionSplits)
      .where(
        tenantFilter(
          scope,
          transactionSplits,
          eq(transactionSplits.transactionId, transactions.id),
          inArray(transactionSplits.categoryId, [...covered]),
        ),
      ),
  )

  const membership =
    budget.kind === 'category'
      ? (or(membershipPredicate(scope, budget, covered), inASplit) as SQL)
      : membershipPredicate(scope, budget, covered)

  const rows = await scope.db
    .select()
    .from(transactions)
    .where(
      scopedTransactionFilter(
        scope,
        BUDGET_POLICIES,
        membership,
        ...statisticalExclusions(scope),
        gte(transactions.bookedOn, parsedRange.from),
        lte(transactions.bookedOn, parsedRange.to),
      ),
    )
    .orderBy(desc(transactions.bookedOn), desc(transactions.bookedAt))
    .limit(Math.min(Math.max(limit, 1), 200))

  return rows.map(toTransaction)
}

/**
 * The budget's limit expressed in the workspace base currency, or `null` when no rate exists.
 *
 * Converted **once**, at the period's first day, and only when the two currencies differ — the
 * identity case short-circuits before any resolver is consulted, so a same-currency budget gets
 * its own integer back with no arithmetic at all. The individual transactions are *never*
 * converted a second time: they already carry `ref_amount_minor`.
 *
 * `null` rather than a throw, because a missing rate must not take a whole list screen down. The
 * budget renders with an em dash where its utilisation would be — which is the honest reading, and
 * is not `0%`, which would say "nothing spent".
 */
export async function limitInBaseMinor(
  input: {
    readonly limitMinor: Minor
    readonly currencyCode: string
    readonly onDate: string
  },
  conversion: ConversionContext,
): Promise<Minor | null> {
  if (input.currencyCode === conversion.baseCurrencyCode)
    return input.limitMinor
  try {
    const converted = await computeRefAmount(
      {
        amountMinor: input.limitMinor,
        currencyCode: asCurrencyCode(input.currencyCode),
        bookedOn: input.onDate,
      },
      conversion,
    )
    return converted.refAmountMinor
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Creates a budget, and its category set in the same call.
 *
 * The quota check runs **inside the repository, before the insert**, with the count the workspace
 * would end up at. A check in a server function is one call site away from being skipped, and
 * skipped is silent. Archived budgets are counted, for the same reason archived accounts are: the
 * row is still there, still holds history, and still costs storage.
 */
export async function createBudget(
  scope: TenantScope,
  input: CreateBudgetInput,
): Promise<Budget> {
  const parsed = createBudgetSchema.parse(input)

  if (parsed.kind === 'manual' && parsed.categoryIds.length > 0) {
    throw new BudgetMembershipError(
      '(new)',
      'manual',
      'following a set of categories',
    )
  }
  if (parsed.endDate !== null && parsed.endDate < parsed.startDate) {
    throw new ConflictError('A budget cannot end before it starts.')
  }
  await requireOwnedCategories(scope, parsed.categoryIds)

  const current = await budgetRepo.count(scope)
  await assertWithinLimit(scope, BUDGET_QUOTA_METRIC, current + 1)

  const now = new Date()
  const created = await budgetRepo.insert(scope, {
    id: newId(),
    name: parsed.name,
    kind: parsed.kind,
    status: 'active',
    period: parsed.period,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    limitMinor: parsed.limitMinor,
    currencyCode: parsed.currencyCode,
    autoInclude: parsed.autoInclude,
    rolloverPolicy: parsed.rolloverPolicy,
    alertThresholds: JSON.stringify(parsed.alertThresholds),
    createdAt: now,
    updatedAt: now,
  })
  const budget = toBudget(created)

  if (parsed.categoryIds.length > 0) {
    await budgetCategoryAccess.insertMany(
      scope,
      [...new Set(parsed.categoryIds)].map((categoryId) => ({
        budgetId: budget.id,
        categoryId,
      })),
    )
  }

  return budget
}

/**
 * Edits a budget.
 *
 * **Editing `limit_minor` does not rewrite a single period.** `budget_periods.limit_minor` is the
 * limit *as it was*, and a closed period's copy of it is frozen; the new figure reaches the open
 * period through {@link import('./budget-periods').recomputeOpenPeriod} and every period after it
 * through materialisation. That is the whole reason the column is duplicated onto the period row.
 */
export async function updateBudget(
  scope: TenantScope,
  budgetId: string,
  input: UpdateBudgetInput,
): Promise<Budget> {
  const id = idSchema.parse(budgetId)
  const parsed = updateBudgetSchema.parse(input)
  const existing = await budgetRepo.requireById(scope, id)

  const endDate =
    parsed.endDate === undefined ? existing.endDate : parsed.endDate
  if (endDate !== null && endDate < existing.startDate) {
    throw new ConflictError('A budget cannot end before it starts.')
  }

  return toBudget(
    await budgetRepo.requireUpdate(scope, id, {
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(parsed.status === undefined ? {} : { status: parsed.status }),
      ...(parsed.period === undefined ? {} : { period: parsed.period }),
      ...(parsed.endDate === undefined ? {} : { endDate: parsed.endDate }),
      ...(parsed.limitMinor === undefined
        ? {}
        : { limitMinor: parsed.limitMinor }),
      ...(parsed.autoInclude === undefined
        ? {}
        : { autoInclude: parsed.autoInclude }),
      ...(parsed.rolloverPolicy === undefined
        ? {}
        : { rolloverPolicy: parsed.rolloverPolicy }),
      ...(parsed.alertThresholds === undefined
        ? {}
        : { alertThresholds: JSON.stringify(parsed.alertThresholds) }),
      updatedAt: new Date(),
    }),
  )
}

/** Takes a budget out of the list without losing a period of its history. Reversible. */
export async function archiveBudget(
  scope: TenantScope,
  budgetId: string,
): Promise<Budget> {
  const id = idSchema.parse(budgetId)
  await assertMayAdministerBudgets(scope, 'archive a budget')
  return toBudget(
    await budgetRepo.requireUpdate(scope, id, {
      status: 'archived',
      updatedAt: new Date(),
    }),
  )
}

/** Puts an archived budget back in the list, active. */
export async function restoreBudget(
  scope: TenantScope,
  budgetId: string,
): Promise<Budget> {
  const id = idSchema.parse(budgetId)
  await assertMayAdministerBudgets(scope, 'restore a budget')
  return toBudget(
    await budgetRepo.requireUpdate(scope, id, {
      status: 'active',
      updatedAt: new Date(),
    }),
  )
}

/**
 * Deletes a budget that never closed a period.
 *
 * Refuses — with the count — once there is closed history, and offers archiving instead. The
 * reasoning is `repos/categories`' delete refusal applied to a different table: a closed period is
 * a number somebody read and acted on, and deleting the budget deletes the record of it.
 */
export async function deleteBudget(
  scope: TenantScope,
  budgetId: string,
): Promise<void> {
  const id = idSchema.parse(budgetId)
  await assertMayAdministerBudgets(scope, 'delete a budget')
  await budgetRepo.requireById(scope, id)

  const closed = await countClosedPeriods(scope, id)
  if (closed > 0) throw new BudgetHasHistoryError(id, closed)

  await budgetRepo.requireRemove(scope, id)
}

/**
 * How many of this budget's periods are closed.
 *
 * Read here rather than through `./budget-periods` so the two modules stay acyclic: the periods
 * repository needs the budget's calendar, and a budget's delete needs the periods' count.
 */
async function countClosedPeriods(
  scope: TenantScope,
  budgetId: string,
): Promise<number> {
  const rows = await scope.db
    .select({ value: count() })
    .from(budgetPeriodsTable)
    .where(
      tenantFilter(
        scope,
        budgetPeriodsTable,
        eq(budgetPeriodsTable.budgetId, budgetId),
        not(isNull(budgetPeriodsTable.closedAt)),
      ),
    )
  return rows.at(0)?.value ?? 0
}

/**
 * Replaces a `category` budget's category set wholesale.
 *
 * Wholesale rather than add/remove, because the screen is a multi-select and "what it shows is
 * what it is" is the only contract a multi-select can keep. Refuses a `manual` budget: its
 * membership is `budget_transactions` and nothing else.
 */
export async function setBudgetCategories(
  scope: TenantScope,
  input: SetBudgetCategoriesInput,
): Promise<ReadonlyArray<string>> {
  const parsed = setBudgetCategoriesSchema.parse(input)
  const budget = await budgetRepo.requireById(scope, parsed.budgetId)
  if (budget.kind !== 'category') {
    throw new BudgetMembershipError(
      budget.id,
      budget.kind,
      'following a set of categories',
    )
  }
  await requireOwnedCategories(scope, parsed.categoryIds)

  const wanted = [...new Set(parsed.categoryIds)]
  await budgetCategoryAccess.removeWhere(
    scope,
    eq(budgetCategories.budgetId, budget.id),
  )
  if (wanted.length > 0) {
    await budgetCategoryAccess.insertMany(
      scope,
      wanted.map((categoryId) => ({ budgetId: budget.id, categoryId })),
    )
  }
  return wanted
}

/**
 * Puts transactions into a `manual` budget.
 *
 * Refuses a `category` budget outright — see rule 1 in the module docblock. Re-adding a row the
 * budget already holds is a no-op rather than a conflict: the operation is *"these are in the
 * envelope"*, and a multi-select that fails because one of its rows was already selected is a
 * multi-select nobody can use.
 */
export async function addBudgetTransactions(
  scope: TenantScope,
  input: BudgetTransactionsInput,
): Promise<number> {
  const parsed = budgetTransactionsSchema.parse(input)
  const budget = await budgetRepo.requireById(scope, parsed.budgetId)
  if (budget.kind !== 'manual') {
    throw new BudgetMembershipError(
      budget.id,
      budget.kind,
      'adding transactions by hand',
    )
  }
  await requireOwnedTransactions(scope, parsed.transactionIds)

  const already = new Set(await listBudgetTransactionIds(scope, budget.id))
  const fresh = [...new Set(parsed.transactionIds)].filter(
    (transactionId) => !already.has(transactionId),
  )
  if (fresh.length === 0) return 0

  await budgetTransactionAccess.insertMany(
    scope,
    fresh.map((transactionId) => ({
      budgetId: budget.id,
      transactionId,
      addedByUserId: scope.ctx.userId,
      createdAt: new Date(),
    })),
  )
  return fresh.length
}

/** Takes transactions back out of a `manual` budget. Returns how many rows went. */
export async function removeBudgetTransactions(
  scope: TenantScope,
  input: BudgetTransactionsInput,
): Promise<number> {
  const parsed = budgetTransactionsSchema.parse(input)
  const budget = await budgetRepo.requireById(scope, parsed.budgetId)
  if (budget.kind !== 'manual') {
    throw new BudgetMembershipError(
      budget.id,
      budget.kind,
      'adding transactions by hand',
    )
  }

  return budgetTransactionAccess.removeWhere(
    scope,
    and(
      eq(budgetTransactions.budgetId, budget.id),
      inArray(budgetTransactions.transactionId, [
        ...new Set(parsed.transactionIds),
      ]),
    ) as SQL,
  )
}
